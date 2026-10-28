import React, { useEffect, useRef, useState } from 'react';
import { scanPaper, groupScanPages } from '../services/scannedPapers';
import { Camera, Download, Maximize2, ArrowLeft, Loader2 } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import { readServerEvents } from '../services/examEvents';
import ScanPageThumbnail from './ScanPageThumbnail';
import HandwritingReview, { type HandwritingEvidence } from './HandwritingReview';
import { PageView, type Review } from '../pages/ExamReviewPage';
import type { PageItem } from './DocumentScanner';
import type { StudentScript } from '../types';

export interface ScanBatch { id: string; pages: PageItem[]; examId?: string }
interface Submission { id: string; candidateId: string; candidateName: string; pages: number; state: string; error?: { message: string } }
interface Snapshot { examId: string; title: string; scheme: { status: string; errors: string[] } | null; submissions: Submission[]; progress?: { run: { state: string } | null } }
interface Row { submissionId: string; candidateId: string; candidateName: string; total: number; maxTotal: number; percent: number; complete: boolean; openFlags: number; released: boolean }
async function request(path: string, init?: RequestInit) {
  const res = await authFetch(`/api/exams${path}`, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}
const exportDownloads = (artifacts: any[]) => { const latest = artifacts.find(a => !a.stale && a.status === 'ready'); return latest ? [...(latest.classPdfUrl ? [{ name: 'All students — marked papers.pdf', url: latest.classPdfUrl }] : []), ...(latest.candidatePdfs || [])] : []; };
const json = (body: object): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export default function ScanMarkWorkspace({ batch, onClose, onScan, onResults, onExamReady }: {
  batch: ScanBatch; onExamReady: (examId: string) => void; onClose: () => void; onScan?: () => void; onResults: (scripts: StudentScript[]) => void;
}) {
  const [examId, setExamId] = useState(batch.examId || '');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState('');
  const [review, setReview] = useState<(Review & { evidence?: HandwritingEvidence[] }) | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [busy, setBusy] = useState(batch.examId ? '' : 'Saving scanned papers…');
  const [error, setError] = useState('');
  const savedJob = (kind: string) => { try { return JSON.parse(sessionStorage.getItem(`bwenge.scan.jobs:${batch.examId}`) || '{}')[kind] || ''; } catch { return ''; } };
  const [schemeJob, setSchemeJob] = useState(() => savedJob('scheme'));
  const [exportJob, setExportJob] = useState(() => savedJob('export'));
  const [schemePreview, setSchemePreview] = useState<any>(null);
  const [downloads, setDownloads] = useState<Array<{ name: string; url: string }>>([]);
  const [connection, setConnection] = useState<'connecting' | 'live' | 'reconnecting' | 'offline'>('connecting');
  const [refresh, setRefresh] = useState(0);
  const [remarkJob, setRemarkJob] = useState(() => savedJob('remark'));
  const [taskProgress, setTaskProgress] = useState('');
  const [follow, setFollow] = useState(true);
  const [showStudents, setShowStudents] = useState(false);
  const lastMarked = useRef('');
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [overrideQuestion, setOverrideQuestion] = useState('');
  const [overrideMarks, setOverrideMarks] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!examId) return;
    try { sessionStorage.setItem(`bwenge.scan.jobs:${examId}`, JSON.stringify({ scheme: schemeJob, export: exportJob, remark: remarkJob })); } catch {}
  }, [examId, schemeJob, exportJob, remarkJob]);
  const started = useRef(false);
  const resultSink = useRef(onResults); resultSink.current = onResults;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // A ref prevents React StrictMode from submitting the same batch twice.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (batch.examId) return;
    void (async () => {
      const created = await request('', json({ title: 'Scanned assessment' }));
      const groups = groupScanPages(batch.pages);
      if (groups.size > 30) throw new Error('Scan at most 30 students in one batch.');
      const form = new FormData();
      const mapping: object[] = [];
      let index = 0;
      for (const pages of groups.values()) {
        const candidateId = `SCN-${String(++index).padStart(3, '0')}`;
        const name = `${candidateId}.pdf`;
        form.append('scripts', await scanPaper(pages), name);
        mapping.push({ fileName: name, candidateId, candidateName: pages[0].studentName || candidateId });
      }
      form.append('mapping', JSON.stringify(mapping));
      const saved = await request(`/${created.examId}/submissions`, { method: 'POST', body: form });
      if (saved.rejected?.length) throw new Error(saved.rejected.map((r: any) => r.message || r.error || r.fileName).join('; '));
      onExamReady(created.examId);
      if (alive.current) { setExamId(created.examId); setSelected(saved.accepted[0]?.id || ''); setBusy(''); }
    })().catch(e => { if (alive.current) { setError(e.message); setBusy(''); } });
  }, [batch]);

  useEffect(() => {
    if (!examId) return;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout>;
    let attempt = 0;
    const apply = (data: any) => {
      const next: Snapshot = data.exam;
      setSnapshot(next); setRows(data.candidates); setReview(data.review);
      if (!selected && next.submissions.length) setSelected(next.submissions[0].id);
      setSchemePreview(data.schemePreview);
      setDownloads(exportDownloads(data.artifacts));
      resultSink.current(data.candidates.map((r: Row) => ({ id: r.submissionId, studentId: r.candidateId, studentName: r.candidateName || r.candidateId,
        submittedAt: new Date().toISOString(), status: r.released ? 'approved' : r.complete ? 'marked' : 'marking', answers: [],
        totalAwardedMarks: r.complete ? r.total : undefined, maxTotalMarks: r.maxTotal, percentage: r.complete ? r.percent : undefined,
        teacherApproved: r.released, flags: r.openFlags ? ['needs_teacher_review'] : [], overallFeedback: r.openFlags ? `${r.openFlags} answers need teacher review.` : 'AI marks are provisional until reviewed.' })));
      setTaskProgress(data.jobs.find((j: any) => j.status === 'queued' || j.status === 'processing')?.progress?.stage || '');
      for (const job of data.jobs) {
        if (job.status === 'failed' || job.status === 'cancelled') {
          setError(job.error?.message || 'The task could not finish. Please retry.');
          if (job.id === schemeJob) setSchemeJob('');
          if (job.id === exportJob) setExportJob('');
          if (job.id === remarkJob) setRemarkJob('');
          setBusy('');
        } else if (job.status === 'completed') {
          if (job.id === schemeJob) setSchemeJob('');
          if (job.id === exportJob) setExportJob('');
          if (job.id === remarkJob) setRemarkJob('');
          setBusy('');
        }
      }
      const checked = data.review?.questions.filter((q: any) => q.awardedMarks !== null);
      const newest = checked?.at(-1);
      const markKey = newest ? `${selected}:${newest.questionId}` : '';
      if (follow && markKey && markKey !== lastMarked.current) {
        lastMarked.current = markKey;
        const item = data.review.layout.items.find((i: any) => i.id === `${newest.questionId}:mark`);
        if (item?.placed) setPage(item.page);
        setSelectedItem(`${newest.questionId}:mark`);
      }
    };
    const connect = async () => {
      setConnection(attempt ? 'reconnecting' : 'connecting');
      try {
        const params = new URLSearchParams();
        if (selected) params.set('submissionId', selected);
        const jobs = [schemeJob, exportJob, remarkJob].filter(Boolean);
        if (jobs.length) params.set('jobs', jobs.join(','));
        const response = await authFetch(`/api/exams/${examId}/events?${params}`, { signal: controller.signal });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          if ([400, 401, 403, 404, 410, 422].includes(response.status)) { setConnection('offline'); setError(data.error || 'This saved examination is unavailable.'); return; }
          throw new Error(data.error || 'Live updates could not connect.');
        }
        setConnection('live'); attempt = 0;
        await readServerEvents(response, event => {
          if (controller.signal.aborted) return;
          if (event.event === 'snapshot') apply(JSON.parse(event.data));
          if (event.event === 'stream_error') setConnection('reconnecting');
        }, controller.signal);
      } catch (e: any) {
        if (!controller.signal.aborted) setConnection('reconnecting');
      }
      if (!controller.signal.aborted) { attempt++; retry = setTimeout(connect, Math.min(10_000, 750 * 2 ** Math.min(attempt, 4))); }
    };
    void connect();
    return () => { controller.abort(); clearTimeout(retry); };
  }, [examId, selected, schemeJob, exportJob, remarkJob, refresh, follow]);

  const action = async (label: string, fn: () => Promise<void>) => {
    setError(''); setBusy(label);
    try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(''); setRefresh(n => n + 1); }
  };
  const rubric = (files?: FileList | null, questionPaper = false) => action('Reading marking criteria…', async () => {
    const form = new FormData();
    if (files?.length) for (const f of Array.from(files)) form.append(questionPaper ? 'questionPaper' : 'scheme', f);
    const data = await request(`/${examId}/rubric${!files?.length || questionPaper ? '/draft' : ''}`, { method: 'POST', body: form });
    setSchemeJob(data.job.id); setSchemePreview(null); setDownloads([]);
  });
  const mark = () => action('Starting marking…', async () => {
    if (snapshot?.scheme?.status === 'needs_confirmation') await request(`/${examId}/rubric/confirm`, json({}));
    await request(`/${examId}/mark`, json({})); setSchemePreview(null); setDownloads([]);
  });
  const exportPdf = () => action('Preparing marked PDFs…', async () => {
    const data = await request(`/${examId}/exports`, json({}));
    if (data.job) setExportJob(data.job.id);
    else { const artifacts = await request(`/${examId}/artifacts`); setDownloads(exportDownloads(artifacts.artifacts)); }
  });
  const sub = snapshot?.submissions.find(s => s.id === selected);
  const selectedRow = rows.find(r => r.submissionId === selected);
  const running = !!remarkJob || (!!snapshot?.progress?.run && !['completed', 'completed_with_warnings', 'failed'].includes(snapshot.progress.run.state)) || snapshot?.submissions.some(s => !['queued', 'completed', 'completed_with_warnings', 'failed'].includes(s.state));
  const markedQuestions = review?.questions.filter(q => q.awardedMarks !== null).length || 0;
  const button = 'rounded-lg border border-[#E8E4DC] px-3 py-2 text-xs font-semibold disabled:opacity-40 hover:bg-black/5';

  return <div ref={root} className="flex h-full min-h-[70vh] flex-col bg-[#FBF9F6] text-[#242422]">
    <header className="flex flex-wrap items-center gap-2 border-b border-[#E8E4DC] px-4 py-3">
      <button className={button} onClick={onClose} aria-label="Back to workspace"><ArrowLeft size={16} /></button>
      <button className={`${button} md:hidden`} onClick={() => setShowStudents(v => !v)}>Students</button>
      <div className="mr-auto"><h2 className="text-sm font-bold">Scanned assessment</h2><p className="text-xs text-neutral-500" role="status">{connection === 'live' ? '● Live — saved results' : connection === 'reconnecting' ? 'Reconnecting — your marks are saved' : connection === 'offline' ? 'Live updates unavailable' : 'Connecting to saved papers…'}</p></div>
      <button className={button} onClick={onScan}><Camera size={15} className="inline mr-1" />New scan</button>
      {examId && <a className={button} href={`/exams/${examId}/review`}>Review all</a>}
      <button className={`${button} bg-[#D97757] text-white`} disabled={!rows.some(r => r.complete) || !!busy || !!exportJob || running} onClick={() => void exportPdf()}><Download size={14} className="inline mr-1" />Export PDFs</button>
    </header>
    {(error || busy || schemeJob || exportJob || remarkJob) && <div role={error ? 'alert' : 'status'} className={`px-4 py-2 text-sm ${error ? 'bg-rose-50 text-rose-700' : 'bg-orange-50 text-orange-900'}`}>{error || busy || taskProgress || (schemeJob ? 'Reading marking criteria…' : remarkJob ? 'Re-marking corrected handwriting…' : 'Preparing PDFs…')}</div>}
    {examId && !running && snapshot?.scheme?.status !== 'confirmed' && <section className="border-b p-4 text-sm">
      <p className="mb-2 font-semibold">Attach a marking scheme, or let AI draft one from the visible questions.</p>
      <div className="flex flex-wrap gap-2">
        <label className={button}>Attach scheme<input aria-label="Attach marking scheme" type="file" accept=".pdf,.jpg,.jpeg,.png,.txt,.docx" className="hidden" disabled={!!busy || !!schemeJob} onChange={e => void rubric(e.target.files)} /></label>
        <label className={button}>Attach question paper<input aria-label="Attach question paper" type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" disabled={!!busy || !!schemeJob} onChange={e => void rubric(e.target.files, true)} /></label>
        <button className={button} disabled={!!busy || !!schemeJob} onClick={() => void rubric()}>Use AI draft</button>
      </div>
      {schemePreview && <div className="mt-3"><p className="text-xs text-amber-800">AI draft — check the questions and marks before starting.</p><div className="my-2 max-h-40 overflow-auto rounded border bg-white p-3 text-xs">{schemePreview.questions?.map((q: any) => <p key={q.id} className="mb-2"><b>Q{q.number} · {q.maxMarks} marks</b> {q.text} {q.criteria?.map((c: any) => c.description).join('; ')}</p>)}</div><button className={button} disabled={!!busy} onClick={() => void mark()}>Confirm criteria & start marking</button></div>}
      {snapshot?.scheme?.errors?.map(e => <p key={e} className="mt-2 text-rose-700">{e}</p>)}
    </section>}
    {snapshot?.scheme?.status === 'confirmed' && !running && snapshot.submissions.some(s => s.state === 'queued' || s.state === 'failed') && <button className={`${button} m-3 self-start`} disabled={!!busy} onClick={() => void mark()}>Start marking</button>}
    {downloads.length > 0 && <div className="flex flex-wrap gap-3 border-b p-3 text-xs">{downloads.map((d: any) => <a key={d.url} className="underline text-[#A44B32]" href={d.url} download>{d.submissionId ? `${rows.find(r => r.submissionId === d.submissionId)?.candidateName || 'Student'} — marked.pdf` : d.name || 'Marked PDF'}</a>)}</div>}
    <div className="flex flex-1 min-h-0">
      <aside className={`${showStudents ? 'block' : 'hidden'} w-40 shrink-0 overflow-y-auto border-r border-[#E8E4DC] p-2 md:block md:w-48`}>
        <h3 className="p-2 text-xs font-bold uppercase text-neutral-500">Class papers · {snapshot?.submissions.length || 0}</h3>
        {(snapshot?.submissions || []).map(s => { const r = rows.find(x => x.submissionId === s.id); return <button key={s.id} className={`mb-2 w-full rounded-xl p-3 text-left text-xs ${selected === s.id ? 'bg-[#F7E8E0] ring-1 ring-[#D97757]' : 'bg-white'}`} onClick={() => { setSelected(s.id); setPage(1); setReview(null); setSelectedItem(null); setShowStudents(false); lastMarked.current = '';  }}><b className="block">{s.candidateName || s.candidateId}</b><span className="block mt-1">{s.pages} pages · {r?.complete ? `${r.total}/${r.maxTotal}` : r ? `${r.total} so far` : 'Pending'}</span><span className={`block mt-1 ${s.error ? 'text-rose-700' : 'text-neutral-500'}`}>{s.error?.message || (r?.released ? 'Reviewed' : r?.complete ? 'Needs teacher review' : s.state.replaceAll('_', ' '))}</span></button>; })}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs"><label className="flex items-center gap-1"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />Follow marking</label><b className="mr-auto">{sub?.candidateName || 'Scanned paper'} · Page {page}/{sub?.pages || batch.pages.length}</b><select aria-label="Paper zoom" className={button} value={zoom} onChange={e => setZoom(Number(e.target.value))}><option value={100}>Fit width</option><option value={125}>125%</option><option value={150}>150%</option></select><button className={button} title="Fullscreen paper" onClick={() => void root.current?.requestFullscreen().catch(() => setError('Fullscreen is unavailable.'))}><Maximize2 size={14} /></button></div>
        <div className="flex-1 overflow-auto bg-[#EFEEEB] p-3 sm:p-6"><div className="mx-auto" style={{ width: `${zoom}%`, minWidth: 280, maxWidth: zoom === 100 ? 1200 : undefined }}>
          {sub ? <PageView key={`${examId}:${selected}:${page}`} examId={examId} submissionId={selected} page={page}
            aspect={review?.layout.pages.find(p => p.page === page)?.aspect}
            items={review?.layout.items.filter(i => i.kind !== 'total' || selectedRow?.complete) || []}
            selected={selectedItem} onSelect={id => { setSelectedItem(id); setFollow(false); }}
            onMove={(id, page, fx, fy) => { if (running) return; void action('Saving mark position…', async () => {
              const data = await request(`/${examId}/submissions/${selected}/layout/${encodeURIComponent(id)}`, { ...json({ page, fx, fy }), method: 'PUT' });
              setReview(data); setDownloads([]);
            }); }} /> : batch.pages[0] ? <img className="w-full rounded bg-white shadow-lg" src={batch.pages[0].dataUrl} alt="Scanned paper uploading" /> : <p className="p-12 text-center text-sm">Loading saved scanned pages…</p>}

        </div></div>
        <footer className="border-t p-3 text-xs"><div role="status" aria-live="polite" className="flex items-center gap-2 mb-2">{running && <Loader2 size={14} className="animate-spin" />}{sub?.error?.message || (running ? `${sub?.state.replaceAll('_', ' ')} · ${markedQuestions}/${review?.questions.length || '?'} questions checked` : selectedRow?.complete ? 'Marking complete — review before releasing.' : 'Ready for marking criteria.')}</div><div className="flex items-center gap-2 overflow-x-auto">
          <button className={button} disabled={page <= 1} onClick={() => { setPage(p => p - 1); setFollow(false); }}>Previous</button>
          {sub && Array.from({ length: Math.min(5, sub.pages) }, (_, i) => i + Math.max(1, Math.min(page - 2, sub.pages - 4))).map(number => <ScanPageThumbnail key={`${selected}:${number}`} examId={examId} submissionId={selected} page={number} active={page === number} onClick={() => { setPage(number); setFollow(false); }} />)}
          <button className={button} disabled={page >= (sub?.pages || 1)} onClick={() => { setPage(p => p + 1); setFollow(false); }}>Next</button>
        </div></footer>
        {review && <div className="flex items-center gap-2 border-t px-3 py-2 text-xs"><label htmlFor="review-question">Review answer</label><select id="review-question" className={button} value={selectedItem?.split(':')[0] || ''} onChange={e => { setFollow(false); setSelectedItem(e.target.value ? `${e.target.value}:mark` : null); const item = review.layout.items.find(i => i.id === `${e.target.value}:mark`); if (item?.placed) setPage(item.page); }}><option value="">Select question</option>{review.questions.map(q => <option key={q.questionId} value={q.questionId}>Q{q.number} · {q.awardedMarks ?? 'Pending'}/{q.maxMarks}{q.openReviewFlags.length ? ' · Check' : ''}</option>)}</select></div>}
        {selectedItem && review && <section className="max-h-[45vh] overflow-y-auto border-t p-3 text-xs"><h3 className="font-bold">Selected answer</h3>{review.questions.filter(q => selectedItem.startsWith(`${q.questionId}:`)).map(q => <div key={q.questionId}><p className="my-1">Q{q.number}: {q.answerAsRead || 'No readable answer'}</p><p>{q.feedback} {q.lostMarks}</p>{q.openReviewFlags.map(f => <p key={f.code} className="text-amber-800">{f.detail}</p>)}{review.evidence?.filter(e => e.questionIds.includes(q.questionId)).map(e => <HandwritingReview key={e.id} evidence={e} disabled={!!running || !!busy} onCorrect={async (elementId, text) => {
          const result = await request(`/${examId}/submissions/${selected}/corrections`, json({ elementId, to: text, remark: true }));
          setDownloads([]); if (result.jobId) setRemarkJob(result.jobId); setRefresh(n => n + 1);
        }} />)}<button className={`${button} mt-2`} disabled={running} onClick={() => { setOverrideQuestion(q.questionId); setOverrideMarks(String(q.awardedMarks ?? 0)); }}>Adjust mark</button></div>)}</section>}
        {overrideQuestion && <form className="flex flex-wrap gap-2 border-t p-3 text-xs" onSubmit={e => { e.preventDefault(); void action('Saving teacher mark…', async () => { await request(`/${examId}/submissions/${selected}/marks/${overrideQuestion}`, { ...json({ marks: Number(overrideMarks), reason: overrideReason }), method: 'PATCH' }); setOverrideQuestion(''); setOverrideReason(''); setDownloads([]); }); }}><input aria-label="Teacher mark" type="number" min="0" step="0.5" required value={overrideMarks} onChange={e => setOverrideMarks(e.target.value)} className="w-20 rounded border p-2" /><input aria-label="Reason for mark adjustment" required maxLength={1000} placeholder="Reason for adjustment" value={overrideReason} onChange={e => setOverrideReason(e.target.value)} className="min-w-40 flex-1 rounded border p-2" /><button className={button}>Save mark</button></form>}
        {selectedRow?.complete && <div className="flex gap-2 border-t p-3 text-xs"><span className="mr-auto self-center">{selectedRow.released ? 'Teacher reviewed' : 'AI draft — teacher review required'}</span><button className={button} disabled={!!busy || running || selectedRow.released} onClick={() => void action('Confirming reviewed paper…', async () => { const result = await request(`/${examId}/release`, json({ submissionIds: [selected] })); if (result.skipped?.length) throw new Error(result.skipped[0].reason); setDownloads([]); if (result.exportJobId) setExportJob(result.exportJobId); })}>Confirm reviewed paper</button></div>}
      </main>
    </div>
  </div>;
}
