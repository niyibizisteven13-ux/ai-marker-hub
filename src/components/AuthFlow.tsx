import React, { useState, useEffect } from 'react';
import { authService, AuthError } from '../auth/authService';
import { normalizePhone, maskPhone, sanitizeNext } from '../auth/validators';
import { PasswordField } from './PasswordField';
import { OtpField } from './OtpField';
import { Spinner } from './Spinner';

export type AuthStep = 'start' | 'password' | 'phone' | 'otp';

export function AuthFlow({
  t,
  onLoginSuccess,
  onCreateAccount,
  onTerms,
  onPrivacy,
}: {
  t: (key: string, params?: Record<string, string | number>) => string;
  onLoginSuccess: (user?: any) => void;
  onCreateAccount: () => void;
  onTerms: () => void;
  onPrivacy: () => void;
}) {
  const [step, setStep] = useState<AuthStep>('start');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [normalizedPhone, setNormalizedPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resendCountdown, setResendCountdown] = useState(0);

  useEffect(() => {
    let timer: any;
    if (resendCountdown > 0) {
      timer = setInterval(() => setResendCountdown((c) => c - 1), 1000);
    }
    return () => clearInterval(timer);
  }, [resendCountdown]);

  const handleError = (err: any) => {
    if (err instanceof AuthError) {
      if (err.code === 'invalid_credentials') setErrorMessage(t('errCreds'));
      else if (err.code === 'rate_limited') setErrorMessage(t('errRate'));
      else if (err.code === 'otp_invalid' || err.code === 'otp_expired') setErrorMessage(t('errCode'));
      else if (err.code === 'invalid_phone') setErrorMessage(t('errPhone'));
      else if (err.code === 'oauth_failed') setErrorMessage(t('errGoogle'));
      else if (err.code === 'network') setErrorMessage(t('errNet'));
      else setErrorMessage(t('errGeneric'));
    } else {
      setErrorMessage(t('errGeneric'));
    }
  };

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    const norm = normalizePhone(phoneInput);
    if (!norm) {
      setErrorMessage(t('errPhone'));
      return;
    }
    setNormalizedPhone(norm);
    setLoading(true);
    try {
      const res = await authService.requestOtp({ phone: norm });
      setResendCountdown(res.retryAfter || 30);
      setStep('otp');
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otpCode.length < 6) return;
    setErrorMessage(null);
    setLoading(true);
    try {
      const user = await authService.verifyOtp({ phone: normalizedPhone, code: otpCode });
      finishLogin(user);
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setErrorMessage(null);
    setLoading(true);
    try {
      const user = await authService.loginWithPassword({ identifier: identifier.trim(), password });
      finishLogin(user);
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMessage(null);
    setLoading(true);
    try {
      const user = await authService.loginWithGoogle();
      finishLogin(user);
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  };

  const finishLogin = (user?: any) => {
    const params = new URLSearchParams(window.location.search);
    const next = sanitizeNext(params.get('next'));
    onLoginSuccess(user);
    if (next) {
      window.history.replaceState({}, '', next);
    }
  };

  return (
    <div className="auth" aria-busy={loading}>
      {step === 'start' && (
        <>
          <button type="button" className="pill" onClick={handleGoogleLogin} disabled={loading}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h4l2 5l-2.5 1.5a11 11 0 0 0 5 5l1.5-2.5l5 2v4a2 2 0 0 1-2 2a16 16 0 0 1-15-15a2 2 0 0 1 2-2"/></svg>
            <span>{t('phone')}</span>
          </button>
          <button type="button" className="pill" onClick={handleGoogleLogin} disabled={loading}>
            <svg viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.4673-.8059 5.9564-2.1805l-2.9087-2.2581c-.8059.54-1.8368.859-3.0477.859-2.344 0-4.3282-1.5831-5.036-3.7104H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z" />
              <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.2822-1.1168-.2822-1.71s.1023-1.17.2823-1.71V4.9582H.9573C.3477 6.1732 0 7.5477 0 9s.3477 2.8268.9573 4.0418L3.964 10.71z" />
              <path fill="#EA4335" d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.426 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.656 3.5795 9 3.5795z" />
            </svg>
            <span>{t('google')}</span>
          </button>

          <div className="or">
            <span>{t('or')}</span>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (identifier.trim()) setStep('password');
            }}
          >
            <div className={`field ${errorMessage ? 'error' : ''}`}>
              <label htmlFor="id">{t('label')}</label>
              <input
                id="id"
                type="text"
                autoComplete="username"
                inputMode="email"
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value);
                  setErrorMessage(null);
                }}
              />
            </div>
            {errorMessage && <p role="alert" className="err">{errorMessage}</p>}
            <button
              type="submit"
              className="go"
              id="go"
              disabled={identifier.trim().length === 0 || loading}
              style={{ width: '100%', marginTop: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            >
              {loading && <Spinner />}
              <span>{t('cont')}</span>
            </button>
          </form>

          <p className="legal">
            {t('l1')}{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); onTerms(); }}>
              {t('terms')}
            </a>{' '}
            {t('l2')}{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); onPrivacy(); }}>
              {t('privacy')}
            </a>
            .
          </p>
        </>
      )}

      {step === 'password' && (
        <form onSubmit={handlePasswordSubmit}>
          <div className="back-row">
            <button
              type="button"
              className="back-btn"
              onClick={() => {
                setStep('start');
                setPassword('');
                setErrorMessage(null);
              }}
            >
              ← {t('back')}
            </button>
            <span style={{ fontSize: '13px', color: 'var(--muted)', fontWeight: 500 }}>{identifier}</span>
          </div>

          <PasswordField
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setErrorMessage(null);
            }}
            label={t('password')}
            error={!!errorMessage}
            showLabel={t('showPw')}
            hideLabel={t('hidePw')}
          />
          {errorMessage && <p role="alert" className="err">{errorMessage}</p>}

          <button
            type="submit"
            className="go"
            disabled={!password.trim() || loading}
            style={{ width: '100%', marginTop: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          >
            {loading && <Spinner />}
            <span>{t('signin')}</span>
          </button>
        </form>
      )}

      {step === 'phone' && (
        <form onSubmit={handlePhoneSubmit}>
          <div className="back-row">
            <button
              type="button"
              className="back-btn"
              onClick={() => {
                setStep('start');
                setPhoneInput('');
                setErrorMessage(null);
              }}
            >
              ← {t('back')}
            </button>
          </div>

          <div className={`field ${errorMessage ? 'error' : ''}`}>
            <label htmlFor="phone">{t('phoneLabel')}</label>
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              placeholder="+250 788 123 456"
              value={phoneInput}
              onChange={(e) => {
                setPhoneInput(e.target.value);
                setErrorMessage(null);
              }}
              autoFocus
            />
          </div>
          {errorMessage && <p role="alert" className="err">{errorMessage}</p>}

          <button
            type="submit"
            className="go"
            disabled={!phoneInput.trim() || loading}
            style={{ width: '100%', marginTop: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          >
            {loading && <Spinner />}
            <span>{t('sendCode')}</span>
          </button>
        </form>
      )}

      {step === 'otp' && (
        <form onSubmit={handleOtpSubmit}>
          <div className="back-row">
            <button
              type="button"
              className="back-btn"
              onClick={() => {
                setStep('phone');
                setOtpCode('');
                setErrorMessage(null);
              }}
            >
              ← {t('back')}
            </button>
          </div>

          <p style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--muted)' }}>
            {t('codeSent', { phone: maskPhone(normalizedPhone) })}
          </p>

          <OtpField
            value={otpCode}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, '').slice(0, 6);
              setOtpCode(val);
              setErrorMessage(null);
              if (val.length === 6) {
                // auto submit
              }
            }}
            label={t('codeLabel')}
            error={!!errorMessage}
          />
          {errorMessage && <p role="alert" className="err">{errorMessage}</p>}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
            <button
              type="button"
              disabled={resendCountdown > 0 || loading}
              onClick={async () => {
                setResendCountdown(30);
                await authService.requestOtp({ phone: normalizedPhone });
              }}
              style={{ background: 'none', border: 0, color: resendCountdown > 0 ? 'var(--muted)' : 'var(--accent-text)', fontSize: '13px', fontWeight: 600, cursor: resendCountdown > 0 ? 'not-allowed' : 'pointer', padding: 0 }}
            >
              {resendCountdown > 0 ? t('resendIn', { s: resendCountdown }) : t('resend')}
            </button>
          </div>

          <button
            type="submit"
            className="go"
            disabled={otpCode.length < 6 || loading}
            style={{ width: '100%', marginTop: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          >
            {loading && <Spinner />}
            <span>{t('verify')}</span>
          </button>
        </form>
      )}
    </div>
  );
}
