import { generateStructured } from '../ai/llm/structuredJson.js';
import type { ProviderAdapter } from '../ai/providers/types.js';
import { normalizeFields, readSchema } from './model.js';
import { checkDefinition } from './validation.js';

/**
 * Form generation and editing from plain language. The model returns a structured form (sections, typed
 * questions, validation, branching, data-dictionary names); the result is checked structurally before it is
 * saved, and it is always a draft: nothing is published without the owner.
 */

type AI = { adapter: ProviderAdapter; model: string; fallbackModel?: string | null };

const nul = (t: string) => ({ type: [t, 'null'] });
const QUESTION = {
  type: 'object', additionalProperties: false,
  required: ['id', 'type', 'label', 'description', 'required', 'options', 'allowOther', 'min', 'max', 'unit', 'scaleMin', 'scaleMax', 'scaleMinLabel', 'scaleMaxLabel', 'rows', 'columns', 'showIf', 'variable', 'measurement'],
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['text', 'long_text', 'radio', 'checkbox', 'select', 'number', 'date', 'time', 'email', 'tel', 'url', 'linear_scale', 'rating', 'radio_grid', 'checkbox_grid'] },
    label: { type: 'string' }, description: nul('string'), required: { type: 'boolean' },
    options: { type: 'array', items: { type: 'string' } }, allowOther: { type: 'boolean' },
    min: nul('number'), max: nul('number'), unit: nul('string'),
    scaleMin: nul('number'), scaleMax: nul('number'), scaleMinLabel: nul('string'), scaleMaxLabel: nul('string'),
    rows: { type: 'array', items: { type: 'string' } }, columns: { type: 'array', items: { type: 'string' } },
    showIf: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['fieldId', 'equals'], properties: { fieldId: { type: 'string' }, equals: { type: 'string' } } }] },
    variable: { type: 'string' }, measurement: { type: 'string', enum: ['nominal', 'ordinal', 'interval', 'ratio', 'text'] },
  },
};
const FORM_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'description', 'confirmationMessage', 'sections', 'notes'],
  properties: {
    title: { type: 'string' }, description: { type: 'string' }, confirmationMessage: { type: 'string' },
    sections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'questions'], properties: { title: { type: 'string' }, questions: { type: 'array', items: QUESTION } } } },
    notes: { type: 'array', items: { type: 'string' } },
  },
};

const SYSTEM = `You design professional forms and questionnaires (surveys, research instruments, registrations, applications, feedback, quizzes) for the Bwenge platform.
- Ask only what the purpose needs; group questions into sections that each have a short title.
- Choose the question type that gives analysable data: numbers as "number" with realistic min/max and a unit (RWF, years, hours…); agreement and satisfaction as "linear_scale" 1–5 with both end labels; one answer from a list as "radio" (≤ 8 options) or "select" (long lists); several answers as "checkbox"; emails as "email"; phones as "tel"; dates as "date". Add "Other" (allowOther true) when a list may be incomplete.
- Neutral, single-issue wording: no leading questions and no double-barrelled questions.
- Branching: a follow-up that only applies to some respondents gets showIf { fieldId: id of an EARLIER radio/select question, equals: one of its options exactly }.
- Each question: a short stable id (q1, q2…), a snake_case variable name (≤ 32 chars) and its measurement level (nominal, ordinal, interval, ratio, text).
- When personal or sensitive information is collected, the description includes a short consent and privacy statement (purpose, who sees answers, voluntary). Sensitive questions are optional and offer "Prefer not to say".
- Use the language the user wrote in unless they ask for another. Unused fields: null or [].
- notes: 1–4 short sentences explaining the main design choices (for example why a scale is ordinal, what branching does).`;

export interface GeneratedForm { schema: any; notes: string[] }

function toSchema(d: any, base: any = {}): any {
  const fields: any[] = [];
  for (const sec of d.sections ?? []) {
    (sec.questions ?? []).forEach((q: any, i: number) => {
      const f: any = { id: String(q.id || `q${fields.length + 1}`), type: q.type, label: String(q.label).trim(), required: !!q.required };
      if (i === 0 && (d.sections.length > 1 || sec.title)) f.sectionTitle = String(sec.title || '').trim() || undefined;
      if (q.description) f.description = q.description;
      if (['radio', 'checkbox', 'select'].includes(q.type)) { f.options = (q.options ?? []).map(String); if (q.allowOther && q.type !== 'select') f.allowOther = true; }
      if (['radio_grid', 'checkbox_grid'].includes(q.type)) { f.rows = q.rows ?? []; f.columns = q.columns ?? q.options ?? []; }
      if (q.type === 'number') { if (q.min !== null && q.min !== undefined) f.min = q.min; if (q.max !== null && q.max !== undefined) f.max = q.max; }
      if (q.type === 'linear_scale') { f.scaleMin = q.scaleMin ?? 1; f.scaleMax = q.scaleMax ?? 5; if (q.scaleMinLabel) f.scaleMinLabel = q.scaleMinLabel; if (q.scaleMaxLabel) f.scaleMaxLabel = q.scaleMaxLabel; }
      if (q.type === 'rating') f.maxRating = q.scaleMax ?? 5;
      if (q.unit) f.unit = q.unit;
      if (q.showIf?.fieldId) f.showIf = { fieldId: String(q.showIf.fieldId), equals: q.showIf.equals };
      f.analytics = { variableName: q.variable, measurementLevel: q.measurement, ...(q.unit ? { unit: q.unit } : {}) };
      fields.push(f);
    });
  }
  return {
    ...base,
    title: String(d.title || base.title || 'Untitled form').trim(), description: String(d.description ?? base.description ?? ''),
    confirmationMessage: d.confirmationMessage || base.confirmationMessage || 'Your response has been recorded.',
    themeColor: base.themeColor || '#D97757', acceptingResponses: base.acceptingResponses ?? false,
    collectEmail: base.collectEmail ?? false, isQuiz: base.isQuiz ?? false, allowMultipleResponses: base.allowMultipleResponses ?? true,
    fields, blocks: [],
  };
}

const problems = (d: unknown) => {
  const x = d as any;
  if (!x?.sections?.some((s: any) => s.questions?.length)) return ['The form has no questions.'];
  return checkDefinition(toSchema(x)).errors;
};

export async function generateForm(ai: AI, description: string, signal?: AbortSignal): Promise<GeneratedForm & { usage: { input: number; output: number } }> {
  const { data, usage } = await generateStructured<any>(ai.adapter, {
    model: ai.model, fallbackModel: ai.fallbackModel, schema: FORM_SCHEMA, maxTokens: 12_000, signal, system: SYSTEM,
    prompt: `Create this form:\n<request>${description.slice(0, 6000)}</request>`, validate: problems,
  });
  return { schema: toSchema(data), notes: (data.notes ?? []).slice(0, 4), usage };
}

/** Applies a plain-language change to an existing form; unchanged questions keep their ids. */
export async function editForm(ai: AI, current: unknown, instruction: string, signal?: AbortSignal): Promise<GeneratedForm & { usage: { input: number; output: number } }> {
  const base = readSchema(current);
  const compact = normalizeFields(base).map((f) => ({ id: f.id, type: f.kind, label: f.label, required: f.required, options: f.options, min: f.min, max: f.max, unit: f.unit, showIf: f.showIf, section: f.section, variable: f.variable, measurement: f.measurement }));
  const { data, usage } = await generateStructured<any>(ai.adapter, {
    model: ai.model, fallbackModel: ai.fallbackModel, schema: FORM_SCHEMA, maxTokens: 12_000, signal,
    system: `${SYSTEM}\n- You are EDITING an existing form. Apply only the requested change and return the whole form. Keep the id, wording, type and variable of every question the change does not touch, and keep the order unless asked.`,
    prompt: `Current form:\n${JSON.stringify({ title: base.title, description: base.description, questions: compact }).slice(0, 40_000)}\n\nChange requested:\n<request>${instruction.slice(0, 4000)}</request>`,
    validate: problems,
  });
  return { schema: toSchema(data, base), notes: (data.notes ?? []).slice(0, 4), usage };
}
