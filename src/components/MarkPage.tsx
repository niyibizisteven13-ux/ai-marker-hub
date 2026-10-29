import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Camera, Check, ChevronDown, FileText, FolderArchive, Image as ImageIcon, Loader2, Paperclip, PenLine, X } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import type { ChatAttachment } from '../types';

/**
 * Mark: everything needed to mark a class in one place. Files upload as soon as they are added (like attaching
 * in Claude) and each gets a role the teacher can change: marking scheme, question paper or student scripts.
 * A quick check (no AI) shows pages, handwriting and photos to retake. "Mark" sends it all to a new chat, where
 * the marking runs live; the roles are sent with it so the server never guesses which file is which.
 */

export type MarkRole = 'scheme' | 'paper' | 'scripts';
export interface MarkRequest {
  text: string;
  attachments: ChatAttachment[];
  marking: { roles: Record<string, MarkRole>; instructions?: string; credit: 'partial' | 'strict'; corrections: boolean; feedback: 'brief' | 'detailed' };
}
interface Check { pages: number; typedPages: number; students?: number; kind: string; looksLike?: MarkRole; issues: Array<{ page?: number; entry?: string; issue: 'blurry' | 'dark' | 'small' | 'unreadable' }> }
interface Item { key: string; file: File; role: MarkRole; chosen?: boolean; status: 'uploading' | 'ready' | 'failed'; fileId?: string; error?: string; check?: Check; preview?: string }

const ROLE_LABEL: Record<MarkRole, string> = { scheme: 'Marking scheme', paper: 'Question paper', scripts: 'Student scripts' };
const ROLE_TONE: Record<MarkRole, string> = {
  scheme: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/25',
  paper: 'bg-sky-500/15 text-sky-300 ring-sky-500/25',
  scripts: 'bg-[#D97757]/15 text-[#F2B39C] ring-[#D97757]/30',
};
const ISSUE_TEXT: Record<string, string> = { blurry: 'blurry', dark: 'too dark', small: 'too small', unreadable: 'could not be opened' };
const SUGGESTIONS = ['Give half marks when the method is right.', 'Do not take marks off for spelling.', 'Accept equivalent units and correctly rounded answers.', 'Accept any correct method, even if it is not in the scheme.'];

/** First guess from the name; the teacher can change it. */
function guessRole(name: string): MarkRole {
  if (/(mark(?:ing)?[\s_-]*(scheme|guide|key)|rubric|memo(?:randum)?|answer[\s_-]*key|solutions?|bar[eè]me|corrig[eé])/i.test(name)) return 'scheme';
  if (/(question[\s_-]*paper|questions|exam[\s_-]*paper|[eé]preuve)/i.test(name)) return 'paper';
  return 'scripts';
}

async function upload(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file, file.name);
  const res = await authFetch('/api/files/upload', { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.fileId) throw new Error(data.error || `Could not upload ${file.name}.`);
  return data.fileId;
}

const kindIcon = (f: File) => (/\.zip$/i.test(f.name) ? FolderArchive : f.type.startsWith('image/') ? ImageIcon : FileText);

export default function MarkPage({ onClose, onMark, onScan }: { onClose: () => void; onMark: (req: MarkRequest) => void; onScan?: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [instructions, setInstructions] = useState('');
  const [credit, setCredit] = useState<'partial' | 'strict'>('partial');
  const [corrections, setCorrections] = useState(true);
  const [feedback, setFeedback] = useState<'brief' | 'detailed'>('brief');
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  useEffect(() => () => { for (const i of items) if (i.preview) URL.revokeObjectURL(i.preview); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (key: string, p: Partial<Item>) => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const add = useCallback((files: FileList | File[]) => {
    const fresh: Item[] = [...files].map((file) => ({
      key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`, file, role: guessRole(file.name), status: 'uploading',
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    }));
    setItems((cur) => [...cur, ...fresh]);
    for (const it of fresh) {
      upload(it.file)
        .then(async (fileId) => {
          patch(it.key, { status: 'ready', fileId });
          const res = await authFetch('/api/exams/precheck', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileIds: [fileId] }) });
          const body = await res.json().catch(() => null);
          const check = body?.files?.[0];
          // What the file says beats its name ("Maths S4.pdf" that reads "Marking scheme"), unless the teacher chose.
          if (check) setItems((cur) => cur.map((x) => (x.key === it.key ? { ...x, check, role: !x.chosen && check.looksLike ? check.looksLike : x.role } : x)));
        })
        .catch((e) => patch(it.key, { status: 'failed', error: e instanceof Error ? e.message : 'Upload failed.' }));
    }
  }, []);

  const scripts = items.filter((i) => i.role === 'scripts');
  const scheme = items.find((i) => i.role === 'scheme');
  const paper = items.find((i) => i.role === 'paper');
  const summary = useMemo(() => {
    const ok = scripts.filter((i) => i.check);
    const students = scripts.reduce((n, i) => n + (i.check?.students ?? 1), 0);
    const pages = ok.reduce((n, i) => n + (i.check?.pages ?? 0), 0);
    const handwritten = ok.reduce((n, i) => n + Math.max(0, (i.check?.pages ?? 0) - (i.check?.typedPages ?? 0)), 0);
    const retake = items.reduce((n, i) => n + (i.check?.issues.filter((x) => x.issue !== 'small').length ?? 0), 0);
    return { students, pages, handwritten, retake, checking: scripts.length - ok.length };
  }, [items, scripts]);
  const uploading = items.some((i) => i.status === 'uploading');
  const failed = items.filter((i) => i.status === 'failed');
  const canMark = scripts.length > 0 && !uploading && scripts.every((i) => i.status === 'ready');

  const submit = () => {
    const ready = items.filter((i) => i.status === 'ready' && i.fileId);
    const roles = Object.fromEntries(ready.map((i) => [i.file.name, i.role]));
    const n = summary.students;
    const text = [
      `Mark ${n === 1 ? 'this script' : `these ${n} scripts`}${scheme ? ' with the marking scheme' : paper ? '. There is no marking scheme: write one from the question paper first' : '. There is no marking scheme: write one from the questions first'}.`,
      instructions.trim() ? `My instructions: ${instructions.trim()}` : '',
    ].filter(Boolean).join('\n\n');
    onMark({
      text,
      attachments: ready.map((i) => ({ id: i.key, name: i.file.name, serverId: i.fileId, storedFileId: i.fileId, mimeType: i.file.type || 'application/octet-stream', size: `${Math.max(1, Math.round(i.file.size / 1024))} KB`, fileType: i.file.type.startsWith('image/') ? 'image' : /\.pdf$/i.test(i.file.name) ? 'pdf' : 'document' })),
      marking: { roles, instructions: instructions.trim() || undefined, credit, corrections, feedback },
    });
  };

  const toggleSuggestion = (s: string) => setInstructions((cur) => (cur.includes(s) ? cur.replace(s, '').replace(/\s{2,}/g, ' ').trim() : `${cur.trim()} ${s}`.trim()));

  return (
    <div className="fixed inset-0 z-[70] flex flex-col overflow-y-auto bg-[#262624] text-[#F2EFE9]"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) add(e.dataTransfer.files); }}>
      <header className="flex items-center gap-3 px-4 py-3 sm:px-6">
        <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-neutral-400 hover:bg-white/5 hover:text-white"><ArrowLeft size={16} />Back to chat</button>
      </header>
      <main className="mx-auto flex w-full max-w-[840px] flex-1 flex-col px-4 pb-10 sm:px-6">
        <h1 className="mt-4 text-center font-serif text-[28px] font-medium tracking-tight sm:text-[32px]">What are we <span className="text-[#D97757]">marking</span> today?</h1>
        <p className="mx-auto mt-2 max-w-xl text-center text-[14px] text-neutral-400">Add the students' scripts and your marking scheme. Bwenge reads the handwriting, marks every question in red pen, and shows you each step in the chat.</p>

        <section className={`mt-7 overflow-hidden rounded-[20px] border bg-[#30302E] shadow-[0_12px_40px_rgba(0,0,0,.25)] transition-colors ${dragging ? 'border-[#D97757]/70' : 'border-white/[0.12]'}`}>
          {items.length === 0 ? (
            <button type="button" onClick={() => input.current?.click()} className="flex w-full flex-col items-center gap-2 px-6 py-12 text-center hover:bg-white/[0.02]">
              <span className="rounded-2xl bg-white/[0.05] p-3 text-neutral-300"><Paperclip size={22} /></span>
              <span className="text-[15px] font-semibold">Drop files here or choose them</span>
              <span className="text-[13px] text-neutral-400">Student scripts (PDF, photos, Word or a ZIP of the class), the marking scheme, and the question paper if you have it</span>
            </button>
          ) : (
            <ul className="grid gap-2.5 p-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((it) => {
                const Icon = kindIcon(it.file);
                const issues = it.check?.issues.filter((x) => x.issue !== 'small') ?? [];
                return (
                  <li key={it.key} className="relative flex gap-3 rounded-[14px] border border-white/[0.08] bg-[#2B2A28] p-2.5">
                    <span className="flex h-14 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-black/20 bg-[#FBFAF6] text-neutral-500">
                      {it.preview ? <img src={it.preview} alt="" className="h-full w-full object-cover" /> : <Icon size={18} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate pr-5 text-[12.5px] font-semibold">{it.file.name}</span>
                      <span className="block text-[11.5px] text-neutral-400">
                        {it.status === 'uploading' ? <span className="inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" />Uploading…</span>
                          : it.status === 'failed' ? <span className="text-rose-300">{it.error}</span>
                            : !it.check ? <span className="inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" />Checking…</span>
                              : <>{it.check.students && it.check.students > 1 ? `${it.check.students} students · ` : ''}{it.check.pages} page{it.check.pages === 1 ? '' : 's'}{it.check.pages ? ` · ${it.check.typedPages === it.check.pages ? 'typed' : it.check.typedPages ? 'mixed' : 'handwritten or scanned'}` : ''}</>}
                      </span>
                      <span className="relative mt-1 inline-block">
                        <button type="button" onClick={() => setMenu(menu === it.key ? null : it.key)} aria-haspopup="menu" aria-expanded={menu === it.key}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${ROLE_TONE[it.role]}`}>
                          {it.role === 'scheme' && <Check size={11} />}{ROLE_LABEL[it.role]}<ChevronDown size={11} />
                        </button>
                        {menu === it.key && (
                          <span role="menu" className="absolute left-0 top-full z-10 mt-1 w-44 overflow-hidden rounded-xl border border-white/10 bg-[#20201F] py-1 shadow-xl">
                            {(Object.keys(ROLE_LABEL) as MarkRole[]).map((r) => (
                              <button key={r} type="button" role="menuitem" onClick={() => { patch(it.key, { role: r, chosen: true }); setMenu(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-neutral-200 hover:bg-white/[0.06]">
                                <span className="w-3">{it.role === r ? <Check size={12} /> : null}</span>{ROLE_LABEL[r]}
                              </button>
                            ))}
                          </span>
                        )}
                      </span>
                      {issues.length > 0 && <span className="mt-1 flex items-start gap-1 text-[11px] text-amber-300"><AlertTriangle size={11} className="mt-0.5 shrink-0" />{issues.slice(0, 2).map((x) => `${x.entry ? `${x.entry.split('/').pop()} ` : x.page ? `page ${x.page} ` : ''}${ISSUE_TEXT[x.issue]}`).join(', ')}{issues.length > 2 ? ` +${issues.length - 2}` : ''}: retake</span>}
                    </span>
                    <button type="button" aria-label={`Remove ${it.file.name}`} onClick={() => setItems((cur) => cur.filter((x) => x.key !== it.key))} className="absolute right-2 top-2 rounded p-0.5 text-neutral-500 hover:bg-white/10 hover:text-white"><X size={13} /></button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="border-t border-white/[0.08] px-4 py-3">
            <label htmlFor="mark-instructions" className="mb-1.5 block text-[12px] text-neutral-400">Marking instructions <span className="text-neutral-500">(optional, followed on every script)</span></label>
            <textarea id="mark-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value.slice(0, 2000))} rows={2}
              placeholder="For example: accept g = 9.8 or 10 m/s². Half marks when the method is right."
              className="w-full resize-y rounded-xl border border-white/[0.08] bg-transparent px-3 py-2.5 text-[13.5px] text-[#F2EFE9] placeholder:text-neutral-500 focus:border-[#D97757]/60 focus:outline-none" />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => toggleSuggestion(s)} className={`rounded-full border px-2.5 py-1 text-[12px] ${instructions.includes(s) ? 'border-[#D97757]/50 bg-[#D97757]/15 text-[#F2B39C]' : 'border-white/[0.12] text-neutral-400 hover:text-neutral-200'}`}>{s.replace(/\.$/, '')}</button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.08] px-3.5 py-2.5">
            <button type="button" onClick={() => input.current?.click()} className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/[0.12] px-3 py-1.5 text-[12.5px] text-neutral-300 hover:bg-white/5"><Paperclip size={14} />Add files</button>
            {onScan && <button type="button" onClick={onScan} className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/[0.12] px-3 py-1.5 text-[12.5px] text-neutral-300 hover:bg-white/5"><Camera size={14} />Use the camera</button>}
            <select aria-label="Credit" value={credit} onChange={(e) => setCredit(e.target.value as 'partial' | 'strict')} className="h-[30px] rounded-[10px] border border-white/[0.12] bg-[#30302E] px-2 text-[12.5px] text-neutral-300">
              <option value="partial">Part marks allowed</option><option value="strict">Strict marking</option>
            </select>
            <button type="button" onClick={() => setCorrections((v) => !v)} aria-pressed={corrections} className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/[0.12] px-3 py-1.5 text-[12.5px] text-neutral-300 hover:bg-white/5"><PenLine size={14} className={corrections ? 'text-rose-400' : ''} />Red-pen corrections: {corrections ? 'on' : 'off'}</button>
            <select aria-label="Feedback" value={feedback} onChange={(e) => setFeedback(e.target.value as 'brief' | 'detailed')} className="h-[30px] rounded-[10px] border border-white/[0.12] bg-[#30302E] px-2 text-[12.5px] text-neutral-300">
              <option value="brief">Brief feedback</option><option value="detailed">Detailed feedback</option>
            </select>
            <button type="button" disabled={!canMark} onClick={submit}
              className="ml-auto inline-flex items-center gap-2 rounded-xl bg-[#D97757] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#c96a4c] disabled:cursor-not-allowed disabled:opacity-40">
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {scripts.length ? `Mark ${summary.students || scripts.length} script${(summary.students || scripts.length) === 1 ? '' : 's'}` : 'Add student scripts'}
            </button>
          </div>
          <input ref={input} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.tif,.tiff,.bmp,.docx,.doc,.odt,.rtf,.txt,.zip,image/*,application/pdf"
            onChange={(e) => { if (e.target.files?.length) add(e.target.files); e.target.value = ''; }} />
        </section>

        {items.length > 0 && (
          <section aria-label="Summary" className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Stat value={scheme ? '✓' : '—'} label={scheme ? 'marking scheme attached' : paper ? 'no scheme: Bwenge drafts one from the question paper' : 'no scheme: Bwenge drafts one from the questions'} tone={scheme ? 'ok' : 'note'} />
            <Stat value={summary.students || '—'} label={`student${summary.students === 1 ? '' : 's'} found`} />
            <Stat value={summary.checking ? '…' : summary.pages} label={summary.checking ? 'checking pages' : `pages, ${summary.handwritten} handwritten or scanned`} />
            <Stat value={summary.retake} label={summary.retake ? 'photos to retake (marking still works)' : 'photos to retake'} tone={summary.retake ? 'warn' : undefined} />
          </section>
        )}
        {failed.length > 0 && <p className="mt-3 text-[12.5px] text-rose-300">{failed.length} file{failed.length === 1 ? '' : 's'} could not be uploaded. Remove {failed.length === 1 ? 'it' : 'them'} or add {failed.length === 1 ? 'it' : 'them'} again.</p>}
        <ol className="mx-auto mt-6 flex flex-wrap justify-center gap-x-5 gap-y-1 text-[12.5px] text-neutral-500">
          <li><b className="text-neutral-400">1</b> Add files</li><li aria-hidden>→</li><li><b className="text-neutral-400">2</b> Check roles and the summary</li><li aria-hidden>→</li><li><b className="text-neutral-400">3</b> Mark: watch it live in the chat</li>
        </ol>
      </main>
    </div>
  );
}

function Stat({ value, label, tone }: { value: string | number; label: string; tone?: 'ok' | 'warn' | 'note' }) {
  return (
    <div className={`rounded-[14px] border px-3.5 py-3 ${tone === 'warn' ? 'border-amber-500/35' : 'border-white/[0.08]'}`}>
      <b className={`block text-[20px] font-semibold ${tone === 'warn' ? 'text-amber-300' : tone === 'ok' ? 'text-emerald-300' : ''}`}>{value}</b>
      <span className="text-[12px] text-neutral-400">{label}</span>
    </div>
  );
}
