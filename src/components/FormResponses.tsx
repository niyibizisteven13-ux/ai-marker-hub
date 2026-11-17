import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Loader2 } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import { FileThumb, PreviewDialog, type PreviewSource } from './FilePreview';

/**
 * Every response to a form, one at a time (newest first, ← and → to move), each answer under its question.
 * Files people attached open in place, full screen, without downloading.
 */

type Question = { id: string; title?: string; label?: string; type?: string; points?: number; correctAnswer?: unknown };
type Written = Record<string, { marks: number; feedback?: string; by: 'ai' | 'lecturer'; confidence?: 'high' | 'low' }>;
type QuizRec = { score: number; maxScore: number; percent: number; correct: string[]; pending?: number; mark?: number; outOf?: number | null; grade?: string; passed?: boolean };
type Response = { id: string; submittedAt: string; answers: Record<string, unknown> };
type FileValue = { name?: string; size?: number; url?: string; type?: string };

const isFile = (v: unknown): v is FileValue => !!v && typeof v === 'object' && typeof (v as FileValue).url === 'string' && typeof (v as FileValue).name === 'string';
const mimeOf = (f: FileValue) => f.type || (/^data:([^;,]+)/.exec(f.url ?? '')?.[1] ?? '');
const show = (v: unknown): string => (v === null || v === undefined || v === '' ? '' : Array.isArray(v) ? v.map(show).filter(Boolean).join(', ') : typeof v === 'object' ? Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${show(x)}`).join(' · ') : String(v));

export default function FormResponses({ formId, questions, aiMarking = false }: { formId: string; questions: Question[]; aiMarking?: boolean }) {
  const [rows, setRows] = useState<Response[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [preview, setPreview] = useState<PreviewSource | null>(null);
  // Leads across the class (similar answers, shared wrong answers, one device for two students).
  const [review, setReview] = useState<Record<string, Array<{ code: string; level: 'review' | 'info'; message: string }>>>({});
  useEffect(() => {
    authFetch(`/api/forms/${encodeURIComponent(formId)}/class-review`).then((r) => (r.ok ? r.json() : { flags: {} })).then((b) => setReview(b.flags ?? {})).catch(() => undefined);
  }, [formId]);

  useEffect(() => {
    authFetch(`/api/forms/${encodeURIComponent(formId)}/responses`).then(async (r) => {
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || 'Could not load the responses.');
      setRows(b.submissions ?? []);
    }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load the responses.'));
  }, [formId]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (preview || (e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      if (e.key === 'ArrowRight') setI((x) => Math.min((rows?.length ?? 1) - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [rows, preview]);

  const [markBusy, setMarkBusy] = useState('');
  const [markNote, setMarkNote] = useState('');
  const [typed, setTyped] = useState<Record<string, string>>({});
  const reload = () => authFetch(`/api/forms/${encodeURIComponent(formId)}/responses`).then((r) => r.json()).then((b) => setRows(b.submissions ?? [])).catch(() => undefined);
  const saveMark = async (submissionId: string, questionId: string, marks: number) => {
    setMarkBusy(`${submissionId}:${questionId}`); setMarkNote('');
    try {
      const r = await authFetch(`/api/forms/${encodeURIComponent(formId)}/responses/${encodeURIComponent(submissionId)}/marks`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionId, marks }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || 'Could not save the mark.');
      setRows((cur) => (cur ?? []).map((x) => (x.id === submissionId ? { ...x, answers: { ...x.answers, _quiz: b.quiz, _written: b.written } } : x)));
    } catch (e) { setMarkNote(e instanceof Error ? e.message : 'Could not save the mark.'); } finally { setMarkBusy(''); }
  };
  const aiAll = async () => {
    setMarkBusy('ai'); setMarkNote('');
    try {
      const r = await authFetch(`/api/forms/${encodeURIComponent(formId)}/marks/ai`, { method: 'POST' });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || 'Could not mark with AI.');
      setMarkNote(b.marked ? `AI marked ${b.marked} response${b.marked === 1 ? '' : 's'}.${b.left ? ` ${b.left} more are waiting: run it again.` : ''}` : 'Nothing is waiting to be marked.');
      await reload();
    } catch (e) { setMarkNote(e instanceof Error ? e.message : 'Could not mark with AI.'); } finally { setMarkBusy(''); }
  };
  const titleOf = useMemo(() => new Map(questions.map((q) => [q.id, q.title || q.label || q.id])), [questions]);
  if (error) return <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>;
  if (!rows) return <div className="flex justify-center py-8 text-[#5F6368]"><Loader2 className="animate-spin" /></div>;
  if (!rows.length) return null;
  const r = rows[Math.min(i, rows.length - 1)];
  const order = [...questions.map((q) => q.id), ...Object.keys(r.answers).filter((k) => !titleOf.has(k) && !k.startsWith('_'))];
  const quiz = r.answers._quiz as QuizRec | undefined;
  const written = (r.answers._written ?? {}) as Written;
  const writtenIds = new Set(questions.filter((q) => q.type === 'long_text' && Number(q.points) > 0).map((q) => q.id));
  const anyPending = (rows ?? []).some((x) => ((x.answers._quiz as QuizRec | undefined)?.pending ?? 0) > 0);
  const marked = new Set(questions.filter((q) => Number(q.points) > 0 && q.correctAnswer !== undefined && q.correctAnswer !== '').map((q) => q.id));
  const email = typeof r.answers._respondentEmail === 'string' ? r.answers._respondentEmail : '';
  const flags = [...((r.answers._integrity as { flags?: Array<{ code: string; level: 'review' | 'info'; message: string }> } | undefined)?.flags ?? []), ...(review[r.id] ?? [])];

  return (
    <section className="rounded-2xl border border-[#E0E0E0] bg-white p-5" aria-label="Individual responses">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex-1 font-semibold">Individual responses</h3>
        <button type="button" disabled={i === 0} onClick={() => setI(i - 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-[#DADCE0] disabled:opacity-30" aria-label="Newer response"><ChevronLeft size={16} /></button>
        <span className="min-w-[5.5rem] text-center text-sm tabular-nums text-[#5F6368]">{i + 1} of {rows.length}</span>
        <button type="button" disabled={i >= rows.length - 1} onClick={() => setI(i + 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-[#DADCE0] disabled:opacity-30" aria-label="Older response"><ChevronRight size={16} /></button>
      </div>
      {aiMarking && anyPending && (
        <div className="mt-2 flex flex-wrap items-center gap-2"><button type="button" disabled={markBusy === 'ai'} onClick={() => void aiAll()} className="rounded-lg border border-[#DADCE0] bg-white px-3 py-1.5 text-xs font-semibold hover:bg-[#F8F9FA] disabled:opacity-50">{markBusy === 'ai' ? 'Marking with AI…' : 'Mark waiting written answers with AI'}</button></div>
      )}
      {markNote && <p role="status" className="mt-1 text-xs font-semibold text-[#3C4043]">{markNote}</p>}
      <p className="mt-1 text-xs text-[#5F6368]">Sent {new Date(r.submittedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}{email ? ` · ${email}` : ''}</p>
      {quiz && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-[#E0E0E0] bg-[#F8F9FA] px-4 py-3">
          <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-full text-sm font-bold text-white ${quiz.percent >= 80 ? 'bg-emerald-600' : quiz.percent >= 50 ? 'bg-amber-500' : 'bg-rose-600'}`}>{Math.round(quiz.percent)}%</span>
          <div>
            <p className="text-sm font-semibold text-[#202124]">Score {quiz.score} / {quiz.maxScore}{quiz.outOf ? ` · Mark ${quiz.mark} / ${quiz.outOf}` : ''}{quiz.grade ? ` · Grade ${quiz.grade}` : ''}{quiz.passed !== undefined ? <span className={quiz.passed ? ' text-emerald-700' : ' text-rose-700'}>{quiz.passed ? ' · Passed' : ' · Not passed'}</span> : null}</p>
            <p className="text-xs text-[#5F6368]">{(quiz.pending ?? 0) > 0 ? `${quiz.pending} written answer${quiz.pending === 1 ? '' : 's'} waiting to be marked.` : 'Marked against your answer key when it was sent.'}</p>
          </div>
        </div>
      )}
      {flags.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3" role="note" aria-label="Things to look at">
          <p className="text-sm font-semibold text-amber-900">Worth a look ({flags.filter((f) => f.level === 'review').length} to review)</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-amber-900">{flags.map((f, k) => <li key={k} className={f.level === 'info' ? 'text-amber-800/80' : ''}>{f.message}</li>)}</ul>
          <p className="mt-1.5 text-[11px] text-amber-800/80">These are signals, not proof. Ask the student about the answer before deciding anything. Marks are not changed.</p>
        </div>
      )}
      <dl className="mt-4 space-y-3">
        {order.filter((id) => r.answers[id] !== undefined).map((id) => {
          const v = r.answers[id];
          const files = (Array.isArray(v) ? v : [v]).filter(isFile);
          return (
            <div key={id} className="rounded-xl border border-[#F1F3F4] bg-[#F8F9FA] px-4 py-3">
              <dt className="flex items-center gap-2 text-xs font-medium text-[#5F6368]"><span className="min-w-0 flex-1">{titleOf.get(id) ?? id}</span>{quiz && marked.has(id) && (quiz.correct.includes(id) ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-800">✓ Correct</span> : <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10.5px] font-semibold text-rose-800">✗ Wrong</span>)}</dt>
              {files.length ? (
                <dd className="mt-2 flex flex-wrap gap-2">
                  {files.map((f, k) => {
                    const stored = /^\/api\/files\/([0-9a-f-]{36})$/i.exec(f.url ?? '')?.[1];
                    const src: PreviewSource = stored ? { name: f.name ?? 'file', type: mimeOf(f), storedFileId: stored } : { name: f.name ?? 'file', type: mimeOf(f), url: f.url };
                    return (
                      <button key={k} type="button" onClick={() => setPreview(src)} className="w-28 overflow-hidden rounded-lg border border-[#DADCE0] bg-white text-left hover:border-[var(--brand)]" title={`Open ${src.name}`}>
                        <FileThumb src={src} className="h-20 w-full" />
                        <span className="flex items-center gap-1 truncate px-2 py-1 text-[11px] text-[#3C4043]"><FileText size={11} className="shrink-0" />{src.name}</span>
                      </button>
                    );
                  })}
                </dd>
              ) : <dd className="mt-1 whitespace-pre-wrap text-sm text-[#202124]">{show(v) || '—'}</dd>}
              {quiz && writtenIds.has(id) && (() => {
                const q = questions.find((x) => x.id === id)!; const w = written[id]; const max = Number(q.points); const key = `${r.id}:${id}`;
                return (
                  <div className="mt-2 rounded-lg border border-[#E0E0E0] bg-white px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={`rounded-full px-2 py-0.5 font-bold ${w ? (w.by === 'ai' ? 'bg-violet-100 text-violet-800' : 'bg-emerald-100 text-emerald-800') : 'bg-amber-100 text-amber-900'}`}>{w ? (w.by === 'ai' ? `AI mark${w.confidence === 'low' ? ' (not sure: check it)' : ''}` : 'Your mark') : 'Not marked'}</span>
                      <label className="flex items-center gap-1.5 font-semibold text-[#202124]">Marks
                        <input type="number" min={0} max={max} step={0.5} aria-label={`Marks for ${titleOf.get(id) ?? id}`} className="w-20 rounded-md border border-[#DADCE0] px-2 py-1 text-sm" value={typed[key] ?? (w ? String(w.marks) : '')} onChange={(e) => setTyped((c) => ({ ...c, [key]: e.target.value }))} /> / {max}
                      </label>
                      <button type="button" disabled={markBusy === key || (typed[key] ?? '') === ''} onClick={() => void saveMark(r.id, id, Number(typed[key]))} className="rounded-lg bg-[#B4502F] px-3 py-1 font-semibold text-white disabled:opacity-50">{markBusy === key ? 'Saving…' : 'Save mark'}</button>
                    </div>
                    {w?.feedback && <p className="mt-1.5 text-xs text-[#5F6368]">{w.by === 'ai' ? 'AI feedback: ' : 'Feedback: '}{w.feedback}</p>}
                    {typeof q.correctAnswer === 'string' && q.correctAnswer && <p className="mt-1 text-[11px] text-[#5F6368]">Model answer: {q.correctAnswer}</p>}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </dl>
      {preview && <PreviewDialog src={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}
