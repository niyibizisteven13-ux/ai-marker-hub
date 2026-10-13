import { setAccessToken, getAccessToken } from '../utils/authFetch';

export interface User {
  id: string;
  name: string;
  email?: string;
  role: 'user' | 'admin' | 'ADMIN';
  avatarUrl?: string;
  locale?: string;
}

export type AuthErrorCode =
  | 'invalid_email'
  | 'code_invalid'
  | 'rate_limited'
  | 'google_failed'
  | 'google_unverified'
  | 'in_app_browser'
  | 'network'
  | 'server_error'
  | 'unauthorized'
  | 'unknown';

export class AuthError extends Error {
  constructor(public code: AuthErrorCode, message?: string, public retryAfter?: number) {
    super(message ?? code);
  }
}

export interface AuthService {
  me(): Promise<User | null>;
  requestEmailOtp(i: { email: string; locale?: string }): Promise<{ retryAfter: number }>;
  verifyEmailOtp(i: { email: string; code: string }): Promise<{ user: User; isNewUser: boolean }>;
  loginWithGoogle(next?: string): void;
  updateProfile(i: { name?: string; locale?: string }): Promise<User>;
  logout(): Promise<void>;
}

export const authService: AuthService = {
  async me() {
    try {
      const token = localStorage.getItem('bwenge_auth_token') || getAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/auth/me', { headers, credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.user) return data.user;
      }
    } catch {}
    return null;
  },

  async requestEmailOtp({ email, locale }) {
    try {
      const res = await fetch('/api/auth/email/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'bwenge' },
        credentials: 'include',
        body: JSON.stringify({ email, locale: locale || 'en' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        throw new AuthError('rate_limited', 'Too many attempts', data.error?.retryAfter || 60);
      }
      if (!res.ok) {
        throw new AuthError(data.error?.code || 'network', data.error?.message || 'Failed to send code');
      }
      return { retryAfter: data.retryAfter || 30 };
    } catch (err: any) {
      if (err instanceof AuthError) throw err;
      throw new AuthError('network', err.message || 'Network error');
    }
  },

  async verifyEmailOtp({ email, code }) {
    try {
      const res = await fetch('/api/auth/email/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'bwenge' },
        credentials: 'include',
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.user) {
        throw new AuthError(data.error?.code || 'code_invalid', 'Invalid or expired code');
      }
      if (data.accessToken) {
        setAccessToken(data.accessToken, data.expiresIn || 900);
        try { localStorage.setItem('bwenge_auth_token', data.accessToken); } catch {}
      }
      return { user: data.user, isNewUser: !!data.isNewUser };
    } catch (err: any) {
      if (err instanceof AuthError) throw err;
      throw new AuthError('code_invalid', err.message || 'Verification failed');
    }
  },

  loginWithGoogle(next?: string) {
    const nextParam = next ? `?next=${encodeURIComponent(next)}` : '';
    window.location.href = `/api/auth/google/start${nextParam}`;
  },

  async updateProfile({ name, locale }) {
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'bwenge' },
        credentials: 'include',
        body: JSON.stringify({ name, locale }),
      });
      const data = await res.json();
      if (!res.ok || !data.user) {
        throw new Error(data.error?.message || 'Failed to update profile');
      }
      return data.user;
    } catch (err: any) {
      throw new Error(err.message || 'Failed to update profile');
    }
  },

  async logout() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'X-Requested-With': 'bwenge' },
        credentials: 'include',
      });
    } catch {}
    setAccessToken(null);
    try {
      localStorage.removeItem('bwenge_auth_token');
    } catch {}
  },
};
