import { useCallback, useEffect, useState } from 'react';
import Gradebook from '../components/learn/Gradebook';
import { ArrowLeft, ArrowUpRight, Check, Copy, FlaskConical, GraduationCap, Landmark, Languages, Lightbulb, Loader2, Plus, School, Sigma, Sparkles, Target, TrendingDown, TrendingUp, Users, X } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import { PageShell } from '../components/workspace/Shell';

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
const SUBJECTS: Array<{ name: string; icon: React.ReactNode; topics: string[] }> = [
  { name: 'Mathematics', icon: <Sigma size={15} className="text-sky-300" />, topics: ['Fractions', 'Quadratic equations', 'Probability', 'Trigonometry'] },
  { name: 'Sciences', icon: <FlaskConical size={15} className="text-emerald-300" />, topics: ['Photosynthesis', 'Newton’s laws', 'Cell biology', 'Chemical bonding'] },
  { name: 'Humanities', icon: <Landmark size={15} className="text-amber-300" />, topics: ['Rwandan history 1959–1994', 'Supply and demand', 'Map reading', 'Citizenship'] },
  { name: 'Languages', icon: <Languages size={15} className="text-violet-300" />, topics: ['English tenses', 'French verbs (présent)', 'Essay structure', 'Kinyarwanda grammar'] },
];

function Tile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[var(--ws-card)] px-4 py-3">
      <p className="text-[11.5px] font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tabular-nums text-white">{value}</p>
      {hint && <p className="text-[11.5px] text-neutral-500">{hint}</p>}
    </div>
  );
}

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
    const answered = skills.reduce((n, s) => n + s.attempts, 0);
    const avg = skills.length ? skills.reduce((n, s) => n + s.mastery, 0) / skills.length : 0;
    const best = skills.reduce((n, s) => Math.max(n, s.streak), 0);
    // Weakest first: what needs work is what the learner sees first.
    const mine = [...skills].sort((a, b) => a.mastery - b.mastery);
    return (
      <div className="space-y-6">
        <form onSubmit={(e) => { e.preventDefault(); if (topic.trim()) void next(topic.trim()); }} className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[var(--ws-card-hover)] to-[var(--ws-card)] p-5 sm:p-6">
          <h2 className="text-[17px] font-semibold text-white">What do you want to practise?</h2>
          <p className="mt-1 text-[13.5px] text-neutral-400">Questions adapt to you: harder after a streak, back to the foundations when something is not clicking. Every answer is explained.</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} placeholder="Any topic, e.g. balancing chemical equations" className="min-w-0 flex-1 rounded-xl border border-white/[0.1] bg-[var(--ws-bg)] px-4 py-3 text-[14px] text-white placeholder:text-neutral-500 focus:border-[var(--brand)]/60 focus:outline-none" />
            <button disabled={!topic.trim() || busy === 'next'} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-5 py-3 text-[14px] font-semibold text-white shadow-[0_6px_20px_-8px_rgba(217,119,87,0.7)] hover:bg-[var(--brand-strong)] disabled:opacity-50">
              {busy === 'next' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Start practising
            </button>
          </div>
          {error && <ErrorNote error={error} />}
        </form>

        {skills.length > 0 && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Tile label="Topics" value={skills.length} hint="practised" />
            <Tile label="Answered" value={answered} hint="questions" />
            <Tile label="Mastery" value={`${Math.round(avg * 100)}%`} hint="average" />
            <Tile label="Best streak" value={best} hint="correct in a row" />
          </div>
        )}

        {mine.length > 0 && (
          <section>
            <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-neutral-500">Continue · weakest first</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {mine.map((s) => (
                <button key={s.topicKey} type="button" onClick={() => void next(s.topic)} className="group rounded-2xl border border-white/[0.07] bg-[var(--ws-card)] p-4 text-left transition hover:border-white/[0.16] hover:bg-[var(--ws-card-hover)]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[14.5px] font-semibold text-white">{s.topic}</span>
                    {s.mastery < 0.4 ? <span className="shrink-0 rounded-full bg-rose-400/15 px-2 py-0.5 text-[10.5px] font-semibold text-rose-200">Needs work</span>
                      : s.mastery >= 0.7 ? <span className="shrink-0 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-200">Secure</span>
                        : <ArrowUpRight size={15} className="shrink-0 text-neutral-500 group-hover:text-white" />}
                  </div>
                  <div className="mt-3 flex items-center gap-2"><MasteryBar value={s.mastery} /><span className="w-9 shrink-0 text-right text-[12px] tabular-nums text-neutral-300">{Math.round(s.mastery * 100)}%</span></div>
                  <div className="mt-2 flex flex-wrap gap-x-3 text-[12px] text-neutral-500">
                    <span>Level {s.level} · {LEVEL_NAMES[s.level]}</span><span>{s.attempts} answered</span>{s.accuracy !== null && <span>{Math.round(s.accuracy * 100)}% correct</span>}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        <section>
          <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-neutral-500">Start a subject</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {SUBJECTS.map((g) => (
              <div key={g.name} className="rounded-2xl border border-white/[0.07] bg-[var(--ws-card)] p-4">
                <p className="flex items-center gap-2 text-[14px] font-semibold text-white"><span className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.06]">{g.icon}</span>{g.name}</p>
                <div className="mt-3 flex flex-col gap-1">
                  {g.topics.map((t) => (
                    <button key={t} type="button" disabled={busy === 'next'} onClick={() => void next(t)} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-[13px] text-neutral-300 hover:bg-white/[0.05] hover:text-white">
                      {t}<ArrowUpRight size={13} className="text-neutral-600" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
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

      <article className="rounded-2xl border border-white/[0.07] bg-[var(--ws-card)] p-5 sm:p-7">
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
                  className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition-colors ${right ? 'border-emerald-400/60 bg-emerald-400/10 text-white' : picked ? (done ? 'border-rose-400/60 bg-rose-400/10 text-white' : 'border-[var(--brand)] bg-[var(--brand)]/10 text-white') : 'border-white/10 text-neutral-200 hover:border-white/25'}`}>
                  <span className="mt-px font-semibold text-neutral-400">{String.fromCharCode(65 + i)}</span><span className="flex-1">{c}</span>
                  {right && <Check size={16} className="text-emerald-300" />}{done && picked && !right && <X size={16} className="text-rose-300" />}
                </button>
              );
            })}
          </div>
        ) : (
          <textarea value={done ? item.response : response} readOnly={done} onChange={(e) => setResponse(e.target.value)} rows={item.kind === 'numeric' ? 1 : 4} maxLength={2000}
            placeholder={item.kind === 'numeric' ? 'Your answer (include units if needed)' : 'Explain your answer in your own words'}
            className="mt-5 w-full resize-y rounded-2xl border border-white/10 bg-[var(--ws-bg)] px-4 py-3 text-sm text-white placeholder:text-neutral-500 focus:border-[var(--brand)]/60 focus:outline-none" />
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
                  <button key={c} type="button" aria-pressed={confidence === i + 1} onClick={() => setConfidence(confidence === i + 1 ? null : i + 1)} className={`rounded-full border px-3 py-1 text-xs ${confidence === i + 1 ? 'border-[var(--brand)] bg-[var(--brand)]/15 text-white' : 'border-white/10 text-neutral-300 hover:border-white/25'}`}>{c}</button>
                ))}
              </div>
            </fieldset>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button type="button" disabled={!response.trim() || busy === 'answer'} onClick={() => void answer()} className="inline-flex items-center gap-2 rounded-2xl bg-[var(--brand)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
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
  const [view, setView] = useState<'gradebook' | 'overview'>('gradebook');
  const load = useCallback(() => api<any>('/classes').then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await load(); } catch (e: any) { setError(e.message); } };
  const open = async (id: string) => { setError(null); try { setDash(await api<Dashboard>(`/classes/${id}/dashboard`)); } catch (e: any) { setError(e.message); } };

  if (dash) {
    return (
      <div className="space-y-5">
        <button type="button" onClick={() => setDash(null)} className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-white"><ArrowLeft size={15} /> Classes</button>
        <header className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1"><h2 className="truncate text-xl font-semibold text-white">{dash.class.name}</h2><p className="text-sm text-neutral-400">{view === 'gradebook' ? 'Marks from your tasks and quizzes, one row per student' : `Anonymous practice overview · groups smaller than ${dash.k} are hidden`}</p></div>
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(dash.class.code); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-3 py-2 font-mono text-sm tracking-widest text-white hover:border-white/25">
            {dash.class.code} {copied ? <Check size={14} className="text-emerald-300" /> : <Copy size={14} />}
          </button>
        </header>
        <div role="tablist" aria-label="Class view" className="inline-flex rounded-xl border border-white/[0.08] bg-[var(--ws-card)] p-0.5">
          {([['gradebook', 'Gradebook'], ['overview', 'Practice overview']] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)} className={`rounded-[10px] px-3.5 py-1.5 text-[13px] font-medium ${view === id ? 'bg-white/[0.09] text-white' : 'text-neutral-400 hover:text-neutral-200'}`}>{label}</button>
          ))}
        </div>
        {view === 'gradebook' ? <Gradebook classId={dash.class.id} /> : <>
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
              <section key={t.topic} className="rounded-2xl border border-white/[0.07] bg-[var(--ws-card)] p-5">
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
        </>}
      </div>
    );
  }

  const students = data?.teaching.reduce((n, c) => n + c.students, 0) ?? 0;
  return (
    <div className="space-y-5">
      {data && (data.teaching.length > 0 || data.joined.length > 0) && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Tile label="You teach" value={data.teaching.length} hint={`class${data.teaching.length === 1 ? '' : 'es'}`} />
          <Tile label="Students" value={students} hint="joined with your codes" />
          <Tile label="You joined" value={data.joined.length} hint={`class${data.joined.length === 1 ? '' : 'es'}`} />
          <Tile label="Privacy" value="Anonymous" hint="no names in dashboards" />
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-white/[0.07] bg-[var(--ws-card)] p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-white"><School size={17} className="text-[var(--brand-soft)]" /> Create a class</h2>
          <p className="mt-1 text-[13px] text-neutral-400">Students join with a code. You see how the class does per topic and its common misconceptions, never individual names.</p>
          <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) void act(async () => { await api('/classes', { json: { name } }); setName(''); }); }} className="mt-4 flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Class name, e.g. S4 Physics" className="min-w-0 flex-1 rounded-xl border border-white/[0.1] bg-[var(--ws-bg)] px-4 py-2.5 text-[14px] text-white placeholder:text-neutral-500 focus:border-[var(--brand)]/60 focus:outline-none" />
            <button disabled={!name.trim()} className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--brand)] px-4 text-[13.5px] font-semibold text-white hover:bg-[var(--brand-strong)] disabled:opacity-50"><Plus size={15} /> Create</button>
          </form>
        </section>
        <section className="rounded-2xl border border-white/[0.07] bg-[var(--ws-card)] p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-white"><GraduationCap size={17} className="text-sky-300" /> Join a class</h2>
          <p className="mt-1 text-[13px] text-neutral-400">Enter the code your teacher shared. They see only anonymous totals for the class, not your answers.</p>
          <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) void act(async () => { await api('/classes/join', { json: { code } }); setCode(''); }); }} className="mt-4 flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} placeholder="Class code" className="min-w-0 flex-1 rounded-xl border border-white/[0.1] bg-[var(--ws-bg)] px-4 py-2.5 font-mono text-[14px] tracking-widest text-white placeholder:font-sans placeholder:tracking-normal placeholder:text-neutral-500 focus:border-[var(--brand)]/60 focus:outline-none" />
            <button disabled={code.trim().length < 4} className="rounded-xl bg-[var(--invert-bg)] px-4 text-[13.5px] font-semibold text-[#0f1012] hover:bg-white disabled:opacity-50">Join</button>
          </form>
        </section>
      </div>
      {error && <p role="alert" className="rounded-xl bg-rose-500/10 px-4 py-2.5 text-[13px] text-rose-200">{error}</p>}
      {data && data.teaching.length > 0 && (
        <section>
          <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-neutral-500">Classes you teach</h3>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.teaching.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => void open(c.id)} className="group flex h-full w-full flex-col rounded-2xl border border-white/[0.07] bg-[var(--ws-card)] p-4 text-left transition hover:border-white/[0.16] hover:bg-[var(--ws-card-hover)]">
                  <span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-white">{c.name}</span><ArrowUpRight size={15} className="text-neutral-500 group-hover:text-white" /></span>
                  <span className="mt-3 flex items-end justify-between gap-2">
                    <span><span className="block text-[24px] font-semibold leading-none tabular-nums text-white">{c.students}</span><span className="text-[12px] text-neutral-500">student{c.students === 1 ? '' : 's'}</span></span>
                    <span className="rounded-lg border border-white/[0.1] px-2 py-1 font-mono text-[12px] tracking-widest text-neutral-200">{c.code}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data && data.joined.length > 0 && (
        <section>
          <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-neutral-500">Classes you joined</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {data.joined.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-[var(--ws-card)] px-4 py-3">
                <Users size={15} className="text-neutral-500" /><span className="flex-1 truncate text-[14px] text-white">{c.name}</span>
                <button type="button" onClick={() => void act(() => api(`/classes/${c.id}/membership`, { method: 'DELETE' }))} className="text-[12px] text-neutral-400 hover:text-rose-300">Leave</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data && !data.teaching.length && !data.joined.length && <p className="text-center text-[13px] text-neutral-500">No classes yet. Create one for your students, or join with a code.</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"><div className="text-2xl font-semibold text-white">{value}</div><div className="text-xs text-neutral-400">{label}</div></div>;
}

export default function LearnPage({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<'practice' | 'classes'>(() => (new URLSearchParams(window.location.search).get('tab') === 'classes' ? 'classes' : 'practice'));
  useEffect(() => { window.history.replaceState({}, '', tab === 'classes' ? '/learn?tab=classes' : '/learn'); }, [tab]);
  const tabs = (
    <nav className="flex rounded-xl border border-white/[0.08] bg-[var(--ws-card)] p-0.5 text-[13px]" aria-label="Learn sections">
      {(['practice', 'classes'] as const).map((t) => (
        <button key={t} type="button" aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)} className={`rounded-[10px] px-4 py-1.5 font-medium capitalize ${tab === t ? 'bg-white/[0.09] text-white' : 'text-neutral-400 hover:text-neutral-200'}`}>{t}</button>
      ))}
    </nav>
  );
  return (
    <div className="relative h-[100dvh] overflow-y-auto bg-[var(--ws-bg)] text-neutral-200">
      <PageShell onBack={onBack} wide icon={tab === 'practice' ? <Target size={20} /> : <Users size={20} />}
        title={tab === 'practice' ? 'Practice' : 'Classes'}
        subtitle={tab === 'practice' ? 'Adaptive questions on any topic, at your level, with hints and explanations. Mastery grows with every answer.' : 'Bring students together with a code and see how the class is doing per topic, anonymously.'}
        actions={tabs}>
        {tab === 'practice' ? <Practice /> : <Classes />}
      </PageShell>
    </div>
  );
}
