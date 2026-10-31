import test from 'node:test';
import assert from 'node:assert/strict';
import { SafetyService } from '../server/services/SafetyService.js';
import { EmbeddingService } from '../server/services/EmbeddingService.js';

test('safety: blocked patterns stop a request instantly; ordinary messages pass without waiting on a classifier', () => {
  const safety = SafetyService.getInstance();
  const t0 = Date.now();
  const ok = safety.quickScan('Please explain how photosynthesis turns light into chemical energy for my S3 class.');
  assert.equal(ok.blocked, false);
  assert.equal(safety.quickScan('how to make a bomb at home').blocked, true);
  assert.ok(Date.now() - t0 < 50, 'no network call on the reply path');
  // The background review never throws, with or without a classifier configured.
  assert.doesNotThrow(() => safety.reviewLater('A longer message about the history of the Second World War for a lesson.'));
});

test('embeddings: the same text is embedded once, and a slow provider cannot hold a reply', async () => {
  const svc = EmbeddingService.getInstance() as any;
  const original = svc.client;
  const prevTimeout = process.env.EMBEDDING_TIMEOUT_MS;
  let calls = 0;
  try {
    svc.client = { models: { embedContent: async ({ contents }: { contents: string[] }) => { calls++; return { embeddings: contents.map(() => ({ values: [0.1, 0.2, 0.3] })) }; } } };
    const a = await svc.getEmbeddings(['what did we say about fractions?'], 'RETRIEVAL_QUERY');
    const b = await svc.getEmbeddings(['what did we say about fractions?'], 'RETRIEVAL_QUERY');
    assert.deepEqual(a, b);
    assert.equal(calls, 1, 'memory recall and library search reuse one embedding of the message');

    process.env.EMBEDDING_TIMEOUT_MS = '80';
    svc.client = { models: { embedContent: () => new Promise(() => undefined) } };
    const t0 = Date.now();
    await assert.rejects(svc.getEmbeddings(['a question the provider never answers'], 'RETRIEVAL_QUERY'), /longer than 80 ms/);
    assert.ok(Date.now() - t0 < 1000);
    assert.deepEqual(await svc.getEmbedding('another question the provider never answers'), [], 'callers fall back to keyword search');

    // Batches (indexing a library) are not cut short by the live-request time limit.
    let batchCalls = 0;
    svc.client = { models: { embedContent: async ({ contents }: { contents: string[] }) => { batchCalls++; await new Promise((r) => setTimeout(r, 150)); return { embeddings: contents.map(() => ({ values: [1] })) }; } } };
    assert.equal((await svc.getEmbeddings(['one', 'two'])).length, 2);
    assert.equal(batchCalls, 1);
  } finally {
    svc.client = original;
    if (prevTimeout === undefined) delete process.env.EMBEDDING_TIMEOUT_MS; else process.env.EMBEDDING_TIMEOUT_MS = prevTimeout;
  }
});
