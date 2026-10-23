import { CHOICE_KINDS, GRID_KINDS, isEmpty, isVisible, normalizeFields, type Field } from './model.js';

/**
 * Server-side validation. The browser checks answers too, but a modified request can skip that, so every
 * submission is checked again here against the form's own definition, including which questions were shown.
 * Definitions are checked before publishing.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 ()-]{7,20}$/;
const OTHER = '__other__';

export type SubmissionResult = { ok: true; values: Record<string, unknown> } | { ok: false; error: string; fieldId?: string };

/** Checks one response. Answers to questions hidden by branching are dropped, never stored. */
export function validateSubmission(schema: unknown, answers: Record<string, unknown>): SubmissionResult {
  const fields = normalizeFields(schema);
  const values: Record<string, unknown> = {};
  const name = (f: Field, i: number) => `"${f.label.slice(0, 80)}"` || `question ${i + 1}`;
  for (const [i, f] of fields.entries()) {
    if (!isVisible(f, answers)) continue;
    let v = answers[f.id];
    const other = String(answers[`${f.id}::other`] ?? '').trim();
    if (v === OTHER) v = other;
    if (Array.isArray(v)) v = v.map((x) => (x === OTHER ? other : x)).filter((x) => !isEmpty(x));
    if (GRID_KINDS.has(f.kind)) {
      if (v !== undefined && (typeof v !== 'object' || v === null || Array.isArray(v))) return fail(f, `Invalid answer for ${name(f, i)}.`);
      const g = (v ?? {}) as Record<string, unknown>;
      for (const [row, a] of Object.entries(g)) {
        if (!f.rows.includes(row)) return fail(f, `Invalid row for ${name(f, i)}.`);
        if (f.kind === 'radio_grid' && (typeof a !== 'string' || !f.columns.includes(a))) return fail(f, `Invalid choice for ${name(f, i)}.`);
        if (f.kind === 'checkbox_grid' && (!Array.isArray(a) || a.some((x) => !f.columns.includes(String(x))))) return fail(f, `Invalid choice for ${name(f, i)}.`);
      }
      if (f.required && f.rows.some((r) => isEmpty(g[r]))) return fail(f, `Please answer every row of ${name(f, i)}.`);
      if (!isEmpty(g)) values[f.id] = g;
      continue;
    }
    if (isEmpty(v)) {
      if (f.required) return fail(f, `Please answer ${name(f, i)}.`);
      continue;
    }
    switch (f.kind) {
      case 'radio': case 'select': {
        const s = String(v);
        if (f.options.length && !f.options.includes(s) && !(f.allowOther && f.kind === 'radio' && s.length <= 500)) return fail(f, `Choose one of the options for ${name(f, i)}.`);
        values[f.id] = s;
        break;
      }
      case 'checkbox': {
        const list = (Array.isArray(v) ? v : [v]).map(String);
        if (f.options.length && list.some((x) => !f.options.includes(x) && !(f.allowOther && x.length <= 500))) return fail(f, `Choose from the options for ${name(f, i)}.`);
        if (f.minSelected && list.length < f.minSelected) return fail(f, `Select at least ${f.minSelected} for ${name(f, i)}.`);
        if (f.maxSelected && list.length > f.maxSelected) return fail(f, `Select no more than ${f.maxSelected} for ${name(f, i)}.`);
        values[f.id] = [...new Set(list)];
        break;
      }
      case 'number': {
        const n = Number(String(v).replace(/[, ]/g, ''));
        if (!Number.isFinite(n)) return fail(f, `Enter a number for ${name(f, i)}.`);
        if (f.min !== undefined && n < f.min) return fail(f, `${name(f, i)} must be ${f.min} or more.`);
        if (f.max !== undefined && n > f.max) return fail(f, `${name(f, i)} must be ${f.max} or less.`);
        values[f.id] = n;
        break;
      }
      case 'linear_scale': case 'rating': {
        const n = Number(v);
        const lo = f.kind === 'rating' ? 1 : f.scaleMin, hi = f.kind === 'rating' ? f.maxRating : f.scaleMax;
        if (!Number.isInteger(n) || n < lo || n > hi) return fail(f, `Choose a value from ${lo} to ${hi} for ${name(f, i)}.`);
        values[f.id] = n;
        break;
      }
      case 'date': {
        const s = String(v);
        if (!/^\d{4}-\d{2}-\d{2}/.test(s) || Number.isNaN(Date.parse(s))) return fail(f, `Enter a valid date for ${name(f, i)}.`);
        values[f.id] = s.slice(0, 10);
        break;
      }
      case 'time': {
        const s = String(v);
        if (!/^([01]?\d|2[0-3]):[0-5]\d/.test(s)) return fail(f, `Enter a valid time for ${name(f, i)}.`);
        values[f.id] = s.slice(0, 5);
        break;
      }
      case 'file': {
        const s = String(v);
        if (s.length > 15_000_000) return fail(f, `The file for ${name(f, i)} is too large.`);
        values[f.id] = s;
        break;
      }
      default: {
        const s = String(v).trim();
        if (s.length > 50_000) return fail(f, `The answer to ${name(f, i)} is too long.`);
        if (f.minLength && s.length < f.minLength) return fail(f, `Enter at least ${f.minLength} characters for ${name(f, i)}.`);
        if (f.maxLength && s.length > f.maxLength) return fail(f, `Enter no more than ${f.maxLength} characters for ${name(f, i)}.`);
        if (f.kind === 'email' && !EMAIL.test(s)) return fail(f, `Enter a valid email address for ${name(f, i)}.`);
        if (f.kind === 'url') { try { new URL(s); } catch { return fail(f, `Enter a valid web address for ${name(f, i)}.`); } }
        if (f.pattern) { let okp = true; try { okp = new RegExp(f.pattern).test(s); } catch { okp = true; } if (!okp) return fail(f, `${name(f, i)} is not in the expected format.`); }
        else if (f.kind === 'tel' && !PHONE.test(s)) return fail(f, `Enter a valid phone number for ${name(f, i)}.`);
        values[f.id] = s;
      }
    }
  }
  return { ok: true, values };
}

const fail = (f: Field, error: string): SubmissionResult => ({ ok: false, error, fieldId: f.id });

export interface DefinitionCheck { errors: string[]; warnings: string[] }

/** Structural checks before publishing: things that would break the form or its data. */
export function checkDefinition(schema: unknown): DefinitionCheck {
  const fields = normalizeFields(schema);
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Map<string, number>();
  fields.forEach((f, i) => ids.set(f.id, i));
  if (!fields.length) errors.push('The form has no questions.');
  const seen = new Set<string>();
  fields.forEach((f, i) => {
    const n = `Question ${i + 1} ("${f.label.slice(0, 60)}")`;
    if (seen.has(f.id)) errors.push(`${n}: duplicate question id "${f.id}".`);
    seen.add(f.id);
    if (CHOICE_KINDS.has(f.kind) && f.options.length < 2 && !f.allowOther) errors.push(`${n}: needs at least two options.`);
    if (CHOICE_KINDS.has(f.kind) && new Set(f.options.map((o) => o.toLowerCase())).size !== f.options.length) errors.push(`${n}: has duplicate options.`);
    if (GRID_KINDS.has(f.kind) && (!f.rows.length || !f.columns.length)) errors.push(`${n}: needs rows and columns.`);
    if (f.min !== undefined && f.max !== undefined && f.min > f.max) errors.push(`${n}: the minimum is above the maximum.`);
    if (f.kind === 'linear_scale' && f.scaleMax <= f.scaleMin) errors.push(`${n}: the scale maximum must be above the minimum.`);
    if (f.minSelected && f.maxSelected && f.minSelected > f.maxSelected) errors.push(`${n}: minimum selections are above the maximum.`);
    if (f.pattern) { try { new RegExp(f.pattern); } catch { errors.push(`${n}: the answer pattern is not valid.`); } }
    if (f.showIf) {
      const j = ids.get(f.showIf.fieldId);
      if (j === undefined) errors.push(`${n}: is shown depending on a question that does not exist ("${f.showIf.fieldId}").`);
      else if (j >= i) errors.push(`${n}: depends on a later question; a condition must refer to an earlier question.`);
      else {
        const dep = fields[j];
        const val = f.showIf.equals ?? f.showIf.notEquals;
        if (val !== undefined && CHOICE_KINDS.has(dep.kind) && !dep.options.includes(String(val))) errors.push(`${n}: its condition uses "${String(val)}", which is not an option of the question it depends on.`);
      }
    }
    if (f.kind === 'number' && f.min === undefined && f.max === undefined) warnings.push(`${n}: a number without limits; add a minimum and maximum to catch typing mistakes.`);
  });
  return { errors, warnings };
}
