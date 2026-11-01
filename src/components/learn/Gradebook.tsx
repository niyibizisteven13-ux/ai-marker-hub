import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Download, FileCheck2, Loader2, Plus, Settings2, X } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';

/**
 * A class gradebook: students down the side, the tasks and quizzes you add across the top, each mark as a
 * percentage with a colour, averages for every student and every column, and an Excel copy for reports.
 */

interface Cell { percent: number | null; label: string; state: 'marked' | 'submitted' | 'missing' }
interface Data {
  class: { id: string; name: string };
  columns: Array<{ key: string; kind: 'task' | 'quiz'; id: string; title: string; average: number | null; count: number }>;
  students: Array<{ key: string; name: string; studentId: string | null; cells: Record<string, Cell>; average: number | null }>;
  available: { tasks: Array<{ id: string; title: string; autoMark: boolean }>; quizzes: Array<{ id: string; title: string }> };
}

const tone = (v: number | null) => (v === null ? '' : v >= 80 ? 'bg-emerald-500/15 text-emerald-200' : v >= 50 ? 'bg-amber-400/15 text-amber-200' : 'bg-rose-500/15 text-rose-200');

export default function Gradebook({ classId }: { classId: string }) {
  const [g, setG] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const call = async (init?: RequestInit) => {
    const r = await authFetch(`/api/learn/classes/${encodeURIComponent(classId)}/gradebook`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b.error || 'Could not load the gradebook.');
    return b.gradebook as Data;
  };
  useEffect(() => { call().then((d) => { setG(d); if (!d.columns.length) setPicking(true); }).catch((e) => setError(e.message)); }, [classId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (g) setChosen(new Set(g.columns.map((c) => c.key))); }, [g]);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const items = [...chosen].map((k) => { const [kind, id] = k.split(':'); return { kind, id }; });
      setG(await call({ method: 'PUT', body: JSON.stringify({ items }) }));
      setPicking(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); } finally { setSaving(false); }
  };
  const download = async () => {
    setDownloading(true);
    try {
      const r = await authFetch(`/api/learn/classes/${encodeURIComponent(classId)}/gradebook.xlsx`);
      if (!r.ok) throw new Error('Could not make the Excel file.');
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url; a.download = `${g?.class.name ?? 'class'} gradebook.xlsx`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not make the Excel file.'); } finally { setDownloading(false); }
  };
  const classAverage = useMemo(() => {
    const v = g?.students.map((s) => s.average).filter((x): x is number => x !== null) ?? [];
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
  }, [g]);

  if (error && !g) return <p className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>;
  if (!g) return <div className="flex justify-center py-16 text-neutral-400"><Loader2 className="animate-spin" /></div>;

  const toggle = (k: string) => setChosen((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-neutral-400">{g.students.length} student{g.students.length === 1 ? '' : 's'} · {g.columns.length} column{g.columns.length === 1 ? '' : 's'}{classAverage !== null ? ` · class average ${classAverage}%` : ''}</p>
        <button type="button" onClick={() => setPicking((p) => !p)} className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.12] px-3 py-2 text-[13px] text-neutral-200 hover:bg-white/[0.06]"><Settings2 size={14} />Choose columns</button>
        <button type="button" disabled={!g.columns.length || downloading} onClick={() => void download()} className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--brand)] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[var(--brand-strong)] disabled:opacity-40">{downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}Excel</button>
      </div>
      {error && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-200">{error}</p>}

      {picking && (
        <section className="rounded-2xl border border-white/[0.08] bg-[var(--ws-card)] p-4" aria-label="Choose columns">
          <div className="flex items-start justify-between gap-3">
            <div><h3 className="font-semibold text-white">What goes in this gradebook</h3><p className="text-[12.5px] text-neutral-400">Tasks marked automatically and quiz forms give marks. Students are matched by ID, or by name.</p></div>
            <button type="button" onClick={() => setPicking(false)} aria-label="Close" className="rounded-lg p-1.5 text-neutral-400 hover:bg-white/10"><X size={16} /></button>
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-neutral-500"><ClipboardList size={13} />Tasks</p>
              {!g.available.tasks.length && <p className="text-[13px] text-neutral-500">No tasks yet.</p>}
              {g.available.tasks.map((t) => (
                <label key={t.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px] text-neutral-200 hover:bg-white/[0.04]">
                  <input type="checkbox" checked={chosen.has(`task:${t.id}`)} onChange={() => toggle(`task:${t.id}`)} className="h-4 w-4 accent-[var(--brand)]" />
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>{!t.autoMark && <span className="text-[11px] text-neutral-500">hand-ins only</span>}
                </label>
              ))}
            </div>
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-neutral-500"><FileCheck2 size={13} />Quiz forms</p>
              {!g.available.quizzes.length && <p className="text-[13px] text-neutral-500">No quiz forms yet. Turn on "Make this a quiz" in a form.</p>}
              {g.available.quizzes.map((q) => (
                <label key={q.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px] text-neutral-200 hover:bg-white/[0.04]">
                  <input type="checkbox" checked={chosen.has(`quiz:${q.id}`)} onChange={() => toggle(`quiz:${q.id}`)} className="h-4 w-4 accent-[var(--brand)]" />
                  <span className="min-w-0 flex-1 truncate">{q.title}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="mt-3 flex justify-end"><button type="button" disabled={saving} onClick={() => void save()} className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--brand)] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}Save columns</button></div>
        </section>
      )}

      {g.columns.length === 0 ? (
        !picking && <p className="rounded-2xl border border-dashed border-white/[0.12] px-4 py-10 text-center text-sm text-neutral-400">Add tasks and quizzes to see every student's marks in one table.</p>
      ) : g.students.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-white/[0.12] px-4 py-10 text-center text-sm text-neutral-400">No marks yet. They appear as students hand in and their work is marked.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/[0.08]">
          <table className="min-w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-[var(--ws-card)] text-left text-[11.5px] uppercase tracking-wide text-neutral-400">
                <th className="sticky left-0 z-10 bg-[var(--ws-card)] px-3 py-2.5 font-semibold">Student</th>
                {g.columns.map((c) => <th key={c.key} className="max-w-[160px] px-3 py-2.5 font-semibold" title={c.title}><span className="flex items-center gap-1.5">{c.kind === 'task' ? <ClipboardList size={12} /> : <FileCheck2 size={12} />}<span className="truncate normal-case tracking-normal text-neutral-200">{c.title}</span></span></th>)}
                <th className="px-3 py-2.5 font-semibold">Average</th>
              </tr>
            </thead>
            <tbody>
              {g.students.map((s) => (
                <tr key={s.key} className="border-t border-white/[0.06]">
                  <td className="sticky left-0 z-10 bg-[var(--ws-bg)] px-3 py-2"><span className="block font-medium text-white">{s.name}</span>{s.studentId && <span className="text-[11px] text-neutral-500">{s.studentId}</span>}</td>
                  {g.columns.map((c) => {
                    const cell = s.cells[c.key];
                    return <td key={c.key} className="px-2 py-1.5"><span title={cell.label} className={`inline-flex min-w-[64px] justify-center rounded-lg px-2 py-1 tabular-nums ${cell.percent !== null ? tone(cell.percent) : 'text-neutral-500'}`}>{cell.percent !== null ? `${cell.percent}%` : cell.state === 'submitted' ? 'Handed in' : '–'}</span></td>;
                  })}
                  <td className="px-2 py-1.5"><span className={`inline-flex min-w-[64px] justify-center rounded-lg px-2 py-1 font-semibold tabular-nums ${tone(s.average)}`}>{s.average !== null ? `${s.average}%` : '–'}</span></td>
                </tr>
              ))}
              <tr className="border-t border-white/[0.12] bg-white/[0.02] font-semibold">
                <td className="sticky left-0 z-10 bg-[var(--ws-card)] px-3 py-2 text-neutral-200">Class average</td>
                {g.columns.map((c) => <td key={c.key} className="px-2 py-1.5"><span className="inline-flex min-w-[64px] justify-center tabular-nums text-neutral-200">{c.average !== null ? `${c.average}%` : '–'}</span></td>)}
                <td className="px-2 py-1.5"><span className="inline-flex min-w-[64px] justify-center tabular-nums text-neutral-200">{classAverage !== null ? `${classAverage}%` : '–'}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
