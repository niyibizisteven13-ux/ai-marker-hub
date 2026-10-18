import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FileStore } from '../server/services/ai/files/FileStore.js';
import { createAiAgent } from '../server/services/ai/createAiAgent.js';
import type { ProviderAdapter, ProviderChunk, ProviderRequest } from '../server/services/ai/providers/types.js';
import type { AgentTraceRecord } from '../server/services/ai/types.js';

function makeAdapter(stream: (turn: number, request: ProviderRequest) => ProviderChunk[]): ProviderAdapter {
  let turn = 0;
  return {
    name: 'test-provider',
    async *stream(request) {
      yield* stream(turn++, request);
    },
  };
}

test('agent traces retain operational metadata without request or tool content', async () => {
  const traces: AgentTraceRecord[] = [];
  const privatePrompt = 'Synthetic learner Ada Example needs a test answer.';
  let requestedMaxTokens: number | undefined;
  const adapter = makeAdapter((turn, request) => {
    requestedMaxTokens = request.maxTokens;
    return turn === 0
      ? [{ type: 'tool_call', index: 0, id: 'call-1', name: 'search_knowledge', args: '{"query":"Ada Example grades"}' }]
      : [
        { type: 'text', text: 'I found the requested information.' },
        { type: 'usage', input: 12, output: 8 },
      ];
  });
  const agent = createAiAgent({
    provider: adapter,
    model: 'test-model',
    files: new FileStore({ dir: '/tmp/ai-trace-test-files', secret: 'test-secret-at-least-16' }),
    promptVersion: 'test-v1',
    writeTrace: async (trace) => { traces.push(trace); },
    services: {
      knowledge: {
        async search() {
          return [{ title: 'Synthetic source', text: 'Synthetic information only.' }];
        },
      },
    },
  });

  const result = await agent.run({
    userId: 'synthetic-user-id',
    chatId: 'synthetic-chat-id',
    system: 'Test system instructions',
    prompt: privatePrompt,
    maxTokens: 2048,
  });

  assert.equal(result.text, 'I found the requested information.');
  assert.equal(traces.length, 1);
  assert.equal(traces[0].capability, 'A');
  assert.equal(traces[0].provider, 'test-provider');
  assert.equal(traces[0].model, 'test-model');
  assert.equal(traces[0].promptVersion, 'test-v1');
  assert.equal(traces[0].tokensIn, 12);
  assert.equal(traces[0].tokensOut, 8);
  assert.equal(requestedMaxTokens, 2048);
  assert.equal(traces[0].toolCalls.length, 1);
  assert.equal(traces[0].toolCalls[0].name, 'search_knowledge');
  assert.equal(traces[0].toolCalls[0].ok, true);
  assert.equal(traces[0].toolCalls[0].argsValid, true);
  assert.notEqual(traces[0].userIdHash, 'synthetic-user-id');
  assert.notEqual(traces[0].chatIdHash, 'synthetic-chat-id');
  assert.equal(JSON.stringify(traces[0]).includes(privatePrompt), false);
  assert.equal(JSON.stringify(traces[0]).includes('Ada Example grades'), false);
});
