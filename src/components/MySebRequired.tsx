import { useEffect, useState } from 'react';

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
      className={`flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold ${primary ? 'bg-slate-900 text-white hover:bg-slate-800' : 'border border-slate-300 text-slate-800 hover:bg-slate-50'}`}>
      {children}
    </a>
  );
}

export default function MySebRequired({ code = 'MYSEB_REQUIRED', page = false }: { code?: string; page?: boolean }) {
  const [links, setLinks] = useState<Links>(NONE);
  useEffect(() => {
    fetch('/api/myseb/status').then((r) => (r.ok ? r.json() : null)).then((b) => b?.links && setLinks({ ...NONE, ...b.links })).catch(() => undefined);
  }, []);
  const copy = page ? { title: 'Get MySEB', text: 'MySEB is the secure exam app. Install it on the device you will use for your test, then enter the code your lecturer gives you.' } : (COPY[code] ?? COPY.MYSEB_REQUIRED);
  const blocked = code === 'MYSEB_PAUSED' || code === 'MYSEB_ENDED';
  const any = Object.values(links).some(Boolean);

  return (
    <div className={`mx-auto max-w-xl space-y-5 rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm sm:p-8 ${page ? 'my-10' : ''}`}>
      <div>
        <h1 className="text-xl font-bold text-slate-900">{copy.title}</h1>
        <p className="mt-2 text-sm text-slate-600">{copy.text}</p>
      </div>
      {!blocked && (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>Install MySEB (below) on your laptop or phone.</li>
            <li>Open MySEB and type the <b>exam code</b> from your lecturer.</li>
            <li>The test opens inside MySEB. Do not switch apps or windows: leaving is recorded and can pause your test.</li>
          </ol>
          <a href="myseb://join" className="flex min-h-11 items-center justify-center rounded-xl bg-[#B4502F] px-4 text-sm font-bold text-white hover:bg-[#C45A37]">I already have MySEB: open it</a>
          <div className="grid gap-2 sm:grid-cols-2">
            {links.windows && <Btn href={links.windows}>Windows app</Btn>}
            {links.mac && <Btn href={links.mac}>Mac app</Btn>}
            {links.linux && <Btn href={links.linux}>Linux app</Btn>}
            {links.android && <Btn href={links.android}>Android app</Btn>}
            {links.ios && <Btn href={links.ios}>iPhone / iPad app</Btn>}
            {links.extension && <Btn href={links.extension}>Chrome extension (only if your lecturer allows it)</Btn>}
          </div>
          {!any && <p className="text-xs text-slate-500">Ask your lecturer where to download MySEB.</p>}
          <p className="text-xs text-slate-500">The app is the safest choice. The Chrome extension cannot lock your computer, so it is only for tests where your lecturer allows it.</p>
        </>
      )}
    </div>
  );
}
