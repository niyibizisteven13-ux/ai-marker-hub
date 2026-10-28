import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, ChevronLeft, ChevronRight, CircleCheck, Download, EyeOff, FileCheck2, Loader2, Move, RotateCcw, Send, X,
} from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import AskBwengeDrawer from '../components/AskBwengeDrawer';

/**
 * Teacher review of marked scripts before release. Each page of the candidate's own scan is shown with the
 * red marks exactly where the PDF will draw them. Marks can be dragged (or nudged with the arrow keys),
 * corrections hidden, marks changed with a reason, and the marked PDF released. Every "why" shown comes from
 * the saved marking record.
 */

type Sym = 'tick' | 'cross' | 'half';
interface Item {
  id: string; kind: 'mark' | 'correction' | 'total'; questionId?: string; number?: string; page: number; fx: number; fy: number; w: number; h: number;
  placed: boolean; auto: boolean; hidden: boolean; symbols?: Sym[]; label?: string; text?: string; flagged?: boolean;
  confidence?: { level: 'high' | 'medium' | 'low'; score: number; basis: string[] } | null;
}
interface Criterion { criterionId: string; awardedMarks: number; maxMarks: number; reason: string; rubric?: string; evidenceElementIds?: string[] }
interface Question {
  questionId: string; number: string; maxMarks: number; awardedMarks: number | null; source: string; aiProposedMarks: number | null;
  override: { marks: number; reason: string } | null; criterionResults: Criterion[]; feedback: string; lostMarks: string;
  answerAsRead: string | null; correction: string | null; confidence: Item['confidence']; openReviewFlags: Array<{ code: string; detail: string; severity: string }>;
}
interface CandidateRow { submissionId: string; candidateId: string; candidateName: string | null; total: number; maxTotal: number; percent: number; openFlags: number; lowConfidence: number; released: boolean; changedSinceRelease: boolean; complete: boolean }
export interface Review {
  exam: { examId: string; title: string; allowHalfMarks: boolean };
  candidate: { submissionId: string; candidateId: string; candidateName: string | null; fileName: string };
  summary: { total: number; maxTotal: number; percent: number };
  layout: { pages: Array<{ page: number; aspect: number; reliable: boolean }>; items: Item[] };
  released: boolean; releasedAt: string | null; changedSinceRelease: boolean;
  questions: Question[]; markedPdf: { url: string; stale: boolean } | null; candidates: CandidateRow[];
}

const RED = '#D61C17';
const SYMBOL = 0.024, GAP = 0.006, LABEL_CHAR = 0.0125, NOTE_CHAR = 0.0115;
const fmt = (n: number | null) => (n === null ? '–' : Number.isInteger(n) ? String(n) : n.toFixed(1));
const api = (path: string, init?: RequestInit) => authFetch(`/api/exams${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });

function SymbolSvg({ kind, size }: { kind: Sym; size: number }) {
  const sw = Math.max(1.6, size / 8);
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true" style={{ overflow: 'visible' }}>
      {kind === 'cross'
        ? <path d="M1 1 L9 9 M1 9 L9 1" stroke={RED} strokeWidth={(sw * 10) / size} strokeLinecap="round" fill="none" />
        : <>
          <path d="M0 5.5 L3.5 9.2 L10 0.5" stroke={RED} strokeWidth={(sw * 10) / size} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          {kind === 'half' && <path d="M4.5 3.8 L9.2 6.2" stroke={RED} strokeWidth={(sw * 10) / size} strokeLinecap="round" fill="none" />}
        </>}
    </svg>
  );
}

const confTone = (l?: string) => (l === 'high' ? 'bg-emerald-500/12 text-emerald-300 border-emerald-500/25' : l === 'medium' ? 'bg-amber-500/12 text-amber-300 border-amber-500/25' : 'bg-rose-500/12 text-rose-300 border-rose-500/25');

export function PageView({ examId, submissionId, page, aspect, items, selected, onSelect, onMove, editable = true }: {
  examId: string; submissionId: string; page: number; aspect?: number; items: Item[]; selected: string | null;
  editable?: boolean;
  onSelect: (id: string | null) => void; onMove: (id: string, page: number, fx: number, fy: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [width, setWidth] = useState(() => typeof window === 'undefined' ? 800 : Math.min(800, window.innerWidth));
  const deliveryWidth = width > 1100 ? 2200 : width > 600 ? 1600 : 1000;
  const [imageAspect, setImageAspect] = useState(1.414);
  const [imageError, setImageError] = useState(false);
  const [retryImage, setRetryImage] = useState(0);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; sx: number; sy: number } | null>(null);

  useEffect(() => {
    let url: string | null = null;
    const controller = new AbortController();
    setSrc(null); setImageError(false);
    (async () => {
      const res = await authFetch(`/api/exams/${examId}/submissions/${submissionId}/pages/${page}?width=${deliveryWidth}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Page unavailable');
      const blob = await res.blob();
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob); setSrc(url);
    })().catch(() => { if (!controller.signal.aborted) setImageError(true); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [examId, submissionId, page, retryImage, deliveryWidth]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = width * (aspect ?? imageAspect);
  const down = (e: RPointerEvent, it: Item) => {
    e.stopPropagation();
    onSelect(it.id);
    if (!editable) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ id: it.id, dx: 0, dy: 0, sx: e.clientX, sy: e.clientY });
  };
  const move = (e: RPointerEvent) => { if (drag) setDrag({ ...drag, dx: (e.clientX - drag.sx) / width, dy: (e.clientY - drag.sy) / height }); };
  const up = () => {
    if (!drag) return;
    const it = items.find((x) => x.id === drag.id);
    if (it && (Math.abs(drag.dx) > 0.002 || Math.abs(drag.dy) > 0.002)) onMove(it.id, page, Math.min(1, Math.max(0, it.fx + drag.dx)), Math.min(1, Math.max(0, it.fy + drag.dy)));
    setDrag(null);
  };

  return (
    <div ref={box} className="relative w-full select-none overflow-hidden rounded-lg bg-white shadow-[0_10px_40px_-18px_rgba(0,0,0,.6)] ring-1 ring-black/10" style={{ height }} onPointerMove={move} onPointerUp={up} onPointerDown={() => onSelect(null)}>
      {src ? <img src={src} alt={`Page ${page}`} className="absolute inset-0 h-full w-full object-fill" onLoad={e => setImageAspect(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth)} draggable={false} />
        : <div className="absolute inset-0 grid place-items-center text-sm text-neutral-400">{imageError ? <button onClick={() => setRetryImage(n => n + 1)} className="rounded border p-3">Page unavailable — retry</button> : <Loader2 className="animate-spin" size={20} />}</div>}
      <span className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">Page {page}</span>
      {items.filter((it) => it.page === page && it.placed && !it.hidden).map((it) => {
        const d = drag?.id === it.id ? drag : null;
        const fx = it.fx + (d?.dx ?? 0), fy = it.fy + (d?.dy ?? 0);
        const sel = selected === it.id;
        const ring = (editable ? 'touch-none ' : '') + (sel ? 'outline outline-2 outline-offset-2 outline-sky-500' : it.flagged || it.confidence?.level === 'low' ? 'outline outline-1 outline-dashed outline-offset-2 outline-orange-500' : 'hover:outline hover:outline-1 hover:outline-offset-2 hover:outline-sky-400');
        const common = { onPointerDown: (e: RPointerEvent) => down(e, it), title: it.kind === 'mark' ? `Question ${it.number}: drag to move` : it.kind === 'correction' ? 'Correction: drag to move' : 'Total: drag to move' };
        if (it.kind === 'total') {
          const fs = Math.max(9, 0.03 * width);
          return (
            <div key={it.id} {...common} className={`absolute flex cursor-grab items-center justify-center rounded-[50%] active:cursor-grabbing ${ring}`}
              style={{ left: (fx - it.w / 2) * width, top: (fy - it.h / 2) * height, width: it.w * width, height: it.h * height, border: `2px solid ${RED}`, color: RED, fontWeight: 700, fontSize: fs }}>
              {it.label}
            </div>
          );
        }
        if (it.kind === 'correction') {
          const fs = Math.max(8, (NOTE_CHAR / 0.5) * width);
          return (
            <div key={it.id} {...common} className={`absolute cursor-grab whitespace-nowrap italic leading-none active:cursor-grabbing ${ring}`}
              style={{ left: fx * width, top: fy * height, transform: 'translateY(-50%)', color: RED, fontSize: fs, fontFamily: 'Helvetica, Arial, sans-serif' }}>
              {it.text}
            </div>
          );
        }
        const size = Math.max(8, SYMBOL * width);
        const fs = Math.max(7.5, (LABEL_CHAR / 0.56) * width);
        return (
          <div key={it.id} {...common} className={`absolute flex cursor-grab items-center active:cursor-grabbing ${ring}`} style={{ left: fx * width, top: fy * height, transform: 'translateY(-50%)', gap: GAP * width }}>
            {(it.symbols ?? []).map((s, i) => <SymbolSvg key={i} kind={s} size={size} />)}
            <span style={{ color: RED, fontWeight: 700, fontSize: fs, marginLeft: size * 0.3 - GAP * width, fontFamily: 'Helvetica, Arial, sans-serif' }}>{it.label}</span>
            {(it.flagged || it.confidence?.level === 'low') && <span className="ml-1 grid h-4 w-4 place-items-center rounded-full border border-orange-500 text-[10px] font-bold text-orange-500">?</span>}
          </div>
        );
      })}
    </div>
  );
}

function QuestionCard({ q, items, allowHalf, active, onFocus, onOverride, onLayout }: {
  q: Question; items: Item[]; allowHalf: boolean; active: boolean; onFocus: () => void;
  onOverride: (marks: number, reason: string) => Promise<void>; onLayout: (id: string, body: object) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const step = allowHalf ? 0.5 : 1;
  const value = draft ?? q.awardedMarks ?? 0;
  const mark = items.find((i) => i.id === `${q.questionId}:mark`);
  const corr = items.find((i) => i.id === `${q.questionId}:correction`);
  const changed = draft !== null && draft !== q.awardedMarks;
  const conf = q.confidence;
  return (
    <article onClick={onFocus} className={`rounded-xl border p-3.5 transition-colors ${active ? 'border-sky-500/60 bg-sky-500/[0.06]' : 'border-white/[0.08] bg-white/[0.025] hover:border-white/15'}`}>
      <header className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-white">Question {q.number}</span>
        {conf && <span title={conf.basis.join(' · ')} className={`rounded-md border px-1.5 py-px text-[10px] font-semibold uppercase ${confTone(conf.level)}`}>{conf.level} · {Math.round(conf.score * 100)}%</span>}
        {q.override && <span className="rounded-md border border-violet-400/30 bg-violet-400/10 px-1.5 py-px text-[10px] font-semibold text-violet-300">YOUR MARK</span>}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" aria-label="Lower mark" onClick={(e) => { e.stopPropagation(); setDraft(Math.max(0, value - step)); }} className="grid h-7 w-7 place-items-center rounded-md border border-white/10 text-white hover:bg-white/10">−</button>
          <span className={`min-w-14 text-center text-sm font-bold tabular-nums ${changed ? 'text-sky-300' : 'text-[#ff6b63]'}`}>{fmt(value)}/{fmt(q.maxMarks)}</span>
          <button type="button" aria-label="Raise mark" onClick={(e) => { e.stopPropagation(); setDraft(Math.min(q.maxMarks, value + step)); }} className="grid h-7 w-7 place-items-center rounded-md border border-white/10 text-white hover:bg-white/10">+</button>
        </div>
      </header>
      {changed && (
        <form className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()} onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await onOverride(draft!, reason); setDraft(null); setReason(''); } finally { setBusy(false); } }}>
          <input autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the change (kept in the record)" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-white placeholder:text-neutral-500 focus:border-sky-500 focus:outline-none" />
          <button disabled={busy || !reason.trim()} className="rounded-lg bg-sky-500 px-3 text-xs font-semibold text-white disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin" /> : 'Save'}</button>
          <button type="button" onClick={() => setDraft(null)} className="rounded-lg px-2 text-xs text-neutral-400 hover:text-white"><X size={14} /></button>
        </form>
      )}
      {q.answerAsRead && <p className="mt-2 rounded-lg bg-black/25 px-2.5 py-1.5 font-mono text-[11.5px] leading-5 text-neutral-300"><span className="mr-1 font-sans text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Read as</span>{q.answerAsRead}</p>}
      {q.criterionResults.length > 0 && (
        <ul className="mt-2 space-y-1">
          {q.criterionResults.map((c) => (
            <li key={c.criterionId} className="flex gap-2 text-[12px] leading-5">
              <span className={`mt-0.5 shrink-0 ${c.awardedMarks >= c.maxMarks ? 'text-emerald-400' : 'text-[#ff6b63]'}`}>{c.awardedMarks >= c.maxMarks ? <Check size={13} /> : <X size={13} />}</span>
              <span className="min-w-0 text-neutral-300"><b className="font-medium text-white">{c.rubric ?? c.criterionId}</b> <span className="tabular-nums text-neutral-500">{fmt(c.awardedMarks)}/{fmt(c.maxMarks)}</span>{c.reason ? <span className="block text-neutral-400">{c.reason}</span> : null}</span>
            </li>
          ))}
        </ul>
      )}
      {q.correction && <p className="mt-2 text-[12px] italic text-[#ff6b63]">Correction: {q.correction}</p>}
      {q.openReviewFlags.map((f, i) => <p key={i} className="mt-2 flex gap-1.5 text-[11.5px] text-orange-300"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{f.detail}</p>)}
      {q.override && <p className="mt-2 text-[11.5px] text-violet-300">Changed from the AI's {fmt(q.aiProposedMarks)}: {q.override.reason}</p>}
      <footer className="mt-2.5 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
        {mark && !mark.placed && !mark.hidden && mark.label && <button type="button" onClick={() => onLayout(mark.id, { page: 1, fx: 0.8, fy: 0.5 })} className="inline-flex items-center gap-1 rounded-md border border-orange-500/40 bg-orange-500/10 px-2 py-1 text-[11px] text-orange-200"><Move size={12} /> Place mark on page</button>}
        {mark && !mark.auto && <button type="button" onClick={() => onLayout(mark.id, { reset: true })} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-neutral-300 hover:bg-white/5"><RotateCcw size={12} /> Auto position</button>}
        {corr && !corr.hidden && <button type="button" onClick={() => onLayout(corr.id, { hidden: true })} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-neutral-300 hover:bg-white/5"><EyeOff size={12} /> Hide correction</button>}
        {corr && (corr.hidden || !corr.auto) && <button type="button" onClick={() => onLayout(corr.id, { reset: true })} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-neutral-300 hover:bg-white/5"><RotateCcw size={12} /> Restore correction</button>}
        {corr && !corr.placed && !corr.hidden && <span className="text-[11px] text-neutral-500">Correction is on the summary page only (no free space under the answer).</span>}
      </footer>
    </article>
  );
}

export default function ExamReviewPage({ onBack }: { onBack: () => void }) {
  const m = window.location.pathname.match(/^\/exams\/([0-9a-f-]{36})(?:\/review)?(?:\/([^/]+))?/);
  const examId = m?.[1] ?? null;
  const [exams, setExams] = useState<Array<{ examId: string; title: string; candidates: number; marked: number; released: number; needsReview: number; updatedAt: string }> | null>(null);
  const [subId, setSubId] = useState<string | null>(m?.[2] ?? null);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  const nudge = useRef<{ id: string; t: number } | null>(null);

  const say = (t: string) => { setToast(t); window.setTimeout(() => setToast(null), 3200); };

  useEffect(() => {
    if (examId) return;
    api('').then(async (r) => { if (!r.ok) throw new Error(); setExams((await r.json()).exams); }).catch(() => setError('Your examinations could not be loaded.'));
  }, [examId]);

  const load = useCallback(async (id: string | null) => {
    if (!examId) return;
    setLoading(true);
    setError(null);
    try {
      let sid = id;
      if (!sid) {
        const r = await api(`/${examId}/review`);
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? 'This examination could not be loaded.');
        const list: CandidateRow[] = (await r.json()).candidates;
        if (!list.length) throw new Error('No script has been marked yet.');
        sid = (list.find((c) => !c.released && (c.openFlags || c.lowConfidence)) ?? list.find((c) => !c.released) ?? list[0]).submissionId;
      }
      const res = await api(`/${examId}/review/${sid}`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'This script could not be loaded.');
      const data: Review = await res.json();
      setReview(data);
      setSubId(data.candidate.submissionId);
      window.history.replaceState({}, '', `/exams/${examId}/review/${data.candidate.submissionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }, [examId]);

  useEffect(() => { void load(subId); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const items = review?.layout.items ?? [];
  const moveItem = useCallback(async (id: string, page: number, fx: number, fy: number) => {
    if (!review) return;
    setReview({ ...review, layout: { ...review.layout, items: review.layout.items.map((i) => (i.id === id ? { ...i, page, fx, fy, auto: false, placed: true } : i)) } });
    const res = await api(`/${review.exam.examId}/submissions/${review.candidate.submissionId}/layout/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ page, fx: Number(fx.toFixed(4)), fy: Number(fy.toFixed(4)) }) });
    if (res.ok) setReview(await res.json()); else say('The new position could not be saved.');
  }, [review]);

  const layoutAction = useCallback(async (id: string, body: object) => {
    if (!review) return;
    const res = await api(`/${review.exam.examId}/submissions/${review.candidate.submissionId}/layout/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) });
    if (res.ok) setReview(await res.json()); else say('That change could not be saved.');
  }, [review]);

  // Arrow keys nudge the selected item; saved shortly after the last key press.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!review || !selected || (e.target as HTMLElement)?.closest('input,textarea')) return;
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (e.key === 'Escape') { setSelected(null); return; }
      if (!d) return;
      e.preventDefault();
      const stepSize = e.shiftKey ? 0.02 : 0.004;
      const it = review.layout.items.find((i) => i.id === selected);
      if (!it) return;
      const nx = Math.min(1, Math.max(0, it.fx + d[0] * stepSize)), ny = Math.min(1, Math.max(0, it.fy + d[1] * stepSize));
      setReview({ ...review, layout: { ...review.layout, items: review.layout.items.map((i) => (i.id === selected ? { ...i, fx: nx, fy: ny, auto: false } : i)) } });
      if (nudge.current) window.clearTimeout(nudge.current.t);
      nudge.current = { id: selected, t: window.setTimeout(() => void moveItem(it.id, it.page, nx, ny), 500) };
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [review, selected, moveItem]);

  const override = async (q: Question, marks: number, reason: string) => {
    if (!review) return;
    const res = await api(`/${review.exam.examId}/submissions/${review.candidate.submissionId}/marks/${q.questionId}`, { method: 'PATCH', body: JSON.stringify({ marks, reason }) });
    if (!res.ok) { say((await res.json().catch(() => null))?.error ?? 'The mark could not be changed.'); return; }
    await load(review.candidate.submissionId);
    say(`Question ${q.number} set to ${fmt(marks)}.`);
  };

  const release = async (all: boolean) => {
    if (!review) return;
    const open = review.questions.reduce((a, q) => a + q.openReviewFlags.length, 0);
    if (!all && open && !window.confirm(`${open} item${open > 1 ? 's' : ''} on this script still ask for a check. Release anyway?`)) return;
    if (all && !window.confirm('Release the marked PDFs of every fully marked candidate? Marks become confirmed as yours.')) return;
    setReleasing(true);
    try {
      const res = await api(`/${review.exam.examId}/release`, { method: 'POST', body: JSON.stringify(all ? { all: true } : { submissionIds: [review.candidate.submissionId] }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) { say(data?.error ?? 'Release failed.'); return; }
      say(`Released ${data.released.length} script${data.released.length === 1 ? '' : 's'}${data.skipped.length ? `; ${data.skipped.length} skipped (${data.skipped.slice(0, 2).map((s: { candidateId: string; reason: string }) => `${s.candidateId}: ${s.reason}`).join('; ')})` : ''}. The PDFs are being regenerated.`);
      await load(review.candidate.submissionId);
    } finally { setReleasing(false); }
  };

  const idx = useMemo(() => review?.candidates.findIndex((c) => c.submissionId === review.candidate.submissionId) ?? -1, [review]);
  const go = (d: number) => { const c = review?.candidates[idx + d]; if (c) { setSelected(null); void load(c.submissionId); } };
  const activeQ = selected?.split(':')[0] ?? null;

  if (!examId) {
    return (
      <div className="min-h-[100dvh] bg-[#141413] px-4 py-8 text-white">
        <div className="mx-auto max-w-3xl">
          <button type="button" onClick={onBack} className="mb-6 inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white"><ArrowLeft size={16} /> Back to workspace</button>
          <h1 className="font-serif text-3xl">Marked exams</h1>
          <p className="mt-1 text-sm text-neutral-400">Review the red marks on each script and release the marked PDFs.</p>
          {error && <p className="mt-6 text-sm text-rose-300">{error}</p>}
          {!exams ? <Loader2 className="mt-8 animate-spin text-neutral-500" /> : exams.length === 0 ? (
            <div className="mt-8 rounded-3xl border border-white/[0.08] bg-white/[0.02] p-6 sm:p-8">
              <p className="text-lg font-semibold text-white">Mark a class in one message</p>
              <ol className="mt-4 space-y-3 text-sm text-neutral-300">
                <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#D97757]/20 text-xs font-bold text-[#F2B39C]">1</span>Attach the students' scripts in the chat: PDFs, phone photos, Word files or a ZIP folder. Add the marking scheme if you have one.</li>
                <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#D97757]/20 text-xs font-bold text-[#F2B39C]">2</span>Say "mark these". Bwenge reads the handwriting, marks every question and corrects each script in red pen.</li>
                <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#D97757]/20 text-xs font-bold text-[#F2B39C]">3</span>The marked PDFs come back in the chat, with the Excel results. Every class appears here to review and share.</li>
              </ol>
              <div className="mt-6 flex flex-wrap gap-2">
                <a href="/" className="rounded-xl bg-[#D97757] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c66849]">Open the chat</a>
                <a href="/scan" className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-neutral-200 hover:bg-white/5">Scan papers with the phone</a>
              </div>
            </div>
          ) : (
            <ul className="mt-6 divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/[0.08]">
              {exams.map((e) => (
                <li key={e.examId}><a href={`/exams/${e.examId}/review`} className="flex items-center gap-4 bg-white/[0.02] px-4 py-3.5 hover:bg-white/[0.05]">
                  <FileCheck2 size={20} className="text-[#D97757]" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{e.title}</span><span className="text-xs text-neutral-400">{e.marked} of {e.candidates} marked · {e.released} released</span></span>
                  {e.needsReview > 0 && <span className="rounded-md bg-orange-500/15 px-2 py-0.5 text-[11px] font-semibold text-orange-300">{e.needsReview} to check</span>}
                  <ChevronRight size={16} className="text-neutral-500" />
                </a></li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-[#141413] text-white">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/[0.07] px-4 py-2.5">
        <button type="button" onClick={() => { window.history.pushState({}, '', '/exams'); window.location.reload(); }} className="grid h-8 w-8 place-items-center rounded-lg text-neutral-400 hover:bg-white/5 hover:text-white" aria-label="All examinations"><ArrowLeft size={17} /></button>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{review?.exam.title ?? 'Examination'}</div>
          <div className="text-[11px] text-neutral-400">{review ? `${review.candidates.filter((c) => c.released).length} of ${review.candidates.length} released` : ' '}</div>
        </div>
        {review && (
          <div className="ml-2 flex items-center gap-1">
            <button type="button" disabled={idx <= 0} onClick={() => go(-1)} className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 disabled:opacity-30" aria-label="Previous candidate"><ChevronLeft size={16} /></button>
            <select value={review.candidate.submissionId} onChange={(e) => { setSelected(null); void load(e.target.value); }} className="h-8 rounded-lg border border-white/10 bg-[#1f1e1d] px-2 text-sm">
              {review.candidates.map((c) => <option key={c.submissionId} value={c.submissionId}>{c.candidateId}{c.candidateName ? ` – ${c.candidateName}` : ''} · {fmt(c.total)}/{fmt(c.maxTotal)}{c.released ? ' · released' : c.openFlags || c.lowConfidence ? ' · check' : ''}</option>)}
            </select>
            <button type="button" disabled={idx < 0 || idx >= review.candidates.length - 1} onClick={() => go(1)} className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 disabled:opacity-30" aria-label="Next candidate"><ChevronRight size={16} /></button>
          </div>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {review?.markedPdf && <a href={review.markedPdf.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs hover:bg-white/5"><Download size={14} /> {review.released && !review.markedPdf.stale ? 'Marked PDF' : 'Draft PDF'}{review.markedPdf.stale ? ' (updating…)' : ''}</a>}
          {review && <button type="button" disabled={releasing} onClick={() => void release(true)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs hover:bg-white/5 disabled:opacity-50">Release all</button>}
          {review && (review.released
            ? <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 text-xs font-semibold text-emerald-300"><CircleCheck size={14} /> Released</span>
            : <button type="button" disabled={releasing} onClick={() => void release(false)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#D97757] px-3.5 text-xs font-semibold text-white hover:bg-[#c96646] disabled:opacity-50">{releasing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Release {review.candidate.candidateId}</button>)}
        </div>
      </header>

      {error && <div className="m-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>}
      {!review && !error && <div className="grid flex-1 place-items-center"><Loader2 className="animate-spin text-neutral-500" /></div>}

      {review && (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <main className={`min-h-0 flex-1 overflow-y-auto bg-[#2a2926] px-3 py-5 sm:px-8 ${loading ? 'opacity-60' : ''}`}>
            <div className="mx-auto mb-3 flex max-w-[860px] flex-wrap items-center gap-2 text-[12px] text-neutral-300">
              <span className="font-semibold text-white">{review.candidate.candidateId}</span><span className="text-neutral-500">{review.candidate.fileName}</span>
              <span className="ml-auto rounded-md border border-[#D61C17]/40 bg-[#D61C17]/10 px-2 py-0.5 font-bold text-[#ff6b63]">{fmt(review.summary.total)}/{fmt(review.summary.maxTotal)} · {review.summary.percent}%</span>
              {review.changedSinceRelease && <span className="rounded-md bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-300">Changed since release – release again</span>}
            </div>
            <p className="mx-auto mb-3 max-w-[860px] text-[11.5px] text-neutral-400">Drag a red mark to move it, or select it and use the arrow keys (Shift for bigger steps). Dashed orange marks need a check. The scan itself is never changed.</p>
            <div className="mx-auto flex max-w-[860px] flex-col gap-6">
              {review.layout.pages.map((p) => (
                <PageView key={`${review.candidate.submissionId}:${p.page}`} examId={review.exam.examId} submissionId={review.candidate.submissionId} page={p.page} aspect={p.aspect}
                  items={items} selected={selected} onSelect={setSelected} onMove={(id, page, fx, fy) => void moveItem(id, page, fx, fy)} />
              ))}
            </div>
          </main>
          <aside className="flex max-h-[45dvh] w-full shrink-0 flex-col border-t border-white/[0.07] lg:max-h-none lg:w-[400px] lg:border-l lg:border-t-0">
            <div className="flex items-center justify-between px-4 py-3 text-xs text-neutral-400">
              <span>{review.questions.length} questions · from the saved marking record</span>
              {review.questions.some((q) => q.openReviewFlags.length) && <span className="inline-flex items-center gap-1 text-orange-300"><AlertTriangle size={13} /> {review.questions.filter((q) => q.openReviewFlags.length).length} to check</span>}
            </div>
            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 pb-4">
              {review.questions.map((q) => (
                <QuestionCard key={q.questionId} q={q} items={items} allowHalf={review.exam.allowHalfMarks} active={activeQ === q.questionId}
                  onFocus={() => setSelected(`${q.questionId}:mark`)} onOverride={(marks, reason) => override(q, marks, reason)} onLayout={(id, body) => void layoutAction(id, body)} />
              ))}
            </div>
          </aside>
        </div>
      )}
      <AskBwengeDrawer surface="exam" surfaceId={examId} title={review?.exam.title ?? 'Examination'} onDone={() => void load(review?.candidate.submissionId ?? subId)}
        suggestions={['Who scored lowest, and on which questions?', `Why did ${review?.candidate.candidateId ?? 'this student'} lose marks?`, 'Give me the Excel results', 'Send me all the marked PDFs']} />
      {toast && <div role="status" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-[#141413] shadow-2xl">{toast}</div>}
    </div>
  );
}
