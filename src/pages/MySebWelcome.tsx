import { useEffect, useState } from 'react';
import { Download, Eye, GraduationCap, Lock, Radio, ShieldCheck, Smartphone, Sparkles } from 'lucide-react';
import logoUrl from '../assets/myseb-logo.svg';

/**
 * MySEB's own front door (/ms, signed out): what it is, how to sign in, and how to install it as an app. It does not mention anything else of Bwenge's
 * except that the assistant inside is Bwenge's. Students are pointed to the student app.
 */
const FEATURES: Array<[typeof Lock, string, string]> = [
  [Lock, 'A locked test', 'Students open the test in MySEB. If they leave the screen, you are told at once and they are paused.'],
  [Radio, 'A live room', 'See every student working, who left, who needs help. Up to 500 at the same time.'],
  [Sparkles, 'An assistant that helps', 'Make a secure test, run the room and read the results by sending a message.'],
  [Eye, 'Proof you can trust', 'A timeline of what happened for each student, so you decide fairly.'],
];

export default function MySebWelcome({ onSignIn, onSignUp }: { onSignIn: () => void; onSignUp: () => void }) {
  const [install, setInstall] = useState<any>(null); const [ios, setIos] = useState(false); const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setInstall(e); }; window.addEventListener('beforeinstallprompt', h);
    const done = () => setInstalled(true); window.addEventListener('appinstalled', done);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !(window.navigator as any).standalone);
    return () => { window.removeEventListener('beforeinstallprompt', h); window.removeEventListener('appinstalled', done); };
  }, []);
  const doInstall = async () => { try { await install.prompt(); } catch { /* dismissed */ } setInstall(null); };
  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (window.navigator as any).standalone);
  const btn = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-semibold transition';
  return (
    <div className="min-h-[100dvh] bg-[#0A1424] font-sans text-white antialiased">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(76,229,214,0.18),transparent)]" />
      <header className="relative mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <div className="flex items-center gap-3"><img src={logoUrl} alt="" className="h-10 w-10 rounded-xl" /><span className="font-display text-xl font-semibold tracking-tight">MySEB</span></div>
        <button type="button" onClick={onSignIn} className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/10">Sign in</button>
      </header>

      <main className="relative mx-auto max-w-5xl px-5 pb-16 pt-8 sm:pt-14">
        <div className="max-w-2xl">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-[#4CE5D6]"><ShieldCheck size={14} aria-hidden="true" />Secure exams for lecturers</p>
          <h1 className="mt-5 font-display text-[40px] font-semibold leading-[1.05] tracking-tight sm:text-6xl">Give a fair exam,<br />from your phone.</h1>
          <p className="mt-5 text-[17px] leading-relaxed text-white/70">Lock students into the test, watch the live room, and get marks and a clear record of what happened. No setup, no equipment.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button type="button" onClick={onSignUp} className={`${btn} bg-[#4CE5D6] text-[#0A1424] hover:opacity-90`}>Create your account</button>
            <button type="button" onClick={onSignIn} className={`${btn} border border-white/20 hover:bg-white/10`}>Sign in</button>
            {install && !installed && !standalone && <button type="button" onClick={() => void doInstall()} className={`${btn} border border-white/20 hover:bg-white/10`}><Download size={17} aria-hidden="true" />Install the app</button>}
          </div>
          {ios && !installed && !standalone && <p className="mt-4 flex items-center gap-2 text-sm text-white/60"><Smartphone size={15} aria-hidden="true" />On iPhone: tap Share, then “Add to Home Screen” to install MySEB.</p>}
        </div>

        <ul className="mt-14 grid gap-3 sm:grid-cols-2">
          {FEATURES.map(([Icon, title, text]) => <li key={title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#4CE5D6]/15 text-[#4CE5D6]"><Icon size={19} aria-hidden="true" /></span><h2 className="mt-3 font-display text-lg font-semibold">{title}</h2><p className="mt-1 text-[15px] leading-relaxed text-white/65">{text}</p></li>)}
        </ul>

        <div className="mt-8 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F6B94A]/15 text-[#F6B94A]"><GraduationCap size={19} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1"><p className="font-semibold">Taking a test?</p><p className="text-sm text-white/60">Students use the MySEB student app. Your lecturer gives you the test link.</p></div>
          <a href="/myseb" className="rounded-xl border border-white/20 px-4 py-2.5 text-sm font-semibold hover:bg-white/10">Get the student app</a>
        </div>
      </main>
      <footer className="relative mx-auto max-w-5xl px-5 pb-10 text-xs text-white/45"><a href="/terms" className="hover:text-white">Terms</a> · <a href="/privacy" className="hover:text-white">Privacy</a></footer>
    </div>
  );
}
