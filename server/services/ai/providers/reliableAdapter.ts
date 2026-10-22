import { providerMetrics as defaultMetrics, type ProviderMetrics } from '../observability/providerMetrics.js';
import {
  normalizeError,
  ProviderError,
  type ErrorCategory,
  type ProviderAdapter,
  type ProviderChunk,
  type ProviderRequest,
} from './types.js';

export interface ReliabilityLogEvent {
  event: 'provider_attempt_failed' | 'provider_retry' | 'provider_fallback' | 'provider_breaker_open' | 'provider_breaker_skip' | 'provider_exhausted' | 'provider_mid_stream_failure';
  requestId?: string;
  model: string;
  attempt?: number;
  category?: ErrorCategory;
  status?: number;
  delayMs?: number;
  upstreamMessage?: string;
}

export interface ReliableAdapterOptions {
  primary: ProviderAdapter;
  /** Attempts per route (primary model, then fallback). Default 3. */
  maxAttempts?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  /** No new attempt starts once this much time has passed since the request began. Default 45s. */
  totalDeadlineMs?: number;
  /** Default fallback model (same gateway unless fallbackAdapter is given). Per-request `fallbackModel` overrides it. */
  fallbackModel?: string;
  fallbackAdapter?: ProviderAdapter;
  /** Consecutive transient failures that open a model's circuit, and how long it stays open. */
  breakerThreshold?: number;
  breakerCooldownMs?: number;
  metrics?: ProviderMetrics;
  log?: (e: ReliabilityLogEvent) => void;
  /** Injection points for tests. */
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const BREAKER_CATEGORIES = new Set<ErrorCategory>(['PROVIDER_BUSY', 'RATE_LIMITED', 'PROVIDER_TIMEOUT', 'NETWORK_ERROR', 'MODEL_UNAVAILABLE']);
/** Failures where trying a different model can help. Auth and request-shape errors would fail the same way. */
const FALLBACK_CATEGORIES = new Set<ErrorCategory>(['PROVIDER_BUSY', 'RATE_LIMITED', 'PROVIDER_TIMEOUT', 'NETWORK_ERROR', 'MODEL_UNAVAILABLE']);

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(signal?.reason ?? new Error('aborted')); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Wraps a provider adapter with the shared reliability policy:
 * - retries only transient failures, and only before any output was streamed (output cannot be replayed);
 * - bounded exponential backoff with jitter, honouring Retry-After, within a total deadline;
 * - a per-model circuit breaker so an unhealthy model is not hammered (no retry storms);
 * - an optional, explicitly configured fallback model, recorded in metrics and logs;
 * - a final error that keeps status/timeout details and is marked `exhausted` so outer layers do not retry again.
 */
export class ReliableProviderAdapter implements ProviderAdapter {
  readonly name: string;
  private breakers = new Map<string, { failures: number; openUntil: number }>();
  private readonly o: Required<Omit<ReliableAdapterOptions, 'fallbackModel' | 'fallbackAdapter' | 'log'>> & Pick<ReliableAdapterOptions, 'fallbackModel' | 'fallbackAdapter' | 'log'>;

  constructor(opts: ReliableAdapterOptions) {
    this.name = opts.primary.name;
    this.o = {
      maxAttempts: Math.max(1, opts.maxAttempts ?? 3),
      initialBackoffMs: opts.initialBackoffMs ?? 500,
      maxBackoffMs: opts.maxBackoffMs ?? 8_000,
      totalDeadlineMs: opts.totalDeadlineMs ?? 45_000,
      breakerThreshold: opts.breakerThreshold ?? 5,
      breakerCooldownMs: opts.breakerCooldownMs ?? 30_000,
      metrics: opts.metrics ?? defaultMetrics,
      now: opts.now ?? Date.now,
      random: opts.random ?? Math.random,
      sleep: opts.sleep ?? abortableSleep,
      primary: opts.primary,
      fallbackModel: opts.fallbackModel,
      fallbackAdapter: opts.fallbackAdapter,
      log: opts.log,
    };
  }

  /** Current breaker state, for admin diagnostics. */
  breakerState() {
    const now = this.o.now();
    return Object.fromEntries([...this.breakers].map(([model, b]) => [model, { consecutiveFailures: b.failures, open: b.openUntil > now, openUntil: b.openUntil > now ? new Date(b.openUntil).toISOString() : null }]));
  }

  private isOpen(model: string): boolean {
    const b = this.breakers.get(model);
    // After the cooldown the breaker is half-open: one attempt is allowed through.
    return !!b && b.openUntil > this.o.now();
  }

  private onSuccess(model: string) { this.breakers.delete(model); }

  private onFailure(model: string, category: ErrorCategory, requestId?: string) {
    if (!BREAKER_CATEGORIES.has(category)) return;
    const b = this.breakers.get(model) ?? { failures: 0, openUntil: 0 };
    b.failures++;
    if (b.failures >= this.o.breakerThreshold && b.openUntil <= this.o.now()) {
      b.openUntil = this.o.now() + this.o.breakerCooldownMs;
      this.o.metrics.recordBreakerOpen(model);
      this.o.log?.({ event: 'provider_breaker_open', requestId, model, category });
    }
    this.breakers.set(model, b);
  }

  private backoff(attempt: number, retryAfterMs?: number): number {
    const exp = Math.min(this.o.maxBackoffMs, this.o.initialBackoffMs * 2 ** (attempt - 1));
    const jittered = Math.round(exp * (0.5 + this.o.random() * 0.5));
    return retryAfterMs !== undefined ? Math.max(jittered, retryAfterMs) : jittered;
  }

  async *stream(req: ProviderRequest): AsyncGenerator<ProviderChunk> {
    const started = this.o.now();
    const deadline = started + this.o.totalDeadlineMs;
    const fallbackModel = req.fallbackModel === null ? undefined : req.fallbackModel ?? this.o.fallbackModel;
    const routes: Array<{ adapter: ProviderAdapter; model: string; fallback: boolean }> = [{ adapter: this.o.primary, model: req.model, fallback: false }];
    if (fallbackModel && fallbackModel !== req.model) {
      routes.push({ adapter: this.o.fallbackAdapter ?? this.o.primary, model: fallbackModel, fallback: true });
    }

    let lastError: unknown;
    let lastCategory: ErrorCategory = 'INTERNAL_ERROR';
    let totalAttempts = 0;
    let fallbackTried = false;

    for (const route of routes) {
      if (route.fallback) {
        if (!FALLBACK_CATEGORIES.has(lastCategory)) break;
        this.o.log?.({ event: 'provider_fallback', requestId: req.requestId, model: route.model, category: lastCategory });
        fallbackTried = true;
      }
      if (this.isOpen(route.model)) {
        this.o.log?.({ event: 'provider_breaker_skip', requestId: req.requestId, model: route.model });
        lastCategory = 'PROVIDER_BUSY';
        // Treated like an upstream 503 so the caller sees PROVIDER_BUSY without an upstream call.
        lastError ??= new ProviderError(`${this.name}: circuit open for model`, 503, true);
        continue;
      }

      for (let attempt = 1; attempt <= this.o.maxAttempts; attempt++) {
        totalAttempts++;
        let yielded = false;
        let firstChunkAt: number | undefined;
        try {
          for await (const chunk of route.adapter.stream({ ...req, model: route.model })) {
            if (!yielded) { yielded = true; firstChunkAt = this.o.now(); }
            yield chunk;
          }
          this.onSuccess(route.model);
          this.o.metrics.recordCall({
            model: route.model, outcome: 'success', latencyMs: this.o.now() - started, attempts: totalAttempts,
            fallbackUsed: route.fallback, timeToFirstChunkMs: firstChunkAt !== undefined ? firstChunkAt - started : undefined,
          });
          return;
        } catch (err) {
          if (req.signal?.aborted) throw err;
          const n = normalizeError(err);
          lastError = err;
          lastCategory = n.category;
          this.o.metrics.recordAttemptError(route.model, n.category);
          this.onFailure(route.model, n.category, req.requestId);
          const upstreamMessage = (err as ProviderError)?.upstreamMessage;

          if (yielded) {
            // Partial output already reached the caller; replaying here would duplicate text.
            this.o.log?.({ event: 'provider_mid_stream_failure', requestId: req.requestId, model: route.model, attempt, category: n.category, status: n.statusCode, upstreamMessage });
            this.o.metrics.recordCall({ model: route.model, outcome: 'failure', category: n.category, latencyMs: this.o.now() - started, attempts: totalAttempts, fallbackUsed: route.fallback });
            throw err;
          }
          this.o.log?.({ event: 'provider_attempt_failed', requestId: req.requestId, model: route.model, attempt, category: n.category, status: n.statusCode, upstreamMessage });

          if (!n.retryable || attempt >= this.o.maxAttempts || this.isOpen(route.model)) break;
          const delay = this.backoff(attempt, n.retryAfterMs);
          if (this.o.now() + delay >= deadline) break;
          this.o.metrics.recordRetry(route.model);
          this.o.log?.({ event: 'provider_retry', requestId: req.requestId, model: route.model, attempt, category: n.category, delayMs: delay });
          await this.o.sleep(delay, req.signal);
        }
      }
      if (this.o.now() >= deadline) break;
    }

    const n = normalizeError(lastError);
    this.o.metrics.recordCall({ model: req.model, outcome: 'failure', category: n.category, latencyMs: this.o.now() - started, attempts: totalAttempts, fallbackUsed: fallbackTried });
    this.o.log?.({ event: 'provider_exhausted', requestId: req.requestId, model: req.model, attempt: totalAttempts, category: n.category, status: n.statusCode });
    const src = lastError as Partial<ProviderError> | undefined;
    const final = new ProviderError(`${this.name}: request failed (${n.category}) after ${totalAttempts} attempt(s)`, n.statusCode, false, !!src?.timeout || n.category === 'PROVIDER_TIMEOUT', src?.timeoutKind);
    final.category = n.category;
    final.exhausted = true;
    final.attempts = totalAttempts;
    final.retryAfterMs = n.retryAfterMs;
    final.upstreamMessage = src?.upstreamMessage;
    throw final;
  }
}
