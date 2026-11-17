import { useState } from 'react';
import { Fingerprint, KeyRound, Loader2 } from 'lucide-react';
import { setAccessToken } from '../utils/authFetch';
import { PasskeyProblem, explain, signInWithPasskey, signInWithRecoveryCode, wasCancelled } from '../auth/passkeys';

/**
 * The second step of sign-in for accounts that asked for a passkey: the phone checks the fingerprint, face or screen lock.
 * A recovery code (given once when the passkey was added) is the way in if the phone is lost.
 */
export function MfaStep({ onDone }: { onDone: (next: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [useCode, setUseCode] = useState(false);
  const [code, setCode] = useState('');

  const finish = (r: { accessToken: string; expiresIn: number; next: string }) => { setAccessToken(r.accessToken, r.expiresIn || 900); onDone(r.next || '/chat'); };
  const fail = (e: unknown) => {
    if (e instanceof PasskeyProblem && e.code === 'TICKET_EXPIRED') { setExpired(true); setMsg(e.message); return; }
    if (!wasCancelled(e)) setMsg(explain(e) + (e instanceof PasskeyProblem && e.triesLeft ? ` (${e.triesLeft} ${e.triesLeft === 1 ? 'try' : 'tries'} left)` : ''));
  };
  const withPasskey = async () => { setBusy(true); setMsg(null); try { finish(await signInWithPasskey()); } catch (e) { fail(e); } finally { setBusy(false); } };
  const withCode = async (ev: React.FormEvent) => { ev.preventDefault(); if (!code.trim()) return; setBusy(true); setMsg(null); try { finish(await signInWithRecoveryCode(code)); } catch (e) { fail(e); } finally { setBusy(false); } };

  return (
    <div className="auth" aria-busy={busy} role="group" aria-label="Second step">
      <h2 style={{ fontSize: '1.15rem', margin: '0 0 6px' }}>Confirm it is you</h2>
      <p style={{ opacity: 0.75, fontSize: '0.9rem', margin: '0 0 16px' }}>This account asks for your fingerprint or face after you sign in.</p>
      {!expired && !useCode && (
        <>
          <button type="button" className="pill" onClick={() => void withPasskey()} disabled={busy} style={{ minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Fingerprint size={20} />} Use fingerprint or face
          </button>
          <button type="button" onClick={() => { setUseCode(true); setMsg(null); }} style={{ background: 'none', border: 0, marginTop: 14, textDecoration: 'underline', cursor: 'pointer', color: 'inherit', opacity: 0.8 }}>I lost my phone: use a recovery code</button>
        </>
      )}
      {!expired && useCode && (
        <form onSubmit={withCode}>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="abcd-efgh" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} aria-label="Recovery code"
            style={{ width: '100%', minHeight: 48, padding: '0 14px', borderRadius: 12, border: '1px solid rgba(128,128,128,.4)', background: 'transparent', color: 'inherit', fontFamily: 'monospace', fontSize: '1.05rem' }} />
          <button type="submit" className="pill" disabled={busy || !code.trim()} style={{ minHeight: 48, marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%' }}>
            {busy ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={18} />} Use recovery code
          </button>
          <button type="button" onClick={() => { setUseCode(false); setMsg(null); }} style={{ background: 'none', border: 0, marginTop: 12, textDecoration: 'underline', cursor: 'pointer', color: 'inherit', opacity: 0.8 }}>Back</button>
        </form>
      )}
      {expired && <button type="button" className="pill" onClick={() => { window.location.href = '/'; }} style={{ minHeight: 48 }}>Sign in again</button>}
      {msg && <p role="alert" style={{ color: '#f87171', fontSize: '0.88rem', marginTop: 12 }}>{msg}</p>}
    </div>
  );
}
