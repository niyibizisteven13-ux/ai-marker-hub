import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getApiUrl } from '../utils/authFetch';

/**
 * "A new version of Bwenge is ready." The site tells its build (/api/app/version). The first answer is this page's own version; when a later
 * check (every 5 minutes, and when the app returns to the screen) answers differently, the banner offers a refresh. Nothing reloads by itself,
 * so a half-written message is never lost; any normal reload or reopening the app also brings the new version.
 */
export const CHECK_EVERY_MS = 5 * 60_000;
export default function UpdateBanner() {
  const first = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stop = false;
    const check = async () => {
      try {
        const r = await fetch(getApiUrl('/api/app/version'), { cache: 'no-store' });
        const b = r.ok ? await r.json() : null; const build = typeof b?.build === 'string' ? b.build : null;
        if (stop || !build || build === 'dev') return;
        if (first.current === null) first.current = build; else if (first.current !== build) setReady(true);
      } catch { /* offline: try again later */ }
    };
    void check();
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stop = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  if (!ready) return null;
  return (
    <div role="status" className="fixed inset-x-3 bottom-3 z-[250] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-white/10 bg-[#14161b] p-3 text-sm text-white shadow-2xl">
      <RefreshCw size={18} className="shrink-0 text-[#F6B94A]" />
      <span className="min-w-0 flex-1">A new version of Bwenge is ready.</span>
      <button type="button" onClick={() => window.location.reload()} className="min-h-10 shrink-0 rounded-xl bg-[#F6B94A] px-4 text-sm font-semibold text-black">Update</button>
      <button type="button" onClick={() => setReady(false)} aria-label="Later" className="shrink-0 px-1 text-neutral-400 hover:text-white">Later</button>
    </div>
  );
}
