import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Camera, CheckCircle2, Download, FileText, Image as ImageIcon, Loader2, Lock, Paperclip, Send, X } from 'lucide-react';
import { getApiUrl } from '../utils/authFetch';
import logoUrl from '../assets/bwenge-logo.svg';

/**
 * The page a person opens from a shared task link (/a/<token>): the task, then the submission. No account: a name
 * (and an ID if they have one), the answer as photos, PDF, Word or typed text, and a receipt.
 * Submitting again before the owner closes it replaces the earlier submission.
 */

interface Task { title: string; instructions: string; dueAt: string | null; open: boolean; taskFiles: Array<{ index: number; name: string; mime: string; size: number }> }
const MAX_FILES = 10;
const MAX_MB = 25;
const ACCEPT = '.pdf,.doc,.docx,.odt,.rtf,.txt,.md,image/*,.heic,.heif';
const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

export default function AssignmentSubmitPage({ token }: { token: string }) {
  const api = (p = '') => getApiUrl(`/api/assignments/public/${encodeURIComponent(token)}${p}`);
  const [task, setTask] = useState<Task | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'sending' } | { kind: 'error'; message: string } | { kind: 'done'; receiptId: string; submittedAt: string; late: boolean; replaced: boolean }>({ kind: 'idle' });

  useEffect(() => {
    document.title = 'Submit · Bwenge';
    fetch(api()).then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || 'This link is not valid.'); setTask(b); })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'This link is not valid.'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Nothing is remembered on the device: people often share phones, and a remembered name or number would
  // make the next person's submission replace the previous one's.

  const previews = useMemo(() => files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);

  const add = (list: FileList | null) => {
    if (!list) return;
    const fresh = [...list];
    const big = fresh.find((f) => f.size > MAX_MB * 1048576);
    if (big) { setState({ kind: 'error', message: `${big.name} is larger than ${MAX_MB} MB.` }); return; }
    setFiles((cur) => [...cur, ...fresh].slice(0, MAX_FILES));
    if (state.kind === 'error') setState({ kind: 'idle' });
  };

  const submit = async () => {
    setState({ kind: 'sending' });
    try {
      const form = new FormData();
      form.append('studentName', name.trim());
      if (studentId.trim()) form.append('studentId', studentId.trim());
      if (text.trim()) form.append('text', text.trim());
      for (const f of files) form.append('files', f, f.name);
      const res = await fetch(api('/submit'), { method: 'POST', body: form });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || 'Could not submit. Try again.');
      setState({ kind: 'done', ...b });
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : 'Could not submit. Try again.' });
    }
  };

  const shell = (body: React.ReactNode) => (
    <div className="min-h-dvh bg-[#F5F3EE] text-[#1F1E1D]">
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
              <li key={f.index}>
                <a href={api(`/files/${f.index}`)} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-neutral-200 px-3 py-2.5 hover:bg-neutral-50">
                  <FileText size={18} className="text-[#D97757]" /><span className="min-w-0 flex-1 truncate text-[14px] font-medium">{f.name}</span>
                  <span className="text-[12px] text-neutral-500">{size(f.size)}</span><Download size={16} className="text-neutral-400" />
                </a>
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

          <div className="grid grid-cols-2 gap-2">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#D97757] px-3 py-3.5 text-[14.5px] font-semibold text-white active:bg-[#c96a4c]">
              <Camera size={18} />Take photos
              <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
            </label>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-neutral-300 px-3 py-3.5 text-[14.5px] font-medium hover:bg-neutral-50">
              <Paperclip size={18} />Choose files
              <input type="file" accept={ACCEPT} multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
            </label>
          </div>
          <p className="-mt-2 text-[12px] text-neutral-500">Photos of your pages (one per page), PDF, Word or text. Up to {MAX_FILES} files, {MAX_MB} MB each.</p>

          {files.length > 0 && (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="relative overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
                  {previews[i] ? <img src={previews[i]!} alt={f.name} className="aspect-[3/4] w-full object-cover" />
                    : <span className="flex aspect-[3/4] flex-col items-center justify-center gap-1 p-2 text-center text-[11px] text-neutral-600">{/\.(png|jpe?g|webp|heic|heif)$/i.test(f.name) ? <ImageIcon size={20} /> : <FileText size={20} className="text-[#D97757]" />}<span className="line-clamp-2 break-all">{f.name}</span></span>}
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 text-[10.5px] font-semibold text-white">{i + 1}</span>
                  <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-neutral-700 shadow"><X size={13} /></button>
                </li>
              ))}
            </ul>
          )}

          <label className="block"><span className="mb-1 block text-[13px] font-medium text-neutral-700">Or type your answer <span className="font-normal text-neutral-400">(optional)</span></span>
            <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 20000))} rows={5} placeholder="Write your answer here…" className={`${field} resize-y`} /></label>

          {state.kind === 'error' && <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13.5px] text-rose-700">{state.message}</p>}
          <button type="button" disabled={!ready} onClick={() => void submit()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1F1E1D] px-4 py-3.5 text-[15px] font-semibold text-white disabled:opacity-40">
            {state.kind === 'sending' ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}{state.kind === 'sending' ? 'Submitting…' : 'Submit'}
          </button>
          <p className="text-center text-[12px] text-neutral-500">Only the person who shared the task sees what you submit.</p>
        </section>
      )}
    </>,
  );
}
