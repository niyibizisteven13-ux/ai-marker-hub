import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, Check, ClipboardList, CreditCard, ExternalLink, FileText, LayoutDashboard, Link2, Loader2, Menu, PenLine, Plus, Radio, Smartphone, Sparkles, ShieldCheck, Users, X } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import { AgentComposer, AgentThread, useAgentChat } from '../components/AgentChat';
import MySebPayPanel, { type Payment } from '../components/MySebPayPanel';
import { btnGhost, btnPrimary, card } from '../components/biz/ui';
import logoUrl from '../assets/myseb-logo.svg';

/**
 * The lecturer's MySEB dashboard (/lecturer): everything about secure exams in one place, on a phone and on a computer.
 * A sidebar (a drawer on a phone, with a bottom bar for the four things used most), the live numbers of their rooms, their tests and tasks,
 * and the Bwenge assistant beside it (a sheet on a phone) that knows it is on this page and can run a whole exam from a message.
 */
type View = 'overview' | 'rooms' | 'tests' | 'tasks' | 'marking' | 'app' | 'access';
interface Live { inExam: number; paused: number; left: number; ended: number; total: number }
interface Room { kind: 'form' | 'task'; id: string; title: string; updatedAt: string; link: string; live: Live | null }
interface Item { kind: 'form' | 'task'; id: string; title: string; updatedAt: string; mySeb: boolean }
interface Overview {
  name: string;
  access: { exempt: boolean; charging: boolean; monthActive: boolean; monthUntil: string | null; tests: number; hasAccess: boolean };
  totals: { forms: number; tasks: number; rooms: number; liveRooms: number; studentsIn: number; needAttention: number };
  rooms: Room[]; forms: Item[]; tasks: Item[];
}

const LIGHT = { '--app-bg': '#F2F5FA', '--app-panel': '#FFFFFF', '--app-panel-hover': '#F1F4F9', '--app-line': '#E3E8F0', '--app-text': '#0E1722', '--app-muted': '#5B6776', '--app-faint': '#8A94A3' } as React.CSSProperties;
const NAV: Array<{ id: View; label: string; icon: typeof LayoutDashboard; group?: string }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard }, { id: 'rooms', label: 'Live rooms', icon: Radio }, { id: 'tests', label: 'Tests', icon: FileText }, { id: 'tasks', label: 'Tasks', icon: ClipboardList },
  { id: 'marking', label: 'Marking and results', icon: PenLine }, { id: 'app', label: 'Get the app', icon: Smartphone, group: 'More' }, { id: 'access', label: 'Access and payment', icon: CreditCard },
];
const PHONE_NAV: View[] = ['overview', 'rooms', 'tests'];
const SUGGESTIONS = ['How are my live rooms right now?', 'Who needs my attention?', 'Make a 10-question test from my notes', 'Start a secure exam and give me the code and link', 'Summarise how my last exam went'];

const ago = (iso: string) => { const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); if (s < 90) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86_400) return `${Math.round(s / 3600)} h ago`; return `${Math.round(s / 86_400)} d ago`; };
const hello = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
const absolute = (path: string) => `${window.location.origin}${path}`;

function Stat({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'good' | 'warn' }) {
  return (
    <div className={`${card} !p-4`}>
      <p className="text-xs font-medium text-[var(--app-muted)]">{label}</p>
      <p className={`mt-1 font-display text-3xl font-semibold tabular-nums ${tone === 'warn' ? 'text-amber-600' : tone === 'good' ? 'text-emerald-600' : ''}`}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-[var(--app-faint)]">{hint}</p>}
    </div>
  );
}

function RoomRow({ r }: { r: Room }) {
  const [copied, setCopied] = useState(false);
  const live = r.live; const busy = !!live && (live.inExam > 0 || live.paused > 0);
  const copy = async () => { try { await navigator.clipboard.writeText(absolute(r.link)); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* the link is on the button */ } };
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 py-3 sm:flex sm:flex-wrap">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${busy ? 'bg-emerald-500/15 text-emerald-700' : 'bg-[var(--app-bg)] text-[var(--app-muted)]'}`}><Radio size={18} /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{r.title} <span className="ml-1 rounded-full bg-[var(--app-bg)] px-2 py-0.5 text-[11px] font-normal text-[var(--app-muted)]">{r.kind === 'form' ? 'Test' : 'Task'}</span></p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--app-muted)]">
          {!live ? <span>Status not available right now</span> : busy ? <>
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />Live</span>
            <span>{live.inExam} in the exam</span>{live.paused > 0 && <span className="font-medium text-amber-700">{live.paused} paused</span>}{live.left > 0 && <span className="font-medium text-amber-700">{live.left} left</span>}{live.ended > 0 && <span>{live.ended} finished</span>}
          </> : <span>{live.total ? `${live.total} took it, none in the exam now` : 'No students yet'} · changed {ago(r.updatedAt)}</span>}
        </p>
      </div>
      <div className="col-span-2 flex gap-2 sm:col-span-1 sm:shrink-0 [&>*]:flex-1 sm:[&>*]:flex-none">
        <button type="button" onClick={() => void copy()} className={`${btnGhost} !min-h-9 !px-3 text-xs`} aria-label={`Copy the room link for ${r.title}`}>{copied ? <Check size={14} /> : <Link2 size={14} />}{copied ? 'Copied' : 'Copy link'}</button>
        <a href={r.link} className={`${btnPrimary} !min-h-9 !px-3.5 text-xs`}><Radio size={14} />Open room</a>
      </div>
    </li>
  );
}

function ItemRow({ it, ask }: { it: Item; ask: (q: string) => void }) {
  const href = it.kind === 'form' ? `/forms/${encodeURIComponent(it.id)}/edit` : `/assignments/${encodeURIComponent(it.id)}`;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 py-3 sm:flex sm:flex-wrap">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--app-bg)] text-[var(--app-muted)]">{it.kind === 'form' ? <FileText size={18} /> : <ClipboardList size={18} />}</span>
      <div className="min-w-0 flex-1"><p className="truncate font-medium">{it.title}</p><p className="mt-0.5 text-xs text-[var(--app-muted)]">{it.mySeb ? <span className="font-semibold text-emerald-700">Secure (MySEB)</span> : 'Not secured'} · changed {ago(it.updatedAt)}</p></div>
      <div className="col-span-2 flex gap-2 sm:col-span-1 sm:shrink-0 [&>*]:flex-1 sm:[&>*]:flex-none">
        {!it.mySeb && <button type="button" onClick={() => ask(`Turn on MySEB for "${it.title}" and tell me how students join.`)} className={`${btnGhost} !min-h-9 !px-3 text-xs`}><ShieldCheck size={14} />Secure it</button>}
        {it.mySeb && <a href={`/live/${it.kind}/${encodeURIComponent(it.id)}`} className={`${btnGhost} !min-h-9 !px-3 text-xs`}><Radio size={14} />Room</a>}
        <a href={href} className={`${btnGhost} !min-h-9 !px-3 text-xs`}><ExternalLink size={14} />Open</a>
      </div>
    </li>
  );
}

/** `standalone`: opened as MySEB's own app (/ms): its own logo and name, no way back to Bwenge's chat, and a sign-out instead. */
export default function MySebDashboardPage({ onBack, standalone = false, onSignOut }: { onBack: () => void; standalone?: boolean; onSignOut?: () => void }) {
  const [view, setView] = useState<View>(() => { const v = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('view'); return (['rooms', 'tests', 'tasks', 'marking', 'app', 'access'] as string[]).includes(v ?? '') ? (v as View) : 'overview'; });
  const [data, setData] = useState<Overview | null>(null); const [error, setError] = useState('');
  const [nav, setNav] = useState(false);
  const [agent, setAgent] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches);
  const [pay, setPay] = useState<{ status: Overview['access']; payment: Payment; pendingRequest: { plan: string } | null } | null>(null);

  const load = useCallback(async (quiet = false) => {
    try {
      const r = await authFetch('/api/myseb-dashboard'); const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) throw new Error(j?.error || 'The dashboard could not load.');
      setData(j.data); setError('');
    } catch (e) { if (!quiet) setError(e instanceof Error ? e.message : 'The dashboard could not load.'); }
  }, []);
  useEffect(() => { void load(); const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(true); }, 15_000); return () => window.clearInterval(t); }, [load]);
  useEffect(() => { if (view !== 'access') return; void authFetch('/api/myseb-access').then((r) => r.json()).then((j) => setPay(j?.data ?? null)).catch(() => undefined); }, [view]);

  const chat = useAgentChat({ surface: 'myseb', onDone: () => void load(true) });
  const ask = (q: string) => { setAgent(true); setNav(false); void chat.send(q); };
  const go = (v: View) => { setView(v); setNav(false); document.getElementById('dash-main')?.scrollTo({ top: 0 }); };
  const t = data?.totals;
  const title = useMemo(() => NAV.find((n) => n.id === view)?.label ?? 'Overview', [view]);

  const navList = (
    <nav aria-label="MySEB" className="flex-1 space-y-0.5 overflow-y-auto">
      {NAV.map((n, i) => { const Icon = n.icon; const on = view === n.id; return (
        <div key={n.id}>
          {n.group && NAV[i - 1]?.group !== n.group && <p className="mb-1 mt-4 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">{n.group}</p>}
          <button type="button" aria-current={on ? 'page' : undefined} onClick={() => go(n.id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium transition-colors ${on ? 'bg-[var(--brand)] text-[var(--brand-on)] shadow-sm' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
            <Icon size={17} aria-hidden="true" />{n.label}
            {n.id === 'rooms' && !!t?.liveRooms && <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${on ? 'bg-black/15' : 'bg-emerald-500/25 text-emerald-300'}`}>{t.liveRooms} live</span>}
          </button>
        </div>); })}
    </nav>
  );
  const brand = (
    <div className="mb-5 flex items-center gap-2.5 px-2 py-1.5">{standalone ? <img src={logoUrl} alt="" className="h-9 w-9 rounded-xl" /> : <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand)] text-[var(--brand-on)]"><ShieldCheck size={18} /></span>}<span><span className="block font-display text-[15px] font-semibold leading-tight text-white">MySEB</span><span className="block text-[11px] text-white/55">{standalone ? 'Secure exams' : 'Secure exams · Bwenge'}</span></span></div>
  );
  const accessChip = data && (
    <button type="button" onClick={() => go('access')} className="mt-3 w-full rounded-2xl bg-white/5 p-3.5 text-left text-xs hover:bg-white/10">
      <p className="font-semibold text-white">{data.access.exempt ? 'Full access' : data.access.monthActive ? 'Monthly plan' : data.access.tests > 0 ? `${data.access.tests} test credit${data.access.tests === 1 ? '' : 's'}` : 'No plan yet'}</p>
      <p className="mt-0.5 text-white/55">{data.access.exempt ? 'Included with your account' : data.access.monthActive && data.access.monthUntil ? `until ${new Date(data.access.monthUntil).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : data.access.hasAccess ? 'Open a test to use one' : 'Needed to give students a code'}</p>
    </button>
  );

  return (
    <div style={LIGHT} className="flex h-[100dvh] bg-[var(--app-bg)] text-[var(--app-text)]">
      {/* sidebar (computers) */}
      <aside className="hidden w-64 shrink-0 flex-col bg-[#0B1424] p-4 lg:flex">
        {brand}{navList}{accessChip}
        {standalone ? (onSignOut && <button type="button" onClick={onSignOut} className="mt-3 flex items-center gap-2 px-2 py-1 text-xs text-white/55 hover:text-white"><ArrowLeft size={13} />Sign out</button>) : (<button type="button" onClick={onBack} className="mt-3 flex items-center gap-2 px-2 py-1 text-xs text-white/55 hover:text-white"><ArrowLeft size={13} />Back to Bwenge</button>)}
      </aside>

      {/* sidebar (phones): a drawer */}
      {nav && (
        <div className="fixed inset-0 z-[70] lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/50" onClick={() => setNav(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-[#0B1424] p-4 shadow-2xl">
            <div className="flex items-start justify-between">{brand}<button type="button" onClick={() => setNav(false)} aria-label="Close menu" className="rounded-full p-2 text-white/70 hover:bg-white/10"><X size={18} /></button></div>
            {navList}{accessChip}
            {standalone ? (onSignOut && <button type="button" onClick={onSignOut} className="mt-3 flex items-center gap-2 px-2 py-1 text-xs text-white/55 hover:text-white"><ArrowLeft size={13} />Sign out</button>) : (<button type="button" onClick={onBack} className="mt-3 flex items-center gap-2 px-2 py-1 text-xs text-white/55 hover:text-white"><ArrowLeft size={13} />Back to Bwenge</button>)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-[var(--app-line)] bg-[var(--app-panel)] px-3 py-2.5 sm:gap-3 sm:px-6 sm:py-3">
          <button type="button" onClick={() => setNav(true)} aria-label="Open menu" className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-[var(--app-panel-hover)] lg:hidden"><Menu size={19} /></button>
          <div className="min-w-0 flex-1"><h1 className="truncate font-display text-[17px] font-semibold">{title}</h1><p className="hidden text-xs text-[var(--app-muted)] sm:block">{view === 'overview' ? `${hello()}${data?.name ? `, ${data.name}` : ''}` : 'MySEB · secure exams'}</p></div>
          <a href="/forms" className={`${btnGhost} !min-h-10 !px-3.5`}><Plus size={16} /><span className="hidden sm:inline">New secure test</span></a>
          <button type="button" onClick={() => setAgent((v) => !v)} aria-pressed={agent} className={`${btnPrimary} !min-h-10 !px-3.5`}><Sparkles size={16} /><span className="hidden sm:inline">{standalone ? 'Assistant' : 'Ask Bwenge'}</span></button>
        </header>

        <div className="flex min-h-0 flex-1">
          <main id="dash-main" className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-28 pt-5 sm:px-6 lg:pb-10">
            <div className="mx-auto w-full max-w-5xl space-y-5">
              {error && <p role="alert" className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-600">{error} <button type="button" className="ml-2 font-semibold underline" onClick={() => void load()}>Try again</button></p>}
              {!data && !error && <div className="grid place-items-center py-24"><Loader2 className="animate-spin text-[var(--brand)]" aria-label="Loading" /></div>}

              {data && view === 'overview' && (<>
                {!data.access.hasAccess && <button type="button" onClick={() => go('access')} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900"><span><b className="block">MySEB needs a plan to give students a code</b>One test is 1,500 RWF, or a month is $5. See how to pay.</span><CreditCard size={20} className="shrink-0" /></button>}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Stat label="Students in an exam now" value={data.totals.studentsIn} hint={data.totals.liveRooms ? `${data.totals.liveRooms} live room${data.totals.liveRooms === 1 ? '' : 's'}` : 'No exam running'} tone={data.totals.studentsIn ? 'good' : undefined} />
                  <Stat label="Need your attention" value={data.totals.needAttention} hint="paused or left" tone={data.totals.needAttention ? 'warn' : undefined} />
                  <Stat label="Secure tests and tasks" value={data.totals.rooms} hint="with a live room" />
                  <Stat label="All tests and tasks" value={data.totals.forms + data.totals.tasks} hint={`${data.totals.forms} tests · ${data.totals.tasks} tasks`} />
                </div>

                <section className={card} aria-label="Live rooms">
                  <div className="mb-1 flex items-center justify-between"><h2 className="font-display text-lg font-semibold">Your live rooms</h2>{data.rooms.length > 5 && <button type="button" onClick={() => go('rooms')} className="text-sm font-semibold underline">See all</button>}</div>
                  {data.rooms.length ? <ul className="divide-y divide-[var(--app-line)]">{data.rooms.slice(0, 5).map((r) => <RoomRow key={`${r.kind}${r.id}`} r={r} />)}</ul>
                    : <div className="py-6 text-center"><Radio className="mx-auto text-[var(--app-faint)]" size={28} /><p className="mt-2 font-medium">No secure tests yet</p><p className="mx-auto mt-1 max-w-sm text-sm text-[var(--app-muted)]">Make a test, turn on MySEB, and share the code. Or just ask Bwenge to do all of it.</p>
                      <div className="mt-4 flex flex-wrap justify-center gap-2"><button type="button" className={btnPrimary} onClick={() => ask('Help me make a secure exam from scratch. Ask me what you need.')}><Sparkles size={16} />Make one with Bwenge</button><a href="/forms" className={btnGhost}>Open my tests</a></div></div>}
                </section>

                <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Quick actions">
                  {[
                    { t: 'New secure test', d: 'Make questions or paste a form link', icon: Plus, href: '/forms' },
                    { t: 'Mark papers', d: 'Handwriting or typed, with feedback', icon: PenLine, href: '/mark' },
                    { t: 'Marked exams', d: 'Review marks and change them', icon: BarChart3, href: '/exams' },
                    { t: 'Get the app', d: 'Android locks the phone for the exam', icon: Smartphone, href: '/get-app' },
                  ].map((a) => <a key={a.t} href={a.href} className={`${card} !p-4 transition hover:-translate-y-0.5 hover:shadow-md`}><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand)]/15 text-[var(--brand-strong,var(--brand))]"><a.icon size={18} /></span><p className="mt-2.5 font-semibold">{a.t}</p><p className="text-xs text-[var(--app-muted)]">{a.d}</p></a>)}
                </section>

                <section className={`${card} xl:hidden`} aria-label="Ask Bwenge">
                  <h2 className="font-display text-lg font-semibold">Ask Bwenge</h2><p className="text-sm text-[var(--app-muted)]">Run your exam by talking to it.</p>
                  <div className="mt-3 flex flex-wrap gap-2">{SUGGESTIONS.slice(0, 4).map((s) => <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-[var(--app-line)] px-3 py-1.5 text-left text-sm hover:border-[var(--brand)]">{s}</button>)}</div>
                </section>
              </>)}

              {data && view === 'rooms' && (
                <section className={card}><h2 className="font-display text-lg font-semibold">Live rooms</h2><p className="text-sm text-[var(--app-muted)]">Every test and task protected by MySEB. Open a room to watch students, hear them, pause, add time or send a message.</p>
                  {data.rooms.length ? <ul className="mt-2 divide-y divide-[var(--app-line)]">{data.rooms.map((r) => <RoomRow key={`${r.kind}${r.id}`} r={r} />)}</ul> : <p className="mt-4 text-sm text-[var(--app-muted)]">No live rooms yet. Turn on MySEB for a test, or ask Bwenge to start a secure exam.</p>}
                </section>
              )}

              {data && view === 'tests' && (
                <section className={card}><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-display text-lg font-semibold">Tests</h2><p className="text-sm text-[var(--app-muted)]">Your forms and quizzes.</p></div><div className="flex gap-2"><button type="button" className={btnGhost} onClick={() => ask('Make me a new test. Ask me the topic and how many questions.')}><Sparkles size={16} />Make with Bwenge</button><a href="/forms" className={btnPrimary}><Plus size={16} />All tests</a></div></div>
                  {data.forms.length ? <ul className="mt-2 divide-y divide-[var(--app-line)]">{data.forms.map((f) => <ItemRow key={f.id} it={f} ask={ask} />)}</ul> : <p className="mt-4 text-sm text-[var(--app-muted)]">No tests yet.</p>}
                </section>
              )}

              {data && view === 'tasks' && (
                <section className={card}><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-display text-lg font-semibold">Tasks</h2><p className="text-sm text-[var(--app-muted)]">Work you set for a class, handed in by a link.</p></div><a href="/assignments" className={btnPrimary}><ClipboardList size={16} />All tasks</a></div>
                  {data.tasks.length ? <ul className="mt-2 divide-y divide-[var(--app-line)]">{data.tasks.map((f) => <ItemRow key={f.id} it={f} ask={ask} />)}</ul> : <p className="mt-4 text-sm text-[var(--app-muted)]">No tasks yet.</p>}
                </section>
              )}

              {data && view === 'marking' && (
                <section className="grid gap-3 sm:grid-cols-2">
                  {[{ t: 'Mark papers', d: 'Upload handwritten or typed papers with a marking scheme and get marks, feedback and red-pen PDFs.', href: '/mark', icon: PenLine }, { t: 'Marked exams', d: 'Review every student\'s paper, change a mark with a reason, download the files.', href: '/exams', icon: BarChart3 }].map((a) => <a key={a.t} href={a.href} className={`${card} transition hover:shadow-md`}><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand)]/15 text-[var(--brand-strong,var(--brand))]"><a.icon size={19} /></span><p className="mt-3 font-display text-lg font-semibold">{a.t}</p><p className="mt-1 text-sm text-[var(--app-muted)]">{a.d}</p></a>)}
                  <button type="button" onClick={() => ask('I want to mark papers. Tell me what you need from me.')} className={`${card} text-left transition hover:shadow-md sm:col-span-2`}><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand)]/15 text-[var(--brand-strong,var(--brand))]"><Sparkles size={19} /></span><p className="mt-3 font-display text-lg font-semibold">Mark by chat</p><p className="mt-1 text-sm text-[var(--app-muted)]">Attach the marking scheme and the scripts in the chat. Bwenge marks them and tells you what it found.</p></button>
                </section>
              )}

              {view === 'app' && (
                <section className={card}><h2 className="font-display text-lg font-semibold">Get the MySEB app</h2><p className="mt-1 text-sm text-[var(--app-muted)]">Students use the app so the exam cannot be left or copied.</p>
                  <ul className="mt-3 space-y-2 text-sm">
                    <li className="flex gap-2.5"><Check size={16} className="mt-0.5 shrink-0 text-emerald-600" /><span><b>Android</b>: the phone is pinned to the exam, screenshots and recording are blocked, and leaving is recorded.</span></li>
                    <li className="flex gap-2.5"><Check size={16} className="mt-0.5 shrink-0 text-emerald-600" /><span><b>Windows and Mac</b>: the exam fills the screen; Windows can be locked down further.</span></li>
                    <li className="flex gap-2.5"><Check size={16} className="mt-0.5 shrink-0 text-emerald-600" /><span><b>iPhone</b>: leaving, screenshots and recording are detected and reported; Guided Access locks school-managed phones.</span></li>
                    <li className="flex gap-2.5"><Users size={16} className="mt-0.5 shrink-0 text-[var(--app-muted)]" /><span><b>No app?</b> Turn on the browser option in a live room. It watches and reports but cannot lock the device.</span></li>
                  </ul>
                  <a href="/get-app" className={`${btnPrimary} mt-4`}><Smartphone size={16} />Download links</a>
                </section>
              )}

              {view === 'access' && (
                <section className="space-y-4">
                  {!pay ? <div className="grid place-items-center py-16"><Loader2 className="animate-spin text-[var(--brand)]" aria-label="Loading" /></div>
                    : pay.status.hasAccess ? (
                      <div className={card}><h2 className="font-display text-lg font-semibold">Your MySEB access</h2>
                        <p className="mt-2 text-sm">{pay.status.exempt ? 'MySEB is included with your account.' : pay.status.monthActive && pay.status.monthUntil ? `Monthly plan until ${new Date(pay.status.monthUntil).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.` : `${pay.status.tests} test credit${pay.status.tests === 1 ? '' : 's'} left. Opening a new test uses one.`}</p>
                        <p className="mt-2 text-sm text-[var(--app-muted)]">Need more? One test is 1,500 RWF and a month is $5.</p></div>
                    ) : <MySebPayPanel payment={pay.payment} onAccess={() => { void load(true); void authFetch('/api/myseb-access').then((r) => r.json()).then((j) => setPay(j?.data ?? null)); }} onClose={() => go('overview')} />}
                </section>
              )}
            </div>
          </main>

          {/* Ask Bwenge: docked beside the page on a wide screen, a full sheet on smaller ones */}
          {agent && (
            <aside aria-label="Ask Bwenge" className="fixed inset-0 z-[60] flex flex-col bg-white xl:static xl:z-auto xl:w-[400px] xl:shrink-0 xl:border-l xl:border-[var(--app-line)]">
              <header className="flex items-center gap-2 border-b border-[#E0E0E0] px-4 py-3"><Sparkles size={16} className="text-[var(--brand)]" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">Ask Bwenge</p><p className="truncate text-xs text-[#5F6368]">Your exams, rooms and students</p></div>
                <button type="button" onClick={() => setAgent(false)} aria-label="Close" className="rounded-full p-1.5 hover:bg-black/5"><X size={16} /></button></header>
              <AgentThread chat={chat} light suggestions={SUGGESTIONS} intro="Ask how your exam is going, who needs you, or tell it what to do: pause the room, add ten minutes, message the students, start a new exam." />
              <AgentComposer chat={chat} light placeholder="e.g. pause my room and tell students to stay seated" />
            </aside>
          )}
        </div>

        {/* bottom bar (phones) */}
        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--app-line)] bg-[var(--app-panel)] pb-[env(safe-area-inset-bottom)] lg:hidden">
          {PHONE_NAV.map((id) => { const n = NAV.find((x) => x.id === id)!; const Icon = n.icon; const on = view === id; return (
            <button key={id} type="button" aria-current={on ? 'page' : undefined} onClick={() => go(id)} className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${on ? 'text-[var(--brand-strong,var(--brand))]' : 'text-[var(--app-muted)]'}`}><Icon size={20} />{n.label}{id === 'rooms' && !!t?.liveRooms && <span className="absolute ml-6 -mt-1 h-2 w-2 rounded-full bg-emerald-500" aria-label="live" />}</button>); })}
          <button type="button" onClick={() => setAgent(true)} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-[var(--app-muted)]"><Sparkles size={20} />Ask Bwenge</button>
        </nav>
      </div>
    </div>
  );
}
