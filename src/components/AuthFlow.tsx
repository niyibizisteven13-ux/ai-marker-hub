import React, { useState, useEffect, useRef } from 'react';
import { authService, AuthError, User } from '../auth/authService';
import { Spinner } from './Spinner';
import { sanitizeNext } from '../auth/sanitizeNext';

export type AuthFlowStep = 'start' | 'email' | 'code' | 'name' | 'success';

export function AuthFlow({
  t,
  locale = 'en',
  onLoginSuccess,
  onCreateAccount,
  onTerms,
  onPrivacy,
}: {
  t: (key: string, params?: Record<string, string | number>) => string;
  locale?: string;
  onLoginSuccess: (user: User) => void;
  onCreateAccount?: () => void;
  onTerms: () => void;
  onPrivacy: () => void;
}) {
  const [step, setStep] = useState<AuthFlowStep>('start');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [isInAppBlocked, setIsInAppBlocked] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('auth_error');
    if (authError) {
      if (authError === 'google_cancelled' || authError === 'google_failed') {
        setErrorMessage(t('errGoogle'));
      } else if (authError === 'google_unverified') {
        setErrorMessage(t('errGoogleUnverified'));
      }
      params.delete('auth_error');
      const newQuery = params.toString();
      const newPath = window.location.pathname + (newQuery ? `?${newQuery}` : '');
      window.history.replaceState({}, '', newPath);
    }
  }, [t]);

  useEffect(() => {
    let timer: any;
    if (resendCountdown > 0) {
      timer = setInterval(() => setResendCountdown((c) => c - 1), 1000);
    }
    return () => clearInterval(timer);
  }, [resendCountdown]);

  useEffect(() => {
    if (firstInputRef.current) {
      firstInputRef.current.focus();
    }
  }, [step]);

  const maskEmail = (addr: string) => {
    const parts = addr.split('@');
    if (parts.length !== 2) return addr;
    const namePart = parts[0];
    const masked = namePart.length <= 2 ? namePart[0] + '***' : namePart.slice(0, 2) + '***' + namePart.slice(-1);
    return `${masked}@${parts[1]}`;
  };

  const handleGoogleClick = () => {
    setErrorMessage(null);
    const userAgent = navigator.userAgent || '';
    const inAppKeywords = ['fban', 'fbav', 'instagram', 'wechat', 'micromessenger', 'line', 'twitter', 'linkedinapp', 'snapchat', 'pinterest', 'wv', 'webview'];
    if (inAppKeywords.some((k) => userAgent.toLowerCase().includes(k))) {
      setIsInAppBlocked(true);
      setErrorMessage(t('errInApp'));
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    authService.loginWithGoogle(next || undefined);
  };

  const handleEmailStartSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setErrorMessage(t('errEmail'));
      return;
    }
    setErrorMessage(null);
    setLoading(true);
    try {
      const res = await authService.requestEmailOtp({ email: trimmed, locale });
      setResendCountdown(res.retryAfter || 30);
      setStep('code');
    } catch (err: any) {
      if (err instanceof AuthError && err.code === 'rate_limited') {
        setErrorMessage(t('errRate'));
      } else {
        setErrorMessage(t('errNetwork'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCodeVerify = async (codeToVerify?: string) => {
    const targetCode = codeToVerify || code;
    if (targetCode.length !== 6) return;
    setErrorMessage(null);
    setLoading(true);
    try {
      const { user, isNewUser } = await authService.verifyEmailOtp({ email: email.trim(), code: targetCode });
      setCurrentUser(user);
      if (isNewUser) {
        setStep('name');
      } else {
        finishSuccess(user);
      }
    } catch (err: any) {
      if (err instanceof AuthError) {
        if (err.code === 'rate_limited') setErrorMessage(t('errRate'));
        else setErrorMessage(t('errCode'));
      } else {
        setErrorMessage(t('errCode'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (name.trim()) {
        const updated = await authService.updateProfile({ name: name.trim(), locale });
        if (currentUser) setCurrentUser({ ...currentUser, name: updated.name });
        finishSuccess({ ...currentUser!, name: updated.name });
      } else {
        finishSuccess(currentUser!);
      }
    } catch {
      finishSuccess(currentUser!);
    } finally {
      setLoading(false);
    }
  };

  const finishSuccess = (user: User) => {
    setStep('success');
    const params = new URLSearchParams(window.location.search);
    const next = sanitizeNext(params.get('next'));
    onLoginSuccess(user);
    window.location.href = next;
  };

  return (
    <div className="auth" aria-busy={loading}>
      {step === 'start' && (
        <>
          <button type="button" className="pill" onClick={handleGoogleClick} disabled={loading} style={{ minHeight: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
            <svg viewBox="0 0 18 18" aria-hidden="true" style={{ width: '18px', height: '18px' }}>
              <path fill="#4285F4" d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.4673-.8059 5.9564-2.1805l-2.9087-2.2581c-.8059.54-1.8368.859-3.0477.859-2.344 0-4.3282-1.5831-5.036-3.7104H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z" />
              <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.2822-1.1168-.2822-1.71s.1023-1.17.2823-1.71V4.9582H.9573C.3477 6.1732 0 7.5477 0 9s.3477 2.8268.9573 4.0418L3.964 10.71z" />
              <path fill="#EA4335" d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.426 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.656 3.5795 9 3.5795z" />
            </svg>
            <span style={{ fontSize: '15px', fontWeight: 600 }}>{t('continueGoogle')}</span>
          </button>

          <button type="button" className="pill" onClick={() => { setStep('email'); setErrorMessage(null); }} disabled={loading} style={{ minHeight: '48px', marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
            <span style={{ fontSize: '15px', fontWeight: 600 }}>{t('continueEmail')}</span>
          </button>

          {errorMessage && (
            <div style={{ marginTop: '16px' }}>
              <p role="alert" className="err" style={{ fontSize: '13px', color: '#ff6b6b' }}>{errorMessage}</p>
              {isInAppBlocked && (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href);
                    setLinkCopied(true);
                  }}
                  style={{ marginTop: '8px', background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', padding: '8px 12px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}
                >
                  {linkCopied ? 'Link Copied!' : t('copyLink')}
                </button>
              )}
            </div>
          )}

          <p className="legal" style={{ marginTop: '24px', fontSize: '12px', color: 'var(--muted)' }}>
            By continuing, you agree to our{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); onTerms(); }}>Terms</a> and{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); onPrivacy(); }}>Privacy Policy</a>.
          </p>
        </>
      )}

      {step === 'email' && (
        <form onSubmit={handleEmailStartSubmit}>
          <div className="back-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <button
              type="button"
              className="back-btn"
              onClick={() => { setStep('start'); setErrorMessage(null); }}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '14px' }}
            >
              ← {t('back')}
            </button>
          </div>

          <div className={`field ${errorMessage ? 'error' : ''}`}>
            <label htmlFor="email-input">{t('emailLabel')}</label>
            <input
              ref={firstInputRef}
              id="email-input"
              type="email"
              autoComplete="email"
              inputMode="email"
              enterKeyHint="send"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setErrorMessage(null); }}
              style={{ minHeight: '48px', fontSize: '16px', padding: '0 14px', width: '100%', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
            />
          </div>
          {errorMessage && <p role="alert" className="err" style={{ marginTop: '8px', fontSize: '13px', color: '#ff6b6b' }}>{errorMessage}</p>}

          <button
            type="submit"
            className="go"
            disabled={!email.trim() || loading}
            style={{ width: '100%', minHeight: '48px', marginTop: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', borderRadius: '12px', background: 'var(--accent)', color: '#fff', fontWeight: 600, border: 'none', cursor: 'pointer' }}
          >
            {loading && <Spinner />}
            <span>{t('sendCode')}</span>
          </button>
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={(e) => { e.preventDefault(); handleCodeVerify(); }}>
          <div className="back-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <button
              type="button"
              className="back-btn"
              onClick={() => { setStep('email'); setCode(''); setErrorMessage(null); }}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '14px' }}
            >
              ← {t('otherEmail')}
            </button>
          </div>

          <p style={{ margin: '0 0 16px', fontSize: '14px', color: 'var(--muted)', lineHeight: '1.5' }}>
            {t('codeSentTo', { email: maskEmail(email) })}
          </p>

          <div className={`field ${errorMessage ? 'error' : ''}`}>
            <label htmlFor="code-input">{t('codeLabel')}</label>
            <input
              ref={firstInputRef}
              id="code-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                setCode(val);
                setErrorMessage(null);
                if (val.length === 6) {
                  handleCodeVerify(val);
                }
              }}
              style={{ minHeight: '48px', fontSize: '24px', letterSpacing: '8px', textAlign: 'center', padding: '0 14px', width: '100%', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
            />
          </div>
          {errorMessage && <p role="alert" className="err" style={{ marginTop: '8px', fontSize: '13px', color: '#ff6b6b' }}>{errorMessage}</p>}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px' }}>
            <button
              type="button"
              disabled={resendCountdown > 0 || loading}
              onClick={async () => {
                setResendCountdown(30);
                await authService.requestEmailOtp({ email: email.trim(), locale });
              }}
              style={{ background: 'none', border: 0, color: resendCountdown > 0 ? 'var(--muted)' : 'var(--accent-text)', fontSize: '13px', fontWeight: 600, cursor: resendCountdown > 0 ? 'not-allowed' : 'pointer', padding: 0 }}
            >
              {resendCountdown > 0 ? t('resendIn', { s: resendCountdown }) : t('resend')}
            </button>
          </div>

          <button
            type="submit"
            className="go"
            disabled={code.length < 6 || loading}
            style={{ width: '100%', minHeight: '48px', marginTop: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', borderRadius: '12px', background: 'var(--accent)', color: '#fff', fontWeight: 600, border: 'none', cursor: 'pointer' }}
          >
            {loading && <Spinner />}
            <span>{t('verify')}</span>
          </button>
        </form>
      )}

      {step === 'name' && (
        <form onSubmit={handleNameSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: '18px', fontWeight: 600, color: '#fff' }}>{t('nameQ')}</h3>
          </div>

          <div className="field">
            <input
              ref={firstInputRef}
              type="text"
              placeholder="Your full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ minHeight: '48px', fontSize: '16px', padding: '0 14px', width: '100%', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button
              type="button"
              onClick={() => finishSuccess(currentUser!)}
              style={{ flex: 1, minHeight: '48px', borderRadius: '12px', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
            >
              {t('skip')}
            </button>
            <button
              type="submit"
              className="go"
              disabled={loading}
              style={{ flex: 1, minHeight: '48px', borderRadius: '12px', background: 'var(--accent)', color: '#fff', fontWeight: 600, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            >
              {loading && <Spinner />}
              <span>{t('verify')}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
