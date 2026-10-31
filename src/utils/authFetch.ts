let currentAccessToken: string | null = null;
let tokenExpiresAt: number = 0;
let refreshPromise: Promise<string | null> | null = null;

export const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || '';

export function getApiUrl(path: string): string {
  const cleanPath = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
  if (cleanPath.startsWith('/api') && API_BASE_URL) {
    return `${API_BASE_URL.replace(/\/$/, '')}${cleanPath}`;
  }
  return cleanPath;
}

export function setAccessToken(token: string | null, expiresInSeconds: number = 900) {
  currentAccessToken = token;
  tokenExpiresAt = token ? Date.now() + expiresInSeconds * 1000 : 0;
}

export function getAccessToken(): string | null {
  return currentAccessToken;
}

/**
 * Why the last refresh gave no token: 'expired' means the session really ended (sign in again); 'transient' means
 * the server was busy, rate-limited (429) or unreachable, and the session is still valid, so nobody is signed out.
 */
let lastRefreshFailure: 'expired' | 'transient' | null = null;
export const refreshFailure = () => lastRefreshFailure;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function performRefresh(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      for (let attempt = 0; ; attempt++) {
        let response: Response | null = null;
        try {
          response = await fetch(getApiUrl('/api/auth/refresh'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Requested-With': 'bwenge',
            },
            credentials: 'include',
          });
        } catch {
          response = null; // offline or the server is restarting
        }

        if (response?.ok) {
          const data = await response.json().catch(() => null);
          if (data?.accessToken) {
            lastRefreshFailure = null;
            setAccessToken(data.accessToken, data.expiresIn || 900);
            return data.accessToken as string;
          }
        }

        // Only 401/403 mean the session is over. Busy (429), server errors and no connection are retried and
        // never sign the person out.
        if (response && (response.status === 401 || response.status === 403)) {
          lastRefreshFailure = 'expired';
          setAccessToken(null);
          return null;
        }
        if (attempt >= 2) {
          lastRefreshFailure = 'transient';
          // Keep a token that is still valid; the next request tries again.
          return currentAccessToken && tokenExpiresAt > Date.now() ? currentAccessToken : null;
        }
        const retryAfter = Number(response?.headers.get('Retry-After'));
        await sleep(Math.min(8000, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * (attempt + 1)));
      }
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export function refreshAccessToken(): Promise<string | null> {
  return performRefresh();
}

// Proactive refresh timer & visibility change listener
if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentAccessToken) {
      const timeLeft = tokenExpiresAt - Date.now();
      if (timeLeft < 120 * 1000) {
        performRefresh();
      }
    }
  });

  const interval = setInterval(() => {
    if (currentAccessToken) {
      const timeLeft = tokenExpiresAt - Date.now();
      if (timeLeft > 0 && timeLeft < 90 * 1000) {
        performRefresh();
      }
    }
  }, 30 * 1000);
  if (interval && typeof (interval as any).unref === 'function') {
    (interval as any).unref();
  }
}

export async function authFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input.url;
  const isRefreshEndpoint = url.includes('/api/auth/refresh');

  let token = currentAccessToken;

  // If the token is about to expire or missing, refresh it before protected requests.
  if (!isRefreshEndpoint && (!token || tokenExpiresAt - Date.now() < 30 * 1000)) {
    token = await performRefresh();
  }

  const makeRequest = async (t: string | null) => {
    const headers = new Headers(init?.headers ?? {});

    if (!headers.has('Content-Type') && !(init?.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    if (t && !headers.has('Authorization') && !isRefreshEndpoint) {
      headers.set('Authorization', `Bearer ${t}`);
    }

    return fetch(getApiUrl(url), {
      ...init,
      credentials: 'include',
      headers,
    });
  };

  let response = await makeRequest(token);

  if (response.status === 401 && !isRefreshEndpoint) {
    try {
      const errorBody = await response.clone().json().catch(() => ({}));
      if (errorBody?.code === 'TOKEN_EXPIRED' || errorBody?.code === 'NO_TOKEN' || !errorBody?.code) {
        const newToken = await performRefresh();
        if (newToken) {
          response = await makeRequest(newToken);
        } else if (lastRefreshFailure !== 'transient') {
          window.dispatchEvent(new Event('bwenge:session-expired'));
        }
      } else if (lastRefreshFailure !== 'transient') {
        window.dispatchEvent(new Event('bwenge:session-expired'));
      }
    } catch {
      if (lastRefreshFailure !== 'transient') window.dispatchEvent(new Event('bwenge:session-expired'));
    }
  }

  return response;
}
