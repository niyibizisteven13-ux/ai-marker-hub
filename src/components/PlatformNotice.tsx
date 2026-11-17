import { useEffect, useState } from 'react';

/**
 * What the administrator tells everyone: an announcement line at the top, and, in maintenance mode, a full-page message. The admin pages
 * and sign-in stay reachable (the server leaves them open), so the administrator can turn maintenance off.
 */
interface Status { maintenance: { on: boolean; message?: string }; announcement: { text: string; level: 'info' | 'warning' | 'critical' } | null }
const TONE = { info: 'bg-sky-800 text-sky-50', warning: 'bg-amber-700 text-amber-50', critical: 'bg-rose-800 text-rose-50' } as const;
const seenKey = 'bwenge-announcement-seen';

export default function PlatformNotice() {
  const [s, setS] = useState<Status | null>(null);
  const [hidden, setHidden] = useState('');
  useEffect(() => {
    try { setHidden(sessionStorage.getItem(seenKey) ?? ''); } catch { /* storage unavailable */ }
    let stop = false;
    const load = () => fetch('/api/platform/status', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!stop && j && typeof j === 'object') setS({ maintenance: { on: j.maintenance?.on === true, message: typeof j.maintenance?.message === 'string' ? j.maintenance.message : undefined }, announcement: j.announcement && typeof j.announcement.text === 'string' && j.announcement.text ? { text: j.announcement.text, level: (['info', 'warning', 'critical'] as const).includes(j.announcement.level) ? j.announcement.level : 'info' } : null }); }).catch(() => undefined);
    void load(); const t = window.setInterval(load, 60_000);
    return () => { stop = true; window.clearInterval(t); };
  }, []);
  if (!s) return null;
  const onAdmin = typeof window !== 'undefined' && /^\/admin(\/|$)/.test(window.location.pathname);
  if (s.maintenance.on && !onAdmin) {
    return (
      <div role="alert" className="fixed inset-0 z-[300] grid place-items-center bg-slate-950 p-6 text-center text-slate-100">
        <div className="max-w-md space-y-3">
          <p className="text-2xl font-bold">We are making Bwenge better</p>
          <p className="text-base text-slate-300">{s.maintenance.message || 'Bwenge is being updated. Please try again in a few minutes.'}</p>
          <p className="text-xs text-slate-500">Administrator? <a className="underline" href="/admin">Open the admin console</a></p>
        </div>
      </div>
    );
  }
  const a = s.announcement;
  if (!a || hidden === a.text) return null;
  return (
    <div role="status" className={`fixed inset-x-0 top-0 z-[250] flex items-center justify-center gap-3 px-3 py-1.5 text-center text-xs font-semibold ${TONE[a.level]}`}>
      <span>{a.text}</span>
      {a.level !== 'critical' && <button type="button" aria-label="Hide this message" className="rounded px-1.5 text-base leading-none opacity-80 hover:opacity-100" onClick={() => { setHidden(a.text); try { sessionStorage.setItem(seenKey, a.text); } catch { /* storage unavailable */ } }}>×</button>}
    </div>
  );
}
