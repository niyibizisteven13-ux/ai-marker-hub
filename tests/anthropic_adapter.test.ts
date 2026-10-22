import test from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicAdapter, toAnthropicMessages } from '../server/services/ai/providers/anthropicAdapter.js';
import { ReliableProviderAdapter } from '../server/services/ai/providers/reliableAdapter.js';
import { ProviderMetrics } from '../server/services/ai/observability/providerMetrics.js';
import { isRetryable, type ProviderAdapter, type ProviderChunk } from '../server/services/ai/providers/types.js';
import { loadClaudeAgentConfig } from '../server/services/ai/router/agentProvider.js';
import { AgentRuntime } from '../server/services/ai/AgentRuntime.js';
import { ToolRegistry } from '../server/services/ai/tools/registry.js';
import { describeChatFailure } from '../server/services/ai/chatFailure.js';

type Final = Omit<Partial<Anthropic.Message>, 'content' | 'stop_details'> & { content: any[]; stop_details?: unknown };

/** Fake SDK client: each stream() call replays scripted deltas and a final message, or throws. */
function fakeClient(script: Array<{ deltas?: string[]; final?: Final; error?: unknown }>) {
  const calls: any[] = [];
  return {
    calls,
    client: {
      messages: {
        stream(params: any) {
          calls.push(params);
          const step = script.shift()!;
          return {
            async *[Symbol.asyncIterator]() {
              if (step.error) throw step.error;
              for (const t of step.deltas ?? []) yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } };
            },
            async finalMessage() {
              if (step.error) throw step.error;
              return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 90 }, ...step.final };
            },
          };
        },
      },
    } as unknown as Pick<Anthropic, 'messages'>,
  };
}

async function collect(gen: AsyncGenerator<ProviderChunk>) {
  const out: ProviderChunk[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

test('message conversion: system extracted, tool results merged into one user turn, images first, Claude blocks replayed unchanged', () => {
  const thinking = { type: 'thinking', thinking: '', signature: 'sig-abc' };
  const toolUse = { type: 'tool_use', id: 'tu_1', name: 'search_knowledge', input: { query: 'x' } };
  const { system, messages } = toAnthropicMessages([
    { role: 'system', content: 'You are Bwenge.' },
    { role: 'user', content: [{ type: 'text', text: 'What is this?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
    { role: 'assistant', content: null, tool_calls: [{ id: 'tu_1', type: 'function', function: { name: 'search_knowledge', arguments: '{"query":"x"}' } }], providerState: { provider: 'anthropic', content: [thinking, toolUse] } },
    { role: 'tool', tool_call_id: 'tu_1', name: 'search_knowledge', content: 'result A' },
    { role: 'tool', tool_call_id: 'tu_2', name: 'other', content: 'result B' },
    { role: 'assistant', content: 'Gonka answer', tool_calls: [{ id: 'c9', type: 'function', function: { name: 'calc', arguments: 'not json' } }] },
  ]);
  assert.equal(system, 'You are Bwenge.');
  assert.equal((messages[0].content as any[])[0].type, 'image');
  assert.deepEqual(messages[1].content, [thinking, toolUse], 'thinking block passed back unmodified');
  assert.equal(messages[2].role, 'user');
  assert.deepEqual((messages[2].content as any[]).map((b) => b.tool_use_id), ['tu_1', 'tu_2']);
  assert.deepEqual((messages[3].content as any[])[1], { type: 'tool_use', id: 'c9', name: 'calc', input: {} });
});

test('stream: text deltas, usage incl. cache reads, request has effort, caching and no sampling params', async () => {
  const { client, calls } = fakeClient([{ deltas: ['Mura', 'ho'], final: { content: [{ type: 'text', text: 'Muraho' }] } }]);
  const a = new AnthropicAdapter({ client, effort: 'low' });
  const out = await collect(a.stream({ model: 'claude-haiku-5-5', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }], temperature: 0.3, maxTokens: 500 }));
  assert.deepEqual(out.filter((c) => c.type === 'text').map((c: any) => c.text), ['Mura', 'ho']);
  assert.deepEqual(out.find((c) => c.type === 'usage'), { type: 'usage', input: 100, output: 5 });
  const p = calls[0];
  assert.equal(p.model, 'claude-haiku-5-5');
  assert.equal(p.max_tokens, 500);
  assert.equal(p.system, 'sys');
  assert.deepEqual(p.output_config, { effort: 'low' });
  assert.deepEqual(p.cache_control, { type: 'ephemeral' });
  assert.equal('temperature' in p, false);
  assert.equal('top_p' in p, false);
});

test('stream: tool calls are emitted with provider_state; structured output uses output_config.format', async () => {
  const content = [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 'tu_9', name: 'calc', input: { expr: '2+2' } }];
  const { client, calls } = fakeClient([{ final: { content, stop_reason: 'tool_use' } }]);
  const out = await collect(new AnthropicAdapter({ client }).stream({ model: 'm', messages: [{ role: 'user', content: 'x' }], tools: [{ name: 'calc', description: 'd', parameters: { type: 'object' } }], responseSchema: { type: 'object' } }));
  assert.deepEqual(out.find((c) => c.type === 'provider_state'), { type: 'provider_state', provider: 'anthropic', content });
  assert.deepEqual(out.find((c) => c.type === 'tool_call'), { type: 'tool_call', index: 0, id: 'tu_9', name: 'calc', args: '{"expr":"2+2"}' });
  assert.deepEqual(calls[0].tools, [{ name: 'calc', description: 'd', input_schema: { type: 'object' } }]);
  assert.deepEqual(calls[0].tool_choice, { type: 'auto' });
  assert.deepEqual(calls[0].output_config.format, { type: 'json_schema', schema: { type: 'object' } });
});

test('a tool call cut off by max_tokens is never emitted', async () => {
  const { client } = fakeClient([{ final: { content: [{ type: 'tool_use', id: 't', name: 'calc', input: { expr: '2+' } }], stop_reason: 'max_tokens' } }]);
  const out = await collect(new AnthropicAdapter({ client }).stream({ model: 'm', messages: [{ role: 'user', content: 'x' }] }));
  assert.equal(out.some((c) => c.type === 'tool_call'), false);
  assert.deepEqual(out.at(-1), { type: 'finish', reason: 'length' });
});

test('a refusal is final: not retried, no fallback, clear category', async () => {
  const { client, calls } = fakeClient([{ final: { content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null } as any } }]);
  const gonkaCalls: string[] = [];
  const gonka: ProviderAdapter = { name: 'gonka', async *stream(req) { gonkaCalls.push(req.model); yield { type: 'text', text: 'x' }; } };
  const reliable = new ReliableProviderAdapter({ primary: new AnthropicAdapter({ client }), fallbackAdapter: gonka, fallbackModel: 'gonka/std', metrics: new ProviderMetrics(), sleep: async () => {} });
  await assert.rejects(collect(reliable.stream({ model: 'claude-haiku-5-5', messages: [{ role: 'user', content: 'x' }] })), (e: any) => {
    assert.equal(e.category, 'CONTENT_REFUSED');
    assert.equal(isRetryable(e), false);
    assert.equal(describeChatFailure(e).category, 'CONTENT_REFUSED');
    return true;
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(gonkaCalls, []);
});

test('API errors map to provider errors: 429 honours retry-after, 401 is auth, timeouts keep their kind', async () => {
  const headers = new Headers({ 'retry-after': '7' });
  const rate = new Anthropic.RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } } as any, 'rate', headers);
  const { client } = fakeClient([{ error: rate }]);
  await assert.rejects(collect(new AnthropicAdapter({ client }).stream({ model: 'm', messages: [{ role: 'user', content: 'x' }] })), (e: any) => {
    assert.equal(e.status, 429);
    assert.equal(e.retryAfterMs, 7000);
    assert.match(e.upstreamMessage, /rate_limit_error slow down/);
    return true;
  });
  const timeout = fakeClient([{ error: new Anthropic.APIConnectionTimeoutError() }]);
  await assert.rejects(collect(new AnthropicAdapter({ client: timeout.client }).stream({ model: 'm', messages: [{ role: 'user', content: 'x' }] })), (e: any) => e.timeout === true && e.timeoutKind === 'request');
});

test('transient Claude failure falls back to Gonka when configured', async () => {
  const overloaded = new Anthropic.InternalServerError(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } as any, 'overloaded', new Headers());
  const { client } = fakeClient([{ error: overloaded }, { error: overloaded }]);
  const gonka: ProviderAdapter = { name: 'gonka', async *stream(req) { yield { type: 'text', text: `gonka:${req.model}` }; } };
  const reliable = new ReliableProviderAdapter({ primary: new AnthropicAdapter({ client }), maxAttempts: 2, fallbackAdapter: gonka, fallbackModel: 'gonka/std', metrics: new ProviderMetrics(), sleep: async () => {} });
  const out = await collect(reliable.stream({ model: 'claude-haiku-5-5', messages: [{ role: 'user', content: 'x' }] }));
  assert.deepEqual(out, [{ type: 'text', text: 'gonka:gonka/std' }]);
});

test('agent loop on Claude: thinking/tool blocks from turn 1 are replayed on turn 2', async () => {
  const turn1 = [{ type: 'thinking', thinking: '', signature: 'sig1' }, { type: 'tool_use', id: 'tu_1', name: 'echo', input: { v: 'hi' } }];
  const { client, calls } = fakeClient([
    { final: { content: turn1, stop_reason: 'tool_use' } },
    { deltas: ['done'], final: { content: [{ type: 'text', text: 'done' }] } },
  ]);
  const tools = new ToolRegistry([{ definition: { name: 'echo', description: 'echo', parameters: { type: 'object', properties: { v: { type: 'string' } } } }, async execute(input: any) { return { text: `echo ${input.v}` }; } } as any]);
  const runtime = new AgentRuntime(new AnthropicAdapter({ client }), tools, { maxRetries: 0 });
  const r = await runtime.run({ system: 's', messages: [{ role: 'user', content: 'go' }], ctx: { userId: 'u', files: {} as any, services: {} }, model: 'claude-haiku-5-5' });
  assert.equal(r.text, 'done');
  assert.deepEqual(calls[1].messages[1], { role: 'assistant', content: turn1 });
  assert.deepEqual(calls[1].messages[2].content[0], { type: 'tool_result', tool_use_id: 'tu_1', content: 'echo hi' });
});

test('Claude agent config is opt-in and validated', () => {
  assert.equal(loadClaudeAgentConfig({}).config, null);
  assert.match(loadClaudeAgentConfig({ AI_AGENT_PROVIDER: 'anthropic' }).reason, /ANTHROPIC_API_KEY is not set/);
  const c = loadClaudeAgentConfig({ AI_AGENT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }).config!;
  assert.deepEqual([c.model, c.effort, c.fallbackToGonka], ['claude-haiku-5-5', 'medium', true]);
  const d = loadClaudeAgentConfig({ AI_AGENT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', CLAUDE_EFFORT: 'turbo', CLAUDE_FALLBACK_TO_GONKA: 'false' });
  assert.equal(d.config!.effort, 'medium');
  assert.match(d.reason, /invalid/);
  assert.equal(d.config!.fallbackToGonka, false);
  assert.equal(loadClaudeAgentConfig({ AI_AGENT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', CLAUDE_AGENT_MODEL: 'bad model!' }).config, null);
});
