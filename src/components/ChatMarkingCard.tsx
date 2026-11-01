import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2, PanelRightOpen, X, XCircle } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import LiveMarkingPanel, { useExamActivity, type ExamEvent } from './LiveMarkingPanel';
import { PageView, penActions, type Item } from './MarkedPaperView';

/**
 * Marking inside the chat. The card under the assistant's reply shows the run live: progress, then one line per
 * student as each script is finished ("Student 2 marked: S4B-002, 41/50") with a thumbnail of its first page.
 * "Open live marking" opens the side panel (full activity, settings, Stop, pages) without leaving the chat.
 */

const OPEN_EVENT = 'bwenge:open-marking';
export const openMarking = (examId: string, submissionId?: string) =>
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { examId, submissionId } }));

interface Marked { submissionId: string; candidateId: string; total?: number; maxTotal?: number; n: number }

/** Scripts finished so far, in the order they were marked (a re-mark keeps the student's number). */
function markedFrom(events: ExamEvent[]): Marked[] {
  const out = new Map<string, Marked>();
  for (const e of events) {
    if (e.type !== 'script_marked' || !e.submissionId) continue;
    const prev = out.get(e.submissionId);
    out.set(e.submissionId, { submissionId: e.submissionId, candidateId: e.candidateId ?? '', total: Number(e.data?.total), maxTotal: Number(e.data?.maxTotal), n: prev?.n ?? out.size + 1 });
  }
  return [...out.values()];
}

function useRunState(events: ExamEvent[]) {
  const lastStart = events.reduce((a, e, i) => (e.type === 'job_created' ? i : a), -1);
  const lastEnd = events.reduce((a, e, i) => (['job_completed', 'job_failed', 'job_cancelled'].includes(e.type) ? i : a), -1);
  const progress = [...events].reverse().find((e) => e.progress)?.progress ?? null;
  const active = lastStart >= 0 && lastStart > lastEnd;
  const startedAt = lastStart >= 0 ? Date.parse(events[lastStart].at) : NaN;
  const endedAt = lastEnd > lastStart && lastStart >= 0 ? Date.parse(events[lastEnd].at) : NaN;
  return { active, progress, ended: lastEnd >= 0 ? events[lastEnd] : null, startedAt, endedAt };
}

const minutes = (ms: number) => (ms < 60_000 ? 'under a minute' : `${Math.round(ms / 60_000)} min`);
const timeLeft = (ms: number) => (ms < 60_000 ? 'less than a minute left' : `about ${Math.round(ms / 60_000)} min left`);

/** Time left from the pace so far ("about 3 min left"), or how long the finished run took. */
function useTiming(active: boolean, progress: { done: number; total: number } | null, startedAt: number, endedAt: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, [active]);
  if (!Number.isFinite(startedAt)) return null;
  if (!active) return Number.isFinite(endedAt) && endedAt > startedAt ? `in ${minutes(endedAt - startedAt)}` : null;
  if (!progress || progress.done < 1 || progress.done >= progress.total) return null;
  const left = ((now - startedAt) / progress.done) * (progress.total - progress.done);
  return timeLeft(left);
}

/** What the marker is doing right now, in words, plus the steps of the current script already done (ticked). */
const STEP_TYPES = new Set(['page_processing_started', 'question_marking_started', 'question_marked', 'uncertainty_detected', 'rubric_processing_started', 'rubric_ready', 'marking_started', 'pdf_generation_started']);
function currentSteps(events: ExamEvent[]) {
  const steps = events.filter((e) => STEP_TYPES.has(e.type) && e.message);
  const now = steps[steps.length - 1] ?? null;
  // Steps of the script being marked now (since its "reading" step), oldest first, the last one still running.
  const sid = now?.submissionId;
  const start = sid ? steps.reduce((a, e, i) => (e.submissionId === sid && e.type === 'page_processing_started' ? i : a), -1) : -1;
  const mine = (start >= 0 ? steps.slice(start) : steps.slice(-1)).filter((e) => !sid || e.submissionId === sid);
  return { now, done: mine.slice(0, -1).filter((e) => e.type !== 'question_marking_started').slice(-4) };
}

export function PageThumb({ examId, submissionId, page = 1, large = false, alt }: { examId: string; submissionId: string; page?: number; large?: boolean; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let made: string | null = null;
    let alive = true;
    authFetch(`/api/exams/${examId}/submissions/${submissionId}/pages/${page}?${large ? 'width=1000' : 'thumbnail=1'}`)
      .then(async (r) => { if (!r.ok) throw new Error(String(r.status)); made = URL.createObjectURL(await r.blob()); if (alive) setUrl(made); })
      .catch(() => alive && setFailed(true));
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [examId, submissionId, page, large]);
  if (failed) return <div className={`${large ? 'h-64' : 'h-14 w-11'} flex items-center justify-center rounded bg-white/[0.04] text-[10px] text-neutral-500`}>no page</div>;
  if (!url) return <div className={`${large ? 'h-64' : 'h-14 w-11'} animate-pulse rounded bg-white/[0.06]`} />;
  return <img src={url} alt={alt} className={large ? 'w-full rounded-lg bg-white' : 'h-14 w-11 rounded border border-white/10 bg-white object-cover object-top'} />;
}

export default function ChatMarkingCard({ examId }: { examId: string }) {
  const { events, connected } = useExamActivity(examId);
  const marked = useMemo(() => markedFrom(events), [events]);
  const { active, progress, ended, startedAt, endedAt } = useRunState(events);
  const timing = useTiming(active, progress, startedAt, endedAt);
  const shown = marked.slice(-6);
  const steps = useMemo(() => currentSteps(events), [events]);

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${active ? 'animate-pulse bg-emerald-400' : connected ? 'bg-emerald-500/70' : 'bg-neutral-500'}`} aria-hidden />
        <span className="whitespace-nowrap text-[12.5px] font-semibold text-white">{active ? 'Marking in progress' : ended?.type === 'job_cancelled' ? 'Marking stopped' : marked.length ? 'Marking finished' : 'Marking'}</span>
        {progress && <span className="min-w-0 truncate whitespace-nowrap text-[11.5px] text-neutral-400">{progress.done}/{progress.total}<span className="hidden sm:inline"> marked</span>{timing ? <span className="hidden sm:inline"> · {timing}</span> : null}</span>}
        <button type="button" onClick={() => openMarking(examId)} className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--brand)] px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-[var(--brand-strong)]">
          <PanelRightOpen size={13} aria-hidden /><span className="whitespace-nowrap"><span className="sm:hidden">Red pen</span><span className="hidden sm:inline">Open live marking</span></span>
        </button>
      </div>
      {progress && (
        <div className="h-1 bg-white/[0.05]" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
          <div className="h-full bg-[var(--brand)] transition-[width] duration-500" style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} />
        </div>
      )}
      <ul className="divide-y divide-white/[0.04]" aria-live="polite">
        {!marked.length && !(active && steps.now) && (
          <li className="flex items-center gap-2 px-3 py-2.5 text-[12px] text-neutral-400">
            {active ? <Loader2 size={13} className="animate-spin" /> : null}
            {active ? 'Reading the first script…' : 'Each student appears here as soon as their script is marked.'}
          </li>
        )}
        {marked.length > shown.length && <li className="px-3 py-1.5 text-[11px] text-neutral-500">{marked.length - shown.length} earlier student{marked.length - shown.length === 1 ? '' : 's'} marked: open live marking to see all.</li>}
        {shown.map((m) => (
          <li key={m.submissionId}>
            <button type="button" onClick={() => openMarking(examId, m.submissionId)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.03]">
              <PageThumb examId={examId} submissionId={m.submissionId} alt={`First page of ${m.candidateId}`} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-neutral-100"><CheckCircle2 size={13} className="text-emerald-400" aria-hidden />Student {m.n} marked</span>
                <span className="block truncate text-[11.5px] text-neutral-400">{m.candidateId}{Number.isFinite(m.total) ? ` · ${m.total}/${m.maxTotal}` : ''} · view page</span>
              </span>
            </button>
          </li>
        ))}
        {active && (marked.length > 0 || steps.now) && (
          <li className="px-3 py-2 text-[12px]">
            {steps.done.map((e) => (
              <span key={e.seq} className="flex items-center gap-2 py-0.5 text-neutral-500"><CheckCircle2 size={12} className="text-emerald-500/80" aria-hidden /><span className="truncate">{e.message}</span></span>
            ))}
            <span className="flex items-center gap-2 py-0.5 text-neutral-200"><Loader2 size={13} className="animate-spin text-[var(--brand)]" aria-hidden /><span className="truncate">{steps.now?.message ?? `Marking student ${marked.length + 1}…`}</span></span>
          </li>
        )}
        {ended?.type === 'job_failed' && <li className="flex items-center gap-2 px-3 py-2 text-[12px] text-rose-300"><XCircle size={13} />{ended.message}</li>}
      </ul>
    </div>
  );
}

interface ReviewView { candidate: { submissionId: string; candidateId: string }; summary?: { total: number; maxTotal: number }; layout: { pages: Array<{ page: number; aspect: number }>; items: Item[] } }

/**
 * The script with the red pen on it: ticks, crosses, corrections and the circled total, drawn where the marked PDF
 * puts them. Before the script is finished the plain page shows; the marks appear as soon as it is marked.
 */
function RedPenScript({ examId, submissionId, refresh }: { examId: string; submissionId: string; refresh: number }) {
  const [review, setReview] = useState<ReviewView | null>(null);
  const [page, setPage] = useState(1);
  // The teacher's own pen marks can be added on a script as soon as it is marked, while the others are still marking.
  const [penSelected, setPenSelected] = useState<string | null>(null);
  useEffect(() => { setReview(null); setPage(1); }, [submissionId]);
  useEffect(() => {
    let alive = true;
    authFetch(`/api/exams/${examId}/review/${submissionId}`)
      .then(async (r) => { if (r.ok && alive) setReview(await r.json()); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [examId, submissionId, refresh]);
  const pages = review?.layout.pages ?? [];
  const pageCount = pages.length || null;
  const aspect = pages.find((p) => p.page === page)?.aspect;
  return (
    <section className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-2.5">
      <div className="mb-2 flex items-center gap-2 text-[12px] text-neutral-300">
        <span className="min-w-0 flex-1 truncate">{review
          ? <span className="inline-flex items-center gap-1.5 font-medium text-[#ff8a80]"><span className="h-1.5 w-1.5 rounded-full bg-[#D61C17]" aria-hidden />Red pen · {review.candidate.candidateId}{review.summary ? ` · ${review.summary.total}/${review.summary.maxTotal}` : ''}</span>
          : <span className="inline-flex items-center gap-1.5 text-neutral-400"><Loader2 size={12} className="animate-spin" aria-hidden />Marking this script…</span>}</span>
        <span className="shrink-0 whitespace-nowrap text-neutral-500">{page}{pageCount ? ` / ${pageCount}` : ''}</span>
        <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="shrink-0 rounded border border-white/10 px-2 py-0.5 disabled:opacity-40">‹</button>
        <button type="button" aria-label="Next page" disabled={!!pageCount && page >= pageCount} onClick={() => setPage((p) => p + 1)} className="shrink-0 rounded border border-white/10 px-2 py-0.5 disabled:opacity-40">›</button>
      </div>
      {review
        ? <PageView examId={examId} submissionId={submissionId} page={page} aspect={aspect} items={review.layout.items} selected={penSelected} editable={false} onSelect={setPenSelected} onMove={() => undefined}
            pen={review.summary ? penActions(examId, submissionId, setReview) : undefined} />
        : <PageThumb examId={examId} submissionId={submissionId} page={page} large alt={`Page ${page} of the script`} />}
    </section>
  );
}

/** Right-hand panel with the full live marking view, opened from the chat card. */
export function MarkingDrawer() {
  const [target, setTarget] = useState<{ examId: string; submissionId?: string; pinned?: boolean } | null>(null);
  useEffect(() => {
    const open = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.examId) setTarget({ ...d, pinned: !!d.submissionId }); };
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);
  // On wide screens the panel sits beside the chat (the page makes room for it) instead of covering it.
  useEffect(() => {
    document.documentElement.classList.toggle('bw-side-open', !!target);
    return () => document.documentElement.classList.remove('bw-side-open');
  }, [target]);
  useEffect(() => {
    if (!target) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setTarget(null); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [target]);
  if (!target) return null;
  return <DrawerBody target={target} setTarget={setTarget} />;
}

function DrawerBody({ target, setTarget }: { target: { examId: string; submissionId?: string; pinned?: boolean }; setTarget: (t: { examId: string; submissionId?: string; pinned?: boolean } | null) => void }) {
  const { events } = useExamActivity(target.examId);
  const [refresh, setRefresh] = useState(0);
  const seen = useRef(0);
  // Unless the teacher picked a script, show the latest one with the red pen on it (or, before any is finished,
  // the one being read); reload the red pen when the shown script is marked or re-marked.
  useEffect(() => {
    const fresh = events.filter((e) => e.seq > seen.current);
    if (!fresh.length) return;
    seen.current = fresh[fresh.length - 1].seq;
    let next = target.submissionId;
    if (!target.pinned) {
      const marked = [...fresh].reverse().find((e) => e.type === 'script_marked' && e.submissionId);
      const reading = !next ? fresh.find((e) => e.type === 'page_processing_started' && e.submissionId) : undefined;
      next = marked?.submissionId ?? reading?.submissionId ?? next;
      if (next !== target.submissionId) setTarget({ ...target, submissionId: next });
    }
    if (fresh.some((e) => e.type === 'script_marked' && e.submissionId === next)) setRefresh((n) => n + 1);
  }, [events, target, setTarget]);
  return (
    <aside aria-label="Live marking" className="fixed inset-y-0 right-0 z-[80] flex w-full flex-col border-l border-white/[0.08] bg-[var(--app-panel-2)] text-neutral-100 shadow-2xl sm:w-[min(560px,92vw)] animate-[slideIn_.22s_ease-out]">
      <header className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <h2 className="flex-1 text-[15px] font-semibold">Live marking</h2>
        {target.pinned && <button type="button" onClick={() => setTarget({ ...target, pinned: false })} className="rounded-lg border border-white/10 px-2.5 py-1 text-[12px] text-neutral-300 hover:bg-white/5">Follow live</button>}
        <a href={`/exams/${target.examId}/review`} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-[12px] text-neutral-300 hover:bg-white/5"><ExternalLink size={12} />Full review</a>
        <button type="button" onClick={() => setTarget(null)} aria-label="Close" className="rounded-lg p-1.5 text-neutral-400 hover:bg-white/5 hover:text-white"><X size={18} /></button>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {target.submissionId && <RedPenScript examId={target.examId} submissionId={target.submissionId} refresh={refresh} />}
        <LiveMarkingPanel examId={target.examId} onScriptMarked={(sid) => { if (sid && !target.submissionId) setTarget({ ...target, submissionId: sid }); }} />
      </div>
    </aside>
  );
}
