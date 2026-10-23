import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, Copy, GraduationCap, Lightbulb, Loader2, Plus, Sparkles, Target, TrendingDown, TrendingUp, Users, X } from 'lucide-react';
import { authFetch } from '../utils/authFetch';

/**
 * Adaptive practice and classes (/learn). Practice: pick a topic, answer questions generated at your level, say how
 * sure you are, ask for hints; mastery and level move with each answer. Classes: teachers create a class and see an
 * anonymised dashboard (per topic, no names, small groups hidden); students join with the class code.
 */

interface Skill { topic: string; topicKey: string; mastery: number; level: number; attempts: number; accuracy: number | null; streak: number; calibration: number | null }
interface Item { id: string; topic: string; level: number; kind: 'mcq' | 'numeric' | 'short'; question: string; choices: string[]; foundation: boolean; hintsShown: string[]; hintsLeft: number; answered?: boolean; response?: string; score?: number; feedback?: string; answer?: string; explanation?: string; misconception?: string | null }
interface Result { item: Item; skill: Skill; delta: number; calibration: string | null; levelChange: 'up' | 'down' | null; message: string | null }
interface Topic { topic: string; learners: number; attempts: number; accuracy: number | null; meanMastery: number; meanLevel: number; bands: { struggling: number; developing: number; secure: number }; misconceptions: Array<{ tag: string; learners: number }> }
interface Dashboard { class: { id: string; name: string; code: string }; students: number; k: number; active7d: number | null; topics: Topic[]; hidden: number; note: string | null }

const api = async <T,>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
  const r = await authFetch(`/api/learn${path}`, { ...init, method: init?.method ?? (init?.json !== undefined ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' }, body: init?.json !== undefined ? JSON.stringify(init.json) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || 'Something went wrong.'), { upgrade: d.upgrade });
  return d as T;
};

const LEVEL_NAMES = ['', 'Foundation', 'Basic', 'Multi-step', 'Analysis', 'Challenge'];
const CONFIDENCE = ['Guessing', 'Unsure', 'Fairly sure', 'Sure', 'Certain'];
const SUGGESTED = ['Fractions', 'Photosynthesis', 'Newton’s laws', 'Quadratic equations', 'Rwandan history 1959–1994', 'Supply and demand', 'Cell biology', 'Probability'];

function MasteryBar({ value, className = '' }: { value: number; className?: string }) {
  const pct = Math.round(value * 100);
  const color = value < 0.4 ? 'bg-rose-400' : value < 0.7 ? 'bg-amber-300' : 'bg-emerald-400';
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-white/10 ${className}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Mastery">
      <div className={`h-full rounded-full transition-[width] duration-700 ${color}`} style={{ width: `${Math.max(3, pct)}%` }} />
    </div>
  );
}

function Practice() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [topic, setTopic] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [item, setItem] = useState<Item | null>(null);
  const [skill, setSkill] = useState<Skill | null>(null);
  const [response, setResponse] = useState('');
  const [confidence, setConfidence] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<'next' | 'hint' | 'answer' | null>(null);
  const [error, setError] = useState<{ message: string; upgrade?: { url: string } } | null>(null);

  const loadSkills = useCallback(() => api<{ skills: Skill[] }>('/skills').then((d) => setSkills(d.skills)).catch(() => undefined), []);
  useEffect(() => { void loadSkills(); }, [loadSkills]);

  const next = async (t = active) => {
    if (!t) return;
    setBusy('next'); setError(null); setResult(null); setResponse(''); setConfidence(null);
    try {
      const d = await api<{ item: Item; skill: Skill }>('/practice/next', { json: { topic: t } });
      setActive(t); setItem(d.item); setSkill(d.skill);
    } catch (e: any) { setError({ message: e.message, upgrade: e.upgrade }); } finally { setBusy(null); }
  };
  const hint = async () => {
    if (!item) return;
    setBusy('hint');
    try { setItem((await api<{ item: Item }>(`/practice/${item.id}/hint`, { json: {} })).item); } catch (e: any) { setError({ message: e.message }); } finally { setBusy(null); }
  };
  const answer = async (value = response) => {
    if (!item || !value.trim()) return;
    setBusy('answer'); setError(null);
    try {
      const d = await api<Result>(`/practice/${item.id}/answer`, { json: { response: value, confidence } });
      setResult(d); setItem(d.item); setSkill(d.skill); void loadSkills();
    } catch (e: any) { setError({ message: e.message, upgrade: e.upgrade }); } finally { setBusy(null); }
  };

  if (!active || !item) {
    return (
      <div className="space-y-8">
        <form onSubmit={(e) => { e.preventDefault(); if (topic.trim()) void next(topic.trim()); }} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-7">
          <h2 className="text-lg font-semibold text-white">What do you want to practise?</h2>
          <p className="mt-1 text-sm text-neutral-400">Questions adapt to you: they get harder after a streak, and go back to the foundations when something is not clicking.</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} placeholder="Any topic, e.g. balancing chemical equations" className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white placeholder:text-neutral-500 focus:border-[#D97757]/60 focus:outline-none" />
            <button disabled={!topic.trim() || busy === 'next'} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#D97757] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
              {busy === 'next' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Start
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {SUGGESTED.map((s) => <button key={s} type="button" onClick={() => void next(s)} className="rounded-full border border-white/10 px-3 py-1 text-xs text-neutral-300 hover:border-white/25 hover:text-white">{s}</button>)}
          </div>
          {error && <ErrorNote error={error} />}
        </form>
        {skills.length > 0 && (
          <section>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Your topics</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {skills.map((s) => (
                <button key={s.topicKey} type="button" onClick={() => void next(s.topic)} className="group rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition-colors hover:border-white/20 hover:bg-white/[0.05]">
                  <div className="flex items-center justify-between gap-2"><span className="truncate font-medium text-white">{s.topic}</span><ArrowUpRight size={15} className="shrink-0 text-neutral-500 group-hover:text-white" /></div>
                  <MasteryBar value={s.mastery} className="mt-3" />
                  <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-neutral-400">
                    <span>Level {s.level} · {LEVEL_NAMES[s.level]}</span><span>{s.attempts} answered</span>{s.accuracy !== null && <span>{Math.round(s.accuracy * 100)}% correct</span>}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  const done = !!item.answered;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => { setActive(null); setItem(null); setResult(null); }} className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-white"><ArrowLeft size={15} /> Topics</button>
        <span className="font-semibold text-white">{skill?.topic ?? active}</span>
        {skill && <span className="ml-auto flex min-w-[10rem] items-center gap-2 text-xs text-neutral-400">Mastery <MasteryBar value={skill.mastery} /> {Math.round(skill.mastery * 100)}%</span>}
      </div>

      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-7">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-medium">
          <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-neutral-200">Level {item.level} · {LEVEL_NAMES[item.level]}</span>
          {item.foundation && <span className="rounded-full bg-sky-400/15 px-2.5 py-0.5 text-sky-200">Foundation: an idea this topic builds on</span>}
        </div>
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-white">{item.question}</p>

        {item.kind === 'mcq' ? (
          <div className="mt-5 grid gap-2">
            {item.choices.map((c, i) => {
              const picked = (done ? item.response : response) === c;
              const right = done && c === item.answer;
              return (
                <button key={c} type="button" disabled={done || busy === 'answer'} onClick={() => setResponse(c)}
                  className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition-colors ${right ? 'border-emerald-400/60 bg-emerald-400/10 text-white' : picked ? (done ? 'border-rose-400/60 bg-rose-400/10 text-white' : 'border-[#D97757] bg-[#D97757]/10 text-white') : 'border-white/10 text-neutral-200 hover:border-white/25'}`}>
                  <span className="mt-px font-semibold text-neutral-400">{String.fromCharCode(65 + i)}</span><span className="flex-1">{c}</span>
                  {right && <Check size={16} className="text-emerald-300" />}{done && picked && !right && <X size={16} className="text-rose-300" />}
                </button>
              );
            })}
          </div>
        ) : (
          <textarea value={done ? item.response : response} readOnly={done} onChange={(e) => setResponse(e.target.value)} rows={item.kind === 'numeric' ? 1 : 4} maxLength={2000}
            placeholder={item.kind === 'numeric' ? 'Your answer (include units if needed)' : 'Explain your answer in your own words'}
            className="mt-5 w-full resize-y rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white placeholder:text-neutral-500 focus:border-[#D97757]/60 focus:outline-none" />
        )}

        {item.hintsShown.length > 0 && (
          <ol className="mt-4 space-y-2">
            {item.hintsShown.map((h, i) => <li key={i} className="flex gap-2 rounded-2xl bg-amber-300/10 px-4 py-2.5 text-sm text-amber-100"><Lightbulb size={15} className="mt-0.5 shrink-0" /> {h}</li>)}
          </ol>
        )}

        {!done && (
          <>
            <fieldset className="mt-5">
              <legend className="mb-2 text-xs text-neutral-400">How sure are you?</legend>
              <div className="flex flex-wrap gap-1.5">
                {CONFIDENCE.map((c, i) => (
                  <button key={c} type="button" aria-pressed={confidence === i + 1} onClick={() => setConfidence(confidence === i + 1 ? null : i + 1)} className={`rounded-full border px-3 py-1 text-xs ${confidence === i + 1 ? 'border-[#D97757] bg-[#D97757]/15 text-white' : 'border-white/10 text-neutral-300 hover:border-white/25'}`}>{c}</button>
                ))}
              </div>
            </fieldset>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button type="button" disabled={!response.trim() || busy === 'answer'} onClick={() => void answer()} className="inline-flex items-center gap-2 rounded-2xl bg-[#D97757] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {busy === 'answer' && <Loader2 size={15} className="animate-spin" />} Check answer
              </button>
              <button type="button" disabled={item.hintsLeft === 0 || busy === 'hint'} onClick={() => void hint()} className="inline-flex items-center gap-1.5 rounded-2xl border border-white/10 px-4 py-2.5 text-sm text-neutral-200 hover:border-white/25 disabled:opacity-40">
                <Lightbulb size={15} /> {item.hintsLeft ? `Hint (${item.hintsLeft} left)` : 'No more hints'}
              </button>
              <span className="text-xs text-neutral-500">Hints reduce the credit a little.</span>
            </div>
          </>
        )}

        {done && result && (
          <div className="mt-6 space-y-3 border-t border-white/10 pt-5">
            <div className={`flex items-center gap-2 text-base font-semibold ${result.item.score! >= 0.75 ? 'text-emerald-300' : result.item.score! > 0 ? 'text-amber-200' : 'text-rose-300'}`}>
              {result.item.score! >= 0.75 ? <Check size={18} /> : <X size={18} />}{result.item.score! >= 0.75 ? 'Correct' : result.item.score! > 0 ? 'Partly right' : 'Not this time'}
              <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-neutral-400">{result.delta >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />} mastery {result.delta >= 0 ? '+' : ''}{Math.round(result.delta * 100)}</span>
            </div>
            {result.item.feedback && <p className="text-sm text-neutral-200">{result.item.feedback}</p>}
            {item.kind !== 'mcq' && <p className="text-sm text-neutral-300"><b className="text-white">Model answer:</b> {result.item.answer}</p>}
            {result.item.explanation && <p className="text-sm text-neutral-400">{result.item.explanation}</p>}
            {result.calibration && <p className="flex gap-2 rounded-2xl bg-sky-400/10 px-4 py-2.5 text-sm text-sky-100"><Target size={15} className="mt-0.5 shrink-0" /> {result.calibration}</p>}
            {result.message && <p className="rounded-2xl bg-white/5 px-4 py-2.5 text-sm text-white">{result.message}</p>}
            <button type="button" onClick={() => void next()} disabled={busy === 'next'} className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-60">
              {busy === 'next' && <Loader2 size={15} className="animate-spin" />} Next question
            </button>
          </div>
        )}
        {error && <ErrorNote error={error} />}
      </article>
    </div>
  );
}

function ErrorNote({ error }: { error: { message: string; upgrade?: { url: string } } }) {
  return (
    <p role="alert" className="mt-4 rounded-2xl bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">
      {error.message} {error.upgrade && <a href={error.upgrade.url} className="font-semibold text-white underline">Upgrade</a>}
    </p>
  );
}

function Classes() {
  const [data, setData] = useState<{ teaching: Array<{ id: string; name: string; code: string; students: number }>; joined: Array<{ id: string; name: string }> } | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const load = useCallback(() => api<any>('/classes').then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await load(); } catch (e: any) { setError(e.message); } };
  const open = async (id: string) => { setError(null); try { setDash(await api<Dashboard>(`/classes/${id}/dashboard`)); } catch (e: any) { setError(e.message); } };

  if (dash) {
    return (
      <div className="space-y-5">
        <button type="button" onClick={() => setDash(null)} className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-white"><ArrowLeft size={15} /> Classes</button>
        <header className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1"><h2 className="truncate text-xl font-semibold text-white">{dash.class.name}</h2><p className="text-sm text-neutral-400">Anonymous class overview · groups smaller than {dash.k} are hidden</p></div>
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(dash.class.code); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-3 py-2 font-mono text-sm tracking-widest text-white hover:border-white/25">
            {dash.class.code} {copied ? <Check size={14} className="text-emerald-300" /> : <Copy size={14} />}
          </button>
        </header>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Students" value={dash.students} />
          <Stat label="Active this week" value={dash.active7d ?? '–'} />
          <Stat label="Topics shown" value={dash.topics.length} />
        </div>
        {dash.note && <p className="rounded-2xl bg-white/5 px-4 py-2.5 text-sm text-neutral-300">{dash.note}</p>}
        <div className="space-y-3">
          {dash.topics.map((t) => {
            const total = t.bands.struggling + t.bands.developing + t.bands.secure;
            return (
              <section key={t.topic} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <h3 className="flex-1 font-semibold text-white">{t.topic}</h3>
                  <span className="text-xs text-neutral-400">{t.learners} students · {t.attempts} answers · {t.accuracy === null ? '–' : `${Math.round(t.accuracy * 100)}% correct`} · avg level {t.meanLevel}</span>
                </div>
                <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-white/10" aria-label={`${t.bands.struggling} struggling, ${t.bands.developing} developing, ${t.bands.secure} secure`}>
                  <div className="bg-rose-400" style={{ width: `${(t.bands.struggling / total) * 100}%` }} />
                  <div className="bg-amber-300" style={{ width: `${(t.bands.developing / total) * 100}%` }} />
                  <div className="bg-emerald-400" style={{ width: `${(t.bands.secure / total) * 100}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-neutral-400">
                  <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-rose-400" />{t.bands.struggling} struggling</span>
                  <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-300" />{t.bands.developing} developing</span>
                  <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-400" />{t.bands.secure} secure</span>
                </div>
                {t.misconceptions.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Common misconceptions</p>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">{t.misconceptions.map((m) => <li key={m.tag} className="rounded-full bg-rose-400/10 px-3 py-1 text-xs text-rose-100">{m.tag} · {m.learners}</li>)}</ul>
                  </div>
                )}
              </section>
            );
          })}
          {dash.topics.length === 0 && <p className="text-sm text-neutral-400">No topic has enough students practising yet.</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="flex items-center gap-2 font-semibold text-white"><Users size={17} /> Classes you teach</h2>
        <p className="mt-1 text-sm text-neutral-400">Students join with a code. You see how the class is doing per topic, never individual names.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) void act(async () => { await api('/classes', { json: { name } }); setName(''); }); }} className="mt-4 flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Class name, e.g. S4 Physics" className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-white placeholder:text-neutral-500" />
          <button disabled={!name.trim()} className="inline-flex items-center gap-1.5 rounded-2xl bg-[#D97757] px-4 text-sm font-semibold text-white disabled:opacity-50"><Plus size={15} /> Create</button>
        </form>
        <ul className="mt-4 space-y-2">
          {data?.teaching.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => void open(c.id)} className="flex w-full items-center gap-3 rounded-2xl border border-white/10 px-4 py-3 text-left hover:border-white/25">
                <span className="min-w-0 flex-1"><span className="block truncate font-medium text-white">{c.name}</span><span className="text-xs text-neutral-400">{c.students} students · code <span className="font-mono tracking-wider">{c.code}</span></span></span>
                <ArrowUpRight size={15} className="text-neutral-500" />
              </button>
            </li>
          ))}
          {data && data.teaching.length === 0 && <li className="text-sm text-neutral-500">No classes yet.</li>}
        </ul>
      </section>
      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="flex items-center gap-2 font-semibold text-white"><GraduationCap size={17} /> Join a class</h2>
        <p className="mt-1 text-sm text-neutral-400">Your teacher sees only anonymous totals for the class, not your answers.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) void act(async () => { await api('/classes/join', { json: { code } }); setCode(''); }); }} className="mt-4 flex gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} placeholder="Class code" className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/30 px-4 py-2.5 font-mono text-sm tracking-widest text-white placeholder:font-sans placeholder:tracking-normal placeholder:text-neutral-500" />
          <button disabled={code.trim().length < 4} className="rounded-2xl bg-white px-4 text-sm font-semibold text-black disabled:opacity-50">Join</button>
        </form>
        <ul className="mt-4 space-y-2">
          {data?.joined.map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-2xl border border-white/10 px-4 py-3">
              <span className="flex-1 truncate text-white">{c.name}</span>
              <button type="button" onClick={() => void act(() => api(`/classes/${c.id}/membership`, { method: 'DELETE' }))} className="text-xs text-neutral-400 hover:text-rose-300">Leave</button>
            </li>
          ))}
        </ul>
      </section>
      {error && <p role="alert" className="rounded-2xl bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200 lg:col-span-2">{error}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"><div className="text-2xl font-semibold text-white">{value}</div><div className="text-xs text-neutral-400">{label}</div></div>;
}

export default function LearnPage({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<'practice' | 'classes'>(() => (new URLSearchParams(window.location.search).get('tab') === 'classes' ? 'classes' : 'practice'));
  useEffect(() => { window.history.replaceState({}, '', tab === 'classes' ? '/learn?tab=classes' : '/learn'); }, [tab]);
  return (
    <div className="h-[100dvh] overflow-y-auto bg-[#101114] text-neutral-200">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-[#101114]/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <button type="button" onClick={onBack} aria-label="Back to chat" className="rounded-full p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white"><ArrowLeft size={18} /></button>
          <h1 className="font-semibold text-white">Learn</h1>
          <nav className="ml-auto flex rounded-full bg-white/5 p-1 text-sm" aria-label="Learn sections">
            {(['practice', 'classes'] as const).map((t) => (
              <button key={t} type="button" aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)} className={`rounded-full px-3.5 py-1 capitalize ${tab === t ? 'bg-white text-black' : 'text-neutral-300 hover:text-white'}`}>{t}</button>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6 sm:py-10">{tab === 'practice' ? <Practice /> : <Classes />}</main>
    </div>
  );
}
