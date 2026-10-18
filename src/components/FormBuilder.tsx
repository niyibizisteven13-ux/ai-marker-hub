/**
 * FormBuilder — creator-side editor that produces the schema DynamicForm renders.
 * Dark studio look with the clay accent, matching the rest of the app.
 *
 * Props
 *  - initialSchema  existing schema (object or JSON string) to edit; omit to start a blank form.
 *  - onChange       called with the schema every time something changes (for autosave).
 *  - onPublish      called with the schema on "Save & Publish". May return { shareUrl }.
 *  - shareUrl       link to show under "Get link" once the form is published.
 *  - uploadFile     optional (file) => Promise<url> for images. Without it images are embedded (max 3 MB).
 *  - onBack         shows the back arrow in the header and calls this when pressed.
 *  - onResults      shows the Results button and calls this when pressed.
 *  - onRunAgent     (prompt, currentSchema) => Promise<schema>. Enables the AI co-pilot panel; the returned
 *                   schema replaces the form (the builder reads old and new schema shapes).
 *
 * Needs ./DynamicForm (the renderer) for the Preview tab.
 * NOTE: quiz answers (`correctAnswer`) live in the schema this builder emits. Keep them on the server and
 * strip them before sending the schema to respondents.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import DynamicForm from './DynamicForm';

/* ------------------------------------------------------------------ types */

export const QUESTION_TYPES = [
  { type: 'text', label: 'Short answer', glyph: 'Aa' },
  { type: 'long_text', label: 'Paragraph', glyph: '¶' },
  { type: 'radio', label: 'Multiple choice', glyph: '( )' },
  { type: 'checkbox', label: 'Checkboxes', glyph: '[ ]' },
  { type: 'select', label: 'Dropdown', glyph: '▾' },
  { type: 'date', label: 'Date', glyph: '31' },
  { type: 'number', label: 'Number', glyph: '#' },
  { type: 'email', label: 'Email', glyph: '@' },
  { type: 'tel', label: 'Phone', glyph: '+' },
  { type: 'url', label: 'Link', glyph: '://' },
  { type: 'file', label: 'File upload', glyph: '↑' },
  { type: 'linear_scale', label: 'Linear scale', glyph: '1–5' },
  { type: 'rating', label: 'Rating', glyph: '★' },
  { type: 'radio_grid', label: 'Multiple choice grid', glyph: '::' },
  { type: 'checkbox_grid', label: 'Checkbox grid', glyph: '[::]' },
  { type: 'time', label: 'Time', glyph: ':' },
] as const;

const TYPE_LABEL: Record<string, string> = Object.fromEntries(QUESTION_TYPES.map(t => [t.type, t.label]));
const CHOICE = new Set(['radio', 'checkbox', 'select']);
const GRID = new Set(['radio_grid', 'checkbox_grid']);
const TEXTY = new Set(['text', 'long_text', 'number', 'email', 'tel', 'url']);

type Question = {
  kind: 'question';
  id: string;
  type: string;
  label: string;
  description: string;
  required: boolean;
  points?: number;
  correctAnswer?: string | string[];
  options: string[];
  rows: string[];
  columns: string[];
  allowOther?: boolean;
  shuffleOptions?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  minSelected?: number;
  maxSelected?: number;
  pattern?: string;
  patternMessage?: string;
  scaleMin: number;
  scaleMax: number;
  scaleMinLabel: string;
  scaleMaxLabel: string;
  maxRating: number;
  accept: string;
  maxSizeMB: number;
  imageUrl?: string;
  videoUrl?: string;
  videoDataUrl?: string;
};
type Block = {
  kind: 'section' | 'image' | 'video' | 'text';
  id: string;
  title: string;
  description: string;
  url?: string;
};
type Item = Question | Block;

export type BuilderState = {
  title: string;
  description: string;
  descriptionImageUrl: string;
  themeColor: string;
  isQuiz: boolean;
  collectEmail: boolean;
  acceptingResponses: boolean;
  allowMultipleResponses: boolean;
  confirmationMessage: string;
  items: Item[];
};

export type FormBuilderProps = {
  initialSchema?: any;
  onChange?: (schema: any) => void;
  onPublish?: (schema: any) => void | { shareUrl?: string } | Promise<void | { shareUrl?: string }>;
  shareUrl?: string;
  uploadFile?: (file: File) => Promise<string>;
  onBack?: () => void;
  onResults?: () => void;
  onRunAgent?: (prompt: string, currentSchema: any) => Promise<any>;
};

/* ---------------------------------------------------------------- helpers */

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);

const makeQuestion = (type: string): Question => ({
  kind: 'question',
  id: `q_${uid()}`,
  type,
  label: '',
  description: '',
  required: false,
  options: CHOICE.has(type) ? ['Option 1'] : [],
  rows: GRID.has(type) ? ['Row 1'] : [],
  columns: GRID.has(type) ? ['Column 1', 'Column 2'] : [],
  scaleMin: 1,
  scaleMax: 5,
  scaleMinLabel: '',
  scaleMaxLabel: '',
  maxRating: 5,
  accept: '',
  maxSizeMB: 5,
});

const makeBlock = (kind: Block['kind']): Block => ({ kind, id: `b_${uid()}`, title: '', description: '', url: '' });

const OLD_TYPES: Record<string, string> = {
  SHORT_TEXT: 'text', LONG_TEXT: 'long_text', MULTIPLE_CHOICE: 'radio', CHECKBOX: 'checkbox', DROPDOWN: 'select',
  DATE: 'date', NUMBER: 'number', EMAIL: 'email', PHONE: 'tel', URL: 'url', FILE_UPLOAD: 'file', RATING: 'rating',
  LINEAR_SCALE: 'linear_scale', MULTIPLE_CHOICE_GRID: 'radio_grid', CHECKBOX_GRID: 'checkbox_grid', TIME: 'time',
  MCQ: 'select', ESSAY: 'long_text', TEXTAREA: 'long_text',
};
const toType = (t?: string) => OLD_TYPES[String(t || 'text').toUpperCase()] || String(t || 'text').toLowerCase();
const clean = (list: string[]) => list.map(s => s.trim()).filter(Boolean);
const num = (v: string): number | undefined => (v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));

export const blankState = (): BuilderState => ({
  title: '',
  description: '',
  descriptionImageUrl: '',
  themeColor: '#D97757',
  isQuiz: false,
  collectEmail: false,
  acceptingResponses: true,
  allowMultipleResponses: true,
  confirmationMessage: 'Your response has been recorded.',
  items: [],
});

/** Reads an existing schema (old or new shape) into builder state. */
export function fromSchema(input: any): BuilderState {
  let s: any = input;
  if (typeof s === 'string') { try { s = JSON.parse(s); } catch { return blankState(); } }
  if (!s || typeof s !== 'object') return blankState();
  if (s.schema && !Array.isArray(s.fields) && !Array.isArray(s.questions)) {
    let inner = s.schema;
    if (typeof inner === 'string') { try { inner = JSON.parse(inner); } catch { inner = {}; } }
    if (inner && typeof inner === 'object') s = { ...s, ...inner };
  }
  const raw: any[] = Array.isArray(s.fields) ? s.fields : Array.isArray(s.questions) ? s.questions : [];
  const blocks: any[] = Array.isArray(s.blocks) ? s.blocks : [];
  const blockItem = (b: any): Block => ({
    kind: b.type === 'VIDEO' ? 'video' : b.type === 'IMAGE' ? 'image' : b.type === 'SECTION' ? 'section' : 'text',
    id: String(b.id ?? `b_${uid()}`), title: b.title || '', description: b.description || '', url: b.url || '',
  });
  const items: Item[] = [];
  blocks.filter(b => b.beforeFieldId == null && b.before == null).forEach(b => items.push(blockItem(b)));
  raw.forEach((f, i) => {
    const id = String(f.id ?? f.number ?? i + 1);
    blocks.filter(b => String(b.beforeFieldId ?? b.before) === id).forEach(b => items.push(blockItem(b)));
    if (f.sectionTitle) items.push({ ...makeBlock('section'), title: f.sectionTitle });
    const type = toType(f.type);
    const labels = (f.options || []).map((o: any) => (typeof o === 'string' ? o : o?.label ?? ''));
    const q = makeQuestion(type);
    items.push({
      ...q,
      id,
      label: f.label || f.title || f.text || '',
      description: f.description || '',
      required: !!f.required,
      points: f.points !== undefined ? Number(f.points) : undefined,
      correctAnswer: f.correctAnswer,
      options: GRID.has(type) ? [] : labels,
      rows: f.rows || q.rows,
      columns: GRID.has(type) ? (f.columns?.length ? f.columns : labels) : [],
      allowOther: f.allowOther, shuffleOptions: f.shuffleOptions,
      minLength: f.minLength, maxLength: f.maxLength, min: f.min, max: f.max,
      minSelected: f.minSelected, maxSelected: f.maxSelected,
      pattern: f.pattern, patternMessage: f.patternMessage,
      scaleMin: f.scaleMin ?? 1, scaleMax: f.scaleMax ?? 5,
      scaleMinLabel: f.scaleMinLabel || '', scaleMaxLabel: f.scaleMaxLabel || '',
      maxRating: f.maxRating || 5, accept: f.accept || '', maxSizeMB: f.maxSizeMB ?? 5,
      imageUrl: f.imageUrl, videoUrl: f.videoUrl, videoDataUrl: f.videoDataUrl,
    });
  });
  return {
    title: s.title || '',
    description: s.description || '',
    descriptionImageUrl: s.descriptionImageUrl || '',
    themeColor: s.themeColor || '#D97757',
    isQuiz: !!s.isQuiz,
    collectEmail: !!s.collectEmail,
    acceptingResponses: s.acceptingResponses !== false,
    allowMultipleResponses: s.allowMultipleResponses !== false,
    confirmationMessage: s.confirmationMessage || 'Your response has been recorded.',
    items,
  };
}

/** Turns builder state into the schema DynamicForm renders. */
export function buildSchema(s: BuilderState): any {
  const fields: any[] = [];
  const blocks: any[] = [];
  let pending: Block[] = [];
  for (const it of s.items) {
    if (it.kind !== 'question') { pending.push(it); continue; }
    const f: any = { id: it.id, type: it.type, label: it.label.trim() || 'Untitled question', required: it.required };
    if (it.description.trim()) f.description = it.description.trim();
    if (CHOICE.has(it.type)) {
      f.options = clean(it.options);
      if (it.type !== 'select' && it.allowOther) f.allowOther = true;
      if (it.shuffleOptions) f.shuffleOptions = true;
      if (it.type === 'checkbox') {
        if (it.minSelected) f.minSelected = it.minSelected;
        if (it.maxSelected) f.maxSelected = it.maxSelected;
      }
    }
    if (GRID.has(it.type)) { f.rows = clean(it.rows); f.columns = clean(it.columns); }
    if (it.type === 'linear_scale') {
      Object.assign(f, { scaleMin: it.scaleMin, scaleMax: it.scaleMax });
      if (it.scaleMinLabel) f.scaleMinLabel = it.scaleMinLabel;
      if (it.scaleMaxLabel) f.scaleMaxLabel = it.scaleMaxLabel;
    }
    if (it.type === 'rating') f.maxRating = it.maxRating;
    if (it.type === 'file') {
      if (it.accept) f.accept = it.accept;
      f.maxSizeMB = it.maxSizeMB;
    }
    if (TEXTY.has(it.type)) {
      if (it.minLength) f.minLength = it.minLength;
      if (it.maxLength) f.maxLength = it.maxLength;
      if (it.type === 'number') {
        if (it.min !== undefined) f.min = it.min;
        if (it.max !== undefined) f.max = it.max;
      }
      if (it.pattern) { f.pattern = it.pattern; if (it.patternMessage) f.patternMessage = it.patternMessage; }
    }
    if (s.isQuiz) {
      if (it.points) f.points = it.points;
      const a = it.correctAnswer;
      if (Array.isArray(a) ? a.length : a) f.correctAnswer = a;
    }
    if (it.imageUrl) f.imageUrl = it.imageUrl;
    if (it.videoUrl) f.videoUrl = it.videoUrl;
    if (it.videoDataUrl) f.videoDataUrl = it.videoDataUrl;
    fields.push(f);
    pending.forEach(b => {
      const out: any = { id: b.id, type: b.kind.toUpperCase(), beforeFieldId: it.id };
      if (b.title) out.title = b.title;
      if (b.description) out.description = b.description;
      if (b.url) out.url = b.url;
      blocks.push(out);
    });
    pending = [];
  }
  const out: any = {
    title: s.title.trim() || 'Untitled form',
    description: s.description,
    themeColor: s.themeColor,
    isQuiz: s.isQuiz,
    collectEmail: s.collectEmail,
    acceptingResponses: s.acceptingResponses,
    allowMultipleResponses: s.allowMultipleResponses,
    confirmationMessage: s.confirmationMessage,
    fields,
    blocks,
  };
  if (s.descriptionImageUrl) out.descriptionImageUrl = s.descriptionImageUrl;
  return out;
}

type Problem = { id?: string; text: string };
function findProblems(s: BuilderState): Problem[] {
  const out: Problem[] = [];
  if (!s.title.trim()) out.push({ text: 'Add a form title.' });
  const questions = s.items.filter((i): i is Question => i.kind === 'question');
  if (!questions.length) out.push({ text: 'Add at least one question.' });
  questions.forEach((q, i) => {
    const n = `Question ${i + 1}`;
    if (!q.label.trim()) out.push({ id: q.id, text: `${n}: add the question text.` });
    if (CHOICE.has(q.type) && !clean(q.options).length) out.push({ id: q.id, text: `${n}: add at least one option.` });
    if (GRID.has(q.type) && (!clean(q.rows).length || !clean(q.columns).length)) out.push({ id: q.id, text: `${n}: add at least one row and one column.` });
    if (q.type === 'linear_scale' && q.scaleMax <= q.scaleMin) out.push({ id: q.id, text: `${n}: the scale maximum must be above the minimum.` });
    if (q.pattern) { try { new RegExp(q.pattern); } catch { out.push({ id: q.id, text: `${n}: the format pattern is not valid.` }); } }
    if (s.isQuiz && q.points && !(Array.isArray(q.correctAnswer) ? q.correctAnswer.length : q.correctAnswer)) {
      out.push({ id: q.id, text: `${n}: choose the correct answer or set points to 0.` });
    }
  });
  return out;
}

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });

/* --------------------------------------------------------------- styling */

const ring = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F0A58C]';
const inp = 'w-full rounded-lg border border-[#DADCE0] bg-[#FFFFFF] px-3 py-2 text-sm text-[#202124] placeholder:text-[#757575] outline-none focus:border-[#D97757] focus:ring-2 focus:ring-[#D97757]/30';
const btn = `min-h-10 rounded-lg border border-[#DADCE0] bg-transparent px-3 text-sm font-semibold text-[#202124] hover:bg-black/5 ${ring} disabled:opacity-40`;
const ghost = `min-h-10 rounded-lg px-3 text-sm font-semibold text-[#5F6368] hover:bg-black/5 hover:text-[#202124] ${ring} disabled:opacity-40`;
const primary = `min-h-11 rounded-xl bg-[#B4502F] px-5 text-sm font-bold text-white shadow-lg shadow-[#D97757]/10 hover:bg-[#C45A37] ${ring} disabled:opacity-60`;
const card = 'rounded-2xl border border-[#E0E0E0] bg-[#FFFFFF] p-5 sm:p-6';
const eyebrow = 'text-xs font-bold uppercase tracking-wider text-[#5F6368]';

const SparkIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M19 16l.7 1.8L21.5 18.5l-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z" fill="currentColor" />
  </svg>
);

/* ------------------------------------------------------- small components */

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-semibold text-[#202124]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-[#5F6368]">{hint}</span>}
    </label>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-1 h-4 w-4 accent-[#D97757]" />
      <span><span className="font-semibold text-[#202124]">{label}</span>{hint && <span className="block text-xs text-[#5F6368]">{hint}</span>}</span>
    </label>
  );
}

function ListEditor({ label, noun, items, onChange, addLabel }: {
  label: string; noun: string; items: string[]; onChange: (v: string[]) => void; addLabel: string;
}) {
  return (
    <div>
      <div className="text-sm font-semibold text-[#202124]">{label}</div>
      <ul className="mt-2 space-y-2">
        {items.map((value, i) => (
          <li key={i} className="flex gap-2">
            <input aria-label={`${noun} ${i + 1}`} value={value} className={inp}
              onChange={e => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
            <button type="button" className={ghost} disabled={items.length <= 1} aria-label={`Remove ${noun} ${i + 1}`}
              onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove</button>
          </li>
        ))}
      </ul>
      <button type="button" className={`${ghost} mt-1 text-[#B4502F]`} onClick={() => onChange([...items, `${noun} ${items.length + 1}`])}>+ {addLabel}</button>
    </div>
  );
}

function ImagePicker({ url, onChange, uploadFile, label = 'Image' }: {
  url?: string; onChange: (v: string) => void; uploadFile?: (f: File) => Promise<string>; label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pick = async (file?: File) => {
    if (!file) return;
    setError('');
    if (!file.type.startsWith('image/')) { setError('Choose an image file.'); return; }
    if (!uploadFile && file.size > 3 * 1024 * 1024) { setError('Images must be under 3 MB without an upload service.'); return; }
    setBusy(true);
    try { onChange(uploadFile ? await uploadFile(file) : await readAsDataUrl(file)); }
    catch (e: any) { setError(e?.message || 'Could not add the image.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-[#202124]">{label}</div>
      {url && <img src={url} alt="Attached to the question" className="max-h-48 max-w-full rounded-lg border border-[#E0E0E0] object-contain" />}
      <div className="flex flex-wrap items-center gap-2">
        <label className={`${btn} inline-flex cursor-pointer items-center focus-within:ring-2 focus-within:ring-[#F0A58C]`}>
          {busy ? 'Adding…' : url ? 'Replace image' : 'Upload image'}
          <input type="file" accept="image/*" className="sr-only" disabled={busy} onChange={e => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {url && <button type="button" className={ghost} onClick={() => onChange('')}>Remove image</button>}
      </div>
      <input aria-label={`${label} web address`} placeholder="Or paste an image link (https://…)" className={inp}
        value={url && !url.startsWith('data:') ? url : ''} onChange={e => onChange(e.target.value)} />
      {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    </div>
  );
}

function VideoPicker({ url, dataUrl, onUrl, onData }: { url?: string; dataUrl?: string; onUrl: (v: string) => void; onData: (v: string) => void }) {
  const [error, setError] = useState('');
  const isYouTube = !url || /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/.test(url);
  const pick = async (file?: File) => {
    if (!file) return;
    setError('');
    if (!file.type.startsWith('video/')) { setError('Choose a video file.'); return; }
    if (file.size > 10 * 1024 * 1024) { setError('Videos over 10 MB should be added as a YouTube link instead.'); return; }
    try { onData(await readAsDataUrl(file)); } catch (e: any) { setError(e?.message || 'Could not read the video.'); }
  };
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-[#202124]">Video</div>
      <input aria-label="YouTube link" placeholder="Paste a YouTube link" className={inp} value={url || ''} onChange={e => onUrl(e.target.value)} />
      {!isYouTube && <p className="text-xs text-amber-800">That doesn't look like a YouTube link, so the video won't show.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <label className={`${btn} inline-flex cursor-pointer items-center focus-within:ring-2 focus-within:ring-[#F0A58C]`}>
          {dataUrl ? 'Replace video file' : 'Upload video file (max 10 MB)'}
          <input type="file" accept="video/*" className="sr-only" onChange={e => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {dataUrl && <button type="button" className={ghost} onClick={() => onData('')}>Remove video file</button>}
      </div>
      {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    </div>
  );
}

/** Description editor with the B / I / U / list / image / heading toolbar. */
function RichDescription({ html, onChange, imageUrl, onImage, uploadFile }: {
  html: string; onChange: (v: string) => void; imageUrl: string; onImage: (v: string) => void; uploadFile?: (f: File) => Promise<string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== html && document.activeElement !== el) el.innerHTML = html;
  }, [html]);

  const exec = (command: string, value?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, value);
    if (ref.current) onChange(ref.current.innerHTML);
  };
  const tool = `flex h-10 w-10 items-center justify-center rounded-lg text-[#5F6368] hover:bg-black/5 hover:text-[#202124] ${ring}`;
  const keep = (e: React.MouseEvent) => e.preventDefault();

  const pickImage = async (file?: File) => {
    if (!file) return;
    setError('');
    if (!file.type.startsWith('image/')) { setError('Choose an image file.'); return; }
    if (!uploadFile && file.size > 3 * 1024 * 1024) { setError('Images must be under 3 MB without an upload service.'); return; }
    try { onImage(uploadFile ? await uploadFile(file) : await readAsDataUrl(file)); }
    catch (e: any) { setError(e?.message || 'Could not add the image.'); }
  };

  return (
    <div className={card}>
      <div role="toolbar" aria-label="Description formatting" className="flex flex-wrap items-center gap-1 border-b border-[#E0E0E0] pb-3">
        <button type="button" className={tool} aria-label="Bold" onMouseDown={keep} onClick={() => exec('bold')}><span className="font-bold">B</span></button>
        <button type="button" className={tool} aria-label="Italic" onMouseDown={keep} onClick={() => exec('italic')}><span className="italic">I</span></button>
        <button type="button" className={tool} aria-label="Underline" onMouseDown={keep} onClick={() => exec('underline')}><span className="underline">U</span></button>
        <button type="button" className={tool} aria-label="Bulleted list" onMouseDown={keep} onClick={() => exec('insertUnorderedList')}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="4.5" cy="6" r="1.3" fill="currentColor" /><circle cx="4.5" cy="12" r="1.3" fill="currentColor" /><circle cx="4.5" cy="18" r="1.3" fill="currentColor" /></svg>
        </button>
        <label className={`${tool} cursor-pointer focus-within:ring-2 focus-within:ring-[#F0A58C]`} title="Add a picture under the description">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="9" cy="10" r="1.6" fill="currentColor" /><path d="M4 17l5-4.5 4 3 3-2.5 4 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
          <span className="sr-only">Add a picture under the description</span>
          <input type="file" accept="image/*" className="sr-only" onChange={e => { pickImage(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        <button type="button" className={tool} aria-label="Heading" onMouseDown={keep} onClick={() => exec('formatBlock', 'h3')}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M12 6v13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label="Form description"
        contentEditable
        suppressContentEditableWarning
        data-placeholder="Form description (optional) — tell respondents what this is for"
        onInput={e => {
          const el = e.currentTarget;
          if (!el.textContent?.trim() && !el.querySelector('li,h3')) el.innerHTML = '';
          onChange(el.innerHTML);
        }}
        onPaste={e => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }}
        className="mt-4 min-h-[5rem] text-base leading-7 text-[#202124] outline-none empty:before:text-[#757575] empty:before:content-[attr(data-placeholder)] [&_h3]:text-lg [&_h3]:font-bold [&_li]:ml-5 [&_ul]:list-disc"
      />
      {imageUrl && (
        <div className="mt-3 space-y-2">
          <img src={imageUrl} alt="Attached to the form description" className="max-h-56 max-w-full rounded-lg border border-[#E0E0E0] object-contain" />
          <button type="button" className={ghost} onClick={() => onImage('')}>Remove picture</button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------ question editors */

function QuestionEditor({ q, quiz, patch, uploadFile }: {
  q: Question; quiz: boolean; patch: (p: Partial<Question>) => void; uploadFile?: (f: File) => Promise<string>;
}) {
  const [media, setMedia] = useState<'none' | 'image' | 'video'>(q.imageUrl ? 'image' : q.videoUrl || q.videoDataUrl ? 'video' : 'none');
  const cleanOptions = clean(q.options);
  const gradable = CHOICE.has(q.type) || q.type === 'text' || q.type === 'number';

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
        <Field label="Question">
          <input className={inp} value={q.label} placeholder="Type your question" onChange={e => patch({ label: e.target.value })} />
        </Field>
        <Field label="Type">
          <select className={inp} value={q.type} onChange={e => {
            const next = makeQuestion(e.target.value);
            patch({
              type: next.type,
              options: CHOICE.has(next.type) ? (q.options.length ? q.options : next.options) : q.options,
              rows: GRID.has(next.type) ? (q.rows.length ? q.rows : next.rows) : q.rows,
              columns: GRID.has(next.type) ? (q.columns.length ? q.columns : next.columns) : q.columns,
              correctAnswer: undefined,
            });
          }}>
            {QUESTION_TYPES.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Description (optional)">
        <input className={inp} value={q.description} placeholder="Help text shown under the question" onChange={e => patch({ description: e.target.value })} />
      </Field>

      {CHOICE.has(q.type) && (
        <div className="space-y-3">
          <ListEditor label="Options" noun="Option" addLabel="Add option" items={q.options} onChange={options => patch({ options })} />
          {q.type !== 'select' && <Toggle label='Add an "Other" option' checked={!!q.allowOther} onChange={allowOther => patch({ allowOther })} />}
          <Toggle label="Shuffle option order" checked={!!q.shuffleOptions} onChange={shuffleOptions => patch({ shuffleOptions })} />
          {q.type === 'checkbox' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Select at least"><input type="number" min={0} className={inp} value={q.minSelected ?? ''} onChange={e => patch({ minSelected: num(e.target.value) })} /></Field>
              <Field label="Select no more than"><input type="number" min={0} className={inp} value={q.maxSelected ?? ''} onChange={e => patch({ maxSelected: num(e.target.value) })} /></Field>
            </div>
          )}
        </div>
      )}

      {GRID.has(q.type) && (
        <div className="grid gap-5 sm:grid-cols-2">
          <ListEditor label="Rows" noun="Row" addLabel="Add row" items={q.rows} onChange={rows => patch({ rows })} />
          <ListEditor label="Columns" noun="Column" addLabel="Add column" items={q.columns} onChange={columns => patch({ columns })} />
        </div>
      )}

      {q.type === 'linear_scale' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From"><select className={inp} value={q.scaleMin} onChange={e => patch({ scaleMin: Number(e.target.value) })}><option value={0}>0</option><option value={1}>1</option></select></Field>
          <Field label="To"><select className={inp} value={q.scaleMax} onChange={e => patch({ scaleMax: Number(e.target.value) })}>{[2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n}</option>)}</select></Field>
          <Field label="Label for the low end"><input className={inp} value={q.scaleMinLabel} onChange={e => patch({ scaleMinLabel: e.target.value })} /></Field>
          <Field label="Label for the high end"><input className={inp} value={q.scaleMaxLabel} onChange={e => patch({ scaleMaxLabel: e.target.value })} /></Field>
        </div>
      )}

      {q.type === 'rating' && (
        <Field label="Number of stars"><select className={inp} value={q.maxRating} onChange={e => patch({ maxRating: Number(e.target.value) })}>{[3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n}</option>)}</select></Field>
      )}

      {q.type === 'file' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Allowed files">
            <select className={inp} value={q.accept} onChange={e => patch({ accept: e.target.value })}>
              <option value="">Any file</option>
              <option value=".pdf">PDF</option>
              <option value="image/*">Images</option>
              <option value=".doc,.docx">Word documents</option>
              <option value=".xls,.xlsx,.csv">Spreadsheets</option>
              <option value="video/*">Video</option>
            </select>
          </Field>
          <Field label="Maximum size (MB)"><input type="number" min={1} max={100} className={inp} value={q.maxSizeMB} onChange={e => patch({ maxSizeMB: Math.max(1, Number(e.target.value) || 1) })} /></Field>
        </div>
      )}

      {TEXTY.has(q.type) && (
        <details className="rounded-lg border border-[#E0E0E0] p-3">
          <summary className="cursor-pointer text-sm font-semibold text-[#202124]">Answer rules (optional)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {q.type === 'number' ? (
              <>
                <Field label="Smallest number"><input type="number" className={inp} value={q.min ?? ''} onChange={e => patch({ min: num(e.target.value) })} /></Field>
                <Field label="Largest number"><input type="number" className={inp} value={q.max ?? ''} onChange={e => patch({ max: num(e.target.value) })} /></Field>
              </>
            ) : (
              <>
                <Field label="Minimum length"><input type="number" min={0} className={inp} value={q.minLength ?? ''} onChange={e => patch({ minLength: num(e.target.value) })} /></Field>
                <Field label="Maximum length"><input type="number" min={0} className={inp} value={q.maxLength ?? ''} onChange={e => patch({ maxLength: num(e.target.value) })} /></Field>
                <Field label="Must match pattern" hint="A regular expression, for example ^[0-9]{10}$"><input className={inp} value={q.pattern ?? ''} onChange={e => patch({ pattern: e.target.value })} /></Field>
                <Field label="Message if it doesn't match"><input className={inp} value={q.patternMessage ?? ''} onChange={e => patch({ patternMessage: e.target.value })} /></Field>
              </>
            )}
          </div>
        </details>
      )}

      {quiz && (
        <div className="space-y-3 rounded-lg bg-[#F8F9FA] p-3">
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <Field label="Points"><input type="number" min={0} className={inp} value={q.points ?? ''} onChange={e => patch({ points: num(e.target.value) })} /></Field>
            {gradable ? (
              CHOICE.has(q.type) ? (
                q.type === 'checkbox' ? (
                  <fieldset>
                    <legend className="mb-1 text-sm font-semibold text-[#202124]">Correct answers</legend>
                    {cleanOptions.map(o => {
                      const list = Array.isArray(q.correctAnswer) ? q.correctAnswer : [];
                      return (
                        <label key={o} className="flex min-h-9 items-center gap-2 text-sm text-[#202124]">
                          <input type="checkbox" className="h-4 w-4 accent-[#D97757]" checked={list.includes(o)}
                            onChange={e => patch({ correctAnswer: e.target.checked ? [...list, o] : list.filter(x => x !== o) })} />
                          {o}
                        </label>
                      );
                    })}
                  </fieldset>
                ) : (
                  <Field label="Correct answer">
                    <select className={inp} value={typeof q.correctAnswer === 'string' ? q.correctAnswer : ''} onChange={e => patch({ correctAnswer: e.target.value })}>
                      <option value="">Choose</option>
                      {cleanOptions.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </Field>
                )
              ) : (
                <Field label="Correct answer" hint="Matched exactly when graded.">
                  <input className={inp} value={typeof q.correctAnswer === 'string' ? q.correctAnswer : ''} onChange={e => patch({ correctAnswer: e.target.value })} />
                </Field>
              )
            ) : <p className="self-end text-xs text-[#5F6368]">This question type is not graded automatically.</p>}
          </div>
        </div>
      )}

      <div className="space-y-3 border-t border-[#E0E0E0] pt-4">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Attach media">
          <span className="text-sm font-semibold text-[#202124]">Add media:</span>
          <button type="button" className={`${ghost} ${media === 'image' ? 'bg-black/10 text-[#202124]' : ''}`} aria-pressed={media === 'image'} onClick={() => setMedia(media === 'image' ? 'none' : 'image')}>Picture</button>
          <button type="button" className={`${ghost} ${media === 'video' ? 'bg-black/10 text-[#202124]' : ''}`} aria-pressed={media === 'video'} onClick={() => setMedia(media === 'video' ? 'none' : 'video')}>Video</button>
        </div>
        {media === 'image' && <ImagePicker url={q.imageUrl} onChange={imageUrl => patch({ imageUrl })} uploadFile={uploadFile} />}
        {media === 'video' && <VideoPicker url={q.videoUrl} dataUrl={q.videoDataUrl} onUrl={videoUrl => patch({ videoUrl })} onData={videoDataUrl => patch({ videoDataUrl })} />}
      </div>
    </div>
  );
}

function BlockEditor({ b, patch, uploadFile }: { b: Block; patch: (p: Partial<Block>) => void; uploadFile?: (f: File) => Promise<string> }) {
  const heading = { section: 'Section (starts a new page)', image: 'Picture', video: 'Video', text: 'Title and description' }[b.kind];
  return (
    <div className="space-y-4">
      <div className={eyebrow}>{heading}</div>
      <Field label="Title"><input className={inp} value={b.title} onChange={e => patch({ title: e.target.value })} /></Field>
      <Field label="Description (optional)"><textarea rows={2} className={inp} value={b.description} onChange={e => patch({ description: e.target.value })} /></Field>
      {b.kind === 'image' && <ImagePicker url={b.url} onChange={url => patch({ url })} uploadFile={uploadFile} />}
      {b.kind === 'video' && <VideoPicker url={b.url} onUrl={url => patch({ url })} onData={() => undefined} />}
    </div>
  );
}

/* ------------------------------------------------------------------- main */

const AGENT_CHIPS = [
  { label: 'Generate Scholarship Form', prompt: 'Create a scholarship application form with personal details, academic background, financial need and a short essay.' },
  { label: 'Tech Role Screening Form', prompt: 'Create a screening form for a software engineering role with experience, skills, availability and a short technical question.' },
  { label: 'Course Evaluation Survey', prompt: 'Create a course evaluation survey with ratings for teaching, materials and workload, plus open feedback.' },
  { label: 'Add 3 Smart Follow-up Questions', prompt: 'Add 3 smart follow-up questions that fit this form.' },
];

export default function FormBuilder({ initialSchema, onChange, onPublish, shareUrl, uploadFile, onBack, onResults, onRunAgent }: FormBuilderProps) {
  const [state, setState] = useState<BuilderState>(() => (initialSchema ? fromSchema(initialSchema) : blankState()));
  const [activeId, setActiveId] = useState<string | null>(() => state.items[0]?.id ?? null);
  const [view, setView] = useState<'build' | 'preview'>('build');
  const [problems, setProblems] = useState<Problem[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | undefined>(shareUrl);
  const [publishedJson, setPublishedJson] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [aiOpen, setAiOpen] = useState(true);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');

  const schema = useMemo(() => buildSchema(state), [state]);
  const schemaJson = useMemo(() => JSON.stringify(schema), [schema]);
  const questionCount = state.items.filter(i => i.kind === 'question').length;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => { onChangeRef.current?.(schema); }, [schema]);
  useEffect(() => { if (shareUrl) setPublishedUrl(shareUrl); }, [shareUrl]);

  const status = publishedJson === null ? 'Draft' : publishedJson === schemaJson ? 'Published' : 'Unpublished changes';

  const setField = <K extends keyof BuilderState>(key: K, value: BuilderState[K]) => setState(s => ({ ...s, [key]: value }));
  const patchItem = (id: string, p: Partial<Item>) =>
    setState(s => ({ ...s, items: s.items.map(i => (i.id === id ? ({ ...i, ...p } as Item) : i)) }));

  const insert = (item: Item) => {
    setState(s => {
      const at = activeId ? s.items.findIndex(i => i.id === activeId) : -1;
      const items = [...s.items];
      items.splice(at >= 0 ? at + 1 : items.length, 0, item);
      return { ...s, items };
    });
    setActiveId(item.id);
    requestAnimationFrame(() => document.getElementById(`item-${item.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };
  const move = (id: string, dir: -1 | 1) =>
    setState(s => {
      const i = s.items.findIndex(x => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.items.length) return s;
      const items = [...s.items];
      [items[i], items[j]] = [items[j], items[i]];
      return { ...s, items };
    });
  const duplicate = (id: string) => {
    const original = state.items.find(i => i.id === id);
    if (!original) return;
    const next = { ...original, id: `${original.kind === 'question' ? 'q' : 'b'}_${uid()}` } as Item;
    setState(s => {
      const items = [...s.items];
      items.splice(items.findIndex(i => i.id === id) + 1, 0, next);
      return { ...s, items };
    });
    setActiveId(next.id);
  };
  const remove = (id: string) => {
    setState(s => ({ ...s, items: s.items.filter(i => i.id !== id) }));
    setActiveId(null);
  };

  const publish = async () => {
    const found = findProblems(state);
    setProblems(found);
    if (found.length) {
      setView('build');
      if (found[0].id) setActiveId(found[0].id);
      return;
    }
    setPublishing(true);
    try {
      const res = await onPublish?.(schema);
      const url = (res && typeof res === 'object' && res.shareUrl) || shareUrl || publishedUrl;
      setPublishedUrl(url);
      setAnnouncement(`Hi! Please fill in "${schema.title}"${url ? `: ${url}` : '.'}`);
      setPublishedJson(schemaJson);
      setShareOpen(true);
    } catch (e: any) {
      setProblems([{ text: e?.message || 'Publishing failed. Please try again.' }]);
    } finally {
      setPublishing(false);
    }
  };

  const copy = async (text: string, key: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1800); }
    catch { setCopied('failed'); }
  };

  const runAgent = async (prompt: string) => {
    const text = prompt.trim();
    if (!text || !onRunAgent || aiBusy) return;
    setAiBusy(true);
    setAiError('');
    try {
      const result = await onRunAgent(text, schema);
      if (result) {
        const next = fromSchema(result);
        setState(next);
        setActiveId(next.items[0]?.id ?? null);
        setAiPrompt('');
      }
    } catch (e: any) {
      setAiError(e?.message || 'The AI agent could not complete that. Please try again.');
    } finally {
      setAiBusy(false);
    }
  };

  let questionNumber = 0;
  const seg = (id: 'build' | 'preview', text: string) => (
    <button type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
      className={`min-h-10 rounded-lg px-5 text-xs font-bold uppercase tracking-wider ${ring} ${view === id ? 'bg-[#FCE9E2] text-[#202124]' : 'text-[#5F6368] hover:text-[#202124]'}`}>
      {text}
    </button>
  );
  const headBtn = `inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#DADCE0] px-4 text-sm font-bold text-[#202124] hover:bg-black/5 ${ring}`;

  return (
    <div className="min-h-full bg-[#F0EBF8] text-[#202124]">
      {/* ---------- header ---------- */}
      <header className="border-b border-[#E0E0E0] bg-white px-4 py-4 shadow-sm sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-3">
          {onBack && (
            <button type="button" onClick={onBack} aria-label="Back" className={`flex h-11 w-11 items-center justify-center rounded-xl text-[#5F6368] hover:bg-black/5 ${ring}`}>
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          )}
          <div className="min-w-0 flex-1 basis-52">
            <label>
              <span className="sr-only">Form title</span>
              <input value={state.title} onChange={e => setField('title', e.target.value)} placeholder="Untitled form"
                className="w-full bg-transparent text-2xl font-bold text-[#202124] placeholder:text-[#757575] outline-none focus:underline focus:decoration-[#D97757] focus:underline-offset-4" />
            </label>
            <p className="mt-1 text-xs font-bold uppercase tracking-widest text-[#5F6368]" aria-live="polite">
              {questionCount} {questionCount === 1 ? 'question' : 'questions'} · {status}
            </p>
          </div>

          <div role="tablist" aria-label="Builder view" className="flex rounded-xl border border-[#E0E0E0] bg-[#F8F9FA] p-1">
            {seg('build', 'Build')}
            {seg('preview', 'Preview')}
          </div>

          {onRunAgent && (
            <button type="button" onClick={() => setAiOpen(o => !o)} aria-expanded={aiOpen}
              className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold text-[#B4502F] hover:bg-black/5 ${ring}`}>
              <SparkIcon /> Generate with AI instead
            </button>
          )}

          <button type="button" onClick={publish} disabled={publishing} className={`${primary} inline-flex items-center gap-2`}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {publishing ? 'Publishing…' : 'Save & Publish'}
          </button>

          <label className={`${headBtn} cursor-pointer focus-within:ring-2 focus-within:ring-[#F0A58C]`}>
            Theme
            <span aria-hidden="true" className="h-6 w-9 rounded-md border border-black/20" style={{ backgroundColor: state.themeColor }} />
            <input type="color" aria-label="Form theme color" className="sr-only" value={state.themeColor} onChange={e => setField('themeColor', e.target.value)} />
          </label>
          <button type="button" className={headBtn} aria-expanded={shareOpen} onClick={() => setShareOpen(o => !o)}>Get link</button>
          {onResults && <button type="button" className={headBtn} onClick={onResults}>Results</button>}
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-8 sm:px-6">
        {problems.length > 0 && (
          <div role="alert" className="rounded-xl border border-rose-400 bg-rose-50 p-4 text-sm text-rose-900">
            <p className="font-semibold">Fix these before publishing:</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              {problems.map((p, i) => (
                <li key={i}>
                  {p.id ? <button type="button" className="text-left underline" onClick={() => { setView('build'); setActiveId(p.id!); }}>{p.text}</button> : p.text}
                </li>
              ))}
            </ul>
          </div>
        )}

        {shareOpen && (
          <section aria-label="Share your form" className={`${card} space-y-4`}>
            <h2 className="text-lg font-bold">Share your form</h2>
            {publishedUrl && publishedJson !== null ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <input readOnly aria-label="Form link" value={publishedUrl} className={`${inp} flex-1`} onFocus={e => e.currentTarget.select()} />
                  <button type="button" className={btn} onClick={() => copy(publishedUrl, 'link')}>{copied === 'link' ? 'Copied' : 'Copy link'}</button>
                </div>
                <Field label="Announcement message" hint="Edit it, then paste it into WhatsApp, email or your class channel.">
                  <textarea rows={3} className={inp} value={announcement} onChange={e => setAnnouncement(e.target.value)} />
                </Field>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className={btn} onClick={() => copy(announcement, 'msg')}>{copied === 'msg' ? 'Copied' : 'Copy message'}</button>
                  <Toggle label="Accepting responses" checked={state.acceptingResponses} onChange={v => setField('acceptingResponses', v)} />
                </div>
                {copied === 'failed' && <p role="alert" className="text-xs text-rose-700">Copying isn't available here. Select the text and copy it manually.</p>}
              </>
            ) : (
              <p className="text-sm text-[#5F6368]">
                {publishedJson === null ? 'Publish your form to get a link you can share.' : 'Return a shareUrl from onPublish to show the link here.'}
              </p>
            )}
          </section>
        )}

        {view === 'preview' ? (
          <div role="tabpanel" aria-label="Preview" className="space-y-3">
            <p className="rounded-xl bg-[#FFFFFF] px-4 py-3 text-sm text-[#5F6368]">Preview only. Nothing you enter here is saved.</p>
            <div className="rounded-2xl bg-[#F0EBF8] p-4 sm:p-6">
              <DynamicForm
                key={schemaJson.length}
                schema={schema}
                draftKey="__builder_preview__"
                onSubmit={async () => ({ message: 'Preview only: this response was not saved.' })}
              />
            </div>
          </div>
        ) : (
          <div role="tabpanel" aria-label="Build" className="space-y-5">
            {/* ---------- AI co-pilot ---------- */}
            {onRunAgent && aiOpen && (
              <section aria-label="AI form co-pilot" className="rounded-2xl border border-[#F0C9BA] bg-gradient-to-br from-[#FDF1EC] to-[#FFFFFF] p-5 sm:p-6">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#B4502F]"><SparkIcon /> AI form co-pilot agent</h2>
                  <p className="text-xs text-[#5F6368]">Auto-draft, refine, or add scoring criteria</p>
                </div>
                <form className="mt-4 flex flex-wrap gap-3" onSubmit={e => { e.preventDefault(); runAgent(aiPrompt); }}>
                  <label className="min-w-0 flex-1 basis-64">
                    <span className="sr-only">Tell the AI agent what to build or change</span>
                    <input value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} disabled={aiBusy}
                      placeholder="Ask the AI agent to build or edit this form, for example: create a 6-question fellowship application"
                      className={`${inp} h-12 rounded-xl border-[#E6C4B6] bg-[#F8F9FA]`} />
                  </label>
                  <button type="submit" disabled={aiBusy || !aiPrompt.trim()} className={`${primary} inline-flex h-12 items-center gap-2`}>
                    <SparkIcon /> {aiBusy ? 'Working…' : 'Run AI Form Agent'}
                  </button>
                </form>
                <div className="mt-3 flex flex-wrap gap-2">
                  {AGENT_CHIPS.map(c => (
                    <button key={c.label} type="button" disabled={aiBusy} onClick={() => { setAiPrompt(c.prompt); runAgent(c.prompt); }}
                      className={`min-h-10 rounded-lg border border-[#DADCE0] bg-[#F8F9FA] px-3 text-sm font-medium text-[#202124] hover:border-[#D97757] ${ring} disabled:opacity-50`}>
                      {c.label}
                    </button>
                  ))}
                </div>
                {aiError && <p role="alert" className="mt-3 text-sm text-rose-700">{aiError}</p>}
              </section>
            )}

            {/* ---------- description ---------- */}
            <RichDescription
              html={state.description}
              onChange={v => setField('description', v)}
              imageUrl={state.descriptionImageUrl}
              onImage={v => setField('descriptionImageUrl', v)}
              uploadFile={uploadFile}
            />

            <details className={`${card} !p-0`}>
              <summary className="min-h-11 cursor-pointer list-none px-5 py-3 text-sm font-bold text-[#202124] sm:px-6">Form settings</summary>
              <div className="space-y-1 border-t border-[#E0E0E0] px-5 py-4 sm:px-6">
                <Toggle label="Make this a quiz" checked={state.isQuiz} onChange={v => setField('isQuiz', v)} hint="Adds points and correct answers to each question. Grade on your server." />
                <Toggle label="Collect email addresses" checked={state.collectEmail} onChange={v => setField('collectEmail', v)} />
                <Toggle label="Accepting responses" checked={state.acceptingResponses} onChange={v => setField('acceptingResponses', v)} />
                <Toggle label="Allow more than one response per person" checked={state.allowMultipleResponses} onChange={v => setField('allowMultipleResponses', v)} hint="Also enforce this on your server." />
                <div className="pt-2"><Field label="Confirmation message"><textarea rows={2} className={inp} value={state.confirmationMessage} onChange={e => setField('confirmationMessage', e.target.value)} /></Field></div>
              </div>
            </details>

            {/* ---------- questions ---------- */}
            {state.items.length === 0 && (
              <div className="rounded-2xl border-2 border-dashed border-[#F0C9BA] px-6 py-14 text-center">
                <svg width="44" height="44" viewBox="0 0 24 24" aria-hidden="true" className="mx-auto text-[#B4502F]">
                  <path d="M6 2.5h8l4.5 4.5v14a1 1 0 0 1-1 1h-11.5a1 1 0 0 1-1-1v-17.5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  <path d="M14 2.5v4.5h4.5M8.5 12h7M8.5 15.5h7M8.5 19h4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <h2 className="mt-4 text-lg font-bold">No questions yet</h2>
                <p className="mt-1 text-sm text-[#5F6368]">Pick a question type below to add your first field.</p>
              </div>
            )}

            {state.items.map((item, index) => {
              const active = activeId === item.id;
              const isQ = item.kind === 'question';
              if (isQ) questionNumber += 1;
              const label = isQ
                ? `${questionNumber}. ${(item as Question).label || 'Untitled question'}`
                : `${{ section: 'Section', image: 'Picture', video: 'Video', text: 'Title and description' }[item.kind]}${(item as Block).title ? `: ${(item as Block).title}` : ''}`;
              const sub = isQ ? TYPE_LABEL[(item as Question).type] || (item as Question).type : item.kind === 'section' ? 'Starts a new page' : 'Layout item';
              return (
                <section key={item.id} id={`item-${item.id}`}
                  className={`${card} ${active ? 'border-l-4 border-l-[#B4502F] shadow-md' : 'hover:border-[#DADCE0]'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <button type="button" onClick={() => setActiveId(active ? null : item.id)} aria-expanded={active}
                      className={`min-h-11 min-w-0 flex-1 rounded-lg text-left ${ring}`}>
                      <span className="block truncate text-base font-semibold text-[#202124]">{label}</span>
                      <span className="block text-xs font-medium uppercase tracking-wider text-[#5F6368]">{sub}{isQ && (item as Question).required ? ' · Required' : ''}</span>
                    </button>
                    <div className="flex flex-wrap items-center" role="group" aria-label={`Actions for ${label}`}>
                      <button type="button" className={ghost} onClick={() => move(item.id, -1)} disabled={index === 0} aria-label="Move up">Up</button>
                      <button type="button" className={ghost} onClick={() => move(item.id, 1)} disabled={index === state.items.length - 1} aria-label="Move down">Down</button>
                      <button type="button" className={ghost} onClick={() => duplicate(item.id)} aria-label="Duplicate">Duplicate</button>
                      <button type="button" className={`${ghost} !text-rose-700`} onClick={() => remove(item.id)} aria-label="Delete">Delete</button>
                    </div>
                  </div>
                  {active && (
                    <div className="mt-4 border-t border-[#E0E0E0] pt-4">
                      {isQ ? (
                        <>
                          <QuestionEditor q={item as Question} quiz={state.isQuiz} patch={p => patchItem(item.id, p)} uploadFile={uploadFile} />
                          <div className="mt-5 border-t border-[#E0E0E0] pt-3">
                            <Toggle label="Required" checked={(item as Question).required} onChange={required => patchItem(item.id, { required })} />
                          </div>
                        </>
                      ) : (
                        <BlockEditor b={item as Block} patch={p => patchItem(item.id, p)} uploadFile={uploadFile} />
                      )}
                    </div>
                  )}
                </section>
              );
            })}

            {/* ---------- add question ---------- */}
            <section aria-label="Add a question" className={card}>
              <h2 className={eyebrow}>Add a question</h2>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {QUESTION_TYPES.map(t => (
                  <button key={t.type} type="button" onClick={() => insert(makeQuestion(t.type))}
                    className={`flex min-h-12 items-center gap-3 rounded-xl border border-[#E0E0E0] bg-[#F8F9FA] px-3 text-left text-sm font-medium text-[#202124] hover:border-[#D97757] ${ring}`}>
                    <span aria-hidden="true" className="w-9 shrink-0 text-center font-mono text-xs text-[#B4502F]">{t.glyph}</span>
                    {t.label}
                  </button>
                ))}
              </div>
              <h3 className={`${eyebrow} mt-5`}>Add layout</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {([['section', 'Section (new page)'], ['text', 'Title and description'], ['image', 'Picture'], ['video', 'Video']] as const).map(([kind, text]) => (
                  <button key={kind} type="button" onClick={() => insert(makeBlock(kind))}
                    className={`min-h-10 rounded-lg border border-[#E0E0E0] bg-[#F8F9FA] px-3 text-sm font-medium text-[#202124] hover:border-[#D97757] ${ring}`}>
                    + {text}
                  </button>
                ))}
              </div>
              <p className="mt-4 text-xs text-[#5F6368]">New items are added after the one you have open.</p>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}