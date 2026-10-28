import { z } from 'zod';
import { type Dataset, numericColumn, qualityReport, textColumn, type QualityReport } from './dataset.js';
import {
  correlation, crossTab, describe, frequencyTable, linearRegression, oneSampleTTest, timeSeries, tukeyOutliers, weightedDescribe, welchTTest,
} from './statistics.js';

export const ENGINE_VERSION = 'bwenge-stats-1.0.0';

const col = z.string().min(1).max(200);
export const analysisSpecSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('describe'), columns: z.array(col).max(50).optional(), groupBy: col.optional(), weights: col.optional() }).strict(),
  z.object({ type: z.literal('frequency'), column: col }).strict(),
  z.object({ type: z.literal('crosstab'), row: col, column: col }).strict(),
  z.object({ type: z.literal('correlation'), columns: z.array(col).min(2).max(20).optional(), method: z.enum(['pearson', 'spearman']).optional() }).strict(),
  z.object({ type: z.literal('regression'), y: col, x: z.array(col).min(1).max(10) }).strict(),
  z.object({ type: z.literal('ttest'), column: col, groupBy: col.optional(), groups: z.array(z.string()).length(2).optional(), mu: z.number().optional() }).strict(),
  z.object({ type: z.literal('outliers'), column: col, k: z.number().positive().max(10).optional() }).strict(),
  z.object({ type: z.literal('timeseries'), time: col, value: col, groupBy: col.optional() }).strict(),
]);
export type AnalysisSpec = z.infer<typeof analysisSpecSchema>;

export const analysisRequestSchema = z.object({
  analyses: z.array(analysisSpecSchema).max(30).optional(),
  filters: z.array(z.object({
    column: col,
    op: z.enum(['eq', 'neq', 'in', 'gte', 'lte']),
    value: z.union([z.string().max(200), z.number(), z.array(z.union([z.string().max(200), z.number()])).max(200)]),
  }).strict()).max(20).optional(),
  missingValues: z.array(z.string().max(40)).max(30).optional(),
}).strict();
export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;

export interface AnalysisResultItem {
  id: string;
  spec: AnalysisSpec;
  title: string;
  ok: boolean;
  error?: string;
  result?: unknown;
}

export interface AnalysisResult {
  engineVersion: string;
  dataset: { name: string; sha256: string; format: string; rowsLoaded: number; rowsAnalyzed: number; columns: Dataset['columns'] };
  quality: QualityReport;
  transformations: string[];
  results: AnalysisResultItem[];
  warnings: string[];
}

export class AnalysisError extends Error {
  constructor(message: string) { super(message); }
}

function applyFilters(ds: Dataset, filters: AnalysisRequest['filters'], log: string[]): Dataset {
  if (!filters?.length) return ds;
  let rows = ds.rows;
  for (const f of filters) {
    if (!ds.columns.some((c) => c.name === f.column)) throw new AnalysisError(`Filter column "${f.column}" does not exist.`);
    const before = rows.length;
    const vals = (Array.isArray(f.value) ? f.value : [f.value]).map(String);
    rows = rows.filter((r) => {
      const v = r[f.column] ?? '';
      if (f.op === 'eq') return v === vals[0];
      if (f.op === 'neq') return v !== vals[0];
      if (f.op === 'in') return vals.includes(v);
      const num = Number(v);
      const bound = Number(vals[0]);
      if (!Number.isFinite(num) || !Number.isFinite(bound)) return false;
      return f.op === 'gte' ? num >= bound : num <= bound;
    });
    log.push(`Filter ${f.column} ${f.op} ${JSON.stringify(f.value)}: ${before} → ${rows.length} rows.`);
  }
  return { ...ds, rows };
}

/** Picks a sensible default plan when the caller gives none: describe numerics, tabulate categoricals, correlate numerics. */
export function defaultPlan(ds: Dataset): AnalysisSpec[] {
  const usable = ds.columns.filter((c) => !c.hints.some((h) => h.startsWith('identifier')));
  const numeric = usable.filter((c) => c.type === 'numeric' && !c.hints.includes('year')).map((c) => c.name);
  const categorical = usable.filter((c) => c.type === 'categorical' || c.type === 'boolean').map((c) => c.name);
  const plan: AnalysisSpec[] = [];
  if (numeric.length) plan.push({ type: 'describe', columns: numeric.slice(0, 20) });
  for (const c of categorical.slice(0, 8)) plan.push({ type: 'frequency', column: c });
  if (numeric.length >= 2) plan.push({ type: 'correlation', columns: numeric.slice(0, 10), method: 'pearson' });
  return plan;
}

function requireColumns(ds: Dataset, names: string[], kind?: 'numeric') {
  for (const n of names) {
    const c = ds.columns.find((x) => x.name === n);
    if (!c) throw new AnalysisError(`Column "${n}" does not exist.`);
    if (kind === 'numeric' && c.type !== 'numeric') throw new AnalysisError(`Column "${n}" is ${c.type}, not numeric.`);
  }
}

function groupsOf(ds: Dataset, column: string): Map<string, number[]> {
  const g = new Map<string, number[]>();
  textColumn(ds, column).forEach((v, i) => { if (v !== null) { if (!g.has(v)) g.set(v, []); g.get(v)!.push(i); } });
  return g;
}

function run(ds: Dataset, spec: AnalysisSpec): { title: string; result: unknown } {
  switch (spec.type) {
    case 'describe': {
      const cols = spec.columns ?? ds.columns.filter((c) => c.type === 'numeric').map((c) => c.name);
      requireColumns(ds, cols, 'numeric');
      if (spec.weights) requireColumns(ds, [spec.weights], 'numeric');
      const byColumn = Object.fromEntries(cols.map((c) => [c, describe(numericColumn(ds, c))]));
      const weighted = spec.weights ? Object.fromEntries(cols.map((c) => [c, weightedDescribe(numericColumn(ds, c), numericColumn(ds, spec.weights!))])) : undefined;
      let byGroup: Record<string, Record<string, ReturnType<typeof describe>>> | undefined;
      if (spec.groupBy) {
        requireColumns(ds, [spec.groupBy]);
        const groups = groupsOf(ds, spec.groupBy);
        if (groups.size > 50) throw new AnalysisError(`"${spec.groupBy}" has ${groups.size} groups; at most 50 are supported for grouped summaries.`);
        byGroup = Object.fromEntries(cols.map((c) => {
          const vals = numericColumn(ds, c);
          return [c, Object.fromEntries([...groups.entries()].map(([g, idx]) => [g, describe(idx.map((i) => vals[i]))]))];
        }));
      }
      return { title: `Descriptive statistics${spec.groupBy ? ` by ${spec.groupBy}` : ''}`, result: { columns: cols, byColumn, weighted, groupBy: spec.groupBy, byGroup } };
    }
    case 'frequency':
      requireColumns(ds, [spec.column]);
      return { title: `Frequency of ${spec.column}`, result: frequencyTable(textColumn(ds, spec.column)) };
    case 'crosstab':
      requireColumns(ds, [spec.row, spec.column]);
      return { title: `${spec.row} by ${spec.column}`, result: crossTab(textColumn(ds, spec.row), textColumn(ds, spec.column)) };
    case 'correlation': {
      const cols = spec.columns ?? ds.columns.filter((c) => c.type === 'numeric').map((c) => c.name).slice(0, 10);
      if (cols.length < 2) throw new AnalysisError('Correlation needs at least two numeric columns.');
      requireColumns(ds, cols, 'numeric');
      const method = spec.method ?? 'pearson';
      const data = Object.fromEntries(cols.map((c) => [c, numericColumn(ds, c)]));
      const pairs = [];
      for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) pairs.push({ x: cols[i], y: cols[j], ...correlation(data[cols[i]], data[cols[j]], method) });
      return { title: `${method === 'pearson' ? 'Pearson' : 'Spearman'} correlations`, result: { method, columns: cols, pairs } };
    }
    case 'regression': {
      requireColumns(ds, [spec.y, ...spec.x], 'numeric');
      const r = linearRegression(numericColumn(ds, spec.y), Object.fromEntries(spec.x.map((x) => [x, numericColumn(ds, x)])));
      if ('error' in r) throw new AnalysisError(r.error);
      return { title: `Linear regression of ${spec.y} on ${spec.x.join(', ')}`, result: { y: spec.y, ...r } };
    }
    case 'ttest': {
      requireColumns(ds, [spec.column], 'numeric');
      const vals = numericColumn(ds, spec.column);
      if (!spec.groupBy) {
        const r = oneSampleTTest(vals, spec.mu ?? 0);
        if ('error' in r) throw new AnalysisError(r.error);
        return { title: `One-sample t-test of ${spec.column} (μ0 = ${spec.mu ?? 0})`, result: r };
      }
      requireColumns(ds, [spec.groupBy]);
      const groups = groupsOf(ds, spec.groupBy);
      const names = spec.groups ?? [...groups.keys()];
      if (names.length !== 2 || !names.every((g) => groups.has(g))) throw new AnalysisError(`"${spec.groupBy}" must have exactly two groups (or name two with "groups"); found ${groups.size}.`);
      const r = welchTTest(groups.get(names[0])!.map((i) => vals[i]), groups.get(names[1])!.map((i) => vals[i]));
      if ('error' in r) throw new AnalysisError(r.error);
      return { title: `Welch t-test of ${spec.column}: ${names[0]} vs ${names[1]}`, result: { groups: names, ...r } };
    }
    case 'outliers': {
      requireColumns(ds, [spec.column], 'numeric');
      const r = tukeyOutliers(numericColumn(ds, spec.column), spec.k);
      if ('error' in r) throw new AnalysisError(r.error);
      return { title: `Outliers in ${spec.column}`, result: { ...r, outliers: r.outliers.slice(0, 200).map((o) => ({ row: o.index + 1, value: o.value })), total: r.outliers.length } };
    }
    case 'timeseries': {
      requireColumns(ds, [spec.time]);
      requireColumns(ds, [spec.value], 'numeric');
      const periods = textColumn(ds, spec.time);
      const vals = numericColumn(ds, spec.value);
      const build = (idx: number[]) => timeSeries(idx.map((i) => periods[i] as string), idx.map((i) => vals[i]));
      const all = ds.rows.map((_, i) => i).filter((i) => periods[i] !== null);
      if (!spec.groupBy) return { title: `${spec.value} over ${spec.time}`, result: build(all) };
      requireColumns(ds, [spec.groupBy]);
      const groups = groupsOf(ds, spec.groupBy);
      if (groups.size > 20) throw new AnalysisError(`"${spec.groupBy}" has ${groups.size} groups; at most 20 series are supported.`);
      return { title: `${spec.value} over ${spec.time} by ${spec.groupBy}`, result: { groupBy: spec.groupBy, series: Object.fromEntries([...groups.entries()].map(([g, idx]) => [g, build(idx.filter((i) => periods[i] !== null))])) } };
    }
  }
}

/** Runs a validated analysis request. Pure and deterministic: the same file and request give the same output. */
export function runAnalysis(dsIn: Dataset, request: AnalysisRequest = {}): AnalysisResult {
  const transformations: string[] = [
    `Loaded ${dsIn.format.toUpperCase()} "${dsIn.name}" (sha256 ${dsIn.sha256.slice(0, 16)}…, ${dsIn.rows.length} rows, ${dsIn.columns.length} columns).`,
    `Cells treated as missing: ${dsIn.missingTokens.map((t) => (t ? JSON.stringify(t) : 'empty')).join(', ')}. Missing values are excluded from each calculation, never replaced with 0.`,
    'Numbers such as "1,234", "12.5%" and "(3.2)" are parsed as 1234, 12.5 and −3.2; any other non-numeric text in a numeric column is counted as invalid and excluded.',
  ];
  const ds = applyFilters(dsIn, request.filters, transformations);
  if (!ds.rows.length) throw new AnalysisError('No rows remain after filtering.');
  const plan = request.analyses?.length ? request.analyses : defaultPlan(ds);
  if (!request.analyses?.length) transformations.push('No analyses requested: ran the default plan (describe numeric columns, frequencies of categorical columns, correlations).');
  const results: AnalysisResultItem[] = plan.map((spec, i) => {
    const id = `a${i + 1}`;
    try {
      const { title, result } = run(ds, spec);
      return { id, spec, title, ok: true, result };
    } catch (e) {
      if (e instanceof AnalysisError) return { id, spec, title: spec.type, ok: false, error: e.message };
      throw e;
    }
  });
  const warnings = results.filter((r) => !r.ok).map((r) => `${r.id}: ${r.error}`);
  return {
    engineVersion: ENGINE_VERSION,
    dataset: { name: ds.name, sha256: ds.sha256, format: ds.format, rowsLoaded: dsIn.rows.length, rowsAnalyzed: ds.rows.length, columns: ds.columns },
    quality: qualityReport(ds), transformations, results, warnings,
  };
}
