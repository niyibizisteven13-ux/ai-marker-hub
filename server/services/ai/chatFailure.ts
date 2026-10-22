import { normalizeError, type ErrorCategory } from './providers/types.js';

interface ChatFailureDetails {
  code: string;
  message: string;
  status?: number;
  timeout: boolean;
  timeoutKind?: string;
  errorType: string;
  networkCode?: string;
  /** Provider-neutral failure category (additive field; `code` keeps its existing values). */
  category: ErrorCategory | 'CONTEXT_RETRIEVAL_FAILED' | 'AI_UNAVAILABLE';
  /** Whether trying again later may succeed. */
  retryable: boolean;
}

export function describeChatFailure(error: unknown): ChatFailureDetails {
  const err = error as {
    code?: unknown;
    status?: unknown;
    timeout?: unknown;
    timeoutKind?: unknown;
    name?: unknown;
    message?: unknown;
  } | null;
  const status = typeof err?.status === 'number' ? err.status : undefined;
  const timeout = err?.timeout === true || /timeout|timed out/i.test(String(err?.message || ''));
  const unavailable = err?.code === 'AI_UNAVAILABLE';
  const contextFailure = err?.code === 'CONTEXT_RETRIEVAL_FAILED';
  const code = contextFailure
    ? 'CONTEXT_RETRIEVAL_FAILED'
    : unavailable
      ? 'AI_UNAVAILABLE'
    : timeout
      ? 'AI_UPSTREAM_TIMEOUT'
      : status === 401 || status === 403
        ? 'AI_UPSTREAM_AUTH_FAILED'
        : 'AI_UPSTREAM_FAILED';
  const rawNetworkCode = typeof err?.code === 'string' ? err.code : undefined;
  const networkCode = rawNetworkCode && /^[A-Z0-9_]{1,32}$/.test(rawNetworkCode) && !unavailable && !contextFailure
    ? rawNetworkCode
    : undefined;

  const normalized = normalizeError(error);
  const category = contextFailure ? 'CONTEXT_RETRIEVAL_FAILED' : unavailable ? 'AI_UNAVAILABLE' : normalized.category;
  const transient = ['PROVIDER_BUSY', 'RATE_LIMITED', 'PROVIDER_TIMEOUT', 'NETWORK_ERROR', 'CONTEXT_RETRIEVAL_FAILED'].includes(category);

  return {
    code,
    category,
    retryable: transient,
    message: contextFailure
      ? 'Knowledge context could not be loaded. Please retry your request.'
      : category === 'PROVIDER_BUSY' || category === 'RATE_LIMITED'
        ? 'Bwenge is handling a lot of requests right now. Please try again in a moment.'
        : 'Bwenge could not complete your request. Please try again.',
    status,
    timeout,
    timeoutKind: typeof err?.timeoutKind === 'string' ? err.timeoutKind : undefined,
    errorType: typeof err?.name === 'string' ? err.name : 'Error',
    networkCode,
  };
}
