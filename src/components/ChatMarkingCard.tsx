import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2, PanelRightOpen, X, XCircle } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import LiveMarkingPanel, { useExamActivity, type ExamEvent } from './LiveMarkingPanel';

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
  return { active: lastStart >= 0 && lastStart > lastEnd, progress, ended: lastEnd >= 0 ? events[lastEnd] : null };
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
  const { active, progress, ended } = useRunState(events);
  const shown = marked.slice(-6);

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <span className={`h-2 w-2 rounded-full ${active ? 'animate-pulse bg-emerald-400' : connected ? 'bg-emerald-500/70' : 'bg-neutral-500'}`} aria-hidden />
        <span className="text-[12.5px] font-semibold text-white">{active ? 'Marking in progress' : ended?.type === 'job_cancelled' ? 'Marking stopped' : marked.length ? 'Marking finished' : 'Marking'}</span>
        {progress && <span className="text-[11.5px] text-neutral-400">{progress.done} of {progress.total} marked</span>}
        <button type="button" onClick={() => openMarking(examId)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[#D97757] px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-[#c96a4c]">
          <PanelRightOpen size={13} aria-hidden /> Open live marking
        </button>
      </div>
      {progress && (
        <div className="h-1 bg-white/[0.05]" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
          <div className="h-full bg-[#D97757] transition-[width] duration-500" style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} />
        </div>
      )}
      <ul className="divide-y divide-white/[0.04]" aria-live="polite">
        {!marked.length && (
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
        {active && marked.length > 0 && <li className="flex items-center gap-2 px-3 py-2 text-[12px] text-neutral-400"><Loader2 size={13} className="animate-spin" />Marking student {marked.length + 1}…</li>}
        {ended?.type === 'job_failed' && <li className="flex items-center gap-2 px-3 py-2 text-[12px] text-rose-300"><XCircle size={13} />{ended.message}</li>}
      </ul>
    </div>
  );
}

/** Right-hand panel with the full live marking view, opened from the chat card. */
export function MarkingDrawer() {
  const [target, setTarget] = useState<{ examId: string; submissionId?: string } | null>(null);
  const [page, setPage] = useState(1);
  useEffect(() => {
    const open = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.examId) { setTarget(d); setPage(1); } };
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
  return (
    <aside aria-label="Live marking" className="fixed inset-y-0 right-0 z-[80] flex w-full flex-col border-l border-white/[0.08] bg-[#1F1E1D] text-neutral-100 shadow-2xl sm:w-[min(560px,92vw)] animate-[slideIn_.22s_ease-out]">
      <header className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <h2 className="flex-1 text-[15px] font-semibold">Live marking</h2>
        <a href={`/exams/${target.examId}/review`} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-[12px] text-neutral-300 hover:bg-white/5"><ExternalLink size={12} />Full review</a>
        <button type="button" onClick={() => setTarget(null)} aria-label="Close" className="rounded-lg p-1.5 text-neutral-400 hover:bg-white/5 hover:text-white"><X size={18} /></button>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {target.submissionId && (
          <section className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-2.5">
            <div className="mb-2 flex items-center justify-between text-[12px] text-neutral-300">
              <span>Script · page {page}</span>
              <span className="flex gap-1">
                <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-white/10 px-2 py-0.5 disabled:opacity-40">Previous</button>
                <button type="button" onClick={() => setPage((p) => p + 1)} className="rounded border border-white/10 px-2 py-0.5">Next</button>
              </span>
            </div>
            <PageThumb examId={target.examId} submissionId={target.submissionId} page={page} large alt={`Page ${page} of the script`} />
          </section>
        )}
        <LiveMarkingPanel examId={target.examId} onScriptMarked={(sid) => { if (sid && !target.submissionId) setTarget((t) => (t ? { ...t, submissionId: sid } : t)); }} />
      </div>
    </aside>
  );
}
