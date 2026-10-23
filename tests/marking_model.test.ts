import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// Examination marking can run on a larger Claude model (CLAUDE_MARKING_MODEL) with its own effort, while
// everyday agent tasks stay on the agent model. A local fake Claude records which model and effort each call used.

const requests: any[] = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (!req.url?.endsWith('/messages')) { res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":{"message":"stub"}}'); return; }
    const parsed = JSON.parse(body);
    requests.push(parsed);
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    send('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: parsed.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } } });
    send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } });
    send('content_block_stop', { type: 'content_block_stop', index: 0 });
    send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
    send('message_stop', { type: 'message_stop' });
    res.end();
  });
}).listen(0);
await new Promise((r) => fake.once('listening', r));
const base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
Object.assign(process.env, {
  AI_PROVIDER: 'gonkarouter', AI_AGENT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: base,
  CLAUDE_AGENT_MODEL: 'claude-haiku-5-5', CLAUDE_EFFORT: 'medium', CLAUDE_MARKING_MODEL: 'claude-opus-5-5', CLAUDE_MARKING_EFFORT: 'high',
  CLAUDE_FALLBACK_TO_GONKA: 'false', AI_MAX_ATTEMPTS: '1', GONKA_API_KEY: 'test-gonka', GONKA_BASE_URL: `${base}/gonka/v1`,
});

const { agentTarget, markingTarget, fileJobQueue } = await import('../server/services/AiService.js');
test.after(async () => { await fileJobQueue.stop(); fake.close(); });

async function call(t: ReturnType<typeof agentTarget>) {
  for await (const _ of t.adapter.stream({ model: t.model, messages: [{ role: 'user', content: 'mark this' }] } as any)) { /* drain */ }
  return requests.at(-1);
}

test('marking runs on the marking model and effort; agent tasks keep the agent model', async () => {
  const m = markingTarget();
  assert.deepEqual([m.model, m.provider], ['claude-opus-5-5', 'anthropic']);
  const marked = await call(m);
  assert.equal(marked.model, 'claude-opus-5-5');
  assert.equal(marked.output_config?.effort, 'high');

  const a = agentTarget();
  assert.equal(a.model, 'claude-haiku-5-5');
  const agent = await call(a);
  assert.equal(agent.model, 'claude-haiku-5-5');
  assert.equal(agent.output_config?.effort, 'medium');
});
