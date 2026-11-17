import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Download, Monitor, Share, Smartphone, SquarePlus } from 'lucide-react';
import { PLATFORM_LABEL, detectPlatform, type Platform } from '../utils/device';
import { getApiUrl } from '../utils/authFetch';
import { StarsDisplay } from '../components/Stars';
import AppFeedbackForm from '../components/AppFeedbackForm';

/**
 * /get-app (public): get Bwenge on this device. The landing page's QR code and button lead here.
 *  - Bwenge is an installable web app: one tap on Android, Windows, Mac and Linux (Chrome or Edge), "Add to Home Screen" on iPhone. It updates
 *    itself every time it opens, so there is no installer to keep current.
 *  - MySEB (taking an exam) has real installers for Windows, Android, Linux and Mac; the right one for this device is shown first.
 * Presses are counted (see /api/app) so the administrator can see how many people downloaded.
 */
type Prompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
const count = (app: 'bwenge' | 'myseb', platform: Exclude<Platform, 'other'>, kind: 'click' | 'installed') => {
  try {
    const body = JSON.stringify({ app, platform, kind });
    if (!navigator.sendBeacon?.(getApiUrl('/api/app/count'), new Blob([body], { type: 'application/json' }))) void fetch(getApiUrl('/api/app/count'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
  } catch { /* counting never blocks the download */ }
};
const MYSEB: Array<{ id: Exclude<Platform, 'other' | 'ios'>; name: string; file: string }> = [
  { id: 'windows', name: 'Windows', file: '.exe installer' }, { id: 'android', name: 'Android', file: '.apk app' },
  { id: 'linux', name: 'Linux', file: '.AppImage' }, { id: 'mac', name: 'Mac', file: '.dmg' },
];
interface AppStat { downloads: number; installs: number; rating: { average: number | null; count: number } }
/** The numbers people see: the average rating and how many downloaded. Honest: "No ratings yet" until someone rates. */
function StatsRow({ stat }: { stat: AppStat | undefined }) {
  if (!stat) return null;
  const n = (x: number) => x.toLocaleString('en-US');
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-300">
      {stat.rating.average !== null
        ? <span className="inline-flex items-center gap-1.5"><StarsDisplay value={stat.rating.average} size={14} /><b className="text-white">{stat.rating.average.toFixed(1)}</b><span className="text-neutral-400">({n(stat.rating.count)} {stat.rating.count === 1 ? 'rating' : 'ratings'})</span></span>
        : <span className="text-neutral-500">No ratings yet</span>}
      <span className="inline-flex items-center gap-1.5"><Download size={13} className="text-neutral-400" /><b className="text-white">{n(stat.downloads)}</b><span className="text-neutral-400">{stat.downloads === 1 ? 'download' : 'downloads'}</span></span>
    </div>
  );
}
const card = 'rounded-2xl border border-white/10 bg-white/[0.04] p-5';
const primary = 'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#F6B94A] px-5 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-60';

function HowTo({ platform }: { platform: Platform }) {
  if (platform === 'ios') return (
    <ol className="space-y-2 text-sm text-neutral-300">
      <li className="flex gap-2"><Share size={16} className="mt-0.5 shrink-0 text-[#F6B94A]" /><span>Open this page in <b>Safari</b> and tap the <b>Share</b> button.</span></li>
      <li className="flex gap-2"><SquarePlus size={16} className="mt-0.5 shrink-0 text-[#F6B94A]" /><span>Choose <b>Add to Home Screen</b>, then <b>Add</b>. Bwenge opens like an app.</span></li>
    </ol>
  );
  return <p className="text-sm text-neutral-300">Open the browser menu (⋮ or the install icon in the address bar) and choose <b>Install Bwenge</b>{platform === 'android' ? ' or Add to Home screen' : ''}. Chrome and Edge can install it; some other browsers cannot.</p>;
}

export default function GetAppPage() {
  const me = useMemo<Platform>(() => detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0), []);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [stats, setStats] = useState<Record<'bwenge' | 'myseb', AppStat> | null>(null);
  const [installed, setInstalled] = useState(() => { try { return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true; } catch { return false; } });
  const count_ = me === 'other' ? 'windows' : me;                     // the device name used for counting (an unknown computer counts as a computer)

  useEffect(() => {
    document.title = 'Get Bwenge';
    void fetch(getApiUrl('/api/app/stats')).then((r) => (r.ok ? r.json() : null)).then((b) => { if (b?.apps) setStats(b.apps); }).catch(() => undefined);
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as Prompt); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); count('bwenge', count_, 'installed'); };
    window.addEventListener('beforeinstallprompt', onPrompt); window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, [count_]);

  const install = async () => { if (!prompt) return; count('bwenge', count_, 'click'); await prompt.prompt().catch(() => undefined); setPrompt(null); };
  const mysebFirst = [...MYSEB].sort((a, b) => Number(b.id === me) - Number(a.id === me));

  return (
    <div className="min-h-[100dvh] overflow-y-auto bg-[#0B1420] px-4 py-8 text-white">
      <main className="mx-auto w-full max-w-xl space-y-6">
        <a href="/" className="inline-flex items-center gap-2 text-xs text-neutral-400 hover:text-white"><ArrowLeft size={14} />Back to Bwenge</a>
        <header><h1 className="text-2xl font-semibold">Get Bwenge</h1><p className="mt-1 text-sm text-neutral-400">Mark, make quizzes and explore your data. We found: <b className="text-white">{PLATFORM_LABEL[me]}</b>.</p></header>

        <section className={card} aria-labelledby="bwenge-h">
          <h2 id="bwenge-h" className="flex items-center gap-2 text-base font-semibold"><Smartphone size={18} className="text-[#F6B94A]" />Bwenge app</h2>
          <p className="mt-1 text-xs text-neutral-400">Works on every phone and computer and updates itself each time you open it.</p>
          <StatsRow stat={stats?.bwenge} />
          <div className="mt-4 space-y-3">
            {installed ? <p className="flex items-center gap-2 text-sm text-emerald-300"><CheckCircle2 size={18} />Bwenge is installed on this device.</p>
              : prompt ? <button type="button" className={primary} onClick={() => void install()}><Download size={18} />Install Bwenge on {PLATFORM_LABEL[me]}</button>
              : <HowTo platform={me} />}
            {!installed && !prompt && me !== 'ios' && <a href="/" className="block text-center text-xs text-neutral-400 underline">Or just open Bwenge in the browser</a>}
          </div>
          {me !== 'ios' && <details className="mt-4 text-xs text-neutral-400"><summary className="cursor-pointer">iPhone or iPad?</summary><div className="mt-2"><HowTo platform="ios" /></div></details>}
        </section>

        <section className={card} aria-labelledby="myseb-h">
          <h2 id="myseb-h" className="flex items-center gap-2 text-base font-semibold"><Monitor size={18} className="text-[#F6B94A]" />MySEB: the app for taking an exam</h2>
          <p className="mt-1 text-xs text-neutral-400">For students. Your lecturer gives you the exam code. Choose your device:</p>
          <StatsRow stat={stats?.myseb} />
          {me === 'ios' && <p className="mt-3 rounded-lg bg-white/5 p-3 text-xs text-neutral-300">MySEB has no iPhone or iPad app yet. Use a laptop, an Android phone, or ask your lecturer.</p>}
          <ul className="mt-4 grid grid-cols-2 gap-2">
            {mysebFirst.map((p, i) => (
              <li key={p.id}><a href={`/api/app/go/myseb/${p.id}`} className={`flex min-h-14 flex-col items-center justify-center rounded-xl border px-2 text-center text-sm ${p.id === me ? 'border-[#F6B94A] bg-[#F6B94A]/10 font-semibold' : 'border-white/10 hover:bg-white/5'}`}>
                {p.name}<span className="text-[11px] font-normal text-neutral-400">{p.file}{i === 0 && p.id === me ? ' · for you' : ''}</span></a></li>
            ))}
          </ul>
        </section>

        <section className={card} aria-labelledby="fb-h">
          <h2 id="fb-h" className="text-base font-semibold">How is it working for you?</h2>
          <p className="mb-5 mt-1 text-xs text-neutral-400">Your rating helps others, and your comments help us improve.</p>
          <AppFeedbackForm platform={me} />
        </section>
      </main>
    </div>
  );
}
