import type { ErrorCategory } from '../providers/types.js';

export interface ProviderCallRecord {
  model: string;
  outcome: 'success' | 'failure';
  category?: ErrorCategory;
  latencyMs: number;
  attempts: number;
  fallbackUsed: boolean;
  timeToFirstChunkMs?: number;
}

interface ModelStats {
  calls: number;
  successes: number;
  failures: number;
  retries: number;
  fallbacks: number;
  breakerOpens: number;
  errorsByCategory: Partial<Record<ErrorCategory, number>>;
  latencies: number[];
  firstChunk: number[];
}

const SAMPLE_LIMIT = 500;

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function pushSample(list: number[], value: number) {
  list.push(value);
  if (list.length > SAMPLE_LIMIT) list.shift();
}

/**
 * In-process provider metrics: success rate, error categories, retries, fallbacks and latency percentiles.
 * Per-instance only (not aggregated across processes); prompts and user data are never recorded.
 */
export class ProviderMetrics {
  private models = new Map<string, ModelStats>();
  private startedAt = Date.now();

  private stats(model: string): ModelStats {
    let s = this.models.get(model);
    if (!s) {
      s = { calls: 0, successes: 0, failures: 0, retries: 0, fallbacks: 0, breakerOpens: 0, errorsByCategory: {}, latencies: [], firstChunk: [] };
      this.models.set(model, s);
    }
    return s;
  }

  recordCall(r: ProviderCallRecord) {
    const s = this.stats(r.model);
    s.calls++;
    if (r.outcome === 'success') s.successes++;
    else s.failures++;
    if (r.fallbackUsed) s.fallbacks++;
    pushSample(s.latencies, r.latencyMs);
    if (r.timeToFirstChunkMs !== undefined) pushSample(s.firstChunk, r.timeToFirstChunkMs);
  }

  recordAttemptError(model: string, category: ErrorCategory) {
    const s = this.stats(model);
    s.errorsByCategory[category] = (s.errorsByCategory[category] ?? 0) + 1;
  }

  recordRetry(model: string) { this.stats(model).retries++; }
  recordBreakerOpen(model: string) { this.stats(model).breakerOpens++; }

  snapshot() {
    const models: Record<string, unknown> = {};
    for (const [model, s] of this.models) {
      const lat = [...s.latencies].sort((a, b) => a - b);
      const ttfc = [...s.firstChunk].sort((a, b) => a - b);
      models[model] = {
        calls: s.calls,
        successes: s.successes,
        failures: s.failures,
        successRate: s.calls ? Number((s.successes / s.calls).toFixed(4)) : null,
        retries: s.retries,
        fallbacks: s.fallbacks,
        breakerOpens: s.breakerOpens,
        errorsByCategory: { ...s.errorsByCategory },
        latencyMs: { p50: percentile(lat, 50), p95: percentile(lat, 95), p99: percentile(lat, 99), samples: lat.length },
        timeToFirstChunkMs: { p50: percentile(ttfc, 50), p95: percentile(ttfc, 95), samples: ttfc.length },
      };
    }
    return { since: new Date(this.startedAt).toISOString(), models };
  }

  reset() {
    this.models.clear();
    this.startedAt = Date.now();
  }
}

export const providerMetrics = new ProviderMetrics();
