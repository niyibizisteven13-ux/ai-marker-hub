import { CHOICE_KINDS, GRID_KINDS, isEmpty, isVisible, normalizeFields, type Field } from './model.js';
import { compareGroups, correlate, crosstab, describe } from './stats.js';

/**
 * Form responses as a typed dataset, plus the analyses the chat can run on it. Every number comes from
 * stats.ts; the model only chooses analyses by variable name and explains the computed results.
 */

export interface Submission { id: string; data: unknown; createdAt?: Date | string; formVersion?: number | null }
export interface Dataset { fields: Field[]; rows: Array<{ id: string; submittedAt: string | null; version: number | null; answers: Record<string, unknown> }> }

const parse = (d: unknown): Record<string, unknown> => {
  if (typeof d === 'string') { try { const v = JSON.parse(d); return v && typeof v === 'object' ? v : {}; } catch { return {}; } }
  return d && typeof d === 'object' ? (d as Record<string, unknown>) : {};
};

export function buildDataset(schema: unknown, submissions: Submission[]): Dataset {
  return {
    fields: normalizeFields(schema),
    rows: submissions.map((s) => ({ id: s.id, submittedAt: s.createdAt ? new Date(s.createdAt).toISOString() : null, version: s.formVersion ?? null, answers: parse(s.data) })),
  };
}

const NUMERIC = new Set(['number', 'linear_scale', 'rating']);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function findField(ds: Dataset, ref: string): Field | null {
  const k = ref.trim().toLowerCase();
  return ds.fields.find((f) => f.variable.toLowerCase() === k || f.id.toLowerCase() === k)
    ?? ds.fields.find((f) => f.label.toLowerCase() === k)
    ?? ds.fields.find((f) => f.label.toLowerCase().includes(k) && k.length >= 4) ?? null;
}

/** Answered / not shown / skipped counts for a field (branching-aware). */
export function coverage(ds: Dataset, f: Field) {
  let answered = 0, notShown = 0, skipped = 0;
  for (const row of ds.rows) {
    if (!isVisible(f, row.answers)) notShown++;
    else if (isEmpty(row.answers[f.id])) skipped++;
    else answered++;
  }
  return { answered, notShown, skipped, responseRate: answered + skipped ? r2((answered / (answered + skipped)) * 100) : null };
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const cat = (f: Field, v: unknown): string[] => (Array.isArray(v) ? v.map(String) : isEmpty(v) ? [] : [String(v)]);
/** Order categories as the form lists them; answers outside the list (e.g. "Other") come after. */
const order = (f: Field): string[] => (CHOICE_KINDS.has(f.kind) ? f.options : f.kind === 'linear_scale' ? Array.from({ length: f.scaleMax - f.scaleMin + 1 }, (_, i) => String(f.scaleMin + i)) : f.kind === 'rating' ? Array.from({ length: f.maxRating }, (_, i) => String(i + 1)) : []);

export type Summary =
  | { variable: string; question: string; kind: 'categorical'; multiple: boolean; n: number; coverage: ReturnType<typeof coverage>; table: Array<{ value: string; count: number; percent: number }>; median?: number; mean?: number }
  | { variable: string; question: string; kind: 'numeric'; unit?: string; coverage: ReturnType<typeof coverage> } & ReturnType<typeof describe>
  | { variable: string; question: string; kind: 'text'; coverage: ReturnType<typeof coverage>; examples: string[]; averageLength: number }
  | { variable: string; question: string; kind: 'grid'; coverage: ReturnType<typeof coverage>; rows: Array<{ row: string; table: Array<{ value: string; count: number }> }> }
  | { variable: string; question: string; kind: 'date'; coverage: ReturnType<typeof coverage>; first: string | null; last: string | null };

export function summarize(ds: Dataset, f: Field, opts: { examples?: number } = {}): Summary {
  const cov = coverage(ds, f);
  const vals = ds.rows.map((r) => r.answers[f.id]).filter((v) => !isEmpty(v));
  const base = { variable: f.variable, question: f.label, coverage: cov };
  if (GRID_KINDS.has(f.kind)) {
    return { ...base, kind: 'grid', rows: f.rows.map((row) => {
      const counts = new Map<string, number>(f.columns.map((c) => [c, 0]));
      for (const v of vals) for (const c of cat(f, (v as any)?.[row])) counts.set(c, (counts.get(c) ?? 0) + 1);
      return { row, table: [...counts].map(([value, count]) => ({ value, count })) };
    }) };
  }
  if (f.kind === 'number') return { ...base, kind: 'numeric', ...(f.unit ? { unit: f.unit } : {}), ...describe(vals.map(num)) };
  if (f.kind === 'date' || f.kind === 'time') {
    const s = vals.map(String).sort();
    return { ...base, kind: 'date', first: s[0] ?? null, last: s[s.length - 1] ?? null };
  }
  if (CHOICE_KINDS.has(f.kind) || f.kind === 'linear_scale' || f.kind === 'rating') {
    const counts = new Map<string, number>(order(f).map((o) => [o, 0]));
    for (const v of vals) for (const c of cat(f, v)) counts.set(c, (counts.get(c) ?? 0) + 1);
    const n = vals.length;
    const table = [...counts].map(([value, count]) => ({ value, count, percent: n ? r2((count / n) * 100) : 0 }));
    const out: Summary = { ...base, kind: 'categorical', multiple: f.kind === 'checkbox', n, table };
    if (f.measurement === 'ordinal' && NUMERIC.has(f.kind)) { const d = describe(vals.map(num)); out.median = d.median; out.mean = d.mean; }
    return out;
  }
  const texts = vals.map((v) => String(v).trim());
  return { ...base, kind: 'text', examples: texts.slice(0, opts.examples ?? 5).map((t) => t.slice(0, 300)), averageLength: texts.length ? Math.round(texts.reduce((a, t) => a + t.length, 0) / texts.length) : 0 };
}

export type AnalysisRequest =
  | { type: 'summary'; variables?: string[] }
  | { type: 'crosstab'; row: string; column: string }
  | { type: 'compare'; outcome: string; group: string }
  | { type: 'correlate'; x: string; y: string };

export class AnalysisError extends Error {}

/** Runs one analysis, choosing the right method from the measurement levels; refuses unsuitable requests. */
export function runAnalysis(ds: Dataset, req: AnalysisRequest) {
  const need = (ref: string) => {
    const f = findField(ds, ref);
    if (!f) throw new AnalysisError(`There is no variable "${ref}". Available: ${ds.fields.map((x) => x.variable).join(', ')}.`);
    return f;
  };
  const isCat = (f: Field) => CHOICE_KINDS.has(f.kind) || f.measurement === 'nominal' || f.measurement === 'ordinal';
  const isNum = (f: Field) => NUMERIC.has(f.kind) && (f.measurement === 'ratio' || f.measurement === 'interval' || f.measurement === 'ordinal');
  switch (req.type) {
    case 'summary': {
      const fs = req.variables?.length ? req.variables.map(need) : ds.fields.filter((f) => f.kind !== 'file');
      return { type: 'summary' as const, responses: ds.rows.length, summaries: fs.map((f) => summarize(ds, f)) };
    }
    case 'crosstab': {
      const a = need(req.row), b = need(req.column);
      if (!isCat(a) || !isCat(b)) throw new AnalysisError('A cross-tabulation needs two categorical questions (choices, scales or ratings). For a number, use "compare" against a category.');
      const pairs: Array<[string, string]> = [];
      for (const row of ds.rows) for (const x of cat(a, row.answers[a.id])) for (const y of cat(b, row.answers[b.id])) pairs.push([x, y]);
      const multi = a.kind === 'checkbox' || b.kind === 'checkbox';
      const t = crosstab(pairs, order(a), order(b));
      if (multi) t.warnings.push('A multiple-select question counts each selection separately, so the chi-square test does not apply; read the counts only.');
      return { type: 'crosstab' as const, row: a.variable, column: b.variable, ...t, ...(multi ? { chi2: null, p: null, cramersV: null } : {}) };
    }
    case 'compare': {
      const y = need(req.outcome), g = need(req.group);
      if (!isNum(y)) throw new AnalysisError(`"${y.label}" is not numeric; use a cross-tabulation instead.`);
      if (!isCat(g)) throw new AnalysisError(`"${g.label}" is not a category to group by.`);
      const pairs: Array<[string, number]> = [];
      for (const row of ds.rows) { const v = num(row.answers[y.id]); if (Number.isFinite(v)) for (const c of cat(g, row.answers[g.id])) pairs.push([c, v]); }
      const res = compareGroups(pairs, order(g));
      if (y.measurement === 'ordinal') res.warnings.push(`"${y.label}" is an ordinal scale: means are shown for convenience, the medians are the safer summary.`);
      return { type: 'compare' as const, outcome: y.variable, group: g.variable, unit: y.unit ?? null, ...res };
    }
    case 'correlate': {
      const a = need(req.x), b = need(req.y);
      if (!isNum(a) || !isNum(b)) throw new AnalysisError('A correlation needs two numeric questions (numbers, scales or ratings).');
      const res = correlate(ds.rows.map((row) => [num(row.answers[a.id]), num(row.answers[b.id])] as [number, number]));
      if (a.measurement === 'ordinal' || b.measurement === 'ordinal') res.warnings.push('At least one variable is ordinal: Spearman\'s rho is the more appropriate coefficient.');
      return { type: 'correlate' as const, x: a.variable, y: b.variable, ...res };
    }
  }
}

/** Spreadsheet rows: one row per response, one column per variable (multi-select joined with "; "). */
export function tabular(ds: Dataset) {
  const cols = ds.fields.filter((f) => f.kind !== 'file');
  const columns = [{ key: 'response_id', label: 'response_id' }, { key: 'submitted_at', label: 'submitted_at' }, { key: 'form_version', label: 'form_version' },
    ...cols.flatMap((f) => (GRID_KINDS.has(f.kind) ? f.rows.map((row, i) => ({ key: `${f.variable}__${i + 1}`, label: `${f.variable}__${row}`.slice(0, 200) })) : [{ key: f.variable, label: f.variable }]))];
  const rows = ds.rows.map((r) => {
    const out: Record<string, string | number | null> = { response_id: r.id, submitted_at: r.submittedAt, form_version: r.version };
    for (const f of cols) {
      const v = r.answers[f.id];
      if (GRID_KINDS.has(f.kind)) f.rows.forEach((row, i) => { const x = (v as any)?.[row]; out[`${f.variable}__${i + 1}`] = Array.isArray(x) ? x.join('; ') : x ?? null; });
      else out[f.variable] = isEmpty(v) ? (isVisible(f, r.answers) ? null : 'not shown') : Array.isArray(v) ? v.join('; ') : typeof v === 'number' ? v : String(v).slice(0, 2000);
    }
    return out;
  });
  return { columns, rows };
}
