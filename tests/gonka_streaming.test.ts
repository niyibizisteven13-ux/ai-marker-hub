import test from 'node:test';
import assert from 'node:assert/strict';
import { AiService } from '../server/services/AiService.js';

test('GonkaRouter streams response deltas and keeps request context', async () => {
  const originalApiKey = process.env.GONKA_API_KEY;
  const originalBaseUrl = process.env.GONKA_BASE_URL;
  const originalModel = process.env.GONKA_MODEL;
  const originalFetch = globalThis.fetch;
  const receivedTokens: string[] = [];

  process.env.GONKA_API_KEY = 'test-gonka-key';
  process.env.GONKA_BASE_URL = 'https://gonka.test/v1';
  process.env.GONKA_MODEL = 'test-model';
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://gonka.test/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-gonka-key');

    const body = JSON.parse(String(init?.body));
    assert.equal(body.stream, false);
    assert.equal(body.model, 'test-model');
    assert.deepEqual(body.messages.slice(1), [
      { role: 'assistant', content: 'Earlier answer' },
      { role: 'user', content: 'Continue' },
    ]);

    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world."}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    return new Response(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } });
  };

  try {
    await AiService.getInstance().streamGonkaChat('Continue', {
      system: 'Test system',
      history: [{ role: 'assistant', text: 'Earlier answer' }],
      onToken: (token) => receivedTokens.push(token),
    });
    assert.deepEqual(receivedTokens, ['Hello ', 'world.']);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GONKA_API_KEY;
    else process.env.GONKA_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.GONKA_BASE_URL;
    else process.env.GONKA_BASE_URL = originalBaseUrl;
    if (originalModel === undefined) delete process.env.GONKA_MODEL;
    else process.env.GONKA_MODEL = originalModel;
  }
});

test('GonkaRouter emits a JSON message body returned with HTTP 200', async () => {
  const originalApiKey = process.env.GONKA_API_KEY;
  const originalBaseUrl = process.env.GONKA_BASE_URL;
  const originalFetch = globalThis.fetch;
  const receivedTokens: string[] = [];

  process.env.GONKA_API_KEY = 'test-gonka-key';
  process.env.GONKA_BASE_URL = 'https://gonka.test/v1';
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content: 'University comparison answer.' } }],
  }), { headers: { 'Content-Type': 'application/json' } });

  try {
    await AiService.getInstance().streamGonkaChat('Compare universities', {
      onToken: (token) => receivedTokens.push(token),
    });
    assert.deepEqual(receivedTokens, ['University comparison answer.']);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GONKA_API_KEY;
    else process.env.GONKA_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.GONKA_BASE_URL;
    else process.env.GONKA_BASE_URL = originalBaseUrl;
  }
});
