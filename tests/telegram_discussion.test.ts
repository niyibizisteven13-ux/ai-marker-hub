import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

let receivedSystem = '';
let receivedUserPrompt = '';
const server = http.createServer(async (req, res) => {
  assert.equal(req.url, '/v1/messages');
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  receivedSystem = JSON.stringify(body.system);
  receivedUserPrompt = JSON.stringify(body.messages.at(-1).content);
  const events = [
    { type: 'message_start', message: { id: 'discussion', type: 'message', model: body.model, role: 'assistant', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: "Student #3 lost 4 marks on Question 2 because they forgot to state Newton's Third Law explicitly." } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
  ];
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
}).listen(0);
await new Promise(resolve => server.once('listening', resolve));
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
test.after(() => server.close());
const { AiService } = await import('../server/services/AiService.js');

test('Telegram Discussion Mode: Claude answers post-grading questions using student results context', async () => {
  const batchContext = `DISCUSS SESSION FOR GRADED BATCH JOB job-12345:\n[STUDENT Student #3]: Score 16/20. Details: [{"questionNumber": 1, "score": 10, "maxScore": 10}, {"questionNumber": 2, "score": 6, "maxScore": 10, "feedback": "Formula correct but Newton Third Law statement missing"}]`;
  const userQuery = 'Why did Student #3 lose marks on Question 2?';

  const fullPrompt = `${batchContext}\n\nUSER FOLLOW-UP QUESTION: ${userQuery}`;

  const aiService = AiService.getInstance();
  const result = await aiService.completeText(fullPrompt, {
    system: 'You are Bwenge AI Assistant on Telegram helping a teacher analyze class results.',
  });

  assert.ok(result.includes('Student #3 lost 4 marks on Question 2'));
  assert.ok(result.includes('Newton'));
  assert.ok(receivedUserPrompt.includes('Student #3'));
  assert.ok(receivedSystem.includes('Bwenge AI Assistant'));
});
