import React, { useState, useEffect, useRef } from 'react';
import { User } from '../types';
import { setAccessToken } from '../utils/authFetch';
import { X, Eye, EyeOff, Loader2 } from 'lucide-react';

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
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const emailInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setEmail('');
      setPassword('');
      setName('');
      setError('');
      setTimeout(() => emailInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Enter a valid email');
      return;
    }
    if (password.length < 10) {
      setError('Use at least 10 characters');
      return;
    }
    if (isSignUp && (!name.trim() || name.trim().length < 2)) {
      setError('Enter your full name');
      return;
    }

    setLoading(true);

    const endpoint = isSignUp ? '/api/auth/register' : '/api/auth/login';
    const payload = isSignUp ? { name: name.trim(), email: trimmedEmail, password } : { email: trimmedEmail, password };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 429) {
          setError('Too many attempts. Try again in 15 minutes.');
        } else {
          setError(data?.error || 'Email or password is incorrect');
        }
        setPassword('');
        setLoading(false);
        return;
      }

      if (!data?.accessToken || !data?.user) {
        setError('Authentication response missing token or user data');
        setLoading(false);
        return;
      }

      setAccessToken(data.accessToken, data.expiresIn || 900);
      setPassword('');
      onLoginSuccess(data.user, data.accessToken);
      onClose();
    } catch (err: any) {
      setError('Unable to connect to authentication server');
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end lg:items-center justify-center bg-black/75 backdrop-blur-sm p-0 lg:p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="relative w-full lg:max-w-md rounded-t-[28px] lg:rounded-3xl border border-white/10 bg-[#262624] p-6 lg:p-8 shadow-2xl text-[#FAF9F5] max-h-[90dvh] overflow-y-auto"
        style={{ backgroundColor: '#262624' }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 h-11 w-11 grid place-items-center rounded-full bg-[#30302E] text-neutral-300 hover:text-white transition-colors"
          aria-label="Close login modal"
        >
          <X size={20} />
        </button>

        <div className="mb-6 flex items-center gap-3.5">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#D97757]/15 text-[#D97757] text-xl">✦</span>
          <div>
            <h2 className="text-xl font-serif font-medium">{isSignUp ? 'Create account' : 'Sign in to Bwenge'}</h2>
            <p className="text-xs text-neutral-400">Secure AI grading workspace for teachers</p>
          </div>
        </div>

        {error && (
          <div role="alert" className="mb-5 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3.5 text-xs text-rose-300 font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignUp && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
                Full name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-[#30302E] px-4 py-3.5 text-base text-white outline-none focus:border-[#D97757] transition"
                placeholder="Jane Doe"
                autoComplete="name"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
              Email address
            </label>
            <input
              ref={emailInputRef}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-[#30302E] px-4 py-3.5 text-base text-white outline-none focus:border-[#D97757] transition"
              placeholder="teacher@school.edu"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-[#30302E] px-4 py-3.5 pr-12 text-base text-white outline-none focus:border-[#D97757] transition"
                placeholder="At least 10 characters"
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10 grid place-items-center text-neutral-400 hover:text-white"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs pt-1">
            <span className="text-neutral-500">Min 10 characters</span>
            <button
              type="button"
              onClick={() => alert('Password reset will be available in Phase 2.')}
              className="text-[#D97757] hover:underline"
            >
              Forgot password?
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-2xl bg-[#D97757] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-[#D97757]/25 transition hover:bg-[#c86849] disabled:cursor-not-allowed disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            {loading ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <div className="mt-6 border-t border-white/10 pt-5 text-center text-xs text-neutral-400">
          <button
            type="button"
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError('');
            }}
            className="font-medium text-white hover:text-[#D97757] transition"
          >
            {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Create one"}
          </button>
        </div>
      </div>
    </div>
  );
}
