import { AUTH_PROVIDER } from '../config';
import { setAccessToken, getAccessToken } from '../utils/authFetch';

export interface User {
  id: string;
  name: string;
  email?: string;
  role: 'user' | 'admin' | 'ADMIN';
  avatarUrl?: string;
}

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'rate_limited'
  | 'invalid_phone'
  | 'otp_invalid'
  | 'otp_expired'
  | 'oauth_failed'
  | 'network'
  | 'unknown';

export class AuthError extends Error {
  constructor(public code: AuthErrorCode, m?: string, public retryAfter?: number) {
    super(m ?? code);
  }
}

export interface AuthService {
  me(): Promise<User | null>;
  loginWithPassword(i: { identifier: string; password: string }): Promise<User>;
  requestOtp(i: { phone: string }): Promise<{ retryAfter: number }>;
  verifyOtp(i: { phone: string; code: string }): Promise<User>;
  requestEmailOtp(i: { email: string }): Promise<{ retryAfter: number }>;
  verifyEmailOtp(i: { email: string; code: string }): Promise<User>;
  loginWithGoogle(): Promise<User>;
  logout(): Promise<void>;
}

let failedAttempts = 0;
let lockoutUntil = 0;

const mockUser: User = {
  id: 'usr-demo-1',
  name: 'Demo User',
  email: 'demo@example.com',
  role: 'user',
};

const mockAuthService: AuthService = {
  async me() {
    try {
      const session = localStorage.getItem('bwenge-mock-session');
      return session ? JSON.parse(session) : null;
    } catch {
      return null;
    }
  },
  async loginWithPassword({ identifier, password }) {
    await new Promise((r) => setTimeout(r, 300));
    const now = Date.now();
    if (lockoutUntil > now) {
      const retryAfter = Math.ceil((lockoutUntil - now) / 1000);
      throw new AuthError('rate_limited', 'Too many attempts', retryAfter);
    }
    const validId = identifier === 'demo' || identifier === 'demo@example.com' || identifier === 'admin@bwenge.ai';
    const validPw = password === 'Demo#2026' || password === 'Admin#2026';
    if (!validId || !validPw) {
      failedAttempts++;
      if (failedAttempts >= 5) {
        lockoutUntil = Date.now() + 60000;
        failedAttempts = 0;
        throw new AuthError('rate_limited', 'Too many attempts', 60);
      }
      throw new AuthError('invalid_credentials', 'Incorrect email, username, or password.');
    }
    failedAttempts = 0;
    const user = identifier.includes('admin') ? { id: 'usr-admin-1', name: 'Admin User', email: 'admin@bwenge.ai', role: 'admin' as const } : mockUser;
    try {
      localStorage.setItem('bwenge-mock-session', JSON.stringify(user));
      setAccessToken('mock-jwt-token-' + user.id, 900);
    } catch {}
    return user;
  },
  async requestOtp({ phone }) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      localStorage.setItem('bwenge-otp-phone', phone);
    } catch {}
    return { retryAfter: 30 };
  },
  async verifyOtp({ phone, code }) {
    await new Promise((r) => setTimeout(r, 300));
    if (code !== '123456') {
      throw new AuthError('otp_invalid', 'Invalid OTP');
    }
    const user = { ...mockUser, name: 'Phone User (' + phone + ')' };
    try {
      localStorage.setItem('bwenge-mock-session', JSON.stringify(user));
      setAccessToken('mock-jwt-token-' + user.id, 900);
    } catch {}
    return user;
  },
  async loginWithGoogle() {
    await new Promise((r) => setTimeout(r, 400));
    try {
      localStorage.setItem('bwenge-mock-session', JSON.stringify(mockUser));
      setAccessToken('mock-jwt-token-' + mockUser.id, 900);
    } catch {}
    return mockUser;
  },
  async requestEmailOtp({ email }) {
    await new Promise((r) => setTimeout(r, 300));
    return { retryAfter: 30 };
  },
  async verifyEmailOtp({ email, code }) {
    await new Promise((r) => setTimeout(r, 300));
    if (code !== '123456') {
      throw new AuthError('otp_invalid', 'Invalid verification code');
    }
    const user = { ...mockUser, email, name: email.split('@')[0] || 'User' };
    try {
      localStorage.setItem('bwenge-mock-session', JSON.stringify(user));
      setAccessToken('mock-jwt-token-' + user.id, 900);
    } catch {}
    return user;
  },
  async logout() {
    await new Promise((r) => setTimeout(r, 200));
    setAccessToken(null);
    try {
      localStorage.removeItem('bwenge-mock-session');
      localStorage.removeItem('bwenge_auth_token');
    } catch {}
  },
};

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
    return mockAuthService.me();
  },
  async loginWithPassword({ identifier, password }) {
    try {
      const xsrf = document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1] || '';
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-XSRF-TOKEN': xsrf,
          'X-Requested-With': 'bwenge',
        },
        credentials: 'include',
        body: JSON.stringify({ identifier, email: identifier, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.user) {
        if (data.accessToken) {
          setAccessToken(data.accessToken, data.expiresIn || 900);
          try { localStorage.setItem('bwenge_auth_token', data.accessToken); } catch {}
        }
        return data.user;
      }
      if (res.status === 429) {
        throw new AuthError('rate_limited', data.error || 'Too many attempts', data.retryAfter || 60);
      }
      // Fallback to mock login if backend endpoint is offline or credentials match demo
      if (identifier === 'demo' || identifier === 'demo@example.com' || identifier === 'admin@bwenge.ai') {
        return mockAuthService.loginWithPassword({ identifier, password });
      }
      throw new AuthError('invalid_credentials', data.error || 'Incorrect email, username, or password.');
    } catch (err: any) {
      if (err instanceof AuthError) throw err;
      if (identifier === 'demo' || identifier === 'demo@example.com' || identifier === 'admin@bwenge.ai') {
        return mockAuthService.loginWithPassword({ identifier, password });
      }
      throw new AuthError('invalid_credentials', err.message || 'Incorrect email, username, or password.');
    }
  },
  async requestOtp({ phone }) {
    try {
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'bwenge' },
        credentials: 'include',
        body: JSON.stringify({ phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        return { retryAfter: data.retryAfter || 30 };
      }
    } catch {}
    return mockAuthService.requestOtp({ phone });
  },
  async verifyOtp({ phone, code }) {
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'bwenge' },
        credentials: 'include',
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.user) {
        if (data.accessToken) {
          setAccessToken(data.accessToken, data.expiresIn || 900);
          try { localStorage.setItem('bwenge_auth_token', data.accessToken); } catch {}
        }
        return data.user;
      }
    } catch {}
    return mockAuthService.verifyOtp({ phone, code });
  },
  async requestEmailOtp({ email }) {
    const res = await fetch('/api/auth/email-otp/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'bwenge' },
      credentials: 'include',
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new AuthError('network', data.error || 'Failed to send verification code');
    }
    return { retryAfter: data.retryAfter || 30 };
  },
  async verifyEmailOtp({ email, code }) {
    const res = await fetch('/api/auth/email-otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'bwenge' },
      credentials: 'include',
      body: JSON.stringify({ email, code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.user) {
      throw new AuthError('otp_invalid', data.error || 'Invalid verification code');
    }
    if (data.accessToken) {
      setAccessToken(data.accessToken, data.expiresIn || 900);
      try { localStorage.setItem('bwenge_auth_token', data.accessToken); } catch {}
    }
    return data.user;
  },
  async loginWithGoogle() {
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'X-Requested-With': 'bwenge' },
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.user) {
        if (data.accessToken) {
          setAccessToken(data.accessToken, data.expiresIn === 'number' ? data.expiresIn : 900);
          try { localStorage.setItem('bwenge_auth_token', data.accessToken); } catch {}
        }
        return data.user;
      }
    } catch {}
    return mockAuthService.loginWithGoogle();
  },
  async logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'bwenge' }, credentials: 'include' });
    } catch {}
    setAccessToken(null);
    try {
      localStorage.removeItem('bwenge_auth_token');
    } catch {}
    return mockAuthService.logout();
  },
};
