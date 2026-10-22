import test from 'node:test';
import assert from 'node:assert/strict';
import { ReliableProviderAdapter, type ReliabilityLogEvent } from '../server/services/ai/providers/reliableAdapter.js';
import { OpenAICompatibleAdapter } from '../server/services/ai/providers/openaiCompatible.js';
import { normalizeError, parseRetryAfter, ProviderError, isRetryable, type ProviderAdapter, type ProviderChunk, type ProviderRequest } from '../server/services/ai/providers/types.js';
import { ProviderMetrics } from '../server/services/ai/observability/providerMetrics.js';
import { describeChatFailure } from '../server/services/ai/chatFailure.js';

type Step = ProviderChunk[] | Error | { chunks: ProviderChunk[]; then: Error };

/** Scripted adapter: each call consumes the next step. */
function scripted(steps: Step[]) {
  const calls: ProviderRequest[] = [];
  const adapter: ProviderAdapter = {
    name: 'fake',
    async *stream(req) {
      calls.push(req);
      const step = steps.shift();
      if (!step) throw new Error('no more scripted steps');
      if (step instanceof Error) throw step;
      if (Array.isArray(step)) { yield* step; return; }
      yield* step.chunks;
      throw step.then;
    },
  };
  return { adapter, calls };
}

async function collect(gen: AsyncGenerator<ProviderChunk>) {
  const out: ProviderChunk[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

function harness(steps: Step[], extra: Partial<ConstructorParameters<typeof ReliableProviderAdapter>[0]> = {}) {
  const { adapter, calls } = scripted(steps);
  let clock = 0;
  const sleeps: number[] = [];
  const logs: ReliabilityLogEvent[] = [];
  const metrics = new ProviderMetrics();
  const reliable = new ReliableProviderAdapter({
    primary: adapter,
    metrics,
    now: () => clock,
    random: () => 1,
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    log: (e) => logs.push(e),
    ...extra,
  });
  return { reliable, calls, sleeps, logs, metrics, advance: (ms: number) => { clock += ms; } };
}

const ok: ProviderChunk[] = [{ type: 'text', text: 'hi' }, { type: 'finish', reason: 'stop' }];
const req = (over: Partial<ProviderRequest> = {}): ProviderRequest => ({ model: 'm-primary', messages: [{ role: 'user', content: 'hello' }], requestId: 'req-test-1', ...over });

test('normalizeError maps provider failures to stable categories', () => {
  const cases: Array<[unknown, string, boolean]> = [
    [new ProviderError('x', 429), 'RATE_LIMITED', true],
    [new ProviderError('x', 401), 'AUTH_FAILURE', false],
    [new ProviderError('x', 403), 'AUTH_FAILURE', false],
    [new ProviderError('x', 400), 'INVALID_REQUEST', false],
    [new ProviderError('x', 404), 'MODEL_UNAVAILABLE', false],
    [new ProviderError('x', 503), 'PROVIDER_BUSY', true],
    [new ProviderError('x', 502), 'PROVIDER_BUSY', true],
    [new ProviderError('x', 500), 'PROVIDER_BUSY', true],
    [new ProviderError('GonkaRouter: request timeout', undefined, true, true, 'request'), 'PROVIDER_TIMEOUT', true],
    [new ProviderError('GonkaRouter: ECONNRESET', undefined, true), 'NETWORK_ERROR', true],
    [new Error('fetch failed'), 'NETWORK_ERROR', true],
    [new Error('something odd'), 'INTERNAL_ERROR', false],
  ];
  for (const [err, category, retryable] of cases) {
    const n = normalizeError(err);
    assert.equal(n.category, category, String((err as Error).message) + ' ' + (err as ProviderError).status);
    assert.equal(n.retryable, retryable);
  }
});

test('an in-stream "high demand" error with no HTTP status is treated as transient', () => {
  const err = new ProviderError('GonkaRouter returned an upstream error');
  err.upstreamMessage = 'The model is experiencing high demand. Please try again.';
  assert.deepEqual([normalizeError(err).category, normalizeError(err).retryable], ['PROVIDER_BUSY', true]);
  assert.equal(isRetryable(err), true);

  const modelErr = new ProviderError('GonkaRouter returned an upstream error');
  modelErr.upstreamMessage = 'model zai-org/Foo not found';
  assert.equal(normalizeError(modelErr).category, 'MODEL_UNAVAILABLE');
});

test('parseRetryAfter handles seconds and HTTP dates', () => {
  assert.equal(parseRetryAfter('3'), 3000);
  assert.equal(parseRetryAfter('Thu, 01 Jan 2026 00:00:10 GMT', Date.parse('Thu, 01 Jan 2026 00:00:00 GMT')), 10_000);
  assert.equal(parseRetryAfter('garbage'), undefined);
  assert.equal(parseRetryAfter(null), undefined);
});

test('transient 503 then success: retries with backoff and returns output once', async () => {
  const h = harness([new ProviderError('x', 503), ok]);
  const out = await collect(h.reliable.stream(req()));
  assert.deepEqual(out, ok);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.sleeps, [500]);
  const snap: any = h.metrics.snapshot().models['m-primary'];
  assert.equal(snap.successes, 1);
  assert.equal(snap.retries, 1);
  assert.equal(snap.errorsByCategory.PROVIDER_BUSY, 1);
});

test('429 honours Retry-After when longer than the computed backoff', async () => {
  const limited = new ProviderError('x', 429);
  limited.retryAfterMs = 4000;
  const h = harness([limited, ok]);
  await collect(h.reliable.stream(req()));
  assert.deepEqual(h.sleeps, [4000]);
});

test('non-retryable failures (auth, invalid request) are not retried and not sent to fallback', async () => {
  for (const status of [401, 400]) {
    const h = harness([new ProviderError('x', status)], { fallbackModel: 'm-fallback' });
    await assert.rejects(collect(h.reliable.stream(req())), (err: any) => {
      assert.equal(err.exhausted, true);
      assert.equal(err.status, status);
      assert.equal(isRetryable(err), false);
      return true;
    });
    assert.equal(h.calls.length, 1);
  }
});

test('exhausted retries produce one bounded, exhausted error that outer layers do not retry', async () => {
  const h = harness([new ProviderError('x', 503), new ProviderError('x', 503), new ProviderError('x', 503)]);
  await assert.rejects(collect(h.reliable.stream(req())), (err: any) => {
    assert.ok(err instanceof ProviderError);
    assert.equal(err.category, 'PROVIDER_BUSY');
    assert.equal(err.exhausted, true);
    assert.equal(err.attempts, 3);
    assert.equal(isRetryable(err), false);
    const failure = describeChatFailure(err);
    assert.equal(failure.code, 'AI_UPSTREAM_FAILED');
    assert.equal(failure.category, 'PROVIDER_BUSY');
    assert.equal(failure.retryable, true);
    return true;
  });
  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.sleeps, [500, 1000]);
});

test('timeouts keep their timeout details through the reliability layer', async () => {
  const t = () => new ProviderError('GonkaRouter: request timeout', undefined, true, true, 'request');
  const h = harness([t(), t(), t()]);
  await assert.rejects(collect(h.reliable.stream(req())), (err: any) => {
    const failure = describeChatFailure(err);
    assert.equal(failure.code, 'AI_UPSTREAM_TIMEOUT');
    assert.equal(failure.timeoutKind, 'request');
    return true;
  });
});

test('no new attempt starts past the total deadline', async () => {
  const limited = new ProviderError('x', 429);
  limited.retryAfterMs = 60_000;
  const h = harness([limited, ok], { totalDeadlineMs: 45_000 });
  await assert.rejects(collect(h.reliable.stream(req())), (err: any) => err.category === 'RATE_LIMITED');
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.sleeps, []);
});

test('a failure after partial output is not replayed (no duplicated text)', async () => {
  const h = harness([{ chunks: [{ type: 'text', text: 'partial' }], then: new ProviderError('x: stream interrupted', undefined, true) }, ok]);
  const seen: ProviderChunk[] = [];
  await assert.rejects((async () => { for await (const c of h.reliable.stream(req())) seen.push(c); })());
  assert.equal(h.calls.length, 1);
  assert.deepEqual(seen, [{ type: 'text', text: 'partial' }]);
  assert.ok(h.logs.some((l) => l.event === 'provider_mid_stream_failure'));
});

test('fallback model is used only after transient failures, and is recorded', async () => {
  const h = harness([new ProviderError('x', 503), new ProviderError('x', 503), ok], { maxAttempts: 2, fallbackModel: 'm-fallback' });
  const out = await collect(h.reliable.stream(req()));
  assert.deepEqual(out, ok);
  assert.deepEqual(h.calls.map((c) => c.model), ['m-primary', 'm-primary', 'm-fallback']);
  assert.ok(h.logs.some((l) => l.event === 'provider_fallback' && l.model === 'm-fallback'));
  assert.equal((h.metrics.snapshot().models['m-fallback'] as any).fallbacks, 1);
});

test('per-request fallbackModel=null disables the configured fallback', async () => {
  const h = harness([new ProviderError('x', 503), new ProviderError('x', 503)], { maxAttempts: 2, fallbackModel: 'm-fallback' });
  await assert.rejects(collect(h.reliable.stream(req({ fallbackModel: null }))));
  assert.deepEqual(h.calls.map((c) => c.model), ['m-primary', 'm-primary']);
});

test('circuit breaker opens after repeated failures, fails fast, then half-opens after cooldown', async () => {
  const fails = Array.from({ length: 4 }, () => new ProviderError('x', 503));
  const h = harness([...fails, ok], { maxAttempts: 2, breakerThreshold: 3, breakerCooldownMs: 10_000, totalDeadlineMs: 1_000_000 });
  await assert.rejects(collect(h.reliable.stream(req())));
  await assert.rejects(collect(h.reliable.stream(req())));
  assert.equal(h.calls.length, 3, 'breaker opened on the 3rd failure and stopped the 4th attempt');
  assert.equal(h.reliable.breakerState()['m-primary'].open, true);

  // While open: no upstream call at all.
  await assert.rejects(collect(h.reliable.stream(req())), (err: any) => err.category === 'PROVIDER_BUSY');
  assert.equal(h.calls.length, 3);

  h.advance(10_001);
  h.calls.length = 0;
  // Half-open: one attempt goes through (scripted 503 left over), then success closes the breaker.
  await assert.rejects(collect(h.reliable.stream(req())));
  h.advance(10_001);
  const out = await collect(h.reliable.stream(req()));
  assert.deepEqual(out, ok);
  assert.equal(h.reliable.breakerState()['m-primary'], undefined);
});

test('aborting during backoff stops immediately without further attempts', async () => {
  const { adapter, calls } = scripted([new ProviderError('x', 503), ok]);
  const controller = new AbortController();
  const reliable = new ReliableProviderAdapter({ primary: adapter, metrics: new ProviderMetrics(), initialBackoffMs: 5_000, random: () => 1 });
  const p = collect(reliable.stream(req({ signal: controller.signal })));
  setTimeout(() => controller.abort(new Error('client disconnected')), 20);
  const started = Date.now();
  await assert.rejects(p, /client disconnected/);
  assert.ok(Date.now() - started < 2_000);
  assert.equal(calls.length, 1);
});

test('OpenAI-compatible adapter exposes Retry-After and a redacted upstream reason', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'High demand, key sk-abcdefghijklmnop leaked' } }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': '2' },
  });
  try {
    const adapter = new OpenAICompatibleAdapter({ name: 'p', baseUrl: 'https://provider.test/v1' });
    await assert.rejects(collect(adapter.stream(req())), (err: any) => {
      assert.equal(err.status, 429);
      assert.equal(err.retryAfterMs, 2000);
      assert.match(err.upstreamMessage, /High demand/);
      assert.doesNotMatch(err.upstreamMessage, /sk-abcdefghijklmnop/);
      assert.doesNotMatch(err.message, /High demand/, 'public message stays generic');
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAI-compatible adapter: SSE error frame with HTTP 200 is retryable when it says busy', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(`data: ${JSON.stringify({ error: { message: 'Model is experiencing high demand' } })}\n\n`, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
  try {
    const adapter = new OpenAICompatibleAdapter({ name: 'p', baseUrl: 'https://provider.test/v1' });
    await assert.rejects(collect(adapter.stream(req())), (err: any) => {
      assert.equal(normalizeError(err).category, 'PROVIDER_BUSY');
      assert.equal(isRetryable(err), true);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('malformed JSON body from the gateway is a clear, non-retryable failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>oops</html>', { headers: { 'Content-Type': 'application/json' } });
  try {
    const adapter = new OpenAICompatibleAdapter({ name: 'p', baseUrl: 'https://provider.test/v1' });
    const h = new ReliableProviderAdapter({ primary: adapter, metrics: new ProviderMetrics(), sleep: async () => {} });
    await assert.rejects(collect(h.stream(req())), (err: any) => {
      assert.equal(err.category, 'INTERNAL_ERROR');
      assert.equal(err.attempts, 1);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider logs never contain prompt text', async () => {
  const h = harness([new ProviderError('x', 503), ok]);
  await collect(h.reliable.stream(req({ messages: [{ role: 'user', content: 'SECRET-PROMPT-CONTENT' }] })));
  assert.doesNotMatch(JSON.stringify(h.logs), /SECRET-PROMPT-CONTENT/);
  assert.doesNotMatch(JSON.stringify(h.metrics.snapshot()), /SECRET-PROMPT-CONTENT/);
});
