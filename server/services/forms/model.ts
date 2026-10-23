/**
 * The canonical form model, shared by validation, versions, statistics, exports and the chat tools.
 *
 * A form is data: the builder saves `{ title, description, fields[], blocks[], ... }`. Older and AI-made forms
 * may use `questions[]` and UPPERCASE types; everything is read into one typed list of fields here, each with a
 * stable variable name and a measurement level, so the collected answers are ready for statistics.
 */

export type Kind =
  | 'text' | 'long_text' | 'radio' | 'checkbox' | 'select' | 'date' | 'number' | 'email' | 'tel' | 'url'
  | 'file' | 'linear_scale' | 'rating' | 'radio_grid' | 'checkbox_grid' | 'time';
export type Measurement = 'nominal' | 'ordinal' | 'interval' | 'ratio' | 'text' | 'other';
export interface ShowIf { fieldId: string; equals?: unknown; notEquals?: unknown; includes?: string; notEmpty?: boolean }

export interface Field {
  id: string;
  kind: Kind;
  label: string;
  description?: string;
  required: boolean;
  options: string[];
  rows: string[];
  columns: string[];
  allowOther: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  minSelected?: number;
  maxSelected?: number;
  scaleMin: number;
  scaleMax: number;
  maxRating: number;
  pattern?: string;
  unit?: string;
  showIf?: ShowIf;
  /** Title of the section (page) the field is in, if any. */
  section: string | null;
  /** Column name in exports and analyses: short, unique, snake_case. */
  variable: string;
  measurement: Measurement;
}

const OLD: Record<string, Kind> = {
  SHORT_TEXT: 'text', LONG_TEXT: 'long_text', MULTIPLE_CHOICE: 'radio', CHECKBOX: 'checkbox', DROPDOWN: 'select',
  DATE: 'date', NUMBER: 'number', EMAIL: 'email', PHONE: 'tel', URL: 'url', FILE_UPLOAD: 'file', RATING: 'rating',
  LINEAR_SCALE: 'linear_scale', MULTIPLE_CHOICE_GRID: 'radio_grid', CHECKBOX_GRID: 'checkbox_grid', TIME: 'time',
  MCQ: 'select', ESSAY: 'long_text', TEXTAREA: 'long_text', SINGLE_CHOICE: 'radio', LIKERT: 'linear_scale', CURRENCY: 'number',
};
const KINDS = new Set<Kind>(['text', 'long_text', 'radio', 'checkbox', 'select', 'date', 'number', 'email', 'tel', 'url', 'file', 'linear_scale', 'rating', 'radio_grid', 'checkbox_grid', 'time']);
export const CHOICE_KINDS = new Set<Kind>(['radio', 'checkbox', 'select']);
export const GRID_KINDS = new Set<Kind>(['radio_grid', 'checkbox_grid']);

export function kindOf(t: unknown): Kind {
  const s = String(t ?? 'text');
  return OLD[s.toUpperCase()] ?? (KINDS.has(s.toLowerCase() as Kind) ? (s.toLowerCase() as Kind) : 'text');
}

const DEFAULT_MEASUREMENT: Record<Kind, Measurement> = {
  radio: 'nominal', select: 'nominal', checkbox: 'nominal', radio_grid: 'ordinal', checkbox_grid: 'nominal',
  linear_scale: 'ordinal', rating: 'ordinal', number: 'ratio', date: 'interval', time: 'interval',
  text: 'text', long_text: 'text', email: 'text', tel: 'text', url: 'text', file: 'other',
};

/** Parses a stored schema (string or object, possibly wrapped in { schema }). */
export function readSchema(raw: unknown): any {
  let s: any = raw;
  if (typeof s === 'string') { try { s = JSON.parse(s); } catch { return {}; } }
  if (!s || typeof s !== 'object') return {};
  if (s.schema && !Array.isArray(s.fields) && !Array.isArray(s.questions)) {
    let inner = s.schema;
    if (typeof inner === 'string') { try { inner = JSON.parse(inner); } catch { inner = {}; } }
    if (inner && typeof inner === 'object') s = { ...s, ...inner };
  }
  return s;
}

const num = (v: unknown) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));
const label = (o: unknown) => String(typeof o === 'string' ? o : (o as any)?.label ?? '').trim();

export function slugVariable(text: string): string {
  const base = text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(what|which|how|is|are|do|does|your|you|the|a|an|of|in|on|for|to|please|would|did|have|has)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').split('_').filter(Boolean).slice(0, 4).join('_');
  const v = base || 'question';
  return /^\d/.test(v) ? `q_${v}` : v.slice(0, 32);
}

/** All answerable fields of a form, in order, with sections, variable names and measurement levels. */
export function normalizeFields(schemaInput: unknown): Field[] {
  const s = readSchema(schemaInput);
  const raw: any[] = Array.isArray(s.fields) ? s.fields : Array.isArray(s.questions) ? s.questions : [];
  const blocks: any[] = Array.isArray(s.blocks) ? s.blocks : [];
  const used = new Set<string>();
  let section: string | null = null;
  return raw.map((f, i) => {
    const id = String(f.id ?? f.number ?? i + 1);
    for (const b of blocks) if (String(b.type).toUpperCase() === 'SECTION' && String(b.beforeFieldId ?? b.before) === id) section = String(b.title || '').trim() || section;
    if (f.sectionTitle) section = String(f.sectionTitle);
    const kind = kindOf(f.type);
    const text = String(f.label ?? f.title ?? f.text ?? '').trim() || `Question ${i + 1}`;
    const opts = (Array.isArray(f.options) ? f.options : []).map(label).filter(Boolean);
    const analytics = f.analytics && typeof f.analytics === 'object' ? f.analytics : {};
    let variable = String(analytics.variableName ?? analytics.variable ?? '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 32) || slugVariable(text);
    while (used.has(variable)) variable = `${variable.replace(/_\d+$/, '')}_${i + 1}`;
    used.add(variable);
    const m = String(analytics.measurementLevel ?? analytics.measurement ?? '');
    const measurement = (['nominal', 'ordinal', 'interval', 'ratio', 'text', 'other'].includes(m) ? m : DEFAULT_MEASUREMENT[kind]) as Measurement;
    const field: Field = {
      id, kind, label: text, ...(f.description ? { description: String(f.description) } : {}),
      required: !!f.required,
      options: GRID_KINDS.has(kind) ? [] : opts,
      rows: (Array.isArray(f.rows) ? f.rows : []).map(String),
      columns: GRID_KINDS.has(kind) ? (Array.isArray(f.columns) && f.columns.length ? f.columns.map(String) : opts) : [],
      allowOther: !!f.allowOther,
      min: num(f.min ?? f.validation?.min ?? f.validation?.minimum), max: num(f.max ?? f.validation?.max ?? f.validation?.maximum),
      minLength: num(f.minLength), maxLength: num(f.maxLength), minSelected: num(f.minSelected), maxSelected: num(f.maxSelected),
      scaleMin: num(f.scaleMin) ?? 1, scaleMax: num(f.scaleMax) ?? 5, maxRating: num(f.maxRating) ?? 5,
      ...(f.pattern ? { pattern: String(f.pattern) } : {}),
      ...(f.unit || analytics.unit ? { unit: String(f.unit ?? analytics.unit) } : {}),
      ...(f.showIf && typeof f.showIf === 'object' && f.showIf.fieldId ? { showIf: f.showIf as ShowIf } : {}),
      section, variable, measurement,
    };
    return field;
  });
}

export const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && v !== null && Object.keys(v).length === 0);

/** Same rule as the respondent page (DynamicForm): is this field shown for these answers? */
export function isVisible(field: Field, answers: Record<string, unknown>): boolean {
  const rule = field.showIf;
  if (!rule) return true;
  const v = answers[rule.fieldId];
  if (rule.notEmpty !== undefined) return rule.notEmpty ? !isEmpty(v) : isEmpty(v);
  if (rule.equals !== undefined) return Array.isArray(v) ? v.includes(rule.equals) : v === rule.equals;
  if (rule.notEquals !== undefined) return Array.isArray(v) ? !v.includes(rule.notEquals) : v !== rule.notEquals;
  if (rule.includes !== undefined) return Array.isArray(v) ? v.includes(rule.includes) : String(v ?? '').includes(rule.includes);
  return true;
}

/** The data dictionary (codebook) of a form. */
export function codebook(fields: Field[]) {
  return fields.filter((f) => f.kind !== 'file').map((f) => ({
    variable: f.variable, question: f.label, type: f.kind, measurement: f.measurement, required: f.required,
    values: CHOICE_KINDS.has(f.kind) ? [...f.options, ...(f.allowOther ? ['(other: free text)'] : [])].join(' | ')
      : f.kind === 'linear_scale' ? `${f.scaleMin} to ${f.scaleMax}` : f.kind === 'rating' ? `1 to ${f.maxRating}`
        : f.kind === 'number' ? `${f.min ?? '−∞'} to ${f.max ?? '∞'}${f.unit ? ` ${f.unit}` : ''}`
          : GRID_KINDS.has(f.kind) ? `rows: ${f.rows.join(' | ')}; columns: ${f.columns.join(' | ')}` : 'free text',
    shownWhen: f.showIf ? `${f.showIf.fieldId} ${f.showIf.equals !== undefined ? `= ${String(f.showIf.equals)}` : f.showIf.notEquals !== undefined ? `≠ ${String(f.showIf.notEquals)}` : f.showIf.includes !== undefined ? `includes ${f.showIf.includes}` : 'is answered'}` : 'always',
    section: f.section ?? '',
  }));
}
