import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarClock, Camera, CheckCircle2, Download, Eye, FileText, Loader2, Lock, Paperclip, Send, Trash2, X } from 'lucide-react';
import { FileThumb, PreviewDialog, type PreviewSource } from '../components/FilePreview';
import VoiceRecorder from '../components/VoiceRecorder';
import { getApiUrl } from '../utils/authFetch';
import logoUrl from '../assets/bwenge-logo.svg';

/**
 * The page a person opens from a shared task link (/a/<token>): the task, then the submission. No account: a name
 * (and an ID if they have one), the answer as photos, PDF, Word or typed text, and a receipt. Every attached file
 * can be opened full screen before sending and the pages put in order; the upload shows its progress.
 * Submitting again before the owner closes it replaces the earlier submission.
 */

interface Task { title: string; instructions: string; dueAt: string | null; open: boolean; taskFiles: Array<{ index: number; name: string; mime: string; size: number }> }
const MAX_FILES = 10;
const MAX_MB = 25;
const ACCEPT = '.pdf,.doc,.docx,.odt,.rtf,.txt,.md,image/*,.heic,.heif,audio/*,.m4a,.mp3,.wav,.ogg,.webm';
interface Item { id: string; file: File; src: PreviewSource }
const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

export default function AssignmentSubmitPage({ token }: { token: string }) {
  const api = (p = '') => getApiUrl(`/api/assignments/public/${encodeURIComponent(token)}${p}`);
  const [task, setTask] = useState<Task | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Item[]>([]);
  const [open, setOpen] = useState<{ kind: 'mine'; index: number } | { kind: 'task'; src: PreviewSource } | null>(null);
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'sending'; percent: number } | { kind: 'error'; message: string } | { kind: 'done'; receiptId: string; submittedAt: string; late: boolean; replaced: boolean; files?: number }>({ kind: 'idle' });

  useEffect(() => {
    document.title = 'Submit · Bwenge';
    fetch(api()).then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || 'This link is not valid.'); setTask(b); })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'This link is not valid.'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Nothing is remembered on the device: people often share phones, and a remembered name or number would
  // make the next person's submission replace the previous one's.

  const add = (list: FileList | null) => {
    if (!list) return;
    const fresh = [...list];
    const big = fresh.find((f) => f.size > MAX_MB * 1048576);
    if (big) { setState({ kind: 'error', message: `${big.name} is larger than ${MAX_MB} MB.` }); return; }
    const key = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
    const have = new Set(files.map((x) => key(x.file)));
    const added = fresh.filter((f) => !have.has(key(f)));
    const room = MAX_FILES - files.length;
    setFiles((cur) => [...cur, ...added.slice(0, Math.max(0, room)).map((f) => ({ id: `${key(f)}|${Math.random()}`, file: f, src: { name: f.name, type: f.type, file: f } }))]);
    if (added.length > room) setState({ kind: 'error', message: `Up to ${MAX_FILES} files. ${added.length - Math.max(0, room)} not added.` });
    else if (state.kind === 'error') setState({ kind: 'idle' });
  };
  const move = useCallback((i: number, by: number) => setFiles((cur) => {
    const j = i + by;
    if (j < 0 || j >= cur.length) return cur;
    const next = [...cur];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  }), []);
  const remove = (i: number) => { setFiles((cur) => cur.filter((_, j) => j !== i)); setOpen(null); };

  const submit = async () => {
    setState({ kind: 'sending', percent: 0 });
    try {
      const form = new FormData();
      form.append('studentName', name.trim());
      if (studentId.trim()) form.append('studentId', studentId.trim());
      if (text.trim()) form.append('text', text.trim());
      for (const f of files) form.append('files', f.file, f.file.name);
      // XMLHttpRequest rather than fetch: it reports upload progress, which matters on a slow phone connection.
      const b = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', api('/submit'));
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setState({ kind: 'sending', percent: Math.min(99, Math.round((e.loaded / e.total) * 100)) }); };
        xhr.onload = () => {
          let body: any = {};
          try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
          if (xhr.status >= 200 && xhr.status < 300) resolve(body); else reject(new Error(body.error || 'Could not submit. Try again.'));
        };
        xhr.onerror = () => reject(new Error('No connection. Check your internet and try again; nothing was lost.'));
        xhr.send(form);
      });
      setState({ kind: 'done', ...b });
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : 'Could not submit. Try again.' });
    }
  };
  const totalBytes = files.reduce((a, f) => a + f.file.size, 0);

  const shell = (body: React.ReactNode) => (
    <div className="scroll-area h-dvh overflow-y-auto overscroll-contain bg-[#F5F3EE] text-[#1F1E1D]">
      <header className="mx-auto flex max-w-xl items-center gap-2 px-4 pt-5">
        <img src={logoUrl} alt="" className="h-7 w-7 rounded-lg" />
        <span className="text-[14px] font-semibold">Bwenge</span>
        <span className="text-[12.5px] text-neutral-500">· Submit</span>
      </header>
      <main className="mx-auto max-w-xl px-4 pb-16 pt-4">{body}</main>
    </div>
  );

  if (loadError) return shell(<div className="rounded-2xl bg-white p-6 text-center shadow-sm"><Lock className="mx-auto text-neutral-400" /><p className="mt-3 font-semibold">This link does not work</p><p className="mt-1 text-[14px] text-neutral-500">{loadError} Ask the person who shared it for the link again.</p></div>);
  if (!task) return shell(<div className="flex justify-center py-24 text-neutral-400"><Loader2 className="animate-spin" /></div>);

  if (state.kind === 'done') {
    return shell(
      <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
        <CheckCircle2 size={44} className="mx-auto text-emerald-600" />
        <h1 className="mt-3 text-[20px] font-semibold">Submitted</h1>
        <p className="mt-1 text-[14px] text-neutral-600">{task.title}</p>
        <dl className="mx-auto mt-5 grid max-w-xs grid-cols-2 gap-y-2 text-left text-[13.5px]">
          <dt className="text-neutral-500">Receipt</dt><dd className="font-mono font-semibold">{state.receiptId}</dd>
          <dt className="text-neutral-500">Name</dt><dd className="truncate">{name}</dd>
          <dt className="text-neutral-500">Sent</dt><dd>{state.files ? `${state.files} file${state.files === 1 ? '' : 's'}` : ''}{state.files && text.trim() ? ' and ' : ''}{text.trim() ? 'typed answer' : ''}</dd>
          <dt className="text-neutral-500">Time</dt><dd>{new Date(state.submittedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</dd>
        </dl>
        {state.late && <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-[13px] text-amber-800">This was after the due time. The person who shared the task will see it was late.</p>}
        <p className="mt-4 text-[13px] text-neutral-500">{state.replaced ? 'This replaces your earlier submission. ' : ''}You can submit again while the task is open; your latest one counts.</p>
        <button type="button" onClick={() => { setFiles([]); setText(''); setName(''); setStudentId(''); setState({ kind: 'idle' }); }} className="mt-5 rounded-xl border border-neutral-300 px-4 py-2 text-[14px] font-medium hover:bg-neutral-50">Submit again</button>
      </div>,
    );
  }

  const ready = name.trim().length > 0 && (files.length > 0 || text.trim().length > 0) && task.open && state.kind !== 'sending';
  const field = 'w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-[15px] placeholder:text-neutral-400 focus:border-[#D97757] focus:outline-none focus:ring-2 focus:ring-[#D97757]/20';
  return shell(
    <>
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h1 className="text-[21px] font-semibold leading-snug">{task.title}</h1>
        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-neutral-500">
          <span className="inline-flex items-center gap-1"><CalendarClock size={14} />{task.dueAt ? `Due ${new Date(task.dueAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'No due date'}</span>
          {!task.open && <span className="rounded-full bg-neutral-200 px-2 py-0.5 font-semibold text-neutral-700">Closed</span>}
        </p>
        {task.instructions && <p className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-800">{task.instructions}</p>}
        {task.taskFiles.length > 0 && (
          <ul className="mt-4 space-y-2">
            {task.taskFiles.map((f) => (
              <li key={f.index} className="flex items-center gap-1 rounded-xl border border-neutral-200 pr-1 hover:bg-neutral-50">
                <button type="button" onClick={() => setOpen({ kind: 'task', src: { name: f.name, type: f.mime, url: api(`/files/${f.index}`) } })} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left">
                  <FileText size={18} className="shrink-0 text-[#D97757]" /><span className="min-w-0 flex-1 truncate text-[14px] font-medium">{f.name}</span>
                  <span className="shrink-0 text-[12px] text-neutral-500">{size(f.size)}</span><Eye size={16} className="shrink-0 text-neutral-400" />
                </button>
                <a href={api(`/files/${f.index}`)} download={f.name} aria-label={`Download ${f.name}`} className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"><Download size={16} /></a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!task.open ? (
        <p className="mt-4 rounded-2xl bg-white p-5 text-center text-[14px] text-neutral-600 shadow-sm"><Lock size={18} className="mx-auto mb-2 text-neutral-400" />Submissions are closed. Ask the person who shared the task if you still need to submit.</p>
      ) : (
        <section className="mt-4 space-y-4 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-[16px] font-semibold">Your answer</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="mb-1 block text-[13px] font-medium text-neutral-700">Your full name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" placeholder="e.g. Uwase Aline" className={field} /></label>
            <label className="block"><span className="mb-1 block text-[13px] font-medium text-neutral-700">ID or number <span className="font-normal text-neutral-400">(if you have one)</span></span>
              <input value={studentId} onChange={(e) => setStudentId(e.target.value)} maxLength={40} placeholder="e.g. S4B-001" className={field} /></label>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#D97757] px-3 py-3.5 text-[14.5px] font-semibold text-white active:bg-[#c96a4c]">
              <Camera size={18} />Take photos
              <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
            </label>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-neutral-300 px-3 py-3.5 text-[14.5px] font-medium hover:bg-neutral-50">
              <Paperclip size={18} />Choose files
              <input type="file" accept={ACCEPT} multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
            </label>
            <VoiceRecorder className="col-span-2 sm:col-span-1" onRecorded={(f) => { const dt = new DataTransfer(); dt.items.add(f); add(dt.files); }} onError={(message) => setState({ kind: 'error', message })} />
          </div>
          <p className="-mt-2 text-[12px] text-neutral-500">Photos of your pages (one per page), PDF, Word, text or a voice recording. Up to {MAX_FILES} files, {MAX_MB} MB each.</p>

          {files.length > 0 && (
            <div>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {files.map((f, i) => (
                  <li key={f.id} className="relative overflow-hidden rounded-xl border border-neutral-200">
                    <button type="button" onClick={() => setOpen({ kind: 'mine', index: i })} aria-label={`Preview ${f.file.name}`} className="block w-full">
                      <FileThumb src={f.src} className="aspect-[3/4] w-full" />
                    </button>
                    <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 text-[10.5px] font-semibold text-white">{i + 1}</span>
                    <button type="button" aria-label={`Remove ${f.file.name}`} onClick={() => remove(i)} className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-neutral-700 shadow"><X size={13} /></button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-neutral-500">{files.length} file{files.length === 1 ? '' : 's'} · {size(totalBytes)}. Tap one to check it and put the pages in order.</p>
            </div>
          )}

          <label className="block"><span className="mb-1 block text-[13px] font-medium text-neutral-700">Or type your answer <span className="font-normal text-neutral-400">(optional)</span></span>
            <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 20000))} rows={5} placeholder="Write your answer here…" className={`${field} resize-y`} /></label>

          {state.kind === 'error' && <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13.5px] text-rose-700">{state.message}</p>}
          <button type="button" disabled={!ready} onClick={() => void submit()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1F1E1D] px-4 py-3.5 text-[15px] font-semibold text-white disabled:opacity-40">
            {state.kind === 'sending' ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}{state.kind === 'sending' ? (state.percent < 99 && files.length ? `Sending… ${state.percent}%` : 'Saving…') : 'Submit'}
          </button>
          {state.kind === 'sending' && files.length > 0 && <div className="-mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200" role="progressbar" aria-valuenow={state.percent} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-[#D97757] transition-[width]" style={{ width: `${state.percent}%` }} /></div>}
          <p className="text-center text-[12px] text-neutral-500">Only the person who shared the task sees what you submit.</p>
        </section>
      )}
      {open?.kind === 'task' && <PreviewDialog src={open.src} onClose={() => setOpen(null)} />}
      {open?.kind === 'mine' && files[open.index] && (
        <PreviewDialog src={files[open.index].src} onClose={() => setOpen(null)} footer={
          <div className="flex items-center gap-2 text-white">
            <button type="button" disabled={open.index === 0} onClick={() => { move(open.index, -1); setOpen({ kind: 'mine', index: open.index - 1 }); }} className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-2 text-[13px] disabled:opacity-30"><ArrowLeft size={15} />Earlier</button>
            <span className="flex-1 text-center text-[13px] text-white/80">File {open.index + 1} of {files.length}</span>
            <button type="button" disabled={open.index === files.length - 1} onClick={() => { move(open.index, 1); setOpen({ kind: 'mine', index: open.index + 1 }); }} className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-2 text-[13px] disabled:opacity-30">Later<ArrowRight size={15} /></button>
            <button type="button" onClick={() => remove(open.index)} aria-label="Remove this file" className="rounded-lg bg-rose-500/80 p-2"><Trash2 size={16} /></button>
          </div>
        } />
      )}
    </>,
  );
}
