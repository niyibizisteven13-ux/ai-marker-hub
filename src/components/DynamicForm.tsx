/**
 * DynamicForm — respondent-side form renderer (drop-in replacement).
 *
 * Props
 *  - schema      JSON string or object. Old formats (`fields`, `questions`, `blocks`, uppercase types) still work.
 *  - onSubmit    receives the answers. May return { message, score, maxScore, scoreLabel, feedback, results[] }.
 *  - uploadFile  optional (file, onProgress) => Promise<url>. Without it, files are embedded as data URLs.
 *  - draftKey    optional key for the autosaved draft (defaults to schema id / title).
 *
 * New schema options (all optional)
 *  field: allowOther, shuffleOptions, minLength, maxLength, min, max, pattern, patternMessage,
 *         minSelected, maxSelected, accept, maxSizeMB, placeholder, columns,
 *         showIf { fieldId, equals | notEquals | includes | notEmpty }
 *  A field with `sectionTitle` starts a new page. A block with `beforeFieldId` is placed before that
 *  field; if its type is SECTION it also starts a new page.
 *
 * IMPORTANT (server side): never send `correctAnswer` to the browser and grade on the server.
 * This component deletes `correctAnswer` from its own copy, but it was already in the network response.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeBranding } from '../../shared/formBranding';
import { FileThumb, PreviewDialog, type PreviewSource } from './FilePreview';

/* ------------------------------------------------------------------ types */

type Opt = string | { label: string };
type ShowIf = { fieldId: string; equals?: any; notEquals?: any; includes?: string; notEmpty?: boolean };

export type FormField = {
  id: string;
  type: string;
  label: string;
  description?: string;
  required?: boolean;
  points?: number;
  options?: Opt[];
  rows?: string[];
  columns?: string[];
  sectionTitle?: string;
  contentTitle?: string;
  imageUrl?: string;
  videoUrl?: string;
  videoDataUrl?: string;
  scaleMin?: number;
  scaleMax?: number;
  scaleMinLabel?: string;
  scaleMaxLabel?: string;
  maxRating?: number;
  placeholder?: string;
  allowOther?: boolean;
  shuffleOptions?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  patternMessage?: string;
  minSelected?: number;
  maxSelected?: number;
  accept?: string;
  maxSizeMB?: number;
  showIf?: ShowIf;
};

type FormSchema = {
  id?: string;
  title?: string;
  description?: string;
  descriptionImageUrl?: string;
  fields?: any[];
  questions?: any[];
  blocks?: any[];
  themeColor?: string;
  isQuiz?: boolean;
  collectEmail?: boolean;
  acceptingResponses?: boolean;
  allowMultipleResponses?: boolean;
  confirmationMessage?: string;
};

type Answers = Record<string, any>;
type FileValue = { name: string; size: number; url: string };
type UploadState = { busy: boolean; progress: number; error?: string; /** The file on this device, for its preview. */ local?: File };
type Item = { kind: 'block'; block: any } | { kind: 'field'; field: FormField };
type Page = { title?: string; description?: string; items: Item[] };

type ReviewItem = {
  id: string;
  correct?: boolean;
  points?: number;
  maxPoints?: number;
  yourAnswer?: any;
  correctAnswer?: any;
  explanation?: string;
};
type SubmitResult = {
  message: string;
  score?: number | null;
  maxScore?: number;
  scoreLabel?: string;
  feedback?: string | null;
  results?: ReviewItem[];
};

export type DynamicFormProps = {
  schema: string | any;
  onSubmit: (data: any) => void | Promise<any>;
  uploadFile?: (file: File, onProgress?: (percent: number) => void) => Promise<string>;
  draftKey?: string;
};

/* ---------------------------------------------------------------- helpers */

const OTHER = '__other__';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9\s().-]{7,18}$/;
const YT_RE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/;
const GROUP_TYPES = new Set(['radio', 'checkbox', 'linear_scale', 'rating', 'radio_grid', 'checkbox_grid', 'file']);

const TYPE_MAP: Record<string, string> = {
  SHORT_TEXT: 'text', LONG_TEXT: 'long_text', MULTIPLE_CHOICE: 'radio', CHECKBOX: 'checkbox',
  DROPDOWN: 'select', DATE: 'date', NUMBER: 'number', EMAIL: 'email', PHONE: 'tel', URL: 'url',
  FILE_UPLOAD: 'file', RATING: 'rating', LINEAR_SCALE: 'linear_scale', MULTIPLE_CHOICE_GRID: 'radio_grid',
  CHECKBOX_GRID: 'checkbox_grid', TIME: 'time', MCQ: 'select', ESSAY: 'long_text',
};
const normalizeType = (type?: string) => {
  const raw = String(type || 'text');
  return TYPE_MAP[raw.toUpperCase().replace(/[\s-]/g, '_')] || raw.toLowerCase();
};

const optionLabel = (o: Opt) => (typeof o === 'string' ? o : o.label);

const isEmpty = (v: any) =>
  v === undefined || v === null || v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && !('url' in v) && Object.keys(v).length === 0);

const shuffled = <T,>(list: T[]): T[] => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const showAnswer = (v: any): string =>
  Array.isArray(v) ? v.join(', ') : v && typeof v === 'object' ? (v.name ?? JSON.stringify(v)) : String(v ?? '—');

/** Parses the schema and merges an inner `schema` field (old API shape). Never throws. */
function parseSchema(input: any): { schema: FormSchema | null; failed: boolean } {
  if (!input) return { schema: null, failed: false };
  let obj: any = input;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); } catch (error) {
      console.error('DynamicForm: failed to parse schema string', error);
      return { schema: null, failed: true };
    }
  }
  if (!obj || typeof obj !== 'object') return { schema: null, failed: true };
  if (obj.schema && !Array.isArray(obj.questions) && !Array.isArray(obj.fields)) {
    let inner = obj.schema;
    if (typeof inner === 'string') { try { inner = JSON.parse(inner); } catch { inner = {}; } }
    if (inner && typeof inner === 'object') obj = { ...obj, ...inner };
  }
  return { schema: obj, failed: false };
}

function normalizeFields(schema: FormSchema): FormField[] {
  const usingFields = Array.isArray(schema.fields);
  const raw: any[] = usingFields ? schema.fields! : schema.questions || [];
  return raw.map((q, index) => {
    const { correctAnswer: _hidden, ...rest } = q || {};
    return {
      ...rest,
      id: String(q.id ?? q.number ?? index + 1),
      label: q.label || q.title || q.text || `Question ${q.number ?? index + 1}`,
      type: normalizeType(q.type),
      required: usingFields ? !!q.required : q.required === true,
      points: q.points !== undefined ? Number(q.points) : undefined,
      options: q.options || [],
    } as FormField;
  });
}

/** The file someone attached, as a thumbnail that opens full screen, so they can check it before sending. */
function AttachedPreview({ file, value }: { file?: File; value: FileValue }) {
  const [open, setOpen] = useState(false);
  const src = useMemo<PreviewSource>(() => (file ? { name: file.name, type: file.type, file, size: file.size } : { name: value.name, type: /^data:([^;,]+)/.exec(value.url ?? '')?.[1] ?? '', url: value.url, size: value.size }), [file, value.name, value.url, value.size]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Preview ${value.name}`} title="Preview" className="h-14 w-11 shrink-0 overflow-hidden rounded-md border border-slate-300 hover:ring-2 hover:ring-slate-400">
        <FileThumb src={src} badge={false} className="h-full w-full" />
      </button>
      {open && <PreviewDialog src={src} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Splits fields and blocks into pages. */
function buildPages(fields: FormField[], blocks: any[], emailField?: FormField): Page[] {
  const before: Record<string, any[]> = {};
  const lead: any[] = [];
  for (const block of blocks) {
    const target = block.beforeFieldId ?? block.before;
    if (target !== undefined && target !== null) (before[String(target)] ||= []).push(block);
    else lead.push(block);
  }
  const pages: Page[] = [{ items: [] }];
  const current = () => pages[pages.length - 1];
  const startPage = (title?: string, description?: string) => {
    if (current().items.some(item => item.kind === 'field')) pages.push({ title, description, items: [] });
    else { current().title = title; current().description = description; }
  };
  if (emailField) current().items.push({ kind: 'field', field: emailField });
  lead.forEach(block => current().items.push({ kind: 'block', block }));
  for (const field of fields) {
    for (const block of before[field.id] || []) {
      if (block.type === 'SECTION') startPage(block.title, block.description);
      else current().items.push({ kind: 'block', block });
    }
    if (field.sectionTitle) startPage(field.sectionTitle);
    current().items.push({ kind: 'field', field });
  }
  return pages;
}

function isVisible(field: FormField, answers: Answers): boolean {
  const rule = field.showIf;
  if (!rule) return true;
  const v = answers[rule.fieldId];
  if (rule.notEmpty !== undefined) return rule.notEmpty ? !isEmpty(v) : isEmpty(v);
  if (rule.equals !== undefined) return Array.isArray(v) ? v.includes(rule.equals) : v === rule.equals;
  if (rule.notEquals !== undefined) return Array.isArray(v) ? !v.includes(rule.notEquals) : v !== rule.notEquals;
  if (rule.includes !== undefined) return Array.isArray(v) ? v.includes(rule.includes) : String(v ?? '').includes(rule.includes);
  return true;
}

function validateField(field: FormField, answers: Answers): string {
  const v = answers[field.id];
  const required = 'This is a required question.';
  const rows = field.rows || [];

  if (field.type === 'radio_grid') {
    return field.required && rows.some(r => !v?.[r]) ? 'Answer every row.' : '';
  }
  if (field.type === 'checkbox_grid') {
    return field.required && rows.some(r => !(v?.[r]?.length)) ? 'Select at least one option in every row.' : '';
  }
  if (isEmpty(v)) return field.required ? required : '';

  const otherText = String(answers[`${field.id}::other`] ?? '').trim();
  if ((v === OTHER || (Array.isArray(v) && v.includes(OTHER))) && !otherText) return 'Please specify your answer.';

  if (field.type === 'checkbox') {
    const count = (v as string[]).length;
    if (field.minSelected && count < field.minSelected) return `Select at least ${field.minSelected}.`;
    if (field.maxSelected && count > field.maxSelected) return `Select no more than ${field.maxSelected}.`;
    return '';
  }
  if (field.type === 'rating' || field.type === 'linear_scale' || field.type === 'file' || field.type === 'radio' || field.type === 'select') return '';

  const text = String(v);
  if (field.minLength && text.length < field.minLength) return `Enter at least ${field.minLength} characters.`;
  if (field.maxLength && text.length > field.maxLength) return `Enter no more than ${field.maxLength} characters.`;
  if (field.type === 'number') {
    const n = Number(text);
    if (Number.isNaN(n)) return 'Enter a number.';
    if (field.min !== undefined && n < field.min) return `Enter a number of ${field.min} or more.`;
    if (field.max !== undefined && n > field.max) return `Enter a number of ${field.max} or less.`;
  }
  if (field.type === 'email' && !EMAIL_RE.test(text)) return 'Enter a valid email address.';
  if (field.type === 'url') {
    try { new URL(text); } catch { return 'Enter a valid web address, starting with https://'; }
  }
  if (field.pattern) {
    let ok = true;
    try { ok = new RegExp(field.pattern).test(text); } catch { ok = true; }
    if (!ok) return field.patternMessage || 'This answer is not in the expected format.';
  } else if (field.type === 'tel' && !PHONE_RE.test(text)) {
    return 'Enter a valid phone number.';
  }
  return '';
}

/** Small allow-list sanitizer so form descriptions can use basic formatting without script injection. */
const SAFE_TAGS = new Set(['B', 'I', 'EM', 'STRONG', 'U', 'BR', 'P', 'UL', 'OL', 'LI', 'A', 'SPAN', 'H3', 'H4', 'CODE', 'DIV']);
const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT']);

function sanitizeHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return html.replace(/<[^>]*>/g, '');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const clean = (parent: Node) => {
    Array.from(parent.childNodes).forEach(node => {
      if (node.nodeType === 8) { parent.removeChild(node); return; }
      if (node.nodeType !== 1) return;
      const el = node as Element;
      if (DROP_TAGS.has(el.tagName)) { parent.removeChild(el); return; }
      clean(el);
      if (!SAFE_TAGS.has(el.tagName)) {
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        return;
      }
      const href = el.tagName === 'A' ? el.getAttribute('href') || '' : '';
      Array.from(el.attributes).forEach(attr => el.removeAttribute(attr.name));
      if (el.tagName === 'A' && /^(https?:|mailto:)/i.test(href)) {
        el.setAttribute('href', href);
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
    });
  };
  clean(doc.body);
  return doc.body.innerHTML;
}

/* ------------------------------------------------------- small components */

const RichText = ({ text, className }: { text: string; className?: string }) =>
  /<[a-z][\s\S]*>/i.test(text)
    ? <div className={className} dangerouslySetInnerHTML={{ __html: sanitizeHtml(text) }} />
    : <div className={`whitespace-pre-wrap ${className || ''}`}>{text}</div>;

const YouTubeEmbed = ({ url, title }: { url: string; title: string }) => {
  const match = String(url || '').match(YT_RE);
  if (!match) return <p className="mb-4 text-xs text-amber-800">Add a valid YouTube link to show this video.</p>;
  return (
    <div className="mb-4 aspect-video overflow-hidden rounded-xl">
      <iframe
        title={title}
        src={`https://www.youtube-nocookie.com/embed/${match[1]}`}
        className="h-full w-full"
        loading="lazy"
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    </div>
  );
};

const ErrorIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
    <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 4.5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="8" cy="11" r="0.9" fill="currentColor" />
  </svg>
);

const StarIcon = ({ filled }: { filled: boolean }) => (
  <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 2.5l2.9 6.3 6.9.7-5.1 4.7 1.5 6.8L12 17.4 5.9 21l1.5-6.8L2.3 9.5l6.9-.7z"
      fill={filled ? '#B26A00' : 'none'}
      stroke={filled ? '#B26A00' : '#64748b'}
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);

const inputBase =
  'w-full rounded-xl border bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:ring-2 disabled:bg-slate-100 disabled:text-slate-500';
const inputOk = 'border-slate-300 focus:border-slate-500 focus:ring-slate-200';
const inputBad = 'border-rose-600 focus:border-rose-700 focus:ring-rose-200';

/* ---------------------------------------------------------- question card */

type CardProps = {
  field: FormField;
  number?: number;
  value: any;
  otherText: string;
  error?: string;
  disabled: boolean;
  accent: string;
  options: string[];
  upload?: UploadState;
  onChange: (id: string, value: any) => void;
  onOtherChange: (id: string, text: string) => void;
  onBlur: (id: string) => void;
  onFile: (field: FormField, file?: File) => void;
};

const QuestionCard = memo(function QuestionCard(props: CardProps) {
  const { field, number, value, otherText, error, disabled, accent, options, upload, onChange, onOtherChange, onBlur, onFile } = props;
  const id = field.id;
  const controlId = `input-${id}`;
  const errId = `${id}-err`;
  const descId = `${id}-desc`;
  const labelId = `${id}-label`;
  const isGroup = GROUP_TYPES.has(field.type);
  const describedBy = [field.description ? descId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined;
  const aria = { 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy } as const;
  const cls = `${inputBase} ${error ? inputBad : inputOk}`;
  const radioCls = 'h-4 w-4 shrink-0';
  const rowCls = 'flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm text-slate-700 transition hover:bg-slate-50';
  const columns = field.columns && field.columns.length ? field.columns : options;
  const rows = field.rows || [];
  const set = (v: any) => onChange(id, v);

  const title = (
    <>
      {number !== undefined && `${number}. `}
      {field.label}
      {field.required && <span aria-hidden="true" className="text-rose-700"> *</span>}
      {field.required && <span className="sr-only"> (required)</span>}
    </>
  );

  let control: React.ReactNode;
  switch (field.type) {
    case 'long_text':
    case 'textarea':
      control = (
        <>
          <textarea
            id={controlId} rows={4} disabled={disabled} value={value ?? ''} {...aria}
            placeholder={field.placeholder || 'Your answer'}
            onChange={e => set(e.target.value)} onBlur={() => onBlur(id)}
            className={`${cls} resize-y`}
          />
          {field.maxLength ? (
            <p className={`mt-1 text-right text-xs ${String(value ?? '').length > field.maxLength ? 'text-rose-700' : 'text-slate-600'}`}>
              {String(value ?? '').length} / {field.maxLength}
            </p>
          ) : null}
        </>
      );
      break;

    case 'radio':
      control = (
        <div role="radiogroup" aria-labelledby={labelId} {...aria} className="space-y-1">
          {options.map(option => (
            <label key={option} className={rowCls}>
              <input type="radio" name={`field-${id}`} disabled={disabled} checked={value === option}
                onChange={() => set(option)} style={{ accentColor: accent }} className={radioCls} />
              {option}
            </label>
          ))}
          {field.allowOther && (
            <div className="flex min-h-11 items-center gap-3 text-sm">
              <label className="flex cursor-pointer items-center gap-3">
                <input type="radio" name={`field-${id}`} disabled={disabled} checked={value === OTHER}
                  onChange={() => set(OTHER)} style={{ accentColor: accent }} className={radioCls} />
                Other:
              </label>
              <input type="text" aria-label="Other answer" disabled={disabled} value={otherText}
                onChange={e => onOtherChange(id, e.target.value)} onBlur={() => onBlur(id)}
                className="min-w-0 flex-1 border-0 border-b border-slate-400 bg-transparent px-1 py-1 text-sm outline-none focus:border-slate-700" />
            </div>
          )}
        </div>
      );
      break;

    case 'checkbox': {
      const selected: string[] = Array.isArray(value) ? value : [];
      const atMax = !!field.maxSelected && selected.length >= field.maxSelected;
      const toggle = (option: string, on: boolean) =>
        set(on ? [...selected, option] : selected.filter(v => v !== option));
      control = (
        <div role="group" aria-labelledby={labelId} {...aria} className="space-y-1">
          {options.map(option => {
            const checked = selected.includes(option);
            const locked = !checked && atMax;
            return (
              <label key={option} className={`${rowCls} ${locked ? 'cursor-not-allowed text-slate-500' : ''}`}>
                <input type="checkbox" disabled={disabled || locked} checked={checked}
                  onChange={e => toggle(option, e.target.checked)} style={{ accentColor: accent }} className={radioCls} />
                {option}
              </label>
            );
          })}
          {field.allowOther && (
            <div className="flex min-h-11 items-center gap-3 text-sm">
              <label className="flex cursor-pointer items-center gap-3">
                <input type="checkbox" disabled={disabled || (!selected.includes(OTHER) && atMax)} checked={selected.includes(OTHER)}
                  onChange={e => toggle(OTHER, e.target.checked)} style={{ accentColor: accent }} className={radioCls} />
                Other:
              </label>
              <input type="text" aria-label="Other answer" disabled={disabled} value={otherText}
                onChange={e => onOtherChange(id, e.target.value)} onBlur={() => onBlur(id)}
                className="min-w-0 flex-1 border-0 border-b border-slate-400 bg-transparent px-1 py-1 text-sm outline-none focus:border-slate-700" />
            </div>
          )}
          {field.maxSelected || field.minSelected ? (
            <p className="pt-1 text-xs text-slate-600">
              {selected.length}{field.maxSelected ? ` of ${field.maxSelected}` : ''} selected
            </p>
          ) : null}
        </div>
      );
      break;
    }

    case 'select':
      control = (
        <select id={controlId} disabled={disabled} value={value ?? ''} {...aria}
          onChange={e => set(e.target.value)} onBlur={() => onBlur(id)} className={cls}>
          <option value="">Choose</option>
          {options.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      );
      break;

    case 'linear_scale': {
      const min = field.scaleMin ?? 1;
      const max = Math.max(min + 1, field.scaleMax ?? 5);
      const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);
      control = (
        <div role="radiogroup" aria-labelledby={labelId} {...aria}>
          <div className="flex items-start justify-between gap-2 text-xs text-slate-600">
            <span>{min}{field.scaleMinLabel ? ` · ${field.scaleMinLabel}` : ''}</span>
            <span>{max}{field.scaleMaxLabel ? ` · ${field.scaleMaxLabel}` : ''}</span>
          </div>
          {/* One even row of number buttons that always fits the screen (0–10 included). */}
          <div className="mt-3 grid gap-1" style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}>
            {values.map(n => {
              const on = Number(value) === n;
              return (
                <label key={n} className="relative cursor-pointer">
                  <input type="radio" name={`field-${id}`} disabled={disabled} checked={on} aria-label={String(n)}
                    onChange={() => set(n)} className="peer sr-only" />
                  <span className="flex h-10 items-center justify-center rounded-lg border text-sm font-semibold transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-slate-500"
                    style={on ? { backgroundColor: accent, borderColor: accent, color: '#fff' } : { borderColor: '#CBD5E1', color: '#334155' }}>
                    {n}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      );
      break;
    }

    case 'rating': {
      const max = Math.max(1, Math.min(10, field.maxRating || 5));
      control = (
        <div role="group" aria-labelledby={labelId} {...aria} className="flex flex-wrap gap-1">
          {Array.from({ length: max }, (_, i) => i + 1).map(n => (
            <button key={n} type="button" disabled={disabled}
              aria-label={`${n} out of ${max}`} aria-pressed={Number(value) >= n}
              onClick={() => set(Number(value) === n ? undefined : n)}
              className="flex h-11 w-11 items-center justify-center rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">
              <StarIcon filled={Number(value) >= n} />
            </button>
          ))}
        </div>
      );
      break;
    }

    case 'radio_grid':
    case 'checkbox_grid': {
      const isRadio = field.type === 'radio_grid';
      control = (
        <div {...aria}>
          {/* Phones: one card per row with every choice visible, nothing hidden off-screen. */}
          <div className="space-y-3 sm:hidden">
            {rows.map((row, rowIndex) => (
              <fieldset key={row} className="rounded-xl border border-slate-200 p-3">
                <legend className="px-1 text-sm font-medium text-slate-800">{row}</legend>
                <div className="flex flex-wrap gap-2">
                  {columns.map(col => {
                    const rowValue = value?.[row];
                    const checked = isRadio ? rowValue === col : (rowValue || []).includes(col);
                    return (
                      <label key={col} className="cursor-pointer">
                        <input type={isRadio ? 'radio' : 'checkbox'} disabled={disabled} name={`field-${id}-m-${rowIndex}`} checked={checked} className="peer sr-only"
                          onChange={e => {
                            if (isRadio) set({ ...(value || {}), [row]: col });
                            else {
                              const current: string[] = rowValue || [];
                              set({ ...(value || {}), [row]: e.target.checked ? [...current, col] : current.filter(v => v !== col) });
                            }
                          }} />
                        <span className="inline-flex min-h-10 items-center rounded-full border px-3 text-sm transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-slate-500"
                          style={checked ? { backgroundColor: accent, borderColor: accent, color: '#fff' } : { borderColor: '#CBD5E1', color: '#334155' }}>{col}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
          <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[420px] text-left text-xs">
            <caption className="sr-only">{field.label}</caption>
            <thead>
              <tr>
                <td className="p-2" />
                {columns.map(col => <th key={col} scope="col" className="p-2 text-center font-medium text-slate-700">{col}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={row} className="border-t border-slate-200">
                  <th scope="row" className="p-2 text-sm font-medium text-slate-800">{row}</th>
                  {columns.map(col => {
                    const rowValue = value?.[row];
                    const checked = isRadio ? rowValue === col : (rowValue || []).includes(col);
                    return (
                      <td key={col} className="p-1 text-center">
                        <label className="inline-flex h-11 w-11 cursor-pointer items-center justify-center">
                          <input type={isRadio ? 'radio' : 'checkbox'} disabled={disabled}
                            name={`field-${id}-${rowIndex}`} aria-label={`${row}: ${col}`} checked={checked}
                            onChange={e => {
                              if (isRadio) set({ ...(value || {}), [row]: col });
                              else {
                                const current: string[] = rowValue || [];
                                set({ ...(value || {}), [row]: e.target.checked ? [...current, col] : current.filter(v => v !== col) });
                              }
                            }}
                            style={{ accentColor: accent }} className={radioCls} />
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      );
      break;
    }

    case 'file': {
      const file = value as FileValue | undefined;
      control = (
        <div className="space-y-3" {...aria}>
          {!file && (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-400 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800 focus-within:ring-2 focus-within:ring-slate-500 hover:bg-slate-100">
              <span>{upload?.busy ? 'Uploading…' : 'Add file'}</span>
              <input type="file" className="sr-only" disabled={disabled || upload?.busy} accept={field.accept}
                onChange={e => { onFile(field, e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          )}
          {upload?.busy && (
            <div role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={upload.progress}
              className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full" style={{ width: `${upload.progress}%`, backgroundColor: accent }} />
            </div>
          )}
          {file && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
              {(upload?.local || /^data:/.test(file.url ?? '')) && <AttachedPreview file={upload?.local} value={file} />}
              <span className="min-w-0 flex-1 truncate"><span className="font-medium">{file.name}</span> <span className="text-slate-600">· {formatSize(file.size)}</span></span>
              <button type="button" disabled={disabled} onClick={() => set(undefined)}
                aria-label={`Remove ${file.name}`}
                className="h-11 shrink-0 rounded-lg px-3 text-sm font-semibold text-slate-700 hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">
                Remove
              </button>
            </div>
          )}
          {upload?.error && <p className="text-xs text-rose-700">{upload.error}</p>}
          {(field.accept || field.maxSizeMB !== undefined) && (
            <p className="text-xs text-slate-600">
              {field.accept ? `Accepted: ${field.accept}. ` : ''}Up to {field.maxSizeMB ?? 5} MB.
            </p>
          )}
        </div>
      );
      break;
    }

    default: {
      const htmlType = ['email', 'number', 'date', 'time', 'tel', 'url'].includes(field.type) ? field.type : 'text';
      control = (
        <input id={controlId} type={htmlType} disabled={disabled} value={value ?? ''} {...aria}
          inputMode={htmlType === 'tel' ? 'tel' : htmlType === 'number' ? 'decimal' : undefined}
          min={htmlType === 'number' ? field.min : undefined} max={htmlType === 'number' ? field.max : undefined}
          placeholder={field.placeholder || 'Your answer'}
          onChange={e => set(e.target.value)} onBlur={() => onBlur(id)} className={cls} />
      );
    }
  }

  return (
    <section
      id={`field-${id}`}
      className={`rounded-2xl border bg-white p-5 shadow-[0_2px_10px_rgba(15,23,42,0.035)] transition-shadow sm:p-6 ${error ? 'border-rose-500 ring-1 ring-rose-200' : 'border-slate-200 hover:shadow-md'}`}
    >
      {field.contentTitle && <h4 className="mb-2 text-base font-semibold">{field.contentTitle}</h4>}
      {field.imageUrl && <img src={field.imageUrl} alt={field.label || 'Question image'} className="mb-4 max-h-[28rem] max-w-full rounded-xl object-contain" />}
      {field.videoDataUrl && <video controls preload="metadata" src={field.videoDataUrl} className="mb-4 max-h-[28rem] w-full rounded-xl bg-black" />}
      {field.videoUrl && <YouTubeEmbed url={field.videoUrl} title={`${field.label} video`} />}

      <div className="flex items-start justify-between gap-3">
        {isGroup
          ? <div id={labelId} className="text-sm font-semibold leading-6 text-slate-900">{title}</div>
          : <label id={labelId} htmlFor={controlId} className="block text-base font-semibold leading-7 text-slate-900">{title}</label>}
        {field.points !== undefined && field.points > 0 && (
          <span className="shrink-0 text-xs font-medium text-slate-600">{field.points} {field.points === 1 ? 'point' : 'points'}</span>
        )}
      </div>
      {field.description && <p id={descId} className="mt-1 text-sm leading-6 text-slate-500">{field.description}</p>}
      <div className="mt-4 text-slate-700">{control}</div>
      {error && (
        <p id={errId} className="mt-3 flex items-center gap-2 text-sm text-rose-700">
          <ErrorIcon />{error}
        </p>
      )}
    </section>
  );
});

/* ------------------------------------------------------------------- main */

export default function DynamicForm({ schema, onSubmit, uploadFile, draftKey }: DynamicFormProps) {
  const parsed = useMemo(() => parseSchema(schema), [schema]);
  const parsedSchema = parsed.schema;

  const emailField = useMemo<FormField | undefined>(
    () => (parsedSchema?.collectEmail
      ? { id: '_respondentEmail', type: 'email', label: 'Email address', required: true, placeholder: 'Your email address' }
      : undefined),
    [parsedSchema],
  );
  const fields = useMemo(() => (parsedSchema ? normalizeFields(parsedSchema) : []), [parsedSchema]);
  const fieldMap = useMemo(() => {
    const map: Record<string, FormField> = {};
    if (emailField) map[emailField.id] = emailField;
    fields.forEach(f => { map[f.id] = f; });
    return map;
  }, [fields, emailField]);
  const optionLists = useMemo(() => {
    const map: Record<string, string[]> = {};
    fields.forEach(f => {
      const labels = (f.options || []).map(optionLabel);
      map[f.id] = f.shuffleOptions ? shuffled(labels) : labels;
    });
    return map;
  }, [fields]);
  const pages = useMemo(() => buildPages(fields, parsedSchema?.blocks || [], emailField), [fields, parsedSchema, emailField]);

  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const [pageIdx, setPageIdx] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [restored, setRestored] = useState(false);

  const answersRef = useRef(answers);
  answersRef.current = answers;
  const uploadRef = useRef(uploadFile);
  uploadRef.current = uploadFile;
  const pendingFocus = useRef<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const storageKey = `dynamicform:${draftKey || parsedSchema?.id || parsedSchema?.title || 'form'}`;

  /* pages that still have something to show (showIf may hide whole pages) */
  const livePages = useMemo(
    () => pages.filter(p => p.items.some(i => i.kind === 'block' || isVisible(i.field, answers))),
    [pages, answers],
  );
  const safeIdx = Math.min(pageIdx, Math.max(livePages.length - 1, 0));
  const page = livePages[safeIdx];
  const isLast = safeIdx >= livePages.length - 1;

  const numbering = useMemo(() => {
    const map: Record<string, number> = {};
    let n = 0;
    livePages.forEach(p => p.items.forEach(i => {
      if (i.kind === 'field' && i.field.id !== '_respondentEmail' && isVisible(i.field, answers)) map[i.field.id] = ++n;
    }));
    return map;
  }, [livePages, answers]);

  const pageFields = useCallback(
    (p: Page | undefined) => (p ? p.items.flatMap(i => (i.kind === 'field' && isVisible(i.field, answersRef.current) ? [i.field] : [])) : []),
    [],
  );

  /* ---------------------------------------------------- answer handlers */
  const change = useCallback((id: string, value: any) => {
    setAnswers(current => {
      const next = { ...current };
      if (value === undefined) delete next[id]; else next[id] = value;
      return next;
    });
  }, []);

  const changeOther = useCallback((id: string, text: string) => {
    const field = fieldMap[id];
    setAnswers(current => {
      const next = { ...current, [`${id}::other`]: text };
      if (text && field?.type === 'radio') next[id] = OTHER;
      if (text && field?.type === 'checkbox' && !(current[id] || []).includes(OTHER)) next[id] = [...(current[id] || []), OTHER];
      return next;
    });
  }, [fieldMap]);

  const blurField = useCallback((id: string) => {
    const field = fieldMap[id];
    if (!field) return;
    const message = validateField(field, answersRef.current);
    setErrors(current => {
      if (!message && !current[id]) return current;
      const next = { ...current };
      if (message) next[id] = message; else delete next[id];
      return next;
    });
  }, [fieldMap]);

  /* re-check fields that already show an error so it clears as soon as it is fixed */
  useEffect(() => {
    setErrors(current => {
      const keys = Object.keys(current);
      if (!keys.length) return current;
      let changed = false;
      const next = { ...current };
      keys.forEach(id => {
        const field = fieldMap[id];
        const message = field && isVisible(field, answers) ? validateField(field, answers) : '';
        if (!message) { delete next[id]; changed = true; }
        else if (message !== current[id]) { next[id] = message; changed = true; }
      });
      return changed ? next : current;
    });
  }, [answers, fieldMap]);

  const handleFile = useCallback(async (field: FormField, file?: File) => {
    if (!file) return;
    const setState = (state: UploadState) => setUploads(current => ({ ...current, [field.id]: state }));
    const maxMB = field.maxSizeMB ?? 5;
    if (file.size > maxMB * 1024 * 1024) { setState({ busy: false, progress: 0, error: `Please choose a file smaller than ${maxMB} MB.` }); return; }
    if (field.accept) {
      const allowed = field.accept.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const name = file.name.toLowerCase();
      const ok = allowed.some(a => a.startsWith('.') ? name.endsWith(a) : a.endsWith('/*') ? file.type.startsWith(a.slice(0, -1)) : file.type === a);
      if (!ok) { setState({ busy: false, progress: 0, error: `This file type is not accepted. Allowed: ${field.accept}.` }); return; }
    }
    setState({ busy: true, progress: 0 });
    try {
      const upload = uploadRef.current;
      const url = upload
        ? await upload(file, percent => setState({ busy: true, progress: Math.round(percent) }))
        : await readAsDataUrl(file);
      change(field.id, { name: file.name, size: file.size, url } as FileValue);
      setState({ busy: false, progress: 100, local: file });
    } catch (error: any) {
      setState({ busy: false, progress: 0, error: error?.message || 'Upload failed. Please try again.' });
    }
  }, [change]);

  /* ------------------------------------------------------------- draft */
  useEffect(() => {
    if (!parsedSchema) return;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const draft = JSON.parse(saved);
        if (draft && typeof draft.answers === 'object' && Object.keys(draft.answers).length) {
          setAnswers(draft.answers);
          setRestored(true);
        }
      }
    } catch { /* storage unavailable */ }
  }, [storageKey, parsedSchema]);

  useEffect(() => {
    if (result || !parsedSchema) return;
    const timer = setTimeout(() => {
      try {
        const keep: Answers = {};
        Object.entries(answers).forEach(([id, value]) => {
          if (fieldMap[id]?.type !== 'file') keep[id] = value;
        });
        if (Object.keys(keep).length) sessionStorage.setItem(storageKey, JSON.stringify({ answers: keep }));
        else sessionStorage.removeItem(storageKey);
      } catch { /* storage unavailable */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [answers, fieldMap, storageKey, result, parsedSchema]);

  const dirty = !result && Object.keys(answers).length > 0;
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  /* ----------------------------------------------------------- focus */
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    const card = document.getElementById(`field-${id}`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const target = card.querySelector<HTMLElement>('input:not([disabled]), textarea, select, button:not([disabled])');
    target?.focus({ preventScroll: true });
  });

  const focusField = (id: string) => { pendingFocus.current = id; setErrors(current => ({ ...current })); };

  /* --------------------------------------------------------- navigation */
  const validateFields = (list: FormField[]) => {
    const found: Record<string, string> = {};
    list.forEach(field => {
      const message = validateField(field, answersRef.current);
      if (message) found[field.id] = message;
    });
    return found;
  };

  const applyPageErrors = (list: FormField[], found: Record<string, string>) => {
    setErrors(current => {
      const next = { ...current };
      list.forEach(field => { if (found[field.id]) next[field.id] = found[field.id]; else delete next[field.id]; });
      return next;
    });
  };

  const goTo = (index: number) => {
    setPageIdx(index);
    setShowSummary(false);
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const buildPayload = () => {
    const out: Record<string, any> = {};
    const resolveOther = (id: string, v: any) => {
      const text = String(answersRef.current[`${id}::other`] ?? '').trim();
      if (v === OTHER) return text;
      if (Array.isArray(v)) return v.map(x => (x === OTHER ? text : x));
      return v;
    };
    Object.values(fieldMap).forEach(field => {
      if (!isVisible(field, answersRef.current)) return;
      const v = answersRef.current[field.id];
      if (!isEmpty(v)) out[field.id] = resolveOther(field.id, v);
    });
    return out;
  };

  const handleNext = () => {
    const list = pageFields(page);
    const found = validateFields(list);
    applyPageErrors(list, found);
    const first = list.find(f => found[f.id]);
    if (first) { setShowSummary(true); focusField(first.id); return; }
    goTo(Math.min(safeIdx + 1, livePages.length - 1));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (parsedSchema?.acceptingResponses === false) { setSubmitError('This form is no longer accepting responses.'); return; }
    if (!isLast) { handleNext(); return; }

    const everyField = livePages.flatMap(p => pageFields(p));
    const found = validateFields(everyField);
    setErrors(found);
    const first = everyField.find(f => found[f.id]);
    if (first) {
      setShowSummary(true);
      const pageOfFirst = livePages.findIndex(p => p.items.some(i => i.kind === 'field' && i.field.id === first.id));
      if (pageOfFirst !== safeIdx) setPageIdx(pageOfFirst);
      focusField(first.id);
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    try {
      const res: any = await onSubmit(buildPayload());
      const fallback = parsedSchema?.confirmationMessage || 'Your response has been recorded.';
      if (res && typeof res === 'object') {
        setResult({
          message: res.confirmationMessage || res.message || fallback,
          score: res.score ?? null,
          maxScore: res.maxScore ?? 100,
          scoreLabel: res.scoreLabel,
          feedback: res.feedback ?? null,
          results: Array.isArray(res.results) ? res.results : undefined,
        });
      } else {
        setResult({ message: typeof res === 'string' ? res : fallback });
      }
      try { sessionStorage.removeItem(storageKey); } catch { /* ignore */ }
    } catch (error: any) {
      setSubmitError(error?.message || 'Unable to submit this form. Your answers are still here, please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const resetAll = () => {
    setAnswers({}); setErrors({}); setUploads({}); setSubmitError(''); setShowSummary(false);
    setConfirmClear(false); setRestored(false); setPageIdx(0);
    try { sessionStorage.removeItem(storageKey); } catch { /* ignore */ }
  };

  /* -------------------------------------------------------------- views */
  if (parsed.failed) {
    return (
      <div role="alert" className="rounded-2xl border border-rose-300 bg-rose-50 p-8 text-center text-sm text-rose-800">
        This form couldn't be loaded. Please refresh the page or contact the form owner.
      </div>
    );
  }
  if (!parsedSchema || fields.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-600">
        This form has no questions yet.
      </div>
    );
  }

  const accent = parsedSchema.themeColor || '#B4502F';
  const isClosed = parsedSchema.acceptingResponses === false;
  const shell = 'mx-auto w-full max-w-3xl space-y-4 text-slate-800';
  const branding = normalizeBranding((parsedSchema as any).branding);
  const logo = branding.logoUrl ? <img src={branding.logoUrl} alt="" className="h-14 w-14 shrink-0 rounded-2xl border-4 border-white bg-white object-contain shadow-md sm:h-16 sm:w-16" /> : null;
  const headerCard = (
    <header className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {branding.header === 'banner' && branding.bannerUrl ? (
        <div className="relative h-36 sm:h-52">
          <img src={branding.bannerUrl} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 h-1.5" style={{ backgroundColor: accent }} />
        </div>
      ) : branding.header === 'band' ? (
        <div className="relative h-24 sm:h-28" style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc 55%, ${accent}99)` }}>
          <div aria-hidden="true" className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 85% 20%, #fff 0, transparent 45%), radial-gradient(circle at 10% 120%, #fff 0, transparent 40%)' }} />
        </div>
      ) : (
        <div className="h-3" style={{ backgroundColor: accent }} />
      )}
      <div className={`p-6 sm:p-9 ${logo && branding.header !== 'bar' ? '!pt-0' : ''}`}>
        {logo && branding.header !== 'bar' && <div className="relative z-10 -mt-8 mb-4 sm:-mt-9">{logo}</div>}
        <div className="flex items-start gap-4">
          {logo && branding.header === 'bar' && logo}
          <h2 className="min-w-0 break-words text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{parsedSchema.title || 'Untitled form'}</h2>
        </div>
        {parsedSchema.description && <RichText text={parsedSchema.description} className="mt-4 text-base leading-7 text-slate-600" />}
        {parsedSchema.descriptionImageUrl && (
          <img src={parsedSchema.descriptionImageUrl} alt="Form description attachment" className="mt-4 max-h-[28rem] max-w-full rounded-xl object-contain" />
        )}
        {!isClosed && !result && <p className="mt-6 border-t border-slate-100 pt-4 text-xs text-slate-500"><span className="font-bold text-rose-600">*</span> Indicates required question</p>}
      </div>
    </header>
  );

  if (isClosed && !result) {
    return (
      <div className={shell}>
        {headerCard}
        <div role="status" className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm font-medium text-amber-900">
          This form is no longer accepting responses.
        </div>
      </div>
    );
  }

  if (result) {
    const max = result.maxScore ?? 100;
    return (
      <div className={shell}>
        {headerCard}
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" aria-live="polite">
          <p className="text-sm leading-relaxed text-slate-800">{result.message}</p>
          {result.score !== null && result.score !== undefined && (
            <div className="space-y-1.5 rounded-xl border border-emerald-300 bg-emerald-50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-900">{result.scoreLabel || 'Your score'}</span>
                <span className="text-lg font-black text-emerald-800">{result.score} / {max}</span>
              </div>
              {result.feedback && <p className="text-xs leading-relaxed text-emerald-900">{result.feedback}</p>}
            </div>
          )}
          {result.results && result.results.length > 0 && (
            <ul className="space-y-3">
              {result.results.map(item => {
                const field = fieldMap[String(item.id)];
                const status = item.correct === true ? 'Correct' : item.correct === false ? 'Incorrect' : 'Reviewed';
                return (
                  <li key={item.id} className={`rounded-xl border p-4 text-sm ${item.correct === false ? 'border-rose-400' : 'border-slate-200'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-semibold">{field?.label || `Question ${item.id}`}</span>
                      <span className="shrink-0 text-xs font-bold">
                        {status}{item.points !== undefined ? ` · ${item.points}${item.maxPoints !== undefined ? `/${item.maxPoints}` : ''}` : ''}
                      </span>
                    </div>
                    {item.yourAnswer !== undefined && <p className="mt-2 text-slate-700">Your answer: <strong>{showAnswer(item.yourAnswer)}</strong></p>}
                    {item.correct === false && item.correctAnswer !== undefined && <p className="mt-1 text-slate-700">Correct answer: <strong>{showAnswer(item.correctAnswer)}</strong></p>}
                    {item.explanation && <p className="mt-2 rounded-lg bg-slate-50 p-3 text-slate-700">{item.explanation}</p>}
                  </li>
                );
              })}
            </ul>
          )}
          {parsedSchema.allowMultipleResponses !== false && (
            <button type="button" onClick={() => { resetAll(); setResult(null); }}
              style={{ color: accent }} className="min-h-11 text-sm font-semibold underline-offset-2 hover:underline">
              Submit another response
            </button>
          )}
        </div>
      </div>
    );
  }

  const currentFields = pageFields(page);
  const summaryErrors = showSummary ? currentFields.filter(f => errors[f.id]) : [];
  const totalPages = livePages.length;

  return (
    <form onSubmit={handleSubmit} noValidate className={shell}>
      <div ref={topRef} />

      {totalPages > 1 && (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-semibold text-slate-800">Page {safeIdx + 1} of {totalPages}</span>
            {page?.title && <span className="truncate pl-4 text-slate-500">{page.title}</span>}
          </div>
          <div role="progressbar" aria-label="Form progress" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={Math.round(((safeIdx + 1) / totalPages) * 100)}
            className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full transition-all duration-300" style={{ width: `${((safeIdx + 1) / totalPages) * 100}%`, backgroundColor: accent }} />
          </div>
        </div>
      )}

      {restored && safeIdx === 0 && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700">
          <span>We restored the answers you saved earlier on this device.</span>
          <button type="button" onClick={resetAll} className="min-h-11 font-semibold underline" style={{ color: accent }}>Start over</button>
        </div>
      )}

      {summaryErrors.length > 0 && (
        <div role="alert" className="rounded-xl border border-rose-600 bg-rose-50 p-4 text-sm text-rose-900">
          <p className="flex items-center gap-2 font-semibold"><ErrorIcon />
            {summaryErrors.length === 1 ? '1 question needs your attention.' : `${summaryErrors.length} questions need your attention.`}
          </p>
          <ul className="mt-2 list-inside list-disc space-y-1">
            {summaryErrors.map(f => (
              <li key={f.id}>
                <button type="button" onClick={() => focusField(f.id)} className="text-left font-medium underline">
                  {numbering[f.id] ? `Question ${numbering[f.id]}` : f.label}: {errors[f.id]}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {safeIdx === 0 && headerCard}

      {page?.title && safeIdx > 0 && (
        <section className="rounded-2xl border border-slate-200 border-t-4 bg-white p-5 shadow-sm sm:p-6" style={{ borderTopColor: accent }}>
          <h3 className="text-lg font-bold">{page.title}</h3>
          {page.description && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{page.description}</p>}
        </section>
      )}

      {page?.items.map(item => {
        if (item.kind === 'block') {
          const block = item.block;
          if (block.type === 'VIDEO') {
            return (
              <section key={`b-${block.id}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                {block.title && <h3 className="mb-2 font-semibold">{block.title}</h3>}
                {block.description && <p className="mb-3 whitespace-pre-wrap text-sm text-slate-700">{block.description}</p>}
                <YouTubeEmbed url={block.url} title={block.title || 'Form video'} />
              </section>
            );
          }
          if (block.type === 'IMAGE') {
            return (
              <section key={`b-${block.id}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                {block.title && <h3 className="mb-2 font-semibold">{block.title}</h3>}
                {block.description && <p className="mb-3 whitespace-pre-wrap text-sm text-slate-700">{block.description}</p>}
                {block.url && <img src={block.url} alt={block.title || 'Form image'} className="mx-auto max-h-[28rem] max-w-full rounded-xl object-contain" />}
              </section>
            );
          }
          return (
            <section key={`b-${block.id}`}
              className={`rounded-2xl border bg-white p-5 shadow-sm sm:p-6 ${block.type === 'SECTION' ? 'border-t-4' : 'border-slate-200'}`}
              style={block.type === 'SECTION' ? { borderTopColor: accent } : undefined}>
              {block.title && <h3 className="text-lg font-bold">{block.title}</h3>}
              {block.description && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{block.description}</p>}
            </section>
          );
        }
        const field = item.field;
        if (!isVisible(field, answers)) return null;
        return (
          <QuestionCard
            key={field.id}
            field={field}
            number={numbering[field.id]}
            value={answers[field.id]}
            otherText={answers[`${field.id}::other`] ?? ''}
            error={errors[field.id]}
            disabled={submitting}
            accent={accent}
            options={optionLists[field.id] || []}
            upload={uploads[field.id]}
            onChange={change}
            onOtherChange={changeOther}
            onBlur={blurField}
            onFile={handleFile}
          />
        );
      })}

      {submitError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{submitError}</p>}

      <div className="flex flex-col-reverse gap-3 pb-2 sm:flex-row sm:items-center sm:justify-between">
        {confirmClear ? (
          <div className="flex items-center gap-2 text-sm" role="group" aria-label="Confirm clearing the form">
            <span className="text-slate-700">Clear all answers?</span>
            <button type="button" onClick={resetAll} className="min-h-11 rounded-lg px-3 font-semibold text-rose-800 hover:bg-rose-50">Yes, clear</button>
            <button type="button" onClick={() => setConfirmClear(false)} className="min-h-11 rounded-lg px-3 font-semibold text-slate-700 hover:bg-white">Cancel</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmClear(true)} disabled={!dirty || submitting}
            className="min-h-11 rounded-lg px-4 text-sm font-semibold text-slate-700 hover:bg-white disabled:opacity-40">
            Clear form
          </button>
        )}
        <div className="flex gap-3">
          {safeIdx > 0 && (
            <button type="button" onClick={() => goTo(safeIdx - 1)} disabled={submitting}
              className="min-h-12 rounded-lg border border-slate-400 bg-white px-6 text-sm font-semibold text-slate-800 hover:bg-slate-50">
              Back
            </button>
          )}
          {isLast ? (
            <button type="submit" disabled={submitting}
              style={{ backgroundColor: accent }}
              className="min-h-12 rounded-lg px-8 text-sm font-bold text-white shadow-sm hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60">
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          ) : (
            <button type="submit" style={{ backgroundColor: accent }}
              className="min-h-12 rounded-lg px-8 text-sm font-bold text-white shadow-sm hover:brightness-95">
              Next
            </button>
          )}
        </div>
      </div>
      <p className="pb-5 text-center text-xs text-slate-600">Never submit passwords through forms.</p>
    </form>
  );
}
