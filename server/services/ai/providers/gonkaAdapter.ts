import { OpenAICompatibleAdapter, OpenAICompatibleOptions } from './openaiCompatible.js';
import { ProviderAdapter, ProviderChunk, ProviderError, ProviderRequest } from './types.js';

export type ErrorCategory =
  | 'PROVIDER_BUSY'
  | 'RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'INVALID_REQUEST'
  | 'AUTH_FAILURE'
  | 'MODEL_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface NormalizedProviderError {
  category: ErrorCategory;
  message: string;
  statusCode?: number;
  retryable: boolean;
  retryAfterMs?: number;
}

export interface ReliableProviderOptions extends OpenAICompatibleOptions {
  maxRetries?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  fallbackAdapter?: ProviderAdapter;
  fallbackModel?: string;
}

export function normalizeError(err: any): NormalizedProviderError {
  const status = err instanceof ProviderError ? err.status : err?.status;
  const msg = err instanceof Error ? err.message : String(err);
  let category: ErrorCategory = 'INTERNAL_ERROR';
  let retryable = false;
  let retryAfterMs: number | undefined;

  if (status === 429) {
    category = 'RATE_LIMITED';
    retryable = true;
    retryAfterMs = err?.retryAfterMs ?? 5000;
  } else if (status === 401 || status === 403) {
    category = 'AUTH_FAILURE';
    retryable = false;
  } else if (status === 400 || status === 422) {
    category = 'INVALID_REQUEST';
    retryable = false;
  } else if (status === 404 || status === 503 || msg.includes('model_unavailable')) {
    category = 'MODEL_UNAVAILABLE';
    retryable = true;
  } else if (status && status >= 500) {
    category = 'PROVIDER_BUSY';
    retryable = true;
  } else if (msg.includes('timeout') || err?.retryable) {
    category = 'PROVIDER_TIMEOUT';
    retryable = true;
  } else if (msg.includes('high demand') || msg.includes('overloaded')) {
    category = 'PROVIDER_BUSY';
    retryable = true;
  }

  return { category, message: msg, statusCode: status, retryable, retryAfterMs };
}

/**
 * Reliable Provider Adapter wrapping OpenAICompatibleAdapter with normalized error handling,
 * bounded exponential backoff with jitter, Retry-After compliance, and fallback support.
 */
export class ReliableGonkaAdapter implements ProviderAdapter {
  readonly name: string;
  private primary: OpenAICompatibleAdapter;
  private maxRetries: number;
  private initialBackoffMs: number;
  private maxBackoffMs: number;
  private fallbackAdapter?: ProviderAdapter;
  private fallbackModel?: string;

  constructor(opts: ReliableProviderOptions) {
    this.name = `Reliable(${opts.name})`;
    this.primary = new OpenAICompatibleAdapter(opts);
    this.maxRetries = opts.maxRetries ?? 3;
    this.initialBackoffMs = opts.initialBackoffMs ?? 1000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 30000;
    this.fallbackAdapter = opts.fallbackAdapter;
    this.fallbackModel = opts.fallbackModel;
  }

  async *stream(req: ProviderRequest): AsyncGenerator<ProviderChunk> {
    let attempt = 0;
    let lastError: any;

    while (attempt <= this.maxRetries) {
      try {
        yield* this.primary.stream(req);
        return;
      } catch (err: any) {
        lastError = err;
        const normalized = normalizeError(err);

        if (!normalized.retryable || attempt >= this.maxRetries) {
          break;
        }

        attempt++;
        const backoff = Math.min(
          this.maxBackoffMs,
          this.initialBackoffMs * Math.pow(2, attempt - 1) * (0.8 + Math.random() * 0.4)
        );
        const delay = normalized.retryAfterMs ? Math.max(backoff, normalized.retryAfterMs) : backoff;

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    if (this.fallbackAdapter && this.fallbackModel) {
      const fallbackReq: ProviderRequest = {
        ...req,
        model: this.fallbackModel,
      };
      try {
        yield* this.fallbackAdapter.stream(fallbackReq);
        return;
      } catch (fallbackErr: any) {
        throw new ProviderError(
          `Primary provider failed (${normalizeError(lastError).message}) and fallback also failed (${normalizeError(fallbackErr).message})`
        );
      }
    }

    throw new ProviderError(
      `Provider failed after ${this.maxRetries} attempts. Category: ${normalizeError(lastError).category}. Details: ${normalizeError(lastError).message}`,
      normalizeError(lastError).statusCode,
      false
    );
  }
}
