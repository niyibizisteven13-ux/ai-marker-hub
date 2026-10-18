interface ChatFailureDetails {
  code: string;
  message: string;
  status?: number;
  timeout: boolean;
  timeoutKind?: string;
  errorType: string;
  networkCode?: string;
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

  return {
    code,
    message: contextFailure
      ? 'Knowledge context could not be loaded. Please retry your request.'
      : 'Bwenge could not complete your request. Please try again.',
    status,
    timeout,
    timeoutKind: typeof err?.timeoutKind === 'string' ? err.timeoutKind : undefined,
    errorType: typeof err?.name === 'string' ? err.name : 'Error',
    networkCode,
  };
}
