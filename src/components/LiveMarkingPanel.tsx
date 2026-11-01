import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleSlash, FileCheck2, Loader2, ScanText, Sparkles, Square, XCircle } from 'lucide-react';
import { authFetch } from '../utils/authFetch';

/**
 * Live marking activity for one examination, streamed from the backend (Server-Sent Events). Every line is a
 * saved event from a real state change; on reconnect the stream resumes after the last event seen, so nothing is
 * missed or shown twice. Closing the page never stops the marking job.
 */

export interface ExamEvent {
  v: 1; seq: number; type: string; at: string; runId?: string; submissionId?: string; candidateId?: string; questionId?: string;
  page?: number; message: string; progress?: { done: number; total: number }; data?: Record<string, string | number | boolean | null>;
}
interface Preferences { credit: 'partial' | 'strict'; corrections: boolean; feedback: 'brief' | 'detailed' }

const ACTION = new Set(['teacher_review_required', 'clarification_required']);
const NOTICE = new Set(['uncertainty_detected']);
const DONE = new Set(['job_completed', 'pdf_generation_completed', 'rubric_ready', 'script_marked']);
const FAIL = new Set(['job_failed']);
const END = new Set(['job_completed', 'job_failed', 'job_cancelled']);
const START = new Set(['job_created']);

function icon(type: string) {
  if (FAIL.has(type)) return <XCircle size={14} className="text-rose-400" />;
  if (type === 'job_cancelled') return <CircleSlash size={14} className="text-neutral-400" />;
  if (ACTION.has(type)) return <AlertTriangle size={14} className="text-orange-400" />;
  if (NOTICE.has(type)) return <AlertTriangle size={14} className="text-amber-300" />;
  if (DONE.has(type)) return <CheckCircle2 size={14} className="text-emerald-400" />;
  if (type.startsWith('pdf_')) return <FileCheck2 size={14} className="text-sky-300" />;
  if (type.includes('page') || type.includes('document') || type.includes('handwriting')) return <ScanText size={14} className="text-sky-300" />;
  return <Sparkles size={14} className="text-[var(--brand-soft)]" />;
}

/**
 * The saved marking events of one examination, live: replays everything so far, then streams new events.
 * Reconnects after a drop (backing off), asking only for events after the last one seen.
 */
export function useExamActivity(examId: string, onEvent?: (ev: ExamEvent) => void) {
  const [events, setEvents] = useState<ExamEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [gap, setGap] = useState(false);
  const lastSeq = useRef(0);
  const cb = useRef(onEvent);
  cb.current = onEvent;

  // Stream with resume: reconnects after a drop (backing off), asking only for events after the last one seen.
  useEffect(() => {
    let stopped = false;
    let ctrl: AbortController | null = null;
    let wait = 1000;
    const run = async () => {
      while (!stopped) {
        ctrl = new AbortController();
        try {
          const res = await authFetch(`/api/exams/${examId}/activity`, { headers: { 'Last-Event-ID': String(lastSeq.current) }, signal: ctrl.signal });
          if (res.status === 404 || res.status === 401 || res.status === 403) { setConnected(false); return; }
          if (!res.ok || !res.body) throw new Error(String(res.status));
          setConnected(true);
          wait = 1000;
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let cut: number;
            while ((cut = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, cut);
              buf = buf.slice(cut + 2);
              const kind = /^event: (.+)$/m.exec(block)?.[1];
              const data = /^data: (.+)$/m.exec(block)?.[1];
              if (!data) continue;
              if (kind === 'gap') { setGap(true); continue; }
              const ev = JSON.parse(data) as ExamEvent;
              if (ev.seq <= lastSeq.current) continue;
              lastSeq.current = ev.seq;
              setEvents((cur) => [...cur.slice(-299), ev]);
              cb.current?.(ev);
            }
          }
        } catch { /* dropped: retry below */ }
        setConnected(false);
        if (stopped) return;
        await new Promise((r) => setTimeout(r, wait));
        wait = Math.min(wait * 2, 15_000);
      }
    };
    void run();
    return () => { stopped = true; ctrl?.abort(); };
  }, [examId]);

  return { events, connected, gap };
}

export default function LiveMarkingPanel({ examId, onScriptMarked, compact = false }: { examId: string; onScriptMarked?: (submissionId: string | undefined) => void; compact?: boolean }) {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [notice, setNotice] = useState<{ text: string; upgrade?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const onMarked = useRef(onScriptMarked);
  onMarked.current = onScriptMarked;
  const { events, connected, gap } = useExamActivity(examId, (ev) => {
    if (ev.type === 'script_marked' || ev.type === 'job_completed') onMarked.current?.(ev.submissionId);
  });
  useEffect(() => { if (gap) setNotice({ text: 'Some older activity is no longer kept; showing what is.' }); }, [gap]);

  useEffect(() => {
    authFetch(`/api/exams/${examId}/preferences`).then(async (r) => { if (r.ok) setPrefs((await r.json()).preferences); }).catch(() => undefined);
  }, [examId]);

  const savePrefs = useCallback(async (patch: Partial<Preferences>) => {
    setBusy(true);
    try {
      const r = await authFetch(`/api/exams/${examId}/preferences`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const body = await r.json().catch(() => null);
      if (r.ok) { setPrefs(body.preferences); setNotice({ text: 'Saved. Scripts marked from now on use these settings; ask to re-mark to apply them to marked scripts.' }); }
      else setNotice({ text: body?.error ?? 'The setting could not be saved.' });
    } finally { setBusy(false); }
  }, [examId]);

  const cancel = useCallback(async () => {
    if (!window.confirm('Stop marking? Finished scripts keep their marks; the others wait until you continue.')) return;
    setBusy(true);
    try {
      const r = await authFetch(`/api/exams/${examId}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const body = await r.json().catch(() => null);
      if (!r.ok) setNotice({ text: body?.error ?? 'Marking could not be stopped.', upgrade: body?.details?.upgradeUrl });
    } finally { setBusy(false); }
  }, [examId]);

  // Current state from the events themselves: a run is active from job_created until it ends.
  const lastStart = events.reduce((a, e, i) => (START.has(e.type) ? i : a), -1);
  const lastEnd = events.reduce((a, e, i) => (END.has(e.type) ? i : a), -1);
  const active = lastStart >= 0 && lastStart > lastEnd;
  const progress = [...events].reverse().find((e) => e.progress)?.progress ?? null;
  const latest = events[events.length - 1];
  const needAction = events.filter((e, i) => ACTION.has(e.type) && i > lastStart).length;
  const shown = compact ? events.slice(-40) : events.slice(-200);

  return (
    <section aria-label="Live marking" className="rounded-xl border border-white/[0.08] bg-white/[0.02]">
      <header className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <span className={`h-2 w-2 rounded-full ${connected ? (active ? 'animate-pulse bg-emerald-400' : 'bg-emerald-500/70') : 'bg-neutral-500'}`} aria-hidden />
        <span className="text-[12px] font-semibold text-white">{active ? 'Marking in progress' : latest ? 'Marking activity' : 'Live marking'}</span>
        {!connected && <span className="text-[11px] text-neutral-500">reconnecting…</span>}
        {needAction > 0 && <span className="rounded-md bg-orange-500/15 px-1.5 py-px text-[10.5px] font-semibold text-orange-300">{needAction} need{needAction === 1 ? 's' : ''} you</span>}
        {active && <button type="button" disabled={busy} onClick={() => void cancel()} className="ml-auto inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-neutral-300 hover:bg-white/5 disabled:opacity-50"><Square size={11} /> Stop</button>}
      </header>
      {progress && (
        <div className="px-3 pt-2.5">
          <div className="flex justify-between text-[11px] text-neutral-400"><span>{progress.done} of {progress.total} script{progress.total === 1 ? '' : 's'} finished</span>{active && <Loader2 size={12} className="animate-spin" />}</div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
            <div className="h-full rounded-full bg-[var(--brand)] transition-[width] duration-500" style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} />
          </div>
        </div>
      )}
      {prefs && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5 text-[11px]">
          <label className="sr-only" htmlFor={`credit-${examId}`}>Credit</label>
          <select id={`credit-${examId}`} disabled={busy} value={prefs.credit} onChange={(e) => void savePrefs({ credit: e.target.value as Preferences['credit'] })} className="h-7 rounded-md border border-white/10 bg-[var(--app-panel-2)] px-1.5 text-neutral-200">
            <option value="partial">Partial credit</option><option value="strict">Strict marking</option>
          </select>
          <select aria-label="Feedback" disabled={busy} value={prefs.feedback} onChange={(e) => void savePrefs({ feedback: e.target.value as Preferences['feedback'] })} className="h-7 rounded-md border border-white/10 bg-[var(--app-panel-2)] px-1.5 text-neutral-200">
            <option value="brief">Brief feedback</option><option value="detailed">Detailed feedback</option>
          </select>
          <label className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/10 px-2 text-neutral-200">
            <input type="checkbox" disabled={busy} checked={prefs.corrections} onChange={(e) => void savePrefs({ corrections: e.target.checked })} className="accent-[var(--brand)]" /> Red corrections
          </label>
        </div>
      )}
      {notice && (
        <p className="mx-3 mt-2.5 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-[11.5px] text-neutral-300">{notice.text}{notice.upgrade && <> <a className="font-semibold text-[var(--brand-soft)] underline" href={notice.upgrade}>Upgrade</a></>}</p>
      )}
      <ol className={`${compact ? 'max-h-56' : 'max-h-[60dvh]'} mt-2 space-y-1 overflow-y-auto px-3 pb-3`} aria-live="polite">
        {shown.length === 0 && <li className="py-2 text-[12px] text-neutral-500">Nothing yet. Activity appears here as soon as marking starts; it keeps running if you close this page.</li>}
        {[...shown].reverse().map((e) => (
          <li key={e.seq} className={`flex gap-2 rounded-md px-1.5 py-1 text-[12px] leading-5 ${ACTION.has(e.type) ? 'bg-orange-500/[0.07] text-orange-100' : FAIL.has(e.type) ? 'bg-rose-500/[0.07] text-rose-100' : 'text-neutral-300'}`}>
            <span className="mt-0.5 shrink-0">{icon(e.type)}</span>
            <span className="min-w-0 flex-1">{e.message}</span>
            <time className="shrink-0 tabular-nums text-[10.5px] text-neutral-500" dateTime={e.at}>{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}
