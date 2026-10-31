import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarClock, Check, ChevronLeft, ChevronRight, ClipboardList, Copy, Download, ExternalLink, Eye, FileText, Image as ImageIcon, Link2, Loader2, Lock, Paperclip, Plus, Share2, Sparkles, Trash2, Unlock, Users, X } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import { PdfViewer, loadPdfJs } from './PdfViewer';
import { FileThumb, PreviewDialog, type PreviewSource } from './FilePreview';
import { Card, Empty, PageShell, Stat, StatRow, Toolbar, primaryBtn, relative } from './workspace/Shell';

/**
 * Tasks: the owner sets a task (text and/or files) and shares one link; people submit through it in any format,
 * with no account. The dashboard shows every submission with its files previewed in place, and "Mark all with AI"
 * hands them to the Mark page (one PDF per person, names kept) for live marking.
 */

interface StoredFile { id: string; name: string; mime: string; size: number }
interface Submission { id: string; studentName: string; studentId?: string; files: StoredFile[]; text?: string; submittedAt: string; late: boolean; resubmissions: number }
interface Assignment { id: string; title: string; instructions: string; taskFiles: StoredFile[]; dueAt: string | null; open: boolean; link: string; createdAt: string; submissions: Submission[]; counts: { submitted: number; late: number } }
interface Row { id: string; title: string; dueAt: string | null; open: boolean; link: string; createdAt: string; submitted: number; late?: number; lastSubmissionAt: string | null }
/** What "Mark all" hands to the Mark page: files already uploaded, each with its role. */
export interface PreparedMarking { scripts: Array<StoredFile & { studentName: string; candidateId: string }>; roster: StoredFile; task: StoredFile[]; title: string; skipped: Array<{ studentName: string; reason: string }> }

const json = async <T,>(res: Response): Promise<T> => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status}).`);
  return body as T;
};
const when = (iso: string) => {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};
const due = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'No due date');
const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
const isImage = (f: StoredFile) => /^image\/(png|jpeg|webp|gif)$/.test(f.mime);
const isPdf = (f: StoredFile) => f.mime === 'application/pdf';

/** A file of this task as a local object URL (requests carry the sign-in, so plain <img src> cannot be used). */
function useFileUrl(assignmentId: string, f: StoredFile | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!f) return;
    let live = true;
    let made: string | null = null;
    authFetch(`/api/assignments/${assignmentId}/files/${f.id}`).then((r) => (r.ok ? r.blob() : null)).then((b) => {
      if (!b || !live) return;
      made = URL.createObjectURL(b);
      setUrl(made);
    }).catch(() => undefined);
    return () => { live = false; if (made) URL.revokeObjectURL(made); setUrl(null); };
  }, [assignmentId, f?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}

/** First page of a PDF as a small picture, drawn in the browser (pdf.js). */
function usePdfCover(url: string | null) {
  const [cover, setCover] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    (async () => {
      const lib = await loadPdfJs();
      const doc = await lib.getDocument({ url, isEvalSupported: false }).promise;
      const page = await doc.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const scale = 160 / vp.width;
      const canvas = document.createElement('canvas');
      const view = page.getViewport({ scale });
      canvas.width = Math.ceil(view.width);
      canvas.height = Math.ceil(view.height);
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport: view, canvas }).promise;
      if (live) setCover(canvas.toDataURL('image/jpeg', 0.8));
      void doc.destroy();
    })().catch(() => undefined);
    return () => { live = false; };
  }, [url]);
  return cover;
}

function Thumb({ assignmentId, file }: { assignmentId: string; file: StoredFile }) {
  const url = useFileUrl(assignmentId, isImage(file) || isPdf(file) ? file : null);
  const cover = usePdfCover(isPdf(file) ? url : null);
  const src = isImage(file) ? url : cover;
  return (
    <span title={file.name} className="relative flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-black/20 bg-[#FBFAF6] text-neutral-500">
      {src ? <img src={src} alt="" className="h-full w-full object-cover object-top" /> : isImage(file) ? <ImageIcon size={16} /> : <FileText size={16} />}
      {!isImage(file) && <span className="absolute bottom-0 inset-x-0 bg-black/55 text-center text-[8.5px] font-semibold uppercase leading-[13px] text-white">{(/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? 'file').slice(0, 4)}</span>}
    </span>
  );
}

/** One file shown the way it reads best: photos full width, PDFs page by page, documents as text. */
function FileView({ assignmentId, file }: { assignmentId: string; file: StoredFile }) {
  const url = useFileUrl(assignmentId, file);
  const [viewing, setViewing] = useState(false);
  const source = useMemo<PreviewSource | null>(() => (url ? { name: file.name, type: file.mime, url, size: file.size } : null), [url, file.name, file.mime, file.size]);

  return (
    <figure className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#16171b]">
      <figcaption className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2 text-[12.5px] text-neutral-300">
        {isImage(file) ? <ImageIcon size={14} /> : <FileText size={14} />}
        <span className="min-w-0 flex-1 truncate">{file.name}</span>
        <span className="text-neutral-500">{size(file.size)}</span>
        {url && <a href={url} download={file.name} className="rounded p-1 text-neutral-400 hover:bg-white/10 hover:text-white" aria-label={`Download ${file.name}`}><Download size={14} /></a>}
      </figcaption>
      {!url ? <div className="flex h-40 items-center justify-center text-neutral-500"><Loader2 size={18} className="animate-spin" /></div>
        : isImage(file) ? <img src={url} alt={file.name} className="mx-auto max-h-[80vh] w-auto bg-white" />
          : /^audio\//.test(file.mime) ? <div className="p-4"><audio controls src={url} className="w-full" /></div>
          : isPdf(file) ? <div className="h-[70vh]"><PdfViewer url={url} name={file.name} tall /></div>
            : <button type="button" onClick={() => setViewing(true)} aria-label={`Preview ${file.name}`} className="group relative block w-full">
                <FileThumb src={source!} tone="dark" className="h-64 w-full" />
                <span className="absolute inset-0 grid place-items-center bg-black/0 text-[13px] font-semibold text-white opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">Open preview</span>
              </button>}
      {viewing && source && <PreviewDialog src={source} onClose={() => setViewing(false)} />}
    </figure>
  );
}

function ShareBox({ link, title }: { link: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => { void import('qrcode').then((q) => q.toDataURL(link, { margin: 1, width: 220, color: { dark: '#1B1A19', light: '#FFFFFF' } })).then(setQr).catch(() => undefined); }, [link]);
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* clipboard may be blocked */ } };
  const text = `${title}: submit your answers here (photos, PDF, Word or typed): ${link}`;
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-[#D97757]/30 bg-[#D97757]/[0.06] p-4 sm:flex-row sm:items-center">
      {qr && <img src={qr} alt="QR code of the task link" className="h-28 w-28 shrink-0 self-center rounded-lg bg-white p-1.5" />}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-white">Share this link with the people doing the task</p>
        <p className="mt-0.5 text-[12.5px] text-neutral-400">No account needed. They open it, write their name and submit photos, PDF, Word or typed answers.</p>
        <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-white/[0.12] bg-[#111216] px-3 py-2">
          <Link2 size={14} className="shrink-0 text-[#E08A6A]" />
          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-neutral-200">{link}</span>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1.5 rounded-xl bg-[#D97757] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#c96a4c]">{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy link'}</button>
          <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.14] px-3.5 py-2 text-[13px] text-neutral-200 hover:bg-white/5"><Share2 size={15} />WhatsApp</a>
          <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.14] px-3.5 py-2 text-[13px] text-neutral-200 hover:bg-white/5"><ExternalLink size={15} />Open the link</a>
        </div>
      </div>
    </div>
  );
}

function CreateForm({ onCreated, onCancel }: { onCreated: (a: Assignment) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      form.append('title', title);
      form.append('instructions', instructions);
      if (dueAt) form.append('dueAt', new Date(dueAt).toISOString());
      for (const f of files) form.append('files', f, f.name);
      onCreated(await json<Assignment>(await authFetch('/api/assignments', { method: 'POST', body: form })));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create the task.'); } finally { setBusy(false); }
  };
  const field = 'w-full rounded-xl border border-white/[0.1] bg-[#111216] px-3 py-2.5 text-[14px] text-[#F2EFE9] placeholder:text-neutral-500 focus:border-[#D97757]/60 focus:outline-none';
  return (
    <section className="space-y-4 rounded-[20px] border border-white/[0.12] bg-[#16171b] p-4 sm:p-5">
      <div>
        <label htmlFor="as-title" className="mb-1.5 block text-[12.5px] font-medium text-neutral-300">Title</label>
        <input id="as-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="For example: S4 Physics, Newton's laws homework" className={field} />
      </div>
      <div>
        <label htmlFor="as-task" className="mb-1.5 block text-[12.5px] font-medium text-neutral-300">What to do</label>
        <textarea id="as-task" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={5} maxLength={8000} placeholder="Write the questions or what people must do. You can also attach files below." className={`${field} resize-y`} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className="mb-1.5 block text-[12.5px] font-medium text-neutral-300">Task files <span className="text-neutral-500">(optional)</span></span>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-white/[0.16] px-3 py-2.5 text-[13px] text-neutral-300 hover:bg-white/[0.03]">
            <Paperclip size={15} />Attach question paper, worksheet or photos
            <input type="file" multiple hidden accept=".pdf,.docx,.doc,.odt,.txt,.md,image/*" onChange={(e) => { const picked = e.target.files ? [...e.target.files] : []; setFiles((cur) => [...cur, ...picked].slice(0, 5)); e.target.value = ''; }} />
          </label>
          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-[12.5px] text-neutral-300">
                  <FileText size={13} /><span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} className="rounded p-0.5 text-neutral-500 hover:text-white"><X size={13} /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <label htmlFor="as-due" className="mb-1.5 block text-[12.5px] font-medium text-neutral-300">Due <span className="text-neutral-500">(optional; late submissions are accepted and flagged)</span></label>
          <input id="as-due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={`${field} [color-scheme:dark]`} />
        </div>
      </div>
      {error && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-300">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-xl px-4 py-2 text-[13.5px] text-neutral-300 hover:bg-white/5">Cancel</button>
        <button type="button" disabled={busy || !title.trim() || (!instructions.trim() && !files.length)} onClick={() => void submit()} className="inline-flex items-center gap-2 rounded-xl bg-[#D97757] px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-[#c96a4c] disabled:opacity-40">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}Create and get the link
        </button>
      </div>
    </section>
  );
}

function Dashboard({ id, onBack, onMarkAll, autoMark = false }: { id: string; onBack: () => void; onMarkAll: (p: PreparedMarking) => void; autoMark?: boolean }) {
  const [a, setA] = useState<Assignment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Submission | null>(null);
  const [preparing, setPreparing] = useState(false);
  const load = useCallback(async () => {
    try { setA(await json<Assignment>(await authFetch(`/api/assignments/${id}`))); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load.'); }
  }, [id]);
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 20_000); return () => window.clearInterval(t); }, [load]);
  const toggle = async () => { if (a) setA(await json<Assignment>(await authFetch(`/api/assignments/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ open: !a.open }) }))); };
  const remove = async (s: Submission) => {
    if (!window.confirm(`Remove ${s.studentName}'s submission?`)) return;
    setA(await json<Assignment>(await authFetch(`/api/assignments/${id}/submissions/${s.id}`, { method: 'DELETE' })));
    setOpen(null);
  };
  const markAll = async () => {
    setPreparing(true); setError(null);
    try { onMarkAll(await json<PreparedMarking>(await authFetch(`/api/assignments/${id}/prepare-marking`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not prepare the marking.'); } finally { setPreparing(false); }
  };
  // Opened from the chat's "Mark all" link: go on to the Mark page once, as soon as the submissions are loaded.
  const [autoStarted, setAutoStarted] = useState(false);
  useEffect(() => {
    if (!autoMark || autoStarted || !a?.submissions.length) return;
    setAutoStarted(true);
    void markAll();
  }, [autoMark, autoStarted, a]); // eslint-disable-line react-hooks/exhaustive-deps
  const fileCount = useMemo(() => a?.submissions.reduce((n, s) => n + s.files.length + (s.text ? 1 : 0), 0) ?? 0, [a]);
  // Review order: oldest hand-in first.
  const order = useMemo(() => [...(a?.submissions ?? [])].reverse().map((s) => s.id), [a]);
  const step = useCallback((by: number) => setOpen((cur) => {
    if (!cur || !a) return cur;
    const i = order.indexOf(cur.id) + by;
    return i >= 0 && i < order.length ? a.submissions.find((s) => s.id === order[i]) ?? cur : cur;
  }), [a, order]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea')) return;
      if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'Escape') setOpen(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, step]);

  if (!a) return <div className="flex flex-1 items-center justify-center py-24 text-neutral-400">{error ?? <Loader2 className="animate-spin" />}</div>;
  return (
    <>
      <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-neutral-400 hover:text-white"><ArrowLeft size={15} />All tasks</button>
      <div className="flex flex-wrap items-start gap-3">
        {/* Full width on a phone (buttons go underneath), sharing the row on wider screens. */}
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <h1 className="break-words font-serif text-[24px] font-medium leading-tight tracking-tight sm:text-[26px]">{a.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-neutral-400">
            <span className="inline-flex items-center gap-1 whitespace-nowrap"><CalendarClock size={13} />{due(a.dueAt)}</span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${a.open ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-neutral-300'}`}>{a.open ? 'Open for submissions' : 'Closed'}</span>
          </p>
        </div>
        <button type="button" onClick={() => void toggle()} className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.14] px-3 py-2 text-[13px] text-neutral-200 hover:bg-white/5">{a.open ? <Lock size={14} /> : <Unlock size={14} />}{a.open ? 'Close submissions' : 'Reopen'}</button>
        <button type="button" disabled={!a.submissions.length || preparing} onClick={() => void markAll()} className="inline-flex items-center gap-1.5 rounded-xl bg-[#D97757] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#c96a4c] disabled:opacity-40">
          {preparing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}Mark all with AI
        </button>
      </div>
      {error && <p className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-300">{error}</p>}

      <div className="mt-4"><ShareBox link={a.link} title={a.title} /></div>

      <section aria-label="Summary" className="mt-4 grid grid-cols-3 gap-2.5">
        {[[a.counts.submitted, 'submitted'], [a.counts.late, 'late'], [fileCount, 'files and typed answers']].map(([v, l]) => (
          <div key={String(l)} className="rounded-[14px] border border-white/[0.08] px-3.5 py-3"><b className="block text-[22px] font-semibold">{v}</b><span className="text-[12px] text-neutral-400">{l}</span></div>
        ))}
      </section>

      {(a.instructions || a.taskFiles.length > 0) && (
        <details className="mt-4 rounded-[14px] border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <summary className="cursor-pointer text-[13px] font-semibold text-neutral-200">The task as people see it</summary>
          {a.instructions && <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-neutral-300">{a.instructions}</p>}
          {a.taskFiles.length > 0 && <div className="mt-3 grid gap-3">{a.taskFiles.map((f) => <FileView key={f.id} assignmentId={a.id} file={f} />)}</div>}
        </details>
      )}

      <div className="mb-2 mt-6 flex items-center gap-2">
        <h2 className="flex flex-1 items-center gap-2 text-[14px] font-semibold text-neutral-200"><Users size={16} />Submissions</h2>
        {a.submissions.length > 0 && <button type="button" onClick={() => setOpen(a.submissions[a.submissions.length - 1])} className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.12] px-3 py-1.5 text-[12.5px] font-medium text-neutral-200 hover:bg-white/[0.06]"><Eye size={14} />Review all hand-ins</button>}
      </div>
      {!a.submissions.length ? (
        <p className="rounded-[14px] border border-dashed border-white/[0.12] px-4 py-10 text-center text-[13.5px] text-neutral-400">Nothing submitted yet. Share the link; each person appears here as soon as they submit.</p>
      ) : (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {a.submissions.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setOpen(s)} className="flex w-full gap-3 rounded-[14px] border border-white/[0.08] bg-[#16171b] p-3 text-left hover:border-white/[0.18]">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#D97757]/20 text-[12.5px] font-bold text-[#F2B39C]">{initials(s.studentName)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-semibold text-white">{s.studentName}</span>
                    {s.late && <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-300">Late</span>}
                  </span>
                  <span className="block truncate text-[11.5px] text-neutral-400">{s.studentId ? `${s.studentId} · ` : ''}{when(s.submittedAt)}{s.resubmissions ? ` · submitted ${s.resubmissions + 1} times` : ''}</span>
                  <span className="mt-2 flex gap-1.5 overflow-hidden">
                    {s.files.slice(0, 4).map((f) => <Thumb key={f.id} assignmentId={a.id} file={f} />)}
                    {s.text && <span className="flex h-16 w-24 shrink-0 overflow-hidden rounded-md border border-black/20 bg-[#FBFAF6] p-1.5 text-[8.5px] leading-tight text-neutral-700">{s.text.slice(0, 160)}</span>}
                    {s.files.length > 4 && <span className="flex h-16 w-10 items-center justify-center text-[12px] text-neutral-400">+{s.files.length - 4}</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        // The submission, full size: every file previewed in place, the typed answer as a page.
        <div className="fixed inset-0 z-[80] flex justify-end bg-black/60" onClick={() => setOpen(null)}>
          <aside role="dialog" aria-label={`${open.studentName}'s submission`} onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-4xl flex-col bg-[#0f1012] shadow-2xl">
            <header className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-3">
              {/* Oldest first, like a pile of papers: previous / next student (or ← and →). */}
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" disabled={order.indexOf(open.id) <= 0} onClick={() => step(-1)} className="grid h-8 w-8 place-items-center rounded-lg text-neutral-300 hover:bg-white/10 disabled:opacity-30" aria-label="Previous student"><ChevronLeft size={17} /></button>
                <span className="w-14 text-center text-[12px] tabular-nums text-neutral-400">{order.indexOf(open.id) + 1} of {order.length}</span>
                <button type="button" disabled={order.indexOf(open.id) >= order.length - 1} onClick={() => step(1)} className="grid h-8 w-8 place-items-center rounded-lg text-neutral-300 hover:bg-white/10 disabled:opacity-30" aria-label="Next student"><ChevronRight size={17} /></button>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#D97757]/20 text-[12.5px] font-bold text-[#F2B39C]">{initials(open.studentName)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-white">{open.studentName}</span>
                <span className="block text-[12px] text-neutral-400">{open.studentId ? `${open.studentId} · ` : ''}{when(open.submittedAt)}{open.late ? ' · late' : ''}</span>
              </span>
              <button type="button" onClick={() => void remove(open)} className="rounded-lg p-2 text-neutral-400 hover:bg-white/10 hover:text-rose-300" aria-label="Remove this submission"><Trash2 size={16} /></button>
              <button type="button" onClick={() => setOpen(null)} className="rounded-lg p-2 text-neutral-400 hover:bg-white/10 hover:text-white" aria-label="Close"><X size={18} /></button>
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {open.text && (
                <figure className="overflow-hidden rounded-xl border border-white/[0.08]">
                  <figcaption className="border-b border-white/[0.06] bg-[#16171b] px-3 py-2 text-[12.5px] text-neutral-300">Typed answer</figcaption>
                  <div className="whitespace-pre-wrap bg-[#FBFAF6] px-6 py-5 font-serif text-[15px] leading-relaxed text-neutral-900">{open.text}</div>
                </figure>
              )}
              {open.files.map((f) => <FileView key={f.id} assignmentId={a.id} file={f} />)}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

export default function AssignmentsPage({ onClose, onMarkAll, initialId, autoMark = false }: { onClose: () => void; onMarkAll: (p: PreparedMarking) => void; initialId?: string | null; autoMark?: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [view, setView] = useState<{ kind: 'list' } | { kind: 'new' } | { kind: 'one'; id: string }>(initialId ? { kind: 'one', id: initialId } : { kind: 'list' });
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [copied, setCopied] = useState<string | null>(null);
  const loadRows = useCallback(async () => {
    try { setRows((await json<{ assignments: Row[] }>(await authFetch('/api/assignments'))).assignments); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load.'); }
  }, []);
  useEffect(() => { if (view.kind === 'list') void loadRows(); }, [view, loadRows]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && view.kind === 'list') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose, view.kind]);

  const shown = useMemo(() => (rows ?? []).filter((r) => (filter === 'all' || (filter === 'open') === r.open) && (!query.trim() || r.title.toLowerCase().includes(query.trim().toLowerCase()))), [rows, filter, query]);
  const totals = useMemo(() => {
    const list = rows ?? [];
    const week = Date.now() - 7 * 86400e3;
    return {
      tasks: list.length, open: list.filter((r) => r.open).length,
      handIns: list.reduce((n, r) => n + r.submitted, 0), late: list.reduce((n, r) => n + (r.late ?? 0), 0),
      dueSoon: list.filter((r) => r.open && r.dueAt && Date.parse(r.dueAt) > Date.now() && Date.parse(r.dueAt) - Date.now() < 3 * 86400e3).length,
      recent: list.filter((r) => r.lastSubmissionAt && Date.parse(r.lastSubmissionAt) > week).length,
    };
  }, [rows]);
  const copy = async (r: Row) => { try { await navigator.clipboard.writeText(r.link); setCopied(r.id); window.setTimeout(() => setCopied(null), 1600); } catch { /* clipboard may be blocked */ } };

  const newBtn = <button type="button" onClick={() => setView({ kind: 'new' })} className={primaryBtn}><Plus size={16} />New task</button>;
  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-[#0f1012]">
      {view.kind === 'one' ? (
        <div className="min-h-full bg-[#0f1012] text-[#ececee]">
          <div className="px-4 pt-3 sm:px-6"><button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-neutral-400 hover:bg-white/[0.05] hover:text-white"><ArrowLeft size={15} />Back to chat</button></div>
          <main className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6">
            <Dashboard id={view.id} onBack={() => setView({ kind: 'list' })} onMarkAll={onMarkAll} autoMark={autoMark && view.id === initialId} />
          </main>
        </div>
      ) : view.kind === 'new' ? (
        <PageShell icon={<ClipboardList size={20} />} title="New task" subtitle="Write what to do or attach the worksheet. You get one link and a QR code; people submit from any phone, no account needed." onBack={() => setView({ kind: 'list' })} backLabel="All tasks">
          <CreateForm onCancel={() => setView({ kind: 'list' })} onCreated={(a) => setView({ kind: 'one', id: a.id })} />
        </PageShell>
      ) : (
        <PageShell icon={<ClipboardList size={20} />} title="Tasks" onBack={onClose}
          subtitle="Set work, share one link or QR code, and collect answers from any phone: photos, PDF, Word or typed. When you are ready, the AI marks the whole class."
          actions={newBtn}>
          {error ? <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-300">{error}</p>
            : !rows ? <div className="flex justify-center py-16 text-neutral-400"><Loader2 className="animate-spin" /></div>
              : !rows.length ? (
                <Empty icon={<ClipboardList size={22} />} title="No tasks yet" text="Create a task, share the link in your class group, and watch the hand-ins arrive here." action={newBtn} />
              ) : (
                <>
                  <StatRow>
                    <Stat label="Tasks" value={totals.tasks} hint={`${totals.open} open for hand-ins`} />
                    <Stat label="Hand-ins" value={totals.handIns} hint={totals.recent ? `${totals.recent} task${totals.recent === 1 ? '' : 's'} active this week` : 'none this week'} />
                    <Stat label="Late" value={totals.late} tone={totals.late ? 'warn' : undefined} hint="after the due time" />
                    <Stat label="Due soon" value={totals.dueSoon} hint="in the next 3 days" />
                  </StatRow>
                  <Toolbar<'all' | 'open' | 'closed'> query={query} onQuery={setQuery} placeholder="Search tasks" filter={filter} onFilter={setFilter}
                    filters={[{ id: 'all', label: 'All', count: rows.length }, { id: 'open', label: 'Open', count: totals.open }, { id: 'closed', label: 'Closed', count: rows.length - totals.open }]} />
                  {!shown.length ? <p className="py-10 text-center text-[13px] text-neutral-500">No task matches.</p> : (
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {shown.map((r) => {
                        const overdue = r.open && r.dueAt && Date.parse(r.dueAt) < Date.now();
                        return (
                          <li key={r.id}>
                            <Card onClick={() => setView({ kind: 'one', id: r.id })} className="flex h-full flex-col p-4">
                              <div className="flex items-start gap-2">
                                <span className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-white [overflow-wrap:anywhere]">{r.title}</span>
                                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.open ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-neutral-300'}`}>{r.open ? 'Open' : 'Closed'}</span>
                              </div>
                              <p className={`mt-1.5 flex items-center gap-1 text-[12px] ${overdue ? 'text-amber-300' : 'text-neutral-400'}`}><CalendarClock size={12} />{r.dueAt ? `${overdue ? 'Was due' : 'Due'} ${relative(r.dueAt)}` : 'No due date'}</p>
                              <div className="mt-4 flex items-end gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="text-[24px] font-semibold leading-none tabular-nums text-white">{r.submitted}</p>
                                  <p className="mt-1 truncate text-[12px] text-neutral-500">hand-in{r.submitted === 1 ? '' : 's'}{r.late ? ` · ${r.late} late` : ''}{r.lastSubmissionAt ? ` · last ${when(r.lastSubmissionAt)}` : ''}</p>
                                </div>
                                <button type="button" onClick={(e) => { e.stopPropagation(); void copy(r); }} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/[0.1] px-2.5 py-1.5 text-[12px] text-neutral-300 hover:bg-white/[0.06]">{copied === r.id ? <Check size={13} /> : <Link2 size={13} />}{copied === r.id ? 'Copied' : 'Copy link'}</button>
                              </div>
                            </Card>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
        </PageShell>
      )}
    </div>
  );
}
