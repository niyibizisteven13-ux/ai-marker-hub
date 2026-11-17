import { useCallback, useEffect, useRef, useState } from 'react';
import { Fingerprint, Loader2, Lock } from 'lucide-react';
import { readAppLock, shouldLock, writeAppLock } from '../auth/appLock';
import { authService } from '../auth/authService';
import { PasskeyProblem, confirmWithPasskey, explain, wasCancelled } from '../auth/passkeys';

/**
 * Opens with the fingerprint or face on a phone that switched "Lock the app" on (Settings → Security). It covers the whole screen when
 * the app is opened and when it comes back after the chosen time away. The check is real (the server verifies the passkey), but this is a
 * screen lock on top of an existing sign-in: it keeps a borrowed or unattended phone out, it does not replace signing in.
 */
export default function AppLock() {
  const [locked, setLocked] = useState(() => { try { return shouldLock(readAppLock(), null); } catch { return false; } });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenAt.current = Date.now(); return; }
      const away = hiddenAt.current === null ? 0 : Date.now() - hiddenAt.current; hiddenAt.current = null;
      if (shouldLock(readAppLock(), away)) setLocked(true);
    };
    const onConfig = () => { if (!readAppLock().on) setLocked(false); };
    document.addEventListener('visibilitychange', onVisibility); window.addEventListener('bwenge:applock-changed', onConfig);
    return () => { document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('bwenge:applock-changed', onConfig); };
  }, []);

  const unlock = useCallback(async () => {
    setBusy(true); setMsg(null);
    try { await confirmWithPasskey('unlock'); setLocked(false); }
    catch (e) {
      if (e instanceof PasskeyProblem && /No passkey|sign in/i.test(e.message)) { writeAppLock({ on: false, minutes: 1 }); setLocked(false); return; }   // the passkey is gone: do not trap the person
      if (!wasCancelled(e)) setMsg(explain(e));
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { document.documentElement.style.overflow = locked ? 'hidden' : ''; return () => { document.documentElement.style.overflow = ''; }; }, [locked]);
  if (!locked) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="App locked" className="fixed inset-0 z-[500] flex flex-col items-center justify-center gap-5 bg-[#060B12] px-6 text-center text-white">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10"><Lock size={28} /></div>
      <div><h1 className="text-xl font-semibold">Bwenge is locked</h1><p className="mt-1 text-sm text-white/60">Use your fingerprint or face to continue.</p></div>
      <button type="button" onClick={() => void unlock()} disabled={busy} className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-[#F6B94A] px-6 text-sm font-semibold text-black disabled:opacity-60">
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Fingerprint size={20} />} Unlock
      </button>
      {msg && <p role="alert" className="max-w-xs text-sm text-rose-300">{msg}</p>}
      <button type="button" onClick={() => void (async () => { await authService.logout().catch(() => undefined); writeAppLock({ on: false, minutes: 1 }); window.location.href = '/'; })()} className="text-xs text-white/50 underline">Can’t unlock? Sign out and sign in again</button>
    </div>
  );
}
