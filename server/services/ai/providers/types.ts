import type { ChatMessage, ToolDefinition } from '../types.js';

export interface ProviderRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required';
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Correlation id for logs and metrics. Never sent upstream. */
  requestId?: string;
  /** Per-request fallback model chosen by the routing policy. `null` disables fallback for this request. */
  fallbackModel?: string | null;
  /**
   * Ask for JSON matching this schema. Claude enforces it with structured outputs; gateways only get it
   * as an instruction, so callers must still validate the result.
   */
  responseSchema?: Record<string, unknown>;
}

export type ProviderChunk =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call'; index: number; id?: string; name?: string; args?: string }
  | { type: 'usage'; input: number; output: number }
  | { type: 'finish'; reason: string }
  /** Provider-native assistant content to replay on the next turn of the same loop (see ChatMessage.providerState). */
  | { type: 'provider_state'; provider: string; content: unknown[] };

export interface ProviderAdapter {
  readonly name: string;
  stream(req: ProviderRequest): AsyncGenerator<ProviderChunk>;
}

/** Stable, provider-neutral error categories. Safe to expose to clients. */
export type ErrorCategory =
  | 'PROVIDER_BUSY'
  | 'RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'NETWORK_ERROR'
  | 'INVALID_REQUEST'
  | 'AUTH_FAILURE'
  | 'MODEL_UNAVAILABLE'
  | 'CONTENT_REFUSED'
  | 'INTERNAL_ERROR';

export class ProviderError extends Error {
  /** Upstream-provided Retry-After, in milliseconds. */
  retryAfterMs?: number;
  /** Short, redacted upstream error message. For logs and classification only, never for users. */
  upstreamMessage?: string;
  /** Set once a reliability layer has normalized the error. */
  category?: ErrorCategory;
  /** True when retries/fallbacks were already spent; outer layers must not retry again. */
  exhausted?: boolean;
  attempts?: number;

  constructor(
    message: string,
    public status?: number,
    public retryable = false,
    public timeout = false,
    public timeoutKind?: 'connect' | 'idle' | 'request',
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface NormalizedProviderError {
  category: ErrorCategory;
  retryable: boolean;
  statusCode?: number;
  retryAfterMs?: number;
}

const NETWORK_PATTERN = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|terminated|network|stream interrupted/i;
const BUSY_PATTERN = /high demand|overloaded|over capacity|capacity|temporarily unavailable|try again later|server is busy|no available (worker|instance|node)s?/i;
const RATE_PATTERN = /rate.?limit|too many requests|quota exceeded/i;
const MODEL_PATTERN = /model.{0,40}(not found|does not exist|unavailable|not supported|unknown)|unknown model|no such model|model_not_found|model_unavailable/i;
const SECRET_PATTERN = /(sk-[\w-]{10,}|Bearer\s+[\w.-]{10,}|api[_-]?key["':\s=]+[\w.-]{10,})/gi;

/** Redacts credentials and bounds length so upstream text is safe to log. */
export function redactUpstreamText(text: string, max = 200): string {
  return text.replace(SECRET_PATTERN, '[redacted]').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Parses a Retry-After header (delta-seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return undefined;
}

/**
 * Maps any provider/network failure to a stable category and retry decision.
 * Only transient failures (429, selected 5xx, timeouts, connection errors, "busy") are retryable.
 */
export function normalizeError(err: unknown): NormalizedProviderError {
  const e = err as Partial<ProviderError> & { message?: string; code?: string; cause?: { code?: string } };
  if (e?.category && e.exhausted) return { category: e.category, retryable: false, statusCode: e.status };
  const status = typeof e?.status === 'number' ? e.status : undefined;
  const text = `${e?.message ?? ''} ${e?.upstreamMessage ?? ''} ${e?.code ?? ''} ${e?.cause?.code ?? ''}`;
  const retryAfterMs = e?.retryAfterMs;

  if (status === 401 || status === 403) return { category: 'AUTH_FAILURE', retryable: false, statusCode: status };
  if (status === 429 || (!status && RATE_PATTERN.test(text))) return { category: 'RATE_LIMITED', retryable: true, statusCode: status, retryAfterMs };
  if (MODEL_PATTERN.test(text) || status === 404) return { category: 'MODEL_UNAVAILABLE', retryable: false, statusCode: status };
  if (status === 408 || e?.timeout) return { category: 'PROVIDER_TIMEOUT', retryable: true, statusCode: status, retryAfterMs };
  if (status === 500 || status === 502 || status === 503 || status === 504 || status === 520 || status === 529) {
    return { category: 'PROVIDER_BUSY', retryable: true, statusCode: status, retryAfterMs };
  }
  if (status !== undefined && status >= 400 && status < 500) return { category: 'INVALID_REQUEST', retryable: false, statusCode: status };
  if (BUSY_PATTERN.test(text)) return { category: 'PROVIDER_BUSY', retryable: true, statusCode: status, retryAfterMs };
  if (status !== undefined && status >= 500) return { category: 'PROVIDER_BUSY', retryable: true, statusCode: status, retryAfterMs };
  if (/timeout|timed out/i.test(text)) return { category: 'PROVIDER_TIMEOUT', retryable: true, statusCode: status };
  if (NETWORK_PATTERN.test(text) || (err instanceof ProviderError && err.retryable)) {
    return { category: 'NETWORK_ERROR', retryable: true, statusCode: status };
  }
  return { category: 'INTERNAL_ERROR', retryable: false, statusCode: status };
}

export function isRetryable(err: unknown): boolean {
  if ((err as ProviderError | undefined)?.exhausted) return false;
  if (err instanceof ProviderError) return normalizeError(err).retryable;
  const msg = String((err as any)?.message ?? '');
  return NETWORK_PATTERN.test(msg);
}
