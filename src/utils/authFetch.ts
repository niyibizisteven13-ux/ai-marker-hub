let currentAccessToken: string | null = null;
let tokenExpiresAt: number = 0;
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null, expiresInSeconds: number = 900) {
  currentAccessToken = token;
  tokenExpiresAt = token ? Date.now() + expiresInSeconds * 1000 : 0;
}

export function getAccessToken(): string | null {
  return currentAccessToken;
}

async function performRefresh(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'bwenge',
        },
        credentials: 'include',
      });

      if (!response.ok) {
        setAccessToken(null);
        return null;
      }

      const data = await response.json();
      if (data?.accessToken) {
        setAccessToken(data.accessToken, data.expiresIn || 900);
        return data.accessToken;
      }

      setAccessToken(null);
      return null;
    } catch (err) {
      setAccessToken(null);
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
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
  const isAuthEndpoint = url.includes('/api/auth/');

  let token = currentAccessToken;

  // If token is about to expire or missing, and not calling auth endpoints, try silent refresh first
  if (!isAuthEndpoint && (!token || tokenExpiresAt - Date.now() < 30 * 1000)) {
    token = await performRefresh();
  }

  const makeRequest = async (t: string | null) => {
    const headers = new Headers(init?.headers ?? {});

    if (!headers.has('Content-Type') && !(init?.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    if (t && !headers.has('Authorization') && !isAuthEndpoint) {
      headers.set('Authorization', `Bearer ${t}`);
    }

    return fetch(input, {
      ...init,
      credentials: 'include',
      headers,
    });
  };

  let response = await makeRequest(token);

  if (response.status === 401 && !isAuthEndpoint) {
    try {
      const errorBody = await response.clone().json().catch(() => ({}));
      if (errorBody?.code === 'TOKEN_EXPIRED' || !errorBody?.code) {
        const newToken = await performRefresh();
        if (newToken) {
          response = await makeRequest(newToken);
        } else {
          window.dispatchEvent(new Event('bwenge:session-expired'));
        }
      } else {
        window.dispatchEvent(new Event('bwenge:session-expired'));
      }
    } catch {
      window.dispatchEvent(new Event('bwenge:session-expired'));
    }
  }

  return response;
}
