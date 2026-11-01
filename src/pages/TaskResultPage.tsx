import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, FileText, Loader2, Lock } from 'lucide-react';
import { AttachmentCard, PreviewDialog, type PreviewSource } from '../components/FilePreview';
import { getApiUrl } from '../utils/authFetch';
import logoUrl from '../assets/bwenge-logo.svg';

/**
 * A student's own result for a task, through the private link they got when they handed in (no account): marks
 * per question with the teacher's feedback, and the marked paper with the red pen, opened in the page.
 */

interface Result {
  state: 'not_marked' | 'marking' | 'waiting' | 'released';
  title: string;
  studentName: string;
  submittedAt?: string;
  total?: number | null;
  maxTotal?: number | null;
  percent?: number | null;
  releasedAt?: string | null;
  questions?: Array<{ number: string; awardedMarks: number | null; maxMarks: number; feedback: string; lostMarks: string; correction: string | null }>;
  markedPdfUrl?: string | null;
}

export default function TaskResultPage({ token, resultToken }: { token: string; resultToken: string }) {
  const [r, setR] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () => fetch(getApiUrl(`/api/assignments/public/${encodeURIComponent(token)}/result/${encodeURIComponent(resultToken)}`)).then(async (res) => {
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || 'This result link is not valid.');
      if (live) setR(b);
      return b as Result;
    }).catch((e) => { if (live) setError(e instanceof Error ? e.message : 'This result link is not valid.'); return null; });
    void load();
    // While the paper is being marked, look again every half minute.
    const t = window.setInterval(() => { if (!r || r.state === 'marking') void load(); }, 30_000);
    return () => { live = false; window.clearInterval(t); };
  }, [token, resultToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const pdf = useMemo<PreviewSource | null>(() => (r?.markedPdfUrl ? { name: `${r.title} - marked.pdf`, type: 'application/pdf', url: r.markedPdfUrl } : null), [r?.markedPdfUrl, r?.title]);

  const shell = (body: React.ReactNode) => (
    <div className="scroll-area h-[100dvh] overflow-y-auto bg-[#F4F3EF] text-[#1F1E1D]">
      <header className="flex items-center gap-2 px-5 py-4"><img src={logoUrl} alt="" className="h-7 w-7" /><span className="text-[13px] font-semibold text-neutral-600">Bwenge · Result</span></header>
      <main className="mx-auto max-w-2xl px-4 pb-16">{body}</main>
    </div>
  );

  if (error) return shell(<div className="rounded-2xl bg-white p-6 text-center shadow-sm"><Lock className="mx-auto text-neutral-400" /><p className="mt-3 font-semibold">This link does not work</p><p className="mt-1 text-[14px] text-neutral-500">{error}</p></div>);
  if (!r) return shell(<div className="flex justify-center py-24 text-neutral-400"><Loader2 className="animate-spin" /></div>);

  const head = (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-neutral-500">{r.studentName}</p>
      <h1 className="mt-1 text-[21px] font-semibold leading-snug">{r.title}</h1>
      {r.submittedAt && <p className="mt-1 text-[13px] text-neutral-500">Handed in {new Date(r.submittedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>}
    </div>
  );

  if (r.state !== 'released') {
    const [Icon, title, text] = r.state === 'waiting' ? [CheckCircle2, 'Marked, waiting for your teacher', 'Your paper has been marked. Your teacher checks the marks first; they appear here as soon as they are released.']
      : r.state === 'marking' ? [Loader2, 'Being marked', 'Your answer is being marked now. This page updates by itself; you can also come back later.']
        : [Clock, 'Not marked yet', 'Your teacher will mark this task. Keep this link: your result appears here when it is ready.'];
    return shell(<div className="space-y-3">{head}<div className="rounded-2xl bg-white p-6 text-center shadow-sm"><Icon size={36} className={`mx-auto ${r.state === 'marking' ? 'animate-spin text-[#D97757]' : r.state === 'waiting' ? 'text-emerald-600' : 'text-neutral-400'}`} /><p className="mt-3 font-semibold">{title}</p><p className="mx-auto mt-1 max-w-sm text-[14px] text-neutral-500">{text}</p></div></div>);
  }

  const pct = Math.round(r.percent ?? 0);
  return shell(
    <div className="space-y-3">
      {head}
      <div className="flex items-center gap-4 rounded-2xl bg-white p-5 shadow-sm">
        <span className={`grid h-20 w-20 shrink-0 place-items-center rounded-full text-[22px] font-bold text-white ${pct >= 80 ? 'bg-emerald-600' : pct >= 50 ? 'bg-amber-500' : 'bg-rose-600'}`}>{pct}%</span>
        <div>
          <p className="text-[24px] font-semibold tabular-nums">{r.total} / {r.maxTotal}</p>
          <p className="text-[13px] text-neutral-500">{pct >= 80 ? 'Excellent work.' : pct >= 50 ? 'Good effort. Read the feedback below to improve.' : 'Read the feedback below carefully and try again.'}</p>
        </div>
      </div>
      {pdf && (
        <div className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm">
          <div className="rounded-xl bg-[#1F1E1D] p-1"><AttachmentCard src={pdf} size={96} onOpen={() => setViewing(true)} /></div>
          <div className="min-w-0 flex-1"><p className="text-[14px] font-semibold">Your marked paper</p><p className="text-[13px] text-neutral-500">Every page with the red-pen ticks, crosses and corrections. Opens here; no download needed.</p></div>
        </div>
      )}
      {!!r.questions?.length && (
        <section className="rounded-2xl bg-white p-5 shadow-sm" aria-label="Marks per question">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold"><FileText size={16} />Question by question</h2>
          <ul className="mt-3 divide-y divide-neutral-100">
            {r.questions.map((q) => (
              <li key={q.number} className="py-3">
                <div className="flex items-baseline justify-between gap-3"><span className="text-[14px] font-semibold">Question {q.number}</span><span className="text-[14px] font-semibold tabular-nums">{q.awardedMarks ?? '–'} / {q.maxMarks}</span></div>
                {q.feedback && <p className="mt-1 text-[13.5px] text-neutral-700">{q.feedback}</p>}
                {q.lostMarks && q.awardedMarks !== q.maxMarks && <p className="mt-1 text-[13px] text-rose-700">{q.lostMarks}</p>}
                {q.correction && <p className="mt-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 font-mono text-[12.5px] text-emerald-900">{q.correction}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {viewing && pdf && <PreviewDialog src={pdf} onClose={() => setViewing(false)} />}
    </div>,
  );
}
