import { useEffect, useState } from 'react';

/**
 * "MySEB Web": the browser way in, for iPhones and for anyone without the app, on tests the lecturer opened to browsers.
 * A browser cannot lock a device, so this only WATCHES: it tells the lecturer when the student leaves the page, copies, pastes,
 * leaves full screen or opens developer tools, keeps a heartbeat, and covers the page when the lecturer pauses or ends the student.
 * It runs only when the browser holds a MySEB Web session (a secure cookie it cannot read itself), and says so with data-myseb so the
 * camera / screen sharing of the live room works too.
 */
type Phase = 'off' | 'active' | 'paused' | 'ended' | 'lost';
const BAD_KEY = (e: KeyboardEvent) => {
  const k = e.key.toLowerCase(); const ctrl = e.ctrlKey || e.metaKey;
  if (k === 'f12' || (ctrl && e.shiftKey && ['i', 'j', 'c'].includes(k))) return 'devtools';
  if (ctrl && ['u', 'p', 's'].includes(k)) return 'shortcut';
  return null;
};

export default function MySebWebGuard() {
  const [phase, setPhase] = useState<Phase>('off');

  useEffect(() => {
    let stopped = false; let hb = 0; let hidden = 0; let blur = 0;
    const undo: Array<() => void> = [];
    const on = <T extends EventTarget>(t: T, ev: string, fn: (e: any) => void, cap = false) => { t.addEventListener(ev, fn, cap); undo.push(() => t.removeEventListener(ev, fn, cap)); };
    (async () => {
      let path = '';
      try { path = (await (await fetch('/api/myseb/status')).json()).webJoinPath ?? ''; } catch { /* not configured */ }
      if (!path || stopped) return;
      const me = await fetch(`${path}/api/web/me`, { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!me?.active || stopped) return;
      document.documentElement.dataset.myseb = '1';                 // the live room's camera / screen sharing looks for this
      window.dispatchEvent(new Event('myseb-web-active'));

      const apply = (status: string, reload = false) => {
        const next: Phase = status === 'IN_EXAM' ? 'active' : status === 'ENDED' ? 'ended' : 'paused';
        setPhase((cur) => { if (reload && cur === 'paused' && next === 'active') window.setTimeout(() => window.location.reload(), 50); return next; });
      };
      apply(me.status);
      const post = (route: string, body?: unknown) => fetch(`${path}/api/${route}`, { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
        .then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) })).catch(() => null);
      const beat = async () => { const r = await post('heartbeat'); if (!r) return; if (r.status === 401 || r.status === 403) setPhase('lost'); else if (r.json?.status) apply(r.json.status, true); };
      hb = window.setInterval(beat, 5000);
      const report = async (type: string) => { const r = await post('violation', { type, detail: { via: 'browser' } }); if (r?.json?.status) apply(r.json.status); };

      // Leaving the page: another tab, another app, the screen locked. A glance shorter than 1.5 s is not reported.
      on(document, 'visibilitychange', () => { window.clearTimeout(hidden); if (document.hidden) hidden = window.setTimeout(() => void report('visibility_hidden'), 1500); });
      on(window, 'blur', () => { window.clearTimeout(blur); blur = window.setTimeout(() => { if (!document.hasFocus() && !document.hidden) void report('blur'); }, 1500); });
      on(window, 'focus', () => window.clearTimeout(blur));
      on(window, 'pagehide', () => { void report('background'); });
      // No copying, pasting or right-click; developer-tool and print shortcuts are caught.
      for (const t of ['copy', 'cut', 'paste']) on(document, t, (e) => { e.preventDefault(); void report(t); }, true);
      on(document, 'contextmenu', (e) => e.preventDefault(), true);
      on(window, 'keydown', (e: KeyboardEvent) => { const bad = BAD_KEY(e); if (bad) { e.preventDefault(); void report(bad); } }, true);
      on(window, 'beforeunload', (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; });
      // Full screen where the browser allows it (computers; not iPhones).
      if (document.documentElement.requestFullscreen) {
        const goFull = () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => undefined); };
        on(document, 'click', goFull); on(document, 'keydown', goFull);
        on(document, 'fullscreenchange', () => { if (!document.fullscreenElement) void report('fullscreen_exit'); });
      }
    })();
    return () => { stopped = true; window.clearInterval(hb); window.clearTimeout(hidden); window.clearTimeout(blur); undo.forEach((f) => f()); };
  }, []);

  if (phase === 'off') return null;
  const covered = phase !== 'active';
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[90] bg-amber-800 px-3 py-1.5 text-center text-xs font-semibold text-amber-50">
        You are taking this test in the browser (lighter security). Stay on this page.
      </div>
      {covered && (
        <div role="alert" className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/95 p-6 text-center text-slate-100">
          <div className="max-w-sm space-y-3">
            <p className="text-xl font-bold">{phase === 'ended' ? 'Your test has ended' : phase === 'lost' ? 'The connection to your test was lost' : 'Your test is paused'}</p>
            <p className="text-sm text-slate-300">
              {phase === 'ended' ? 'You can close this page.' : phase === 'lost' ? 'Reload this page. If it does not come back, tell your lecturer.' : 'You left the test page, so your lecturer was told. Wait for them to let you continue.'}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
