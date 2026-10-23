import { z } from 'zod';
import { numericColumn, textColumn, type Dataset } from '../analytics/dataset.js';
import { correlation, describe, linearRegression, tukeyOutliers } from '../analytics/statistics.js';
import { PythonRunError, PythonUnavailableError, pythonStatus, runPythonEngine, type Isolation } from './pythonRunner.js';

/**
 * Statistical analysis for outputs. The model may choose operations and explain validated results, but every
 * number comes from the deterministic engine (Python: numpy/pandas; TypeScript fallback for a subset when
 * Python is not installed). Requests are validated against the dataset's real columns and types first.
 */

const col = z.string().min(1).max(200);
export const filterSchema = z.object({ column: col, op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notin', 'isnull', 'notnull']), value: z.union([z.string().max(500), z.number(), z.boolean(), z.null(), z.array(z.union([z.string().max(500), z.number()])).max(200)]).optional() }).strict();
export const operationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('describe'), columns: z.array(col).max(100).optional() }).strict(),
  z.object({ op: z.literal('missing') }).strict(),
  z.object({ op: z.literal('distribution'), column: col, bins: z.number().int().min(2).max(200).optional() }).strict(),
  z.object({ op: z.literal('groupby'), by: z.array(col).min(1).max(3), metrics: z.array(z.object({ column: col, agg: z.enum(['count', 'mean', 'median', 'sum', 'min', 'max', 'std']), as: z.string().max(80).optional() }).strict()).min(1).max(20) }).strict(),
  z.object({ op: z.literal('pivot'), index: col, columns: col, values: col, agg: z.enum(['count', 'mean', 'median', 'sum', 'min', 'max', 'std']).optional() }).strict(),
  z.object({ op: z.literal('correlation'), columns: z.array(col).min(2).max(30).optional(), method: z.enum(['pearson', 'spearman']).optional() }).strict(),
  z.object({ op: z.literal('regression'), y: col, x: z.array(col).min(1).max(20) }).strict(),
  z.object({ op: z.literal('outliers'), column: col, method: z.enum(['iqr', 'zscore', 'mad']).optional(), k: z.number().min(0.5).max(5).optional(), threshold: z.number().min(1).max(10).optional() }).strict(),
  z.object({ op: z.literal('moving_average'), value: col, orderBy: col, window: z.number().int().min(2).max(1000), center: z.boolean().optional() }).strict(),
]);
export type AnalysisOperation = z.infer<typeof operationSchema>;

export const analysisInputSchema = z.object({
  operations: z.array(operationSchema).min(1).max(20),
  filters: z.array(filterSchema).max(20).optional(),
  /** Units per column, carried into tables, charts and reports (e.g. { "income": "RWF" }). */
  units: z.record(z.string().max(40)).optional(),
}).strict();
export type AnalysisInput = z.infer<typeof analysisInputSchema>;

export interface SourceInfo { type: string; id: string; label: string; sha256?: string; rows: number; columns: number; retrievedAt: string }

export interface AnalysisReport {
  source: SourceInfo;
  filters: Array<{ column: string; op: string; value: unknown; rowsBefore: number; rowsAfter: number }>;
  rowsIn: number;
  rowsAnalysed: number;
  units: Record<string, string>;
  results: any[];
  engine: { name: string; kind: 'python' | 'typescript-fallback'; versions?: unknown };
  isolation: Isolation | null;
  methodology: string[];
  assumptions: string[];
  limitations: string[];
}

export class AnalysisInputError extends Error {
  constructor(message: string, public problems: string[] = []) {
    super(message);
  }
}

const NUMERIC_ONLY: Record<string, string[]> = { distribution: [], outliers: ['column'], moving_average: ['value'], regression: ['y'] };

/** Checks every referenced column exists and has a usable type before anything runs. */
export function checkAgainstDataset(ds: Dataset, input: AnalysisInput): string[] {
  const types = new Map(ds.columns.map((c) => [c.name, c.type]));
  const problems: string[] = [];
  const need = (name: string, ctx: string, numeric = false) => {
    if (!types.has(name)) problems.push(`${ctx}: column "${name}" does not exist. Available: ${[...types.keys()].slice(0, 30).join(', ')}.`);
    else if (numeric && types.get(name) !== 'numeric') problems.push(`${ctx}: "${name}" is ${types.get(name)}, not numeric.`);
  };
  for (const f of input.filters ?? []) need(f.column, 'filter');
  input.operations.forEach((op, i) => {
    const ctx = `operation ${i + 1} (${op.op})`;
    switch (op.op) {
      case 'describe': for (const c of op.columns ?? []) need(c, ctx); break;
      case 'distribution': need(op.column, ctx); break;
      case 'groupby': op.by.forEach((b) => need(b, ctx)); op.metrics.forEach((m) => need(m.column, ctx, m.agg !== 'count')); break;
      case 'pivot': need(op.index, ctx); need(op.columns, ctx); need(op.values, ctx, (op.agg ?? 'mean') !== 'count'); break;
      case 'correlation': for (const c of op.columns ?? []) need(c, ctx, true); break;
      case 'regression': need(op.y, ctx, true); op.x.forEach((x) => need(x, ctx)); break;
      case 'outliers': need(op.column, ctx, true); break;
      case 'moving_average': need(op.value, ctx, true); need(op.orderBy, ctx); break;
      default: break;
    }
  });
  void NUMERIC_ONLY;
  return problems;
}

/** Typed rows for the engine: numbers for numeric columns (missing → null), ISO text for dates, text otherwise. */
export function datasetPayload(ds: Dataset) {
  const columns = ds.columns.map((c) => ({ name: c.name, type: c.type === 'numeric' ? 'numeric' : c.type === 'datetime' ? 'datetime' : c.type === 'boolean' ? 'boolean' : c.type === 'categorical' ? 'categorical' : 'text' }));
  const series = ds.columns.map((c) => (c.type === 'numeric' ? numericColumn(ds, c.name) : textColumn(ds, c.name)));
  const rows = ds.rows.map((_, i) => series.map((s) => s[i] ?? null));
  return { columns, rows };
}

const METHOD_NOTES: Record<string, string> = {
  regression: 'Regression and correlation describe association; they do not establish causation.',
  correlation: 'Regression and correlation describe association; they do not establish causation.',
};

export async function analyzeDataset(ds: Dataset, source: Omit<SourceInfo, 'rows' | 'columns' | 'retrievedAt'>, input: AnalysisInput, opts: { signal?: AbortSignal; forceFallback?: boolean } = {}): Promise<AnalysisReport> {
  const parsed = analysisInputSchema.parse(input);
  const problems = checkAgainstDataset(ds, parsed);
  if (problems.length) throw new AnalysisInputError('The analysis request does not match the dataset.', problems);
  const maxRows = Number(process.env.ANALYSIS_MAX_ROWS) > 0 ? Number(process.env.ANALYSIS_MAX_ROWS) : 200_000;
  if (ds.rows.length > maxRows) throw new AnalysisInputError(`The dataset has ${ds.rows.length} rows; at most ${maxRows} can be analysed.`);
  const src: SourceInfo = { ...source, rows: ds.rows.length, columns: ds.columns.length, retrievedAt: new Date().toISOString() };
  const limitations: string[] = [...ds.warnings.slice(0, 10)];
  let out: any;
  let engine: AnalysisReport['engine'];
  let isolation: Isolation | null = null;
  const useFallback = opts.forceFallback || !pythonStatus().available;
  if (!useFallback) {
    try {
      const r = await runPythonEngine({ dataset: datasetPayload(ds), filters: parsed.filters ?? [], operations: parsed.operations }, { signal: opts.signal });
      if (r.output?.error) throw new AnalysisInputError(String(r.output.error));
      out = r.output;
      isolation = r.isolation;
      engine = { name: out.engine?.name ?? 'python', kind: 'python', versions: out.engine };
    } catch (e) {
      if (e instanceof PythonUnavailableError) return analyzeDataset(ds, source, input, { ...opts, forceFallback: true });
      throw e;
    }
  } else {
    out = typescriptFallback(ds, parsed);
    engine = { name: 'bwenge-stats-ts', kind: 'typescript-fallback' };
    limitations.push(`Python analysis is unavailable (${pythonStatus().reason ?? 'disabled'}); the built-in TypeScript engine was used for supported operations.`);
  }
  // Validate the engine's output shape: one result per requested operation, in order.
  if (!out || !Array.isArray(out.results) || out.results.length !== parsed.operations.length || out.results.some((r: any, i: number) => r?.op !== parsed.operations[i].op)) {
    throw new PythonRunError('BAD_OUTPUT', 'The analysis output did not match the request.');
  }
  const methodology = out.results.filter((r: any) => !r.error).map((r: any) => `${r.op}: ${r.methodDescription ?? r.method ?? ''}`.trim());
  const assumptions = [...new Set(out.results.flatMap((r: any) => r.assumptions ?? []))] as string[];
  for (const r of out.results) {
    if (r.error) limitations.push(`${r.op}: ${r.error}`);
    for (const w of r.warnings ?? []) limitations.push(`${r.op}: ${w}`);
    if (METHOD_NOTES[r.op] && !r.error) limitations.push(METHOD_NOTES[r.op]);
  }
  return {
    source: src, filters: out.dataset?.filters ?? [], rowsIn: out.dataset?.rowsIn ?? ds.rows.length, rowsAnalysed: out.dataset?.rowsAnalysed ?? ds.rows.length,
    units: parsed.units ?? {}, results: out.results, engine: engine!, isolation, methodology, assumptions, limitations: [...new Set(limitations)],
  };
}

/** Subset of operations computed by the existing TypeScript engine when Python is not installed. */
function typescriptFallback(ds: Dataset, input: AnalysisInput) {
  if (input.filters?.length) throw new AnalysisInputError('Filters need the Python analysis engine, which is not installed on this server.');
  const types = new Map(ds.columns.map((c) => [c.name, c.type]));
  const results = input.operations.map((op): any => {
    switch (op.op) {
      case 'describe': {
        const cols = op.columns ?? ds.columns.filter((c) => c.type === 'numeric').map((c) => c.name);
        return { op: 'describe', method: 'TypeScript engine: sample SD (n − 1); quartiles R type 7.', assumptions: [], warnings: [], rows: cols.filter((c) => types.get(c) === 'numeric').map((c) => {
          const d = describe(numericColumn(ds, c));
          return { column: c, type: 'numeric', n: d.n, missing: d.missing, mean: d.mean, sd: d.sd, se: d.standardError, min: d.min, q1: d.q1, median: d.median, q3: d.q3, max: d.max, iqr: d.iqr, skewness: d.skewness, excessKurtosis: d.excessKurtosis, sum: d.sum };
        }) };
      }
      case 'missing': {
        const total = ds.rows.length;
        const rows = ds.columns.map((c) => { const m = (c.type === 'numeric' ? numericColumn(ds, c.name) : textColumn(ds, c.name)).filter((v) => v === null).length; return { column: c.name, missing: m, percent: total ? (100 * m) / total : null }; });
        return { op: 'missing', rows, rowsTotal: total, completeRows: ds.rows.filter((_, i) => ds.columns.every((c) => (c.type === 'numeric' ? numericColumn(ds, c.name)[i] : textColumn(ds, c.name)[i]) !== null)).length, method: 'Counts of empty values.', assumptions: [], warnings: [] };
      }
      case 'correlation': {
        const cols = op.columns ?? ds.columns.filter((c) => c.type === 'numeric').map((c) => c.name);
        const pairs = [];
        for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) { const c = correlation(numericColumn(ds, cols[i]), numericColumn(ds, cols[j]), op.method ?? 'pearson'); pairs.push({ x: cols[i], y: cols[j], n: c.n, r: c.r, p: c.pValue, note: c.notes.slice(1).join(' ') || null }); }
        return { op: 'correlation', method: op.method ?? 'pearson', pairs, methodDescription: 'TypeScript engine; pairwise complete observations; t-distribution p-value.', assumptions: [], warnings: [], interpretation: 'Correlation shows association only. It does not show that one variable causes the other.' };
      }
      case 'regression': {
        if (op.x.some((x) => types.get(x) !== 'numeric')) return { op: 'regression', error: 'Categorical predictors need the Python analysis engine.' };
        const r = linearRegression(numericColumn(ds, op.y), Object.fromEntries(op.x.map((x) => [x, numericColumn(ds, x)])));
        if ('error' in r) return { op: 'regression', error: r.error };
        return { op: 'regression', y: op.y, x: op.x, n: r.n, coefficients: r.coefficients.map((c) => ({ term: c.term, estimate: c.estimate, se: c.se, t: c.t, p: c.pValue, ci95: c.ci95 })), r2: r.rSquared, adjustedR2: r.adjRSquared, f: r.fStatistic, fP: r.fPValue, dfResidual: r.dfResidual, sigma: r.residualSe, diagnostics: {}, method: 'TypeScript engine: OLS with intercept on complete cases.', assumptions: ['Linear relationship', 'Independent observations', 'Constant residual variance', 'Approximately normal residuals for small samples'], warnings: ['Residual diagnostics (VIF, Breusch–Pagan, influence) need the Python engine.'], interpretation: 'Coefficients describe association; they do not show causation.' };
      }
      case 'outliers': {
        if ((op.method ?? 'iqr') !== 'iqr') return { op: 'outliers', error: 'Only the IQR method is available without the Python engine.' };
        const r = tukeyOutliers(numericColumn(ds, op.column), op.k ?? 1.5);
        if ('error' in r) return { op: 'outliers', error: r.error };
        return { op: 'outliers', column: op.column, method: 'iqr', n: numericColumn(ds, op.column).filter((v) => v !== null).length, count: r.outliers.length, bounds: { lower: r.lowerFence, upper: r.upperFence }, outliers: r.outliers.map((o: any) => ({ row: o.index + 2, value: o.value })), methodDescription: 'Tukey fences (TypeScript engine).', assumptions: [], warnings: [] };
      }
      case 'groupby': {
        // Same rules and output as the Python engine's op_groupby, so either engine answers "X by district".
        const by: string[] = (op as any).by ?? [];
        const metrics: Array<{ column: string; agg: string; as?: string }> = (op as any).metrics ?? [];
        const AGGS = new Set(['count', 'mean', 'median', 'sum', 'min', 'max', 'std']);
        if (!by.length || by.length > 3) return { op: 'groupby', error: 'Group by 1 to 3 columns.' };
        for (const b of by) if (!types.has(b)) return { op: 'groupby', error: `There is no column "${b}".` };
        for (const m of metrics) {
          if (!AGGS.has(m.agg)) return { op: 'groupby', error: `Unknown aggregation "${m.agg}".` };
          if (!types.has(m.column)) return { op: 'groupby', error: `There is no column "${m.column}".` };
          if (m.agg !== 'count' && types.get(m.column) !== 'numeric') return { op: 'groupby', error: `"${m.column}" is not numeric, so it can only be counted.` };
        }
        const value = (c: string) => (types.get(c) === 'numeric' ? numericColumn(ds, c) : textColumn(ds, c));
        const keys = by.map((b) => value(b).map((v) => (v === null || v === '' ? '(missing)' : v)));
        const cols = new Map(metrics.map((m) => [m.column, value(m.column)]));
        const groups = new Map<string, number[]>();
        for (let i = 0; i < ds.rows.length; i++) {
          const k = JSON.stringify(keys.map((col) => col[i]));
          const list = groups.get(k);
          if (list) list.push(i); else groups.set(k, [i]);
        }
        if (groups.size > 5000) return { op: 'groupby', error: `${groups.size} groups; at most 5000 are allowed.` };
        const sorted = [...groups.entries()].sort(([a], [b]) => {
          const ka = JSON.parse(a), kb = JSON.parse(b);
          for (let j = 0; j < ka.length; j++) { const x = ka[j], y = kb[j]; if (x === y) continue; return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)); }
          return 0;
        });
        const rows = sorted.map(([k, idx]) => {
          const row: Record<string, unknown> = Object.fromEntries(by.map((b, j) => [b, JSON.parse(k)[j]]));
          row.n = idx.length;
          for (const m of metrics) {
            const all = idx.map((i) => cols.get(m.column)![i]);
            const label = m.as || `${m.agg}_${m.column}`;
            if (m.agg === 'count') { row[label] = all.filter((v) => v !== null && v !== '').length; continue; }
            const x = (all.filter((v) => typeof v === 'number' && Number.isFinite(v)) as number[]).sort((a, b) => a - b);
            if (!x.length) { row[label] = null; continue; }
            const sum = x.reduce((a, v) => a + v, 0), mean = sum / x.length;
            row[label] = m.agg === 'mean' ? mean : m.agg === 'sum' ? sum : m.agg === 'min' ? x[0] : m.agg === 'max' ? x[x.length - 1]
              : m.agg === 'median' ? (x.length % 2 ? x[(x.length - 1) / 2] : (x[x.length / 2 - 1] + x[x.length / 2]) / 2)
                : x.length > 1 ? Math.sqrt(x.reduce((a, v) => a + (v - mean) ** 2, 0) / (x.length - 1)) : null;
          }
          return row;
        });
        const small = rows.filter((r) => (r.n as number) < 5).length;
        return { op: 'groupby', by, rows, method: 'Groups of rows sharing the same values; missing group values shown as "(missing)"; aggregations ignore missing values; std uses n − 1 (TypeScript engine).', assumptions: [], warnings: small ? [`${small} group(s) have fewer than 5 rows; their statistics are unstable.`] : [] };
      }
      default:
        return { op: op.op, error: `"${op.op}" needs the Python analysis engine, which is not installed on this server.` };
    }
  });
  return { engine: { name: 'bwenge-stats-ts' }, dataset: { rowsIn: ds.rows.length, rowsAnalysed: ds.rows.length, filters: [] }, results };
}
