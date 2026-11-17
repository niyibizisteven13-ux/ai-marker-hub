import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

declare const __BWENGE_BUILD__: string;
export const CHECK_EVERY_MS = 60_000;
export default function UpdateBanner() {
  const ownBuild = useRef(typeof __BWENGE_BUILD__ === 'string' ? __BWENGE_BUILD__ : null);
  const pendingBuild = useRef<string | null>(null);
  const deferredBuild = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let stop = false;
    const check = async () => {
      try {
        // Same-origin build artifact: compares the installed page with the deployed frontend, including after offline startup.
        const r = await fetch(`/build.json?t=${Date.now()}`, { cache: 'no-store' });
        const b = r.ok ? await r.json() : null;
        const build = typeof b?.build === 'string' ? b.build : null;
        if (!stop && build && build !== 'dev' && ownBuild.current && build !== ownBuild.current && build !== deferredBuild.current) { pendingBuild.current = build; setReady(true); }
      } catch { /* Offline: leave current work alone and retry on reconnect. */ }
    };
    void check();
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    const visible = () => { if (document.visibilityState === 'visible') void check(); };
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', visible);
    return () => { stop = true; window.clearInterval(timer); window.removeEventListener('online', check); document.removeEventListener('visibilitychange', visible); };
  }, []);
  const update = async () => {
    setBusy(true); setError('');
    if (!navigator.onLine) { setError('You are offline. Reconnect to update.'); setBusy(false); return; }
    try {
      const r = await fetch(`/build.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error();
      const b = await r.json(); if (!b?.build) throw new Error();
      if ('serviceWorker' in navigator) { const registration = await navigator.serviceWorker.getRegistration(); await registration?.update(); }
      window.location.reload();
    } catch { setError('Could not download the update. Please try again.'); setBusy(false); }
  };
  if (!ready) return null;
  return <div role="status" className="fixed inset-x-3 bottom-3 z-[250] mx-auto max-w-md rounded-2xl border border-white/10 bg-[#14161b] p-4 text-sm text-white shadow-2xl">
    <div className="flex items-center gap-3"><RefreshCw size={18} className="shrink-0 text-[#F6B94A]" /><div className="min-w-0 flex-1"><b>Bwenge update available</b><p className="mt-1 text-xs text-neutral-300">Update to get the latest changes. Finish or save your work first; the app will reload.</p></div></div>
    {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
    <div className="mt-3 flex justify-end gap-2"><button disabled={busy} onClick={() => { deferredBuild.current = pendingBuild.current; setReady(false); }} className="min-h-10 rounded-xl px-4 text-neutral-300">Later</button><button disabled={busy} onClick={() => void update()} className="min-h-10 rounded-xl bg-[#F6B94A] px-4 font-semibold text-black">{busy ? 'Updating…' : 'Update now'}</button></div>
  </div>;
}
