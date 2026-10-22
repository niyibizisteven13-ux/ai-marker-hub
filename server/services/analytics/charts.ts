import type { AnalysisResult, AnalysisResultItem } from './analyze.js';
import { histogramBins, type CrossTab, type DescriptiveSummary } from './statistics.js';
import type { Dataset } from './dataset.js';
import { numericColumn } from './dataset.js';

/**
 * Builds chart specifications from computed results. Every chart has a title, axis titles, a caption,
 * alt text, provenance, and the table of values it plots. Chart type follows the data:
 * distributions -> histogram/box plot, categories -> bar, two categoricals -> grouped bar + heatmap,
 * two numerics -> scatter with fitted line, time -> line, correlation matrix -> heatmap.
 */

export type ChartType = 'bar' | 'grouped-bar' | 'line' | 'scatter-trend' | 'histogram' | 'boxplot' | 'heatmap';

export interface ChartSpec {
  id: string;
  sourceAnalysis: string;
  chartType: ChartType;
  title: string;
  caption: string;
  altText: string;
  provenance: string;
  table: { columns: string[]; rows: Array<Array<string | number | null>> };
  vegaLite: Record<string, unknown>;
}

const MAX_POINTS = 5000;
const fmt = (x: number | null | undefined, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? 'n/a' : Number(x.toFixed(d)).toLocaleString('en-US', { maximumFractionDigits: d }));
const axis = (title: string) => ({ title, labelLimit: 160 });

function base(title: string, extra: Record<string, unknown>) {
  return { $schema: 'https://vega.github.io/schema/vega-lite/v5.json', title: { text: title, anchor: 'start' }, width: 560, height: 320, ...extra };
}

function histogram(id: string, analysisId: string, column: string, values: Array<number | null>, prov: string): ChartSpec | null {
  const xs = values.filter((v): v is number => v !== null);
  if (xs.length < 5) return null;
  const { method, edges, counts } = histogramBins(xs);
  if (edges.length < 2) return null;
  const rows = counts.map((c, i) => ({ start: edges[i], end: edges[i + 1], count: c }));
  return {
    id, sourceAnalysis: analysisId, chartType: 'histogram', title: `Distribution of ${column}`,
    caption: `Histogram of ${column} (n = ${xs.length}). Bins: ${method}.`,
    altText: `Histogram of ${column} with ${counts.length} bins from ${fmt(edges[0])} to ${fmt(edges[edges.length - 1])}; the tallest bin holds ${Math.max(...counts)} observations.`,
    provenance: prov,
    table: { columns: ['bin start', 'bin end', 'count'], rows: rows.map((r) => [r.start, r.end, r.count]) },
    vegaLite: base(`Distribution of ${column}`, {
      data: { values: rows },
      mark: { type: 'bar', binSpacing: 1 },
      encoding: {
        x: { field: 'start', type: 'quantitative', bin: { binned: true, step: edges[1] - edges[0] }, axis: axis(column) },
        x2: { field: 'end' },
        y: { field: 'count', type: 'quantitative', axis: axis('Number of observations') },
      },
    }),
  };
}

/** Box plot drawn from our own five-number summary so the figure matches the reported quartile method. */
function boxplot(id: string, analysisId: string, groups: Array<{ label: string; d: DescriptiveSummary; values: number[] }>, valueName: string, groupName: string | null, prov: string): ChartSpec | null {
  const rows = groups.filter((g) => g.d.n >= 4).map((g) => {
    const lowFence = g.d.q1! - 1.5 * g.d.iqr!;
    const highFence = g.d.q3! + 1.5 * g.d.iqr!;
    const inside = g.values.filter((v) => v >= lowFence && v <= highFence);
    return { group: g.label, lower: Math.min(...inside), q1: g.d.q1!, median: g.d.median!, q3: g.d.q3!, upper: Math.max(...inside), n: g.d.n, outliers: g.values.filter((v) => v < lowFence || v > highFence).length };
  });
  // A box plot of groups with no spread at all shows nothing a table does not; skip it.
  if (!rows.length || rows.every((r) => r.lower === r.upper)) return null;
  const x = { field: 'group', type: 'nominal', axis: { ...axis(groupName ?? valueName), labelAngle: rows.every((r) => r.group.length <= 12) ? 0 : -40 }, sort: null };
  const title = groupName ? `${valueName} by ${groupName}` : `Spread of ${valueName}`;
  return {
    id, sourceAnalysis: analysisId, chartType: 'boxplot', title,
    caption: `Box plot: box = Q1 to Q3, line = median, whiskers = most extreme values within 1.5 × IQR of the box. Points beyond the whiskers (${rows.reduce((a, r) => a + r.outliers, 0)} in total) are possible outliers and are not drawn.`,
    altText: rows.map((r) => `${r.group || valueName}: median ${fmt(r.median)}, interquartile range ${fmt(r.q1)} to ${fmt(r.q3)}, n = ${r.n}`).join('; ') + '.',
    provenance: prov,
    table: { columns: [groupName ?? 'variable', 'lower whisker', 'Q1', 'median', 'Q3', 'upper whisker', 'n'], rows: rows.map((r) => [r.group, r.lower, r.q1, r.median, r.q3, r.upper, r.n]) },
    vegaLite: base(title, {
      data: { values: rows },
      layer: [
        { mark: { type: 'rule' }, encoding: { x, y: { field: 'lower', type: 'quantitative', axis: axis(valueName), scale: { zero: false } }, y2: { field: 'upper' } } },
        { mark: { type: 'bar', size: 28, color: '#1FB3A6' }, encoding: { x, y: { field: 'q1', type: 'quantitative' }, y2: { field: 'q3' } } },
        { mark: { type: 'tick', size: 28, color: '#12305A', thickness: 2 }, encoding: { x, y: { field: 'median', type: 'quantitative' } } },
      ],
    }),
  };
}

function frequencyChart(id: string, item: AnalysisResultItem, column: string, prov: string): ChartSpec | null {
  const r = item.result as { rows: Array<{ value: string; count: number; percent: number }>; total: number; missing: number };
  if (!r.rows.length) return null;
  const top = r.rows.slice(0, 30);
  const title = `${column}: counts by category`;
  return {
    id, sourceAnalysis: item.id, chartType: 'bar', title,
    caption: `Number of rows in each category of ${column} (n = ${r.total}${r.missing ? `, of which ${r.missing} missing and not shown` : ''}).${r.rows.length > 30 ? ` Showing the 30 most frequent of ${r.rows.length} categories.` : ''}`,
    altText: `Bar chart of ${column}. Most frequent: ${top.slice(0, 3).map((x) => `${x.value} (${x.count}, ${fmt(x.percent, 1)}%)`).join(', ')}.`,
    provenance: prov,
    table: { columns: [column, 'count', 'percent of all rows'], rows: top.map((x) => [x.value, x.count, x.percent]) },
    vegaLite: base(title, {
      data: { values: top },
      mark: { type: 'bar', color: '#1FB3A6' },
      encoding: {
        y: { field: 'value', type: 'nominal', sort: '-x', axis: axis(column) },
        x: { field: 'count', type: 'quantitative', axis: axis('Count') },
        tooltip: [{ field: 'value' }, { field: 'count' }, { field: 'percent', format: '.1f' }],
      },
      height: { step: 22 },
    }),
  };
}

function crosstabCharts(id: string, item: AnalysisResultItem, rowName: string, colName: string, prov: string): ChartSpec[] {
  const ct = item.result as CrossTab;
  if (!ct.n) return [];
  const cells = ct.rowLabels.flatMap((r, i) => ct.colLabels.map((c, j) => ({ row: r, col: c, count: ct.counts[i][j], rowPercent: ct.rowTotals[i] ? Number(((100 * ct.counts[i][j]) / ct.rowTotals[i]).toFixed(2)) : null })));
  const table = { columns: [rowName, colName, 'count', `% within ${rowName}`], rows: cells.map((c) => [c.row, c.col, c.count, c.rowPercent]) };
  const chi = ct.chiSquare ? ` Pearson χ²(${ct.chiSquare.df}) = ${fmt(ct.chiSquare.statistic)}, p = ${fmt(ct.chiSquare.pValue, 4)}, Cramér's V = ${fmt(ct.chiSquare.cramersV, 3)}.` : '';
  const out: ChartSpec[] = [];
  if (ct.rowLabels.length <= 15 && ct.colLabels.length <= 8) {
    const title = `${rowName} by ${colName} (row percentages)`;
    out.push({
      id: `${id}-bar`, sourceAnalysis: item.id, chartType: 'grouped-bar', title,
      caption: `Percentage of each ${rowName} group falling in each ${colName} category (n = ${ct.n}).${chi}`,
      altText: `Grouped bar chart of ${colName} within each ${rowName} category, as row percentages.`,
      provenance: prov, table,
      vegaLite: base(title, {
        data: { values: cells },
        mark: 'bar',
        encoding: {
          x: { field: 'row', type: 'nominal', axis: { ...axis(rowName), labelAngle: ct.rowLabels.every((l) => l.length <= 12) ? 0 : -40 } },
          xOffset: { field: 'col' },
          y: { field: 'rowPercent', type: 'quantitative', axis: axis(`% within ${rowName}`) },
          color: { field: 'col', type: 'nominal', title: colName },
        },
      }),
    });
  }
  const title = `${rowName} × ${colName}: counts`;
  out.push({
    id: `${id}-heat`, sourceAnalysis: item.id, chartType: 'heatmap', title,
    caption: `Cell counts of ${rowName} by ${colName} (n = ${ct.n}).${chi}`,
    altText: `Heatmap of counts with ${ct.rowLabels.length} ${rowName} rows and ${ct.colLabels.length} ${colName} columns.`,
    provenance: prov, table,
    vegaLite: base(title, {
      data: { values: cells },
      encoding: { x: { field: 'col', type: 'nominal', axis: { ...axis(colName), labelAngle: 0 } }, y: { field: 'row', type: 'nominal', axis: axis(rowName) } },
      layer: [
        { mark: 'rect', encoding: { color: { field: 'count', type: 'quantitative', title: 'Count', scale: { scheme: 'blues', zero: true } } } },
        { mark: { type: 'text', fontSize: 11 }, encoding: { text: { field: 'count', type: 'quantitative' } } },
      ],
    }),
  });
  return out;
}

function correlationHeatmap(id: string, item: AnalysisResultItem, prov: string): ChartSpec | null {
  const r = item.result as { method: string; columns: string[]; pairs: Array<{ x: string; y: string; r: number | null; n: number }> };
  if (r.columns.length < 3) return null;
  const cells: Array<{ a: string; b: string; r: number | null }> = [];
  for (const a of r.columns) for (const b of r.columns) {
    const p = r.pairs.find((q) => (q.x === a && q.y === b) || (q.x === b && q.y === a));
    cells.push({ a, b, r: a === b ? 1 : p?.r ?? null });
  }
  const title = `${r.method === 'pearson' ? 'Pearson' : 'Spearman'} correlation matrix`;
  return {
    id, sourceAnalysis: item.id, chartType: 'heatmap', title,
    caption: `Pairwise ${r.method} correlations on complete pairs. Correlation shows association, not causation.`,
    altText: `Correlation matrix of ${r.columns.length} variables; values range from −1 to 1.`,
    provenance: prov,
    table: { columns: ['variable A', 'variable B', 'r'], rows: r.pairs.map((p) => [p.x, p.y, p.r]) },
    vegaLite: base(title, {
      data: { values: cells },
      encoding: { x: { field: 'a', type: 'nominal', axis: { ...axis(''), labelAngle: 0 }, sort: r.columns }, y: { field: 'b', type: 'nominal', axis: axis(''), sort: r.columns } },
      layer: [
        { mark: 'rect', encoding: { color: { field: 'r', type: 'quantitative', title: 'r', scale: { domain: [-1, 1], scheme: 'redblue' } } } },
        { mark: { type: 'text', fontSize: 11 }, encoding: { text: { field: 'r', type: 'quantitative', format: '.2f' } } },
      ],
    }),
  };
}

function scatterTrend(id: string, item: AnalysisResultItem, ds: Dataset, prov: string): ChartSpec | null {
  const r = item.result as { y: string; predictors: string[]; coefficients: Array<{ estimate: number }>; rSquared: number; n: number };
  if (r.predictors.length !== 1) return null;
  const xName = r.predictors[0];
  const xs = numericColumn(ds, xName);
  const ys = numericColumn(ds, r.y);
  const pts = xs.map((x, i) => ({ x, y: ys[i] })).filter((p): p is { x: number; y: number } => p.x !== null && p.y !== null).slice(0, MAX_POINTS);
  if (pts.length < 3) return null;
  const [b0, b1] = r.coefficients.map((c) => c.estimate);
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const title = `${r.y} vs ${xName}`;
  return {
    id, sourceAnalysis: item.id, chartType: 'scatter-trend', title,
    caption: `Each point is one row (n = ${r.n}). Line: least-squares fit ${r.y} = ${fmt(b0, 3)} + ${fmt(b1, 3)} × ${xName}, R² = ${fmt(r.rSquared, 3)}. The fit describes association in this data, not causation.`,
    altText: `Scatter plot of ${r.y} against ${xName} with a ${b1 >= 0 ? 'rising' : 'falling'} fitted line (slope ${fmt(b1, 3)}).`,
    provenance: prov,
    table: { columns: [xName, r.y], rows: pts.slice(0, 200).map((p) => [p.x, p.y]) },
    vegaLite: base(title, {
      layer: [
        { data: { values: pts }, mark: { type: 'point', filled: true, opacity: 0.6, color: '#12305A' }, encoding: { x: { field: 'x', type: 'quantitative', axis: axis(xName), scale: { zero: false } }, y: { field: 'y', type: 'quantitative', axis: axis(r.y), scale: { zero: false } } } },
        { data: { values: [{ x: minX, y: b0 + b1 * minX }, { x: maxX, y: b0 + b1 * maxX }] }, mark: { type: 'line', color: '#D2691E', strokeWidth: 2 }, encoding: { x: { field: 'x', type: 'quantitative' }, y: { field: 'y', type: 'quantitative' } } },
      ],
    }),
  };
}

function lineChart(id: string, item: AnalysisResultItem, time: string, value: string, prov: string): ChartSpec | null {
  const r = item.result as { points?: Array<{ period: string; value: number | null }>; series?: Record<string, { points: Array<{ period: string; value: number | null }> }>; groupBy?: string };
  const rows = r.series
    ? Object.entries(r.series).flatMap(([g, s]) => s.points.map((p) => ({ series: g, period: p.period, value: p.value })))
    : (r.points ?? []).map((p) => ({ series: value, period: p.period, value: p.value }));
  if (rows.filter((x) => x.value !== null).length < 2) return null;
  const title = `${value} over ${time}${r.groupBy ? ` by ${r.groupBy}` : ''}`;
  const periods = [...new Set(rows.map((x) => x.period))];
  return {
    id, sourceAnalysis: item.id, chartType: 'line', title,
    caption: `${value} for each ${time}. Missing periods appear as gaps, not zeros.`,
    altText: `Line chart of ${value} from ${periods[0]} to ${periods[periods.length - 1]}${r.groupBy ? `, one line per ${r.groupBy}` : ''}.`,
    provenance: prov,
    table: { columns: [r.groupBy ?? 'series', time, value], rows: rows.map((x) => [x.series, x.period, x.value]) },
    vegaLite: base(title, {
      data: { values: rows },
      mark: { type: 'line', point: true },
      encoding: {
        x: { field: 'period', type: 'ordinal', sort: periods, axis: axis(time) },
        y: { field: 'value', type: 'quantitative', axis: axis(value), scale: { zero: false } },
        ...(r.groupBy ? { color: { field: 'series', type: 'nominal', title: r.groupBy } } : {}),
      },
    }),
  };
}

/** Builds the charts that the analysis results support. */
export function chartsForAnalysis(ds: Dataset, analysis: AnalysisResult): ChartSpec[] {
  const prov = `Source: ${analysis.dataset.name} (sha256 ${analysis.dataset.sha256.slice(0, 12)}…), ${analysis.dataset.rowsAnalyzed} rows; computed by ${analysis.engineVersion}.`;
  const charts: ChartSpec[] = [];
  for (const item of analysis.results) {
    if (!item.ok) continue;
    const spec = item.spec;
    if (spec.type === 'describe') {
      const r = item.result as { columns: string[]; byColumn: Record<string, DescriptiveSummary>; groupBy?: string; byGroup?: Record<string, Record<string, DescriptiveSummary>> };
      for (const c of r.columns.slice(0, 6)) {
        const vals = numericColumn(ds, c);
        const h = histogram(`${item.id}-${c}-hist`, item.id, c, vals, prov);
        if (h) charts.push(h);
        if (r.groupBy && r.byGroup) {
          const groups = new Map<string, number[]>();
          ds.rows.forEach((row, i) => { const g = row[r.groupBy!]; const v = vals[i]; if (g && v !== null) { if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(v); } });
          const b = boxplot(`${item.id}-${c}-box`, item.id, [...groups.entries()].slice(0, 20).map(([label, values]) => ({ label, values, d: r.byGroup![c][label] })), c, r.groupBy, prov);
          if (b) charts.push(b);
        } else {
          const b = boxplot(`${item.id}-${c}-box`, item.id, [{ label: c, values: vals.filter((v): v is number => v !== null), d: r.byColumn[c] }], c, null, prov);
          if (b) charts.push(b);
        }
      }
    } else if (spec.type === 'frequency') {
      const c = frequencyChart(`${item.id}-bar`, item, spec.column, prov);
      if (c) charts.push(c);
    } else if (spec.type === 'crosstab') {
      charts.push(...crosstabCharts(item.id, item, spec.row, spec.column, prov));
    } else if (spec.type === 'correlation') {
      const c = correlationHeatmap(`${item.id}-heat`, item, prov);
      if (c) charts.push(c);
    } else if (spec.type === 'regression') {
      const c = scatterTrend(`${item.id}-scatter`, item, ds, prov);
      if (c) charts.push(c);
    } else if (spec.type === 'timeseries') {
      const c = lineChart(`${item.id}-line`, item, spec.time, spec.value, prov);
      if (c) charts.push(c);
    }
  }
  return charts;
}

/** Structural checks on a chart spec before it is rendered or returned. */
export function validateChartSpec(c: ChartSpec): string[] {
  const problems: string[] = [];
  if (!c.title.trim()) problems.push('missing title');
  if (!c.caption.trim()) problems.push('missing caption');
  if (!c.altText.trim()) problems.push('missing alt text');
  if (!c.provenance.trim()) problems.push('missing provenance');
  if (!c.table.rows.length) problems.push('no underlying values');
  const raw = JSON.stringify(c.vegaLite);
  if (/"url"\s*:/.test(raw)) problems.push('external data URLs are not allowed');
  if (raw.length > 2_000_000) problems.push('spec too large');
  const encodings: string[] = raw.match(/"axis":\{"title":"([^"]*)"/g) ?? [];
  if (c.chartType !== 'heatmap' && encodings.some((e) => e.endsWith('""'))) problems.push('an axis has no title');
  return problems;
}
