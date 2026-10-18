import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentRuntime } from '../server/services/ai/AgentRuntime.js';
import { FileStore } from '../server/services/ai/files/FileStore.js';
import { describeChatFailure } from '../server/services/ai/chatFailure.js';
import { OpenAICompatibleAdapter } from '../server/services/ai/providers/openaiCompatible.js';
import { ProviderError } from '../server/services/ai/providers/types.js';
import { ToolRegistry } from '../server/services/ai/tools/registry.js';
import { isSmallTalkMessage } from '../server/services/intentRouter.js';
import { buildSmallTalkPrompt } from '../server/services/prompts/promptRouter.js';

function createRuntime(adapter: OpenAICompatibleAdapter) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bwenge-chat-provider-'));
  const fileStore = new FileStore({ dir: directory, secret: crypto.randomBytes(32).toString('hex') });
  const runtime = new AgentRuntime(adapter, new ToolRegistry(), { maxRetries: 1, retryDelayMs: 0 });
  return {
    directory,
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
    run: () => runtime.run({
      system: 'You are Bwenge.',
      messages: [{ role: 'user', content: 'Hello' }],
      ctx: { userId: 'test-user', files: fileStore, services: {} },
      model: 'test-model',
      toolNames: [],
    }),
  };
}

test('OpenAI-compatible chat streams a successful upstream answer', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response([
    `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello from Bwenge.' } }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join(''), { headers: { 'Content-Type': 'text/event-stream' } });

  const adapter = new OpenAICompatibleAdapter({ name: 'test-provider', baseUrl: 'https://provider.test/v1' });
  const testRun = createRuntime(adapter);
  try {
    const result = await testRun.run();
    assert.equal(result.text, 'Hello from Bwenge.');
  } finally {
    globalThis.fetch = originalFetch;
    testRun.cleanup();
  }
});

test('a provider timeout retries once, then returns a clear upstream failure', async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async (_input, init) => {
    attempts++;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  };

  const adapter = new OpenAICompatibleAdapter({
    name: 'test-provider',
    baseUrl: 'https://provider.test/v1',
    connectTimeoutMs: 1_000,
    requestTimeoutMs: 10,
  });
  const testRun = createRuntime(adapter);
  try {
    await assert.rejects(testRun.run(), (error: unknown) => {
      const failure = describeChatFailure(error);
      assert.ok(error instanceof ProviderError);
      assert.equal(failure.code, 'AI_UPSTREAM_TIMEOUT');
      assert.equal(failure.timeout, true);
      assert.equal(failure.timeoutKind, 'request');
      assert.match(failure.message, /Bwenge could not complete your request/);
      return true;
    });
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
    testRun.cleanup();
  }
});

test('context retrieval failures remain explicit and retryable', () => {
  const failure = describeChatFailure(Object.assign(new Error('internal database details'), {
    code: 'CONTEXT_RETRIEVAL_FAILED',
  }));
  assert.equal(failure.code, 'CONTEXT_RETRIEVAL_FAILED');
  assert.equal(failure.message, 'Knowledge context could not be loaded. Please retry your request.');
  assert.equal(failure.message.includes('internal database details'), false);
});

test('an upstream 401 is not retried and its response body is not exposed', async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    return new Response('sensitive upstream details', { status: 401, statusText: 'Unauthorized' });
  };

  const adapter = new OpenAICompatibleAdapter({ name: 'test-provider', baseUrl: 'https://provider.test/v1' });
  const testRun = createRuntime(adapter);
  try {
    await assert.rejects(testRun.run(), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.status, 401);
      assert.equal(error.message.includes('sensitive upstream details'), false);
      assert.equal(describeChatFailure(error).code, 'AI_UPSTREAM_AUTH_FAILED');
      return true;
    });
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
    testRun.cleanup();
  }
});

test('small talk uses the concise Bwenge prompt and bypasses context routing', () => {
  assert.equal(isSmallTalkMessage('how are you doing?'), true);
  assert.equal(isSmallTalkMessage('amakuru?'), true);
  assert.equal(isSmallTalkMessage('muraho'), true);
  assert.equal(isSmallTalkMessage('hello', true), false);

  const prompt = buildSmallTalkPrompt('Bonjour');
  assert.equal(prompt.prompt, 'Bonjour');
  assert.match(prompt.system, /You are Bwenge/);
  assert.match(prompt.system, /Kinyarwanda, English, or French/);
  assert.match(prompt.system, /Keep small-talk replies brief/);
});
