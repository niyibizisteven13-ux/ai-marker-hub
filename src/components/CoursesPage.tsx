import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Accessibility, ClipboardList, Download, GraduationCap, Loader2, Plus, Trash2, UserPlus, Users, X } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import { Empty, PageShell, Stat, StatRow, Toolbar, Card, primaryBtn, ghostBtn, iconBtn } from './workspace/Shell';

/**
 * Classes (a section of the Tasks page): a lecturer's named classes. A class holds the roster (registration number, name, email), each
 * student's accommodations (extra time, no camera, breaks, large text, voice answers), and the tasks and quizzes
 * that belong to it. The dashboard shows every student against every piece of work: handed in, marked, missing,
 * flagged, and who needs attention. Colour is never the only signal: every status also has a word.
 */

interface Accommodation { extraTimePercent: number; cameraExempt: boolean; breaks: boolean; largeText: boolean; voiceAnswers: boolean; note?: string }
interface Cell { state: 'marked' | 'submitted' | 'missing'; percent: number | null; label: string; late?: boolean; flags?: number }
interface Student { id: string; name: string; email: string; status: 'active' | 'withdrawn'; accommodations: Accommodation; hasAccommodation: boolean; cells: Record<string, Cell>; average: number | null; missing: number; flagged: number; late: number; risk: 'ok' | 'watch' | 'attention' }
interface Column { key: string; kind: 'task' | 'quiz'; id: string; title: string; dueAt: string | null; average: number | null; submitted: number; flagged: number }
interface Dashboard {
  course: { id: string; name: string; code: string; term: string }; columns: Column[]; students: Student[]; unmatched: string[];
  totals: { students: number; withAccommodations: number; needAttention: number; flaggedResponses: number; average: number | null };
  available: { tasks: Array<{ id: string; title: string }>; quizzes: Array<{ id: string; title: string }> };
}
interface Row { id: string; name: string; code: string; term: string; students: number; items: number }

const json = async <T,>(res: Response): Promise<T> => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status}).`);
  return body as T;
};
const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const field = 'w-full rounded-xl border border-white/[0.1] bg-[var(--ws-sunken)] px-3 py-2.5 text-[14px] text-[#F2EFE9] placeholder:text-neutral-500 focus:border-[var(--brand)]/60 focus:outline-none';
const RISK: Record<Student['risk'], { text: string; cls: string }> = {
  ok: { text: 'OK', cls: 'bg-emerald-500/15 text-emerald-300' },
  watch: { text: 'Watch', cls: 'bg-amber-500/15 text-amber-300' },
  attention: { text: 'Needs attention', cls: 'bg-rose-500/15 text-rose-300' },
};

function CellView({ c }: { c: Cell }) {
  if (c.state === 'missing') return <span className="text-neutral-500">Missing</span>;
  const tone = c.percent === null ? 'text-neutral-300' : c.percent >= 80 ? 'text-emerald-300' : c.percent >= 50 ? 'text-amber-300' : 'text-rose-300';
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={`font-semibold tabular-nums ${tone}`}>{c.percent === null ? 'Handed in' : `${Math.round(c.percent)}%`}</span>
      {c.late && <span className="rounded bg-amber-500/15 px-1 text-[10px] font-semibold text-amber-300">Late</span>}
      {c.flags ? <span title="Look at this response" className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 text-[10px] font-semibold text-amber-300"><AlertTriangle size={9} />Review</span> : null}
    </span>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-1.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" />
      <span><span className="block text-[13.5px] text-neutral-100">{label}</span>{hint && <span className="block text-[12px] text-neutral-400">{hint}</span>}</span>
    </label>
  );
}

/** One student: details and accommodations. */
function StudentPanel({ courseId, student, onClose, onChanged }: { courseId: string; student: Student; onClose: () => void; onChanged: () => void }) {
  const [a, setA] = useState<Accommodation>(student.accommodations);
  const [name, setName] = useState(student.name);
  const [email, setEmail] = useState(student.email);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (extra: Record<string, unknown> = {}) => {
    setBusy(true); setError(null);
    try { await json(await authFetch(`/api/courses/${courseId}/students/${encodeURIComponent(student.id)}`, jsonInit('PATCH', { name, email, accommodations: a, ...extra }))); onChanged(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Remove ${student.name} from this course? Their hand-ins stay in the tasks.`)) return;
    try { await authFetch(`/api/courses/${courseId}/students/${encodeURIComponent(student.id)}`, { method: 'DELETE' }); onChanged(); onClose(); } catch { /* shown on reload */ }
  };
  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label={`${student.name}`}>
      <div className="flex h-full w-full max-w-md flex-col border-l border-white/[0.1] bg-[var(--ws-bg)]">
        <header className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-3">
          <div className="min-w-0 flex-1"><p className="truncate text-[15px] font-semibold text-white">{student.name}</p><p className="font-mono text-[12px] text-neutral-400">{student.id}</p></div>
          <button type="button" onClick={onClose} className={iconBtn} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <div className="grid gap-3">
            <label className="block"><span className="mb-1 block text-[12.5px] text-neutral-300">Name</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={field} /></label>
            <label className="block"><span className="mb-1 block text-[12.5px] text-neutral-300">Email <span className="text-neutral-500">(optional)</span></span><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={field} /></label>
          </div>
          <section aria-labelledby="acc-h" className="rounded-xl border border-white/[0.1] bg-white/[0.02] p-3">
            <h3 id="acc-h" className="flex items-center gap-2 text-[13.5px] font-semibold text-white"><Accessibility size={15} />Accommodations</h3>
            <p className="mb-2 mt-0.5 text-[12px] leading-relaxed text-neutral-400">Used automatically when this student sits a timed test. Only you can see this.</p>
            <label className="mb-1 block text-[12.5px] text-neutral-300" htmlFor="extra">Extra time</label>
            <select id="extra" value={a.extraTimePercent} onChange={(e) => setA({ ...a, extraTimePercent: Number(e.target.value) })} className={field}>
              {[0, 10, 25, 50, 75, 100].map((n) => <option key={n} value={n}>{n === 0 ? 'None' : `+${n}%`}</option>)}
            </select>
            <div className="mt-2">
              <Toggle label="No camera check" checked={a.cameraExempt} onChange={(v) => setA({ ...a, cameraExempt: v })} hint="For students who cannot be watched by camera (disability, no camera, privacy or religious reasons). Watch them another way." />
              <Toggle label="Breaks allowed" checked={a.breaks} onChange={(v) => setA({ ...a, breaks: v })} hint="The student can pause the clock." />
              <Toggle label="Large text" checked={a.largeText} onChange={(v) => setA({ ...a, largeText: v })} />
              <Toggle label="Answers by voice or a scribe" checked={a.voiceAnswers} onChange={(v) => setA({ ...a, voiceAnswers: v })} />
            </div>
            <label className="mt-2 block"><span className="mb-1 block text-[12.5px] text-neutral-300">Note for you <span className="text-neutral-500">(for example the disability office reference)</span></span>
              <textarea value={a.note ?? ''} onChange={(e) => setA({ ...a, note: e.target.value })} maxLength={300} rows={2} className={`${field} resize-y`} /></label>
          </section>
          {student.status === 'withdrawn' && <p className="rounded-xl bg-white/[0.05] px-3 py-2 text-[12.5px] text-neutral-300">Withdrawn from the class: not counted in averages or as missing work.</p>}
          {error && <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-300">{error}</p>}
        </div>
        <footer className="flex flex-wrap items-center gap-2 border-t border-white/[0.08] p-4">
          <button type="button" onClick={() => void remove()} className={`${ghostBtn} text-rose-300`}><Trash2 size={14} />Remove</button>
          <button type="button" onClick={() => void save({ status: student.status === 'active' ? 'withdrawn' : 'active' })} className={ghostBtn}>{student.status === 'active' ? 'Mark as withdrawn' : 'Re-activate'}</button>
          <button type="button" disabled={busy} onClick={() => void save()} className={`${primaryBtn} ml-auto`}>{busy ? <Loader2 size={15} className="animate-spin" /> : null}Save</button>
        </footer>
      </div>
    </div>
  );
}

function CourseDashboard({ id, onBack, onDeleted }: { id: string; onBack: () => void; onDeleted: () => void }) {
  const [d, setD] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'attention' | 'accommodated'>('all');
  const [open, setOpen] = useState<Student | null>(null);
  const [adding, setAdding] = useState(false);
  const [paste, setPaste] = useState('');
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setD(await json<Dashboard>(await authFetch(`/api/courses/${id}`))); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the course.'); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => (d?.students ?? []).filter((s) => (filter === 'all' || (filter === 'attention' ? s.risk === 'attention' : s.hasAccommodation))
    && (!query.trim() || `${s.name} ${s.id}`.toLowerCase().includes(query.trim().toLowerCase()))), [d, filter, query]);

  const addStudents = async () => {
    try {
      const r = await json<{ added: number; updated: number }>(await authFetch(`/api/courses/${id}/students`, jsonInit('POST', { text: paste })));
      setNotice(`${r.added} added${r.updated ? `, ${r.updated} updated` : ''}.`); setPaste(''); setAdding(false); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add students.'); }
  };
  const saveItems = async (items: Array<{ kind: 'task' | 'quiz'; id: string }>) => {
    try { await json(await authFetch(`/api/courses/${id}/items`, jsonInit('PUT', { items }))); setPicking(false); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
  };
  const exportSheet = async () => {
    try {
      const res = await authFetch(`/api/courses/${id}/export.xlsx`);
      if (!res.ok) throw new Error(`Could not make the sheet (${res.status}).`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = `${d?.course.name || 'course'} marks.xlsx`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not make the sheet.'); }
  };
  const del = async () => {
    if (!d || !window.confirm(`Delete the class "${d.course.name}"? The roster and accommodations are removed. Tasks and quizzes stay.`)) return;
    await authFetch(`/api/courses/${id}`, { method: 'DELETE' }); onDeleted();
  };

  if (!d) return <div className="flex justify-center py-24 text-neutral-400">{error ?? <Loader2 className="animate-spin" />}</div>;
  const linked = new Set(d.columns.map((c) => `${c.kind}:${c.id}`));
  return (
    <PageShell wide icon={<GraduationCap size={20} />} title={d.course.name} onBack={onBack} backLabel="All classes"
      subtitle={[d.course.code, d.course.term].filter(Boolean).join(' · ') || 'Roster, work and marks in one place.'}
      actions={<>
        <button type="button" onClick={() => setAdding((v) => !v)} className={ghostBtn}><UserPlus size={15} />Add students</button>
        <button type="button" onClick={() => setPicking((v) => !v)} className={ghostBtn}><Plus size={15} />Tasks and quizzes</button>
        <button type="button" onClick={() => void exportSheet()} className={primaryBtn}><Download size={15} />Marks (Excel)</button>
      </>}>
      {notice && <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-200">{notice}</p>}
      {error && <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-300">{error}</p>}

      <StatRow>
        <Stat label="Students" value={d.totals.students} />
        <Stat label="Needs attention" value={d.totals.needAttention} tone={d.totals.needAttention ? 'warn' : 'good'} hint="low marks or much missing" />
        <Stat label="Flagged responses" value={d.totals.flaggedResponses} tone={d.totals.flaggedResponses ? 'warn' : undefined} hint="to look at, not proof" />
        <Stat label="Average" value={d.totals.average === null ? '–' : `${Math.round(d.totals.average)}%`} hint={`${d.totals.withAccommodations} with accommodations`} />
      </StatRow>

      {adding && (
        <Card className="p-4">
          <label htmlFor="paste" className="block text-[13.5px] font-semibold text-white">Add students</label>
          <p className="mb-2 text-[12px] text-neutral-400">Paste from Excel: registration number, name and optionally email, one student per line. Students already in the class are updated, and their accommodations are kept.</p>
          <textarea id="paste" value={paste} onChange={(e) => setPaste(e.target.value)} rows={5} placeholder={'222001234\tUwase Aline\taline@ur.ac.rw\n222005678\tMugisha Eric'} className={`${field} resize-y font-mono text-[12.5px]`} />
          <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setAdding(false)} className={ghostBtn}>Cancel</button><button type="button" disabled={!paste.trim()} onClick={() => void addStudents()} className={primaryBtn}>Add</button></div>
        </Card>
      )}

      {picking && (
        <Card className="p-4">
          <p className="text-[13.5px] font-semibold text-white">Tasks and quizzes in this class</p>
          <p className="mb-2 text-[12px] text-neutral-400">Quizzes need a question that asks for the registration number so responses can be matched.</p>
          <PickItems available={d.available} linked={linked} onSave={(items) => void saveItems(items)} onCancel={() => setPicking(false)} />
        </Card>
      )}

      {d.unmatched.length > 0 && (
        <p role="note" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-200">
          {d.unmatched.length} hand-in{d.unmatched.length === 1 ? '' : 's'} used a registration number that is not on this roster: <span className="font-mono">{d.unmatched.slice(0, 6).join(', ')}</span>{d.unmatched.length > 6 ? '…' : ''}. A typo, or a student from another class.
        </p>
      )}

      {d.students.length === 0 ? (
        <Empty icon={<Users size={22} />} title="No students yet" text="Add your class list to see who has handed in what." action={<button type="button" className={primaryBtn} onClick={() => setAdding(true)}><UserPlus size={15} />Add students</button>} />
      ) : (
        <>
          <Toolbar<'all' | 'attention' | 'accommodated'> query={query} onQuery={setQuery} placeholder="Search by name or registration number" filter={filter} onFilter={setFilter}
            filters={[{ id: 'all', label: 'All', count: d.students.length }, { id: 'attention', label: 'Needs attention', count: d.students.filter((s) => s.risk === 'attention').length }, { id: 'accommodated', label: 'Accommodations', count: d.students.filter((s) => s.hasAccommodation).length }]} />
          <div className="overflow-x-auto rounded-2xl border border-white/[0.07] bg-[var(--ws-card)]">
            <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
              <caption className="sr-only">Students and their work in {d.course.name}</caption>
              <thead>
                <tr className="border-b border-white/[0.08] text-[11.5px] uppercase tracking-wide text-neutral-500">
                  <th scope="col" className="sticky left-0 z-10 bg-[var(--ws-card)] px-4 py-3 font-medium">Student</th>
                  {d.columns.map((c) => (
                    <th key={c.key} scope="col" className="px-3 py-3 font-medium normal-case tracking-normal">
                      <span className="block max-w-[11rem] truncate text-[12.5px] font-semibold text-neutral-200" title={c.title}>{c.title}</span>
                      <span className="block text-[11px] font-normal text-neutral-500">{c.kind === 'quiz' ? 'Quiz' : 'Task'} · {c.submitted}/{d.totals.students} in{c.average !== null ? ` · avg ${Math.round(c.average)}%` : ''}</span>
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-3 font-medium">Average</th>
                  <th scope="col" className="px-3 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.id} className={`border-b border-white/[0.05] last:border-0 hover:bg-white/[0.03] ${s.status === 'withdrawn' ? 'opacity-50' : ''}`}>
                    <th scope="row" className="sticky left-0 z-10 bg-[var(--ws-card)] px-4 py-2.5 font-normal">
                      <button type="button" onClick={() => setOpen(s)} className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/60">
                        <span className="flex items-center gap-1.5 font-semibold text-white">{s.name}{s.hasAccommodation && <Accessibility size={13} aria-label="Has accommodations" className="text-sky-300" />}</span>
                        <span className="font-mono text-[11.5px] text-neutral-500">{s.id}{s.status === 'withdrawn' ? ' · withdrawn' : ''}</span>
                      </button>
                    </th>
                    {d.columns.map((c) => <td key={c.key} className="px-3 py-2.5"><CellView c={s.cells[c.key]} /></td>)}
                    <td className="px-3 py-2.5 font-semibold tabular-nums text-neutral-100">{s.average === null ? '–' : `${Math.round(s.average)}%`}</td>
                    <td className="px-3 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${RISK[s.risk].cls}`}>{RISK[s.risk].text}</span></td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={d.columns.length + 3} className="px-4 py-8 text-center text-neutral-400">No student matches.</td></tr>}
              </tbody>
            </table>
          </div>
          {d.columns.length === 0 && <p className="text-[13px] text-neutral-400">Add tasks and quizzes to this class to see marks here.</p>}
        </>
      )}
      <div className="pt-2"><button type="button" onClick={() => void del()} className="text-[12.5px] text-neutral-500 hover:text-rose-300">Delete this class</button></div>
      {open && <StudentPanel courseId={id} student={open} onClose={() => setOpen(null)} onChanged={() => void load()} />}
    </PageShell>
  );
}

function PickItems({ available, linked, onSave, onCancel }: { available: Dashboard['available']; linked: Set<string>; onSave: (items: Array<{ kind: 'task' | 'quiz'; id: string }>) => void; onCancel: () => void }) {
  const [sel, setSel] = useState(new Set(linked));
  const flip = (k: string) => setSel((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const group = (title: string, kind: 'task' | 'quiz', list: Array<{ id: string; title: string }>) => (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-neutral-500">{title}</legend>
      {list.length === 0 ? <p className="text-[12.5px] text-neutral-500">None yet.</p> : list.map((x) => (
        <label key={x.id} className="flex cursor-pointer items-center gap-2 py-1 text-[13px] text-neutral-200"><input type="checkbox" checked={sel.has(`${kind}:${x.id}`)} onChange={() => flip(`${kind}:${x.id}`)} className="h-4 w-4 accent-[var(--brand)]" /><span className="truncate">{x.title}</span></label>
      ))}
    </fieldset>
  );
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">{group('Tasks', 'task', available.tasks)}{group('Quizzes', 'quiz', available.quizzes)}</div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={ghostBtn}>Cancel</button>
        <button type="button" onClick={() => onSave([...sel].map((k) => ({ kind: k.startsWith('quiz:') ? 'quiz' as const : 'task' as const, id: k.slice(k.indexOf(':') + 1) })))} className={primaryBtn}>Save</button>
      </div>
    </>
  );
}

/** The Classes section of the Tasks page: the lecturer's named classes. `tabs` is the Tasks / Classes switch shown on the list. */
export default function CoursesPage({ onClose, tabs }: { onClose: () => void; tabs?: React.ReactNode }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [view, setView] = useState<{ kind: 'list' } | { kind: 'new' } | { kind: 'one'; id: string }>({ kind: 'list' });
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', code: '', term: '', roster: '' });
  const [busy, setBusy] = useState(false);
  const loadRows = useCallback(async () => {
    try { setRows((await json<{ courses: Row[] }>(await authFetch('/api/courses'))).courses); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load.'); }
  }, []);
  useEffect(() => { if (view.kind === 'list') void loadRows(); }, [view, loadRows]);
  const create = async () => {
    setBusy(true); setError(null);
    try { const c = await json<Row>(await authFetch('/api/courses', jsonInit('POST', form))); setForm({ name: '', code: '', term: '', roster: '' }); setView({ kind: 'one', id: c.id }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not create the class.'); } finally { setBusy(false); }
  };
  const newBtn = <button type="button" onClick={() => setView({ kind: 'new' })} className={primaryBtn}><Plus size={16} />New class</button>;
  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-[var(--ws-bg)]">
      {view.kind === 'one' ? (
        <CourseDashboard id={view.id} onBack={() => setView({ kind: 'list' })} onDeleted={() => setView({ kind: 'list' })} />
      ) : view.kind === 'new' ? (
        <PageShell icon={<GraduationCap size={20} />} title="New class" subtitle="Name the class and paste your class list. You can add students, tasks and quizzes later." onBack={() => setView({ kind: 'list' })} backLabel="All classes">
          <section className="space-y-4 rounded-[20px] border border-white/[0.12] bg-[var(--ws-card)] p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block sm:col-span-3"><span className="mb-1.5 block text-[12.5px] font-medium text-neutral-300">Class name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} placeholder="For example: Calculus I" className={field} /></label>
              <label className="block"><span className="mb-1.5 block text-[12.5px] font-medium text-neutral-300">Code <span className="text-neutral-500">(optional)</span></span><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} maxLength={30} placeholder="MATH101" className={field} /></label>
              <label className="block"><span className="mb-1.5 block text-[12.5px] font-medium text-neutral-300">Term <span className="text-neutral-500">(optional)</span></span><input value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} maxLength={40} placeholder="2026 semester 1" className={field} /></label>
            </div>
            <label className="block"><span className="mb-1.5 block text-[12.5px] font-medium text-neutral-300">Class list <span className="text-neutral-500">(optional): registration number, name, email</span></span>
              <textarea value={form.roster} onChange={(e) => setForm({ ...form, roster: e.target.value })} rows={6} placeholder={'222001234\tUwase Aline\taline@ur.ac.rw\n222005678\tMugisha Eric'} className={`${field} resize-y font-mono text-[12.5px]`} /></label>
            {error && <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-300">{error}</p>}
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setView({ kind: 'list' })} className={ghostBtn}>Cancel</button><button type="button" disabled={busy || !form.name.trim()} onClick={() => void create()} className={primaryBtn}>{busy ? <Loader2 size={15} className="animate-spin" /> : null}Create class</button></div>
          </section>
        </PageShell>
      ) : (
        <PageShell icon={<ClipboardList size={20} />} title="Tasks" onBack={onClose} subtitle="Set work, share one link or QR code, and collect answers from any phone: photos, PDF, Word or typed. When you are ready, the AI marks the whole class." actions={newBtn}>
          {tabs}
          {error ? <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-300">{error}</p>
            : !rows ? <div className="flex justify-center py-16 text-neutral-400"><Loader2 className="animate-spin" /></div>
              : !rows.length ? <Empty icon={<GraduationCap size={22} />} title="No classes yet" text="Create a class, paste your class list, then add the tasks and quizzes you give." action={newBtn} />
                : (
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {rows.map((r) => (
                      <li key={r.id}><Card onClick={() => setView({ kind: 'one', id: r.id })} className="p-4">
                        <p className="text-[15px] font-semibold text-white">{r.name}</p>
                        <p className="mt-0.5 text-[12.5px] text-neutral-400">{[r.code, r.term].filter(Boolean).join(' · ') || 'No code'}</p>
                        <p className="mt-3 flex gap-4 text-[12.5px] text-neutral-300"><span className="inline-flex items-center gap-1"><Users size={13} />{r.students} students</span><span>{r.items} tasks and quizzes</span></p>
                      </Card></li>
                    ))}
                  </ul>
                )}
        </PageShell>
      )}
    </div>
  );
}
