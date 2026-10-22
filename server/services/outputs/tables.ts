import type { AnalysisReport } from './analysis.js';

/**
 * Turns engine results into records (for charts) and display tables (for answers, reports and files).
 * Formatting happens only here; the stored results keep full precision.
 */

export type Row = Record<string, string | number | boolean | null>;
export interface DisplayTable { caption: string; columns: Array<{ key: string; label: string; unit?: string }>; rows: Row[]; note?: string }

export function fmt(v: unknown, key = ''): string {
  if (v === null || v === undefined) return '–';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '–';
    if (/^p$|pvalue|^fP$/i.test(key)) return v < 0.001 ? '<0.001' : v.toFixed(3);
    if (Number.isInteger(v)) return v.toLocaleString('en-US');
    const a = Math.abs(v);
    return a >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : a >= 1 ? v.toFixed(3).replace(/\.?0+$/, '') : v.toPrecision(3);
  }
  return String(v);
}

/** Records of one result, suitable as chart data or table rows. */
export function resultRecords(r: any): Row[] {
  if (!r || r.error) return [];
  switch (r.op) {
    case 'describe': return r.rows.map((x: any) => ({ column: x.column, n: x.n, missing: x.missing, mean: x.mean ?? null, sd: x.sd ?? null, min: x.min ?? null, q1: x.q1 ?? null, median: x.median ?? null, q3: x.q3 ?? null, max: x.max ?? null, unique: x.unique ?? null, top: x.top ?? null }));
    case 'missing': return r.rows.map((x: any) => ({ column: x.column, missing: x.missing, percent: x.percent }));
    case 'distribution': return r.kind === 'numeric' ? r.bins.map((b: any) => ({ bin: `${fmt(b.from)} – ${fmt(b.to)}`, from: b.from, to: b.to, count: b.count })) : r.rows.map((x: any) => ({ value: x.value, count: x.count, percent: x.percent }));
    case 'groupby': return r.rows;
    case 'pivot': return r.rows.map((x: any) => Object.fromEntries([[r.index, x.key], ...r.columns.map((c: string, i: number) => [c, x.values[i]])]));
    case 'correlation': return r.pairs.map((p: any) => ({ x: p.x, y: p.y, n: p.n, r: p.r, p: p.p }));
    case 'regression': return r.coefficients.map((c: any) => ({ term: c.term, estimate: c.estimate, se: c.se, t: c.t, p: c.p, ci_low: c.ci95?.[0] ?? null, ci_high: c.ci95?.[1] ?? null }));
    case 'outliers': return r.outliers.map((o: any) => ({ row: o.row, value: o.value }));
    case 'moving_average': return r.rows.map((x: any) => ({ order: x.order, value: x.value, movingAverage: x.movingAverage }));
    default: return [];
  }
}

const LABELS: Record<string, string> = { n: 'n', sd: 'SD', se: 'SE', q1: 'Q1', q3: 'Q3', p: 'p', r: 'r', t: 't', ci_low: '95% CI low', ci_high: '95% CI high', movingAverage: 'Moving average', percent: 'Percent' };

export function resultTable(r: any, units: Record<string, string> = {}): DisplayTable | null {
  if (!r) return null;
  if (r.error) return { caption: `${r.op}: not computed`, columns: [{ key: 'problem', label: 'Problem' }], rows: [{ problem: r.error }] };
  const rows = resultRecords(r);
  if (!rows.length) return { caption: captionOf(r), columns: [{ key: 'note', label: 'Note' }], rows: [{ note: 'No rows.' }] };
  const keys = [...new Set(rows.flatMap((x) => Object.keys(x)))].filter((k) => rows.some((x) => x[k] !== null && x[k] !== undefined) && !(r.op === 'distribution' && (k === 'from' || k === 'to')));
  const unitFor = (k: string) => units[k] ?? (r.op === 'describe' || r.op === 'outliers' ? undefined : undefined);
  return { caption: captionOf(r), columns: keys.map((k) => ({ key: k, label: LABELS[k] ?? k, unit: unitFor(k) })), rows: rows.slice(0, 2000), note: r.interpretation };
}

export function captionOf(r: any): string {
  switch (r.op) {
    case 'describe': return 'Descriptive statistics';
    case 'missing': return `Missing values (${r.completeRows} of ${r.rowsTotal} rows complete)`;
    case 'distribution': return `Distribution of ${r.column} (n = ${r.n})`;
    case 'groupby': return `Grouped by ${r.by.join(', ')}`;
    case 'pivot': return `${r.agg} of ${r.valueColumn} by ${r.index} and ${r.columns.length} column groups`;
    case 'correlation': return `${r.method === 'spearman' ? 'Spearman' : 'Pearson'} correlations`;
    case 'regression': return `Linear regression of ${r.y} (n = ${r.n}, R² = ${fmt(r.r2)})`;
    case 'outliers': return `Outliers in ${r.column} (${r.count} of ${r.n}, ${r.method})`;
    case 'moving_average': return `${r.window}-row moving average of ${r.value}`;
    default: return r.op;
  }
}

export function analysisTables(rep: AnalysisReport): DisplayTable[] {
  return rep.results.map((r) => resultTable(r, rep.units)).filter((t): t is DisplayTable => !!t);
}

/** Plain-text rendering of a table for chat replies (Markdown). */
export function tableMarkdown(t: DisplayTable, maxRows = 25): string {
  const head = `| ${t.columns.map((c) => `${c.label}${c.unit ? ` (${c.unit})` : ''}`).join(' | ')} |`;
  const sep = `| ${t.columns.map(() => '---').join(' | ')} |`;
  const body = t.rows.slice(0, maxRows).map((r) => `| ${t.columns.map((c) => fmt(r[c.key], c.key).replace(/\|/g, '\\|')).join(' | ')} |`);
  return [`**${t.caption}**`, head, sep, ...body, t.rows.length > maxRows ? `_(${t.rows.length - maxRows} more rows in the file)_` : ''].filter(Boolean).join('\n');
}

/** Numbers in a narrative that do not appear in the computed results (to flag, not to block). */
export function unsupportedNumbers(narrative: string, rep: AnalysisReport): string[] {
  const nums = narrative.match(/-?\d+(?:[.,]\d+)?/g) ?? [];
  const known = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    for (const d of [0, 1, 2, 3, 4]) known.add(String(Number(v.toFixed(d))));
    known.add(String(Math.round(v * 100) / 100));
    if (Math.abs(v) <= 1) for (const d of [0, 1, 2]) known.add(String(Number((v * 100).toFixed(d))));
  };
  const walk = (o: unknown) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') Object.values(o).forEach(walk); else add(o); };
  walk(rep.results);
  add(rep.rowsIn); add(rep.rowsAnalysed);
  return [...new Set(nums.map((n) => n.replace(',', '.')).filter((n) => !known.has(String(Number(n))) && !/^(19|20)\d\d$/.test(n) && Math.abs(Number(n)) > 3))];
}
