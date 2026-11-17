import { useEffect, useState } from 'react';
import { PublicFooter, PublicHeader, PublicPage } from './PublicChrome';

/**
 * Shown when a test or assignment needs MySEB and the student opened it in a normal browser
 * (also the /myseb downloads page, and the "paused / ended" notice when MySEB has locked the student out).
 */
type Links = { windows: string; mac: string; linux: string; android: string; ios: string; extension: string };
const NONE: Links = { windows: '', mac: '', linux: '', android: '', ios: '', extension: '' };

const COPY: Record<string, { title: string; text: string }> = {
  MYSEB_REQUIRED: { title: 'This test must be opened in MySEB', text: 'Your lecturer turned on MySEB for this test. It locks your device while you work so the test is fair for everyone.' },
  MYSEB_PAUSED: { title: 'Your test is paused', text: 'You left the test screen, so your lecturer was told. Wait for them to let you continue, then reopen the test in MySEB.' },
  MYSEB_ENDED: { title: 'This test has ended for you', text: 'Your lecturer or the time ended your test. Contact your lecturer if you think this is a mistake.' },
  MYSEB_UNAVAILABLE: { title: 'The exam lock is unavailable', text: 'MySEB could not be reached. Wait a minute and open the test again in MySEB.' },
  MYSEB_NOT_CONFIGURED: { title: 'This test is not ready yet', text: 'The test needs MySEB but it is not set up. Tell your lecturer.' },
};

function Btn({ href, children, primary }: { href: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer"
      className={`flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold ${primary ? 'bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-90' : 'border border-[var(--line)] text-[var(--text)] hover:bg-[var(--hover)]'}`}>
      {children}
    </a>
  );
}

/** For tests the lecturer opened to browsers (iPhones, or no app): name and code, here on this page. The key becomes a secure cookie. */
function BrowserJoin({ path }: { path: string }) {
  const [name, setName] = useState(() => { try { return localStorage.getItem('myseb.name') ?? ''; } catch { return ''; } });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const join = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      let device = ''; try { device = localStorage.getItem('myseb.webDevice') ?? ''; if (!device) { device = 'web-' + crypto.randomUUID(); localStorage.setItem('myseb.webDevice', device); } localStorage.setItem('myseb.name', name.trim()); } catch { device = 'web-' + Math.random().toString(36).slice(2, 12); }
      const r = await fetch(`${path}/api/verify-code`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code.trim(), studentName: name.trim(), deviceId: device, clientType: 'web', platform: navigator.platform || 'browser' }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || 'That did not work. Check the code and try again.');
      window.location.reload();
    } catch (x) { setErr(x instanceof Error ? x.message : 'That did not work.'); setBusy(false); }
  };
  return (
    <form onSubmit={join} className="space-y-3 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 p-4">
      <h2 className="text-base font-bold text-[var(--text)]">No app? Use this browser</h2>
      <p className="text-xs leading-relaxed text-[var(--muted)]">Your lecturer allows the browser for this test (for example on an iPhone). It cannot lock your device, but it watches for you leaving the page, and your lecturer is told. Stay on this page until you finish.</p>
      <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Your name" maxLength={80} className="min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] text-[var(--text)] px-3 text-sm" />
      <input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="Exam code, like 8492-KIGALI-77" aria-label="Exam code" maxLength={24} className="min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] text-[var(--text)] px-3 text-sm tracking-wider" />
      <button type="submit" disabled={busy} className="min-h-11 w-full rounded-xl bg-[var(--accent)] px-4 text-sm font-bold text-[var(--on-accent)] hover:opacity-90 disabled:opacity-50">{busy ? 'Starting…' : 'Start the test in this browser'}</button>
      {err && <p role="alert" className="text-sm font-semibold text-[var(--danger)]">{err}</p>}
    </form>
  );
}

export default function MySebRequired({ code: rawCode = 'MYSEB_REQUIRED', page = false }: { code?: string; page?: boolean }) {
  const webAllowed = rawCode.endsWith('+WEB');
  const code = rawCode.replace('+WEB', '');
  const [links, setLinks] = useState<Links>(NONE);
  const [webPath, setWebPath] = useState('');
  const onIphone = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent);   // no app exists for these: the browser comes first
  useEffect(() => {
    fetch('/api/myseb/status').then((r) => (r.ok ? r.json() : null)).then((b) => { if (b?.links) setLinks({ ...NONE, ...b.links }); if (typeof b?.webJoinPath === 'string') setWebPath(b.webJoinPath); }).catch(() => undefined);
  }, []);
  const copy = page ? { title: 'Get MySEB', text: 'MySEB is the secure exam app. Install it on the device you will use for your test, then enter the code your lecturer gives you.' } : (COPY[code] ?? COPY.MYSEB_REQUIRED);
  const blocked = code === 'MYSEB_PAUSED' || code === 'MYSEB_ENDED';
  const any = Object.values(links).some(Boolean);

  const card = (
    <div className={`mx-auto max-w-xl space-y-5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 text-left shadow-lg shadow-black/10 sm:p-8 ${page ? 'my-10' : ''}`}>
      <div>
        <h1 className="text-xl font-bold text-[var(--text)]">{copy.title}</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">{copy.text}</p>
      </div>
      {!blocked && (
        <>
          {onIphone && webAllowed && webPath && code === 'MYSEB_REQUIRED' && <BrowserJoin path={webPath} />}
          <ol className="list-decimal space-y-1 pl-5 text-sm text-[var(--muted)]">
            <li>Install MySEB (below) on your laptop or phone.</li>
            <li>Open MySEB and type the <b>exam code</b> from your lecturer.</li>
            <li>The test opens inside MySEB. Do not switch apps or windows: leaving is recorded and can pause your test.</li>
          </ol>
          <a href="myseb://join" className="flex min-h-11 items-center justify-center rounded-xl bg-[var(--accent)] px-4 text-sm font-bold text-[var(--on-accent)] hover:opacity-90">I already have MySEB: open it</a>
          <div className="grid gap-2 sm:grid-cols-2">
            {links.windows && <Btn href={links.windows}>Windows app</Btn>}
            {links.mac && <Btn href={links.mac}>Mac app</Btn>}
            {links.linux && <Btn href={links.linux}>Linux app</Btn>}
            {links.android && <Btn href={links.android}>Android app</Btn>}
            {links.ios && <Btn href={links.ios}>iPhone / iPad app</Btn>}
            {links.extension && <Btn href={links.extension}>Chrome extension (only if your lecturer allows it)</Btn>}
          </div>
          {!any && <p className="text-xs text-[var(--muted)]">Ask your lecturer where to download MySEB.</p>}
          {!onIphone && webAllowed && webPath && code === 'MYSEB_REQUIRED' && <BrowserJoin path={webPath} />}
          {onIphone && !(webAllowed && webPath) && <p role="note" className="rounded-xl bg-[var(--accent)]/10 p-3 text-sm text-[var(--muted)]">There is no MySEB app for iPhone yet, and your lecturer has not allowed the browser for this test. Use a laptop or an Android phone, or ask your lecturer.</p>}
          <p className="text-xs text-[var(--muted)]">The app is the safest choice. The Chrome extension cannot lock your computer, so it is only for tests where your lecturer allows it.</p>
        </>
      )}
    </div>
  );
  if (!page) return card;
  return <PublicPage><PublicHeader /><main className="flex-1 px-5">{card}</main><PublicFooter /></PublicPage>;
}
