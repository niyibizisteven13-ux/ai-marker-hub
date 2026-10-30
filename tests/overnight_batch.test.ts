import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { AnthropicAdapter } from '../server/services/ai/providers/anthropicAdapter.js';
import { BatchCollector, isOvernight, runOvernight } from '../server/services/ai/batchMode.js';
import { creditsFor, costUsd } from '../server/services/billing/usage.js';
import { visionCalls } from '../server/utils/concurrency.js';
import type { ProviderChunk } from '../server/services/ai/providers/types.js';

/** Fake Batches API: batches end after `rounds` checks; each request's answer echoes its prompt. */
function fakeBatches(opts: { rounds?: number; fail?: (customId: string) => boolean } = {}) {
  const batches = new Map<string, { requests: Array<{ custom_id: string; params: any }>; checks: number }>();
  let streamed = 0;
  let n = 0;
  const client = {
    messages: {
      stream() { streamed++; throw new Error('overnight requests must not be streamed'); },
      batches: {
        async create({ requests }: { requests: Array<{ custom_id: string; params: any }> }) {
          const id = `msgbatch_${++n}`;
          batches.set(id, { requests, checks: 0 });
          return { id, processing_status: 'in_progress' };
        },
        async retrieve(id: string) {
          const b = batches.get(id)!;
          b.checks++;
          return { id, processing_status: b.checks >= (opts.rounds ?? 1) ? 'ended' : 'in_progress' };
        },
        async results(id: string) {
          const b = batches.get(id)!;
          return (async function* () {
            for (const r of b.requests) {
              const prompt = r.params.messages.at(-1).content.map((c: any) => c.text ?? '').join('');
              yield opts.fail?.(r.custom_id)
                ? { custom_id: r.custom_id, result: { type: 'errored', error: { type: 'error', error: { type: 'api_error', message: 'boom' } } } }
                : { custom_id: r.custom_id, result: { type: 'succeeded', message: { id: 'm', type: 'message', role: 'assistant', model: r.params.model, stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text: `marked: ${prompt}` }], usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } };
            }
          })();
        },
      },
    },
  };
  return { client: client as unknown as Pick<Anthropic, 'messages'>, batches, streamed: () => streamed };
}

async function collect(gen: AsyncGenerator<ProviderChunk>) {
  const out: ProviderChunk[] = [];
  for await (const c of gen) out.push(c);
  return out;
}
const ask = (adapter: AnthropicAdapter, text: string) => collect(adapter.stream({ model: 'claude-haiku-5-5', messages: [{ role: 'user', content: text }] }));
const textOf = (chunks: ProviderChunk[]) => chunks.filter((c) => c.type === 'text').map((c: any) => c.text).join('');

test('overnight mode: requests made together go out as one batch, each caller gets its own answer, nothing is streamed', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'batches-'));
  try {
    const fake = fakeBatches({ rounds: 2 });
    const collector = new BatchCollector({ dir, windowMs: 20, pollMs: 5 });
    const adapter = new AnthropicAdapter({ client: fake.client, batch: collector });
    assert.equal(isOvernight(), false);
    const results = await runOvernight(async () => {
      assert.equal(isOvernight(), true);
      return Promise.all(['script A', 'script B', 'script C', 'script A'].map((t) => ask(adapter, t)));
    });
    assert.deepEqual(results.map(textOf), ['marked: script A', 'marked: script B', 'marked: script C', 'marked: script A']);
    assert.equal(fake.batches.size, 1, 'one batch for the whole step');
    assert.equal([...fake.batches.values()][0].requests.length, 3, 'the same request twice is sent once');
    assert.equal(fake.streamed(), 0);
    const usage = results[0].find((c) => c.type === 'usage') as any;
    assert.deepEqual([usage.input, usage.output], [100, 20]);
    assert.equal(results[0].at(-1)?.type, 'finish');
    assert.equal((await readdir(dir)).length, 3, 'each sent request is remembered');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a restarted job waits for the batch already sent instead of paying again', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'batches-'));
  try {
    const fake = fakeBatches({ rounds: 1 });
    await runOvernight(() => ask(new AnthropicAdapter({ client: fake.client, batch: new BatchCollector({ dir, windowMs: 5, pollMs: 5 }) }), 'script Z'));
    // A new process (new collector) asking the same thing finds the saved batch.
    const again = await runOvernight(() => ask(new AnthropicAdapter({ client: fake.client, batch: new BatchCollector({ dir, windowMs: 5, pollMs: 5 }) }), 'script Z'));
    assert.equal(textOf(again), 'marked: script Z');
    assert.equal(fake.batches.size, 1, 'no second batch');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a failed batch request is reported as a retryable error and is sent again next time', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'batches-'));
  try {
    let failing = true;
    const fake = fakeBatches({ fail: () => failing });
    const adapter = new AnthropicAdapter({ client: fake.client, batch: new BatchCollector({ dir, windowMs: 5, pollMs: 5 }) });
    await assert.rejects(runOvernight(() => ask(adapter, 'script E')), (e: any) => e.retryable === true);
    failing = false;
    assert.equal(textOf(await runOvernight(() => ask(adapter, 'script E'))), 'marked: script E');
    assert.equal(fake.batches.size, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('outside overnight mode the adapter streams as usual', async () => {
  const fake = fakeBatches();
  const adapter = new AnthropicAdapter({ client: fake.client, batch: new BatchCollector({ windowMs: 5, pollMs: 5 }) });
  await assert.rejects(ask(adapter, 'live'), /must not be streamed|failed/);
  assert.equal(fake.streamed(), 1);
  assert.equal(fake.batches.size, 0);
});

test('overnight costs half: credits and AI cost', () => {
  const live = creditsFor('claude-sonnet-5-5', 40_000, 4_000);
  const night = creditsFor('claude-sonnet-5-5', 40_000, 4_000, true);
  assert.equal(live, Math.ceil(costUsd('claude-sonnet-5-5', 40_000, 4_000) / 0.001));
  assert.ok(Math.abs(night - live / 2) <= 1, `${night} is half of ${live}`);
  assert.equal(creditsFor('claude-haiku-5-5', 10, 10, true), 1, 'never below 1 credit');
});

test('overnight calls do not hold the live vision slots', async () => {
  let release!: () => void;
  const blocker = new Promise<void>((r) => { release = r; });
  const held = runOvernight(() => Promise.all(Array.from({ length: 40 }, () => visionCalls.run(() => blocker))));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(visionCalls.active, 0, 'overnight work bypasses the live limiter');
  let ran = false;
  await visionCalls.run(async () => { ran = true; });
  assert.equal(ran, true, 'a live call runs at once');
  release();
  await held;
});
