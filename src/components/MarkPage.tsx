import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Camera, Check, ChevronDown, Loader2, Moon, Paperclip, PenLine, X, Zap } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import { FileThumb, PreviewDialog } from './FilePreview';
import type { ChatAttachment } from '../types';

/**
 * Mark: everything needed to mark a class in one place. Files upload as soon as they are added (like attaching
 * in Claude) and each gets a role the teacher can change: marking scheme, question paper or student scripts.
 * A quick check (no AI) shows pages, handwriting and photos to retake. "Mark" sends it all to a new chat, where
 * the marking runs live; the roles are sent with it so the server never guesses which file is which.
 */

export type MarkRole = 'scheme' | 'paper' | 'scripts';
/** What the camera photographs for this page. */
export type MarkScanTarget = MarkRole;
/** Students found in a camera scan: name, page count and the first page (for the thumbnail). */
export interface ScannedStudent { name: string; pages: number; thumb: string }
/** Files made elsewhere (the camera) and handed to this page, once per id. */
export interface MarkIncoming {
  id: number; files: File[]; role?: MarkRole; students?: ScannedStudent[];
  /** Files already on the server (an assignment's hand-ins, one PDF per student), each with its role. */
  uploaded?: Array<{ fileId: string; name: string; mime: string; size: number; role: MarkRole; label?: string }>;
  /** Sent with the marking but not shown as a file: the students list that keeps their names in the results. */
  extras?: Array<{ fileId: string; name: string; mime: string; size: number }>;
}
export interface MarkRequest {
  text: string;
  attachments: ChatAttachment[];
  marking: { roles: Record<string, MarkRole>; instructions?: string; credit: 'partial' | 'strict'; corrections: boolean; feedback: 'brief' | 'detailed'; overnight?: boolean };
}
interface Check { pages: number; typedPages: number; students?: number; kind: string; looksLike?: MarkRole; issues: Array<{ page?: number; entry?: string; issue: 'blurry' | 'dark' | 'small' | 'unreadable' }> }
interface Item { key: string; file: File; role: MarkRole; chosen?: boolean; status: 'uploading' | 'ready' | 'failed'; fileId?: string; error?: string; check?: Check; preview?: string; students?: ScannedStudent[]; bytes?: number; label?: string }

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


export default function MarkPage({ onClose, onMark, onScan, incoming, covered = false }: {
  onClose: () => void; onMark: (req: MarkRequest) => void;
  /** Opens the camera for the students' scripts, or for one marking scheme / question paper. */
  onScan?: (target: MarkScanTarget) => void;
  /** Another screen (the camera) is on top: keys belong to it. */
  covered?: boolean;
  /** Files made elsewhere while this page stays open (the camera scanner's pages); added once per id. */
  incoming?: MarkIncoming | null;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [instructions, setInstructions] = useState('');
  const [credit, setCredit] = useState<'partial' | 'strict'>('partial');
  const [corrections, setCorrections] = useState(true);
  const [feedback, setFeedback] = useState<'brief' | 'detailed'>('brief');
  // Overnight: sent as half-price batches; results by the next morning (usually much sooner).
  const [overnight, setOvernight] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [viewing, setViewing] = useState<File | null>(null);
  const viewingSrc = useMemo(() => (viewing ? { name: viewing.name, type: viewing.type, file: viewing, size: viewing.size } : null), [viewing]);
  const input = useRef<HTMLInputElement>(null);
  const guideInput = useRef<HTMLInputElement>(null);
  // Step 2 asks for one of these; the teacher says which before photographing or choosing it.
  const [guideKind, setGuideKind] = useState<'scheme' | 'paper'>('scheme');

  useEffect(() => {
    if (covered) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose, covered]);
  useEffect(() => () => { for (const i of items) if (i.preview) URL.revokeObjectURL(i.preview); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (key: string, p: Partial<Item>) => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const taken = useRef(0);
  const add = useCallback((files: FileList | File[], opts: { role?: MarkRole; students?: ScannedStudent[] } = {}) => {
    const fresh: Item[] = [...files].map((file) => ({
      key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`, file, role: opts.role ?? guessRole(file.name), chosen: !!opts.role, status: 'uploading',
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : opts.students?.[0]?.thumb,
      students: opts.students,
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
  const [extras, setExtras] = useState<NonNullable<MarkIncoming['extras']>>([]);
  useEffect(() => {
    if (!incoming || incoming.id === taken.current) return;
    taken.current = incoming.id;
    if (incoming.files.length) add(incoming.files, { role: incoming.role, students: incoming.students });
    if (incoming.extras?.length) setExtras((cur) => [...cur, ...incoming.extras!]);
    if (incoming.uploaded?.length) {
      const ready: Item[] = incoming.uploaded.map((u) => ({
        key: `${u.fileId}-${Math.random().toString(36).slice(2, 7)}`, file: new File([], u.name, { type: u.mime }), bytes: u.size, label: u.label,
        role: u.role, chosen: true, status: 'ready', fileId: u.fileId,
      }));
      setItems((cur) => [...cur, ...ready]);
      // Same quick check as for added files, for the page counts and photos to retake.
      void authFetch('/api/exams/precheck', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileIds: ready.map((r) => r.fileId) }) })
        .then((res) => res.json()).then((body) => {
          // Results come back in any order; each names its file.
          const byId = new Map<string, Check>((body?.files ?? []).map((c: Check & { fileId: string }) => [c.fileId, c]));
          setItems((cur) => cur.map((x) => (x.fileId && byId.has(x.fileId) && ready.some((r) => r.key === x.key) ? { ...x, check: byId.get(x.fileId) } : x)));
        }).catch(() => undefined);
    }
  }, [incoming, add]);

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
  // Bwenge needs one of the two before it marks: the marking scheme, or the question paper to write one from.
  const guide = items.some((i) => (i.role === 'scheme' || i.role === 'paper') && i.status === 'ready');
  const canMark = scripts.length > 0 && guide && !uploading && scripts.every((i) => i.status === 'ready');

  const submit = () => {
    const ready = items.filter((i) => i.status === 'ready' && i.fileId);
    const roles = Object.fromEntries(ready.map((i) => [i.file.name, i.role]));
    const n = summary.students;
    const text = [
      `Mark ${n === 1 ? 'this script' : `these ${n} scripts`}${scheme ? ' with the marking scheme' : '. Use the question paper to write the marking scheme first'}.`,
      instructions.trim() ? `My instructions: ${instructions.trim()}` : '',
      overnight ? 'Mark overnight at half price; I will check the results tomorrow.' : '',
    ].filter(Boolean).join('\n\n');
    onMark({
      text,
      attachments: [
        ...ready.map((i) => ({ id: i.key, name: i.file.name, serverId: i.fileId, storedFileId: i.fileId, mimeType: i.file.type || 'application/octet-stream', size: `${Math.max(1, Math.round((i.bytes ?? i.file.size) / 1024))} KB`, fileType: i.file.type.startsWith('image/') ? 'image' as const : /\.pdf$/i.test(i.file.name) ? 'pdf' as const : 'document' as const })),
        // The students list carries no role, so the marker reads it as the list of names.
        ...extras.map((x) => ({ id: x.fileId, name: x.name, serverId: x.fileId, storedFileId: x.fileId, mimeType: x.mime, size: `${Math.max(1, Math.round(x.size / 1024))} KB`, fileType: 'document' as const })),
      ],
      marking: { roles, instructions: instructions.trim() || undefined, credit, corrections, feedback, ...(overnight ? { overnight: true } : {}) },
    });
  };

  const markLabel = !scripts.length ? 'Add student scripts' : !scheme && !paper ? 'Add scheme or question paper' : `Mark ${summary.students || scripts.length} script${(summary.students || scripts.length) === 1 ? '' : 's'}${overnight ? ' overnight' : ''}`;
  const toggleSuggestion = (s: string) => setInstructions((cur) => (cur.includes(s) ? cur.replace(s, '').replace(/\s{2,}/g, ' ').trim() : `${cur.trim()} ${s}`.trim()));

  return (
    <div className="fixed inset-0 z-[70] flex flex-col overflow-y-auto bg-[#262624] text-[#F2EFE9]"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) add(e.dataTransfer.files); }}>
      <header className="flex items-center gap-3 px-4 py-3 sm:px-6">
        <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-neutral-400 hover:bg-white/5 hover:text-white"><ArrowLeft size={16} />Back to chat</button>
      </header>
      <main className="mx-auto flex w-full max-w-[840px] flex-1 flex-col px-4 pb-28 sm:px-6 sm:pb-10">
        <h1 className="mt-1 text-center sm:mt-4 font-serif text-[28px] font-medium tracking-tight sm:text-[32px]">What are we <span className="text-[#D97757]">marking</span> today?</h1>
        <p className="mx-auto mt-2 hidden max-w-xl text-center text-[14px] text-neutral-400 sm:block">Add the students' scripts and the marking scheme or the question paper. Bwenge reads the handwriting, marks every question in red pen, and shows you each step in the chat.</p>

        <section className={`mt-5 overflow-hidden sm:mt-7 rounded-[20px] border bg-[#30302E] shadow-[0_12px_40px_rgba(0,0,0,.25)] transition-colors ${dragging ? 'border-[#D97757]/70' : 'border-white/[0.12]'}`}>
          {items.length === 0 ? (
            // Two ways in, side by side: the camera (one tap per page) and files (or drop them here on a computer).
            <div className="grid gap-2.5 p-3.5 sm:grid-cols-2">
              {onScan && (
                <button type="button" onClick={() => onScan('scripts')} className="flex items-center gap-3 rounded-2xl bg-[#D97757] px-4 py-4 text-left text-white hover:bg-[#c96a4c] sm:flex-col sm:items-start sm:py-6">
                  <span className="rounded-xl bg-white/15 p-2.5"><Camera size={22} /></span>
                  <span><span className="block text-[15px] font-semibold">Scan papers</span><span className="block text-[12.5px] text-white/80">One tap per page, then next student</span></span>
                </button>
              )}
              <button type="button" onClick={() => input.current?.click()} className={`flex items-center gap-3 rounded-2xl border border-dashed border-white/[0.16] px-4 py-4 text-left hover:bg-white/[0.03] sm:flex-col sm:items-start sm:py-6 ${onScan ? '' : 'sm:col-span-2'}`}>
                <span className="rounded-xl bg-white/[0.06] p-2.5 text-neutral-300"><Paperclip size={22} /></span>
                <span><span className="block text-[15px] font-semibold">Choose files</span><span className="block text-[12.5px] text-neutral-400"><span className="hidden sm:inline">or drop them here: </span>scripts, scheme, question paper (PDF, photos, Word, ZIP)</span></span>
              </button>
            </div>
          ) : (
            <ul className="grid gap-2.5 p-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((it) => {
                const issues = it.check?.issues.filter((x) => x.issue !== 'small') ?? [];
                return (
                  <li key={it.key} className="relative flex gap-3 rounded-[14px] border border-white/[0.08] bg-[#2B2A28] p-2.5">
                    <button type="button" onClick={() => setViewing(it.file)} aria-label={`Preview ${it.file.name}`} title="Preview"
                      className="h-14 w-11 shrink-0 overflow-hidden rounded-md border border-black/20 transition hover:ring-2 hover:ring-[#D97757]/50">
                      <FileThumb src={{ name: it.file.name, type: it.file.type, file: it.file, size: it.file.size }} badge={false} className="h-full w-full" />
                    </button>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate pr-5 text-[12.5px] font-semibold">{it.label ?? it.file.name}</span>
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
                      {it.students && it.students.length > 0 && (
                        <span className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5" aria-label="Scanned students">
                          {it.students.map((st, i) => (
                            <span key={i} className="w-12 shrink-0 text-center">
                              <img src={st.thumb} alt={`${st.name}, first page`} className="h-14 w-12 rounded border border-black/20 bg-[#FBFAF6] object-cover" />
                              <span className="mt-0.5 block truncate text-[10px] text-neutral-400">{st.name.replace(/^Student\s+/i, 'S')} · {st.pages}p</span>
                            </span>
                          ))}
                        </span>
                      )}
                      {issues.length > 0 && <span className="mt-1 flex items-start gap-1 text-[11px] text-amber-300"><AlertTriangle size={11} className="mt-0.5 shrink-0" />{issues.slice(0, 2).map((x) => `${x.entry ? `${x.entry.split('/').pop()} ` : x.page ? `page ${x.page} ` : ''}${ISSUE_TEXT[x.issue]}`).join(', ')}{issues.length > 2 ? ` +${issues.length - 2}` : ''}: retake</span>}
                    </span>
                    <button type="button" aria-label={`Remove ${it.file.name}`} onClick={() => setItems((cur) => cur.filter((x) => x.key !== it.key))} className="absolute right-2 top-2 rounded p-0.5 text-neutral-500 hover:bg-white/10 hover:text-white"><X size={13} /></button>
                  </li>
                );
              })}
            </ul>
          )}

          {scripts.length > 0 && !scheme && !paper && (
            // Step 2, right where the teacher looks next: Bwenge marks against the scheme, or writes it from the questions.
            <div className="border-t border-white/[0.08] bg-[#D97757]/[0.06] px-4 py-3.5">
              <div className="flex items-center gap-2 text-[13.5px] font-semibold text-white">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#D97757] text-[11px] font-bold text-white">2</span>
                Now add the marking scheme or the question paper
              </div>
              <p className="mt-1 text-[12.5px] text-neutral-400">Bwenge marks against your scheme. With only the question paper, it writes the scheme first and shows it to you.</p>
              <div role="radiogroup" aria-label="Which document" className="mt-2.5 grid max-w-sm grid-cols-2 gap-1 rounded-xl bg-white/[0.05] p-1 text-[12.5px]">
                {(['scheme', 'paper'] as const).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={guideKind === k} onClick={() => setGuideKind(k)}
                    className={`rounded-lg px-2 py-1.5 font-semibold ${guideKind === k ? 'bg-[#D97757] text-white' : 'text-neutral-400 hover:text-neutral-200'}`}>{ROLE_LABEL[k]}</button>
                ))}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {onScan && <button type="button" onClick={() => onScan(guideKind)} className="inline-flex items-center gap-1.5 rounded-xl bg-[#D97757] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#c96a4c]"><Camera size={15} />Photograph it</button>}
                <button type="button" onClick={() => guideInput.current?.click()} className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.14] px-3.5 py-2 text-[13px] text-neutral-200 hover:bg-white/5"><Paperclip size={15} />Choose file</button>
              </div>
              <input ref={guideInput} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.docx,.doc,.odt,.rtf,.txt,image/*,application/pdf"
                onChange={(e) => { if (e.target.files?.length) add(e.target.files, { role: guideKind }); e.target.value = ''; }} />
            </div>
          )}

          <div className="border-t border-white/[0.08] px-4 py-3">
            <label htmlFor="mark-instructions" className="mb-1.5 block text-[12px] text-neutral-400">Marking instructions <span className="text-neutral-500">(optional, followed on every script)</span></label>
            <textarea id="mark-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value.slice(0, 2000))} rows={2}
              placeholder="For example: accept g = 9.8 or 10 m/s². Half marks when the method is right."
              className="w-full resize-y rounded-xl border border-white/[0.08] bg-transparent px-3 py-2.5 text-[13.5px] text-[#F2EFE9] placeholder:text-neutral-500 focus:border-[#D97757]/60 focus:outline-none" />
            <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => toggleSuggestion(s)} className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] ${instructions.includes(s) ? 'border-[#D97757]/50 bg-[#D97757]/15 text-[#F2B39C]' : 'border-white/[0.12] text-neutral-400 hover:text-neutral-200'}`}>{s.replace(/\.$/, '')}</button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto border-t border-white/[0.08] px-3.5 py-2.5 [&>*]:shrink-0 sm:flex-wrap sm:overflow-visible">
            {items.length > 0 && <button type="button" onClick={() => input.current?.click()} className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/[0.12] px-3 py-1.5 text-[12.5px] text-neutral-300 hover:bg-white/5"><Paperclip size={14} />Add files</button>}
            {onScan && items.length > 0 && <button type="button" onClick={() => onScan('scripts')} className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/[0.12] px-3 py-1.5 text-[12.5px] text-neutral-300 hover:bg-white/5"><Camera size={14} />Scan papers</button>}
            <select aria-label="Credit" value={credit} onChange={(e) => setCredit(e.target.value as 'partial' | 'strict')} className="h-[30px] rounded-[10px] border border-white/[0.12] bg-[#30302E] px-2 text-[12.5px] text-neutral-300">
              <option value="partial">Part marks allowed</option><option value="strict">Strict marking</option>
            </select>
            <button type="button" onClick={() => setCorrections((v) => !v)} aria-pressed={corrections} className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/[0.12] px-3 py-1.5 text-[12.5px] text-neutral-300 hover:bg-white/5"><PenLine size={14} className={corrections ? 'text-rose-400' : ''} />Red-pen corrections: {corrections ? 'on' : 'off'}</button>
            <select aria-label="Feedback" value={feedback} onChange={(e) => setFeedback(e.target.value as 'brief' | 'detailed')} className="h-[30px] rounded-[10px] border border-white/[0.12] bg-[#30302E] px-2 text-[12.5px] text-neutral-300">
              <option value="brief">Brief feedback</option><option value="detailed">Detailed feedback</option>
            </select>
            <div role="radiogroup" aria-label="When to mark" className="inline-flex rounded-[10px] border border-white/[0.12] p-0.5 text-[12.5px]">
              <button type="button" role="radio" aria-checked={!overnight} onClick={() => setOvernight(false)} className={`inline-flex items-center gap-1 rounded-[8px] px-2.5 py-1 ${!overnight ? 'bg-white/10 text-white' : 'text-neutral-400 hover:text-neutral-200'}`}><Zap size={13} />Now</button>
              <button type="button" role="radio" aria-checked={overnight} onClick={() => setOvernight(true)} title="Results by tomorrow morning, usually much sooner, for half the credits" className={`inline-flex items-center gap-1 rounded-[8px] px-2.5 py-1 ${overnight ? 'bg-indigo-500/20 text-indigo-200' : 'text-neutral-400 hover:text-neutral-200'}`}><Moon size={13} />Overnight · half price</button>
            </div>
            <button type="button" disabled={!canMark} onClick={submit}
              className="ml-auto hidden items-center gap-2 rounded-xl sm:inline-flex bg-[#D97757] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#c96a4c] disabled:cursor-not-allowed disabled:opacity-40">
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}{markLabel}
            </button>
          </div>
          <input ref={input} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.tif,.tiff,.bmp,.docx,.doc,.odt,.rtf,.txt,.zip,image/*,application/pdf"
            onChange={(e) => { if (e.target.files?.length) add(e.target.files); e.target.value = ''; }} />
        </section>

        {items.length > 0 && (
          <section aria-label="Summary" className="mt-4 hidden grid-cols-2 gap-2.5 sm:grid sm:grid-cols-4">
            <Stat value={scheme || paper ? '✓' : '!'} label={scheme ? 'marking scheme attached' : paper ? 'question paper: Bwenge writes the scheme from it' : 'add the marking scheme or the question paper'} tone={scheme || paper ? 'ok' : 'warn'} />
            <Stat value={summary.students || '—'} label={`student${summary.students === 1 ? '' : 's'} found`} />
            <Stat value={summary.checking ? '…' : summary.pages} label={summary.checking ? 'checking pages' : `pages, ${summary.handwritten} handwritten or scanned`} />
            <Stat value={summary.retake} label={summary.retake ? 'photos to retake (marking still works)' : 'photos to retake'} tone={summary.retake ? 'warn' : undefined} />
          </section>
        )}
        {summary.retake > 0 && <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-amber-300 sm:hidden"><AlertTriangle size={13} />{summary.retake} photo{summary.retake === 1 ? '' : 's'} to retake (marking still works)</p>}
        {failed.length > 0 && <p className="mt-3 text-[12.5px] text-rose-300">{failed.length} file{failed.length === 1 ? '' : 's'} could not be uploaded. Remove {failed.length === 1 ? 'it' : 'them'} or add {failed.length === 1 ? 'it' : 'them'} again.</p>}
        {/* Phone: the Mark button stays in reach at the bottom of the screen. */}
        <div className="fixed inset-x-0 bottom-0 z-10 flex items-center gap-3 border-t border-white/[0.08] bg-[#262624]/95 px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:hidden">
          <span className="min-w-0 flex-1 text-[12px] leading-tight text-neutral-400">
            {items.length
              ? <><span className="block truncate">{!scripts.length ? 'Next: the students\' scripts' : scheme ? 'Scheme attached' : paper ? 'Question paper attached' : 'Next: scheme or question paper'}</span><span className="block truncate">{summary.students || 0} student{summary.students === 1 ? '' : 's'} · {summary.pages} page{summary.pages === 1 ? '' : 's'}</span></>
              : 'Scan or add the scripts to start'}
          </span>
          <button type="button" disabled={!canMark} onClick={submit} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#D97757] px-4 py-2.5 text-[14px] font-semibold text-white disabled:opacity-40">
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}{canMark || uploading ? markLabel : !scripts.length ? 'Add scripts' : 'Add scheme'}
          </button>
        </div>
        <ol className="mx-auto mt-6 hidden flex-wrap justify-center gap-x-5 gap-y-1 text-[12.5px] text-neutral-500 sm:flex">
          <li><b className="text-neutral-400">1</b> Add the scripts and the scheme or question paper</li><li aria-hidden>→</li><li><b className="text-neutral-400">2</b> Mark</li><li aria-hidden>→</li><li><b className="text-neutral-400">3</b> {overnight ? 'Results by tomorrow morning, for half the credits' : 'Watch the red pen live in the chat'}</li>
        </ol>
      </main>
      {viewingSrc && <PreviewDialog src={viewingSrc} onClose={() => setViewing(null)} />}
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
