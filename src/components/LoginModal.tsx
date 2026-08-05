import React, { useState } from 'react';
import { User } from '../types';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: User, token: string) => void;
}

export default function LoginModal({ isOpen, onClose, onLoginSuccess }: LoginModalProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    const endpoint = isSignUp ? '/api/auth/signup' : '/api/auth/login';
    const payload = isSignUp ? { name, email, password } : { email, password };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      let data: any = {};

      if (responseText) {
        try {
          data = JSON.parse(responseText);
        } catch {
          throw new Error(
            `Server returned an invalid JSON response (${response.status}). Check whether the backend is running and returning JSON.`
          );
        }
      }

      if (!response.ok) {
        throw new Error(data?.error || `Authentication failed with status ${response.status}.`);
      }

      if (!data?.token || !data?.user) {
        throw new Error('Authentication response missing token or user data.');
      }

      onLoginSuccess(data.user, data.token);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Unable to connect to authentication server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="relative w-full max-w-md rounded-3xl border border-slate-700/90 bg-[#0B111A] p-6 shadow-2xl text-slate-100">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full bg-slate-800/80 px-3 py-2 text-slate-300 hover:text-white"
          aria-label="Close login modal"
        >
          ✕
        </button>

        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-orange-500/15 text-orange-300 text-lg">✦</span>
          <div>
            <h2 className="text-lg font-semibold">{isSignUp ? 'Create Bwenge Account' : 'Sign In to Bwenge'}</h2>
            <p className="text-xs text-slate-500">Secure your marker workspace with email-based access.</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignUp && (
            <label className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Full Name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-[#0D111A] px-4 py-3 text-sm text-slate-100 outline-none focus:border-orange-500"
                placeholder="Jane Doe"
                required
              />
            </label>
          )}

          <label className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Email address
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-[#0D111A] px-4 py-3 text-sm text-slate-100 outline-none focus:border-orange-500"
              placeholder="teacher@school.edu"
              required
            />
          </label>

          <label className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-[#0D111A] px-4 py-3 text-sm text-slate-100 outline-none focus:border-orange-500"
              placeholder="••••••••"
              required
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Working…' : isSignUp ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <div className="mt-4 border-t border-slate-800 pt-4 text-center text-xs text-slate-500">
          <button
            type="button"
            onClick={() => setIsSignUp((value) => !value)}
            className="font-medium text-slate-300 hover:text-orange-300"
          >
            {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
          </button>
        </div>
      </div>
    </div>
  );
}
