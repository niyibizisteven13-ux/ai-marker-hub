import type { AnalysisResult, AnalysisResultItem } from './analyze.js';
import type { ChartSpec } from './charts.js';
import type { CrossTab, Correlation, DescriptiveSummary, RegressionResult, TTestResult } from './statistics.js';
import { QUANTILE_METHOD } from './statistics.js';
import type { ReportCitation, ReportInput, ReportParagraph, ReportSection, ReportTable } from './htmlReport.js';

/**
 * Turns deterministic analysis results into report content. Every sentence here is generated from
 * computed values (marked "calculated"); hedged reading guidance is marked "interpretation".
 */

const f = (x: number | null | undefined, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? 'n/a' : Number(x.toFixed(d)).toLocaleString('en-US', { maximumFractionDigits: d }));
const pv = (p: number | null | undefined) => (p === null || p === undefined ? 'n/a' : p < 0.001 ? '< 0.001' : f(p, 3));
const calc = (text: string): ReportParagraph => ({ text, kind: 'calculated' });
const interp = (text: string): ReportParagraph => ({ text, kind: 'interpretation' });

function strength(r: number): string {
  const a = Math.abs(r);
  return a < 0.1 ? 'negligible' : a < 0.3 ? 'weak' : a < 0.5 ? 'moderate' : 'strong';
}

function describeSection(item: AnalysisResultItem): { section: ReportSection; methods: string[]; notes: string[] } {
  const r = item.result as { columns: string[]; byColumn: Record<string, DescriptiveSummary>; groupBy?: string; byGroup?: Record<string, Record<string, DescriptiveSummary>>; weighted?: Record<string, { mean: number | null; sd: number | null; notes: string[] }> };
  const rows = r.columns.map((c) => {
    const d = r.byColumn[c];
    return [c, d.n, d.missing, d.mean, d.sd, d.median, d.q1, d.q3, d.min, d.max, d.skewness, d.ci95 ? `${f(d.ci95[0])} to ${f(d.ci95[1])}` : null];
  });
  const tables: ReportTable[] = [{ caption: 'Summary statistics', columns: ['Variable', 'n', 'Missing', 'Mean', 'SD', 'Median', 'Q1', 'Q3', 'Min', 'Max', 'Skewness', '95% CI of mean'], rows }];
  const paragraphs: ReportParagraph[] = [];
  const notes: string[] = [];
  for (const c of r.columns) {
    const d = r.byColumn[c];
    if (!d.n) { paragraphs.push(calc(`${c}: no non-missing numeric values.`)); continue; }
    paragraphs.push(calc(`${c}: n = ${d.n}${d.missing ? ` (${d.missing} missing)` : ''}, mean ${f(d.mean)}${d.ci95 ? ` (95% CI ${f(d.ci95[0])} to ${f(d.ci95[1])})` : ''}, median ${f(d.median)}, SD ${f(d.sd)}, range ${f(d.min)} to ${f(d.max)}.`));
    if (d.skewness !== null && Math.abs(d.skewness) >= 1) paragraphs.push(interp(`${c} is strongly ${d.skewness > 0 ? 'right' : 'left'}-skewed (skewness ${f(d.skewness)}), so the median (${f(d.median)}) is likely a better summary of a typical value than the mean (${f(d.mean)}).`));
    notes.push(...d.notes.map((n) => `${c}: ${n}`));
  }
  if (r.weighted) {
    tables.push({ caption: 'Weighted estimates', columns: ['Variable', 'Weighted mean', 'Weighted SD'], rows: r.columns.map((c) => [c, r.weighted![c].mean, r.weighted![c].sd]), note: r.weighted[r.columns[0]]?.notes[0] });
  }
  if (r.byGroup && r.groupBy) {
    for (const c of r.columns) {
      tables.push({ caption: `${c} by ${r.groupBy}`, columns: [r.groupBy, 'n', 'Mean', 'SD', 'Median', 'Q1', 'Q3'], rows: Object.entries(r.byGroup[c]).map(([g, d]) => [g, d.n, d.mean, d.sd, d.median, d.q1, d.q3]) });
    }
    paragraphs.push(interp(`Differences between ${r.groupBy} groups shown here are descriptive; they are not tested for significance unless a t-test is reported.`));
  }
  return { section: { heading: item.title, paragraphs, tables }, methods: r.byColumn[r.columns[0]]?.methods ?? [], notes };
}

function sectionFor(item: AnalysisResultItem): { section: ReportSection; methods: string[]; notes: string[] } {
  const spec = item.spec;
  switch (spec.type) {
    case 'describe':
      return describeSection(item);
    case 'frequency': {
      const r = item.result as { rows: Array<{ value: string; count: number; percent: number; validPercent: number | null }>; total: number; missing: number };
      const top = r.rows[0];
      return {
        section: {
          heading: item.title,
          paragraphs: top ? [calc(`Most common: "${top.value}" with ${top.count} of ${r.total} rows (${f(top.percent, 1)}%). ${r.rows.length} distinct categories; ${r.missing} missing.`)] : [calc('No non-missing values.')],
          tables: [{ caption: `Frequency of ${spec.column}`, columns: ['Category', 'Count', '% of all rows', '% of valid rows'], rows: r.rows.map((x) => [x.value, x.count, x.percent, x.validPercent]) }],
        },
        methods: ['Frequencies: percent of all rows includes missing in the denominator; valid percent excludes missing.'], notes: [],
      };
    }
    case 'crosstab': {
      const r = item.result as CrossTab;
      const paragraphs: ReportParagraph[] = [];
      if (r.chiSquare) {
        paragraphs.push(calc(`Pearson χ²(${r.chiSquare.df}) = ${f(r.chiSquare.statistic)}, p = ${pv(r.chiSquare.pValue)}, Cramér's V = ${f(r.chiSquare.cramersV, 3)} (n = ${r.n}).`));
        paragraphs.push(interp(r.chiSquare.pValue < 0.05
          ? `At the 5% level the data suggest ${spec.row} and ${spec.column} are associated; Cramér's V of ${f(r.chiSquare.cramersV, 2)} indicates how strong. This is an association, not evidence of cause.`
          : `At the 5% level there is no clear evidence of an association between ${spec.row} and ${spec.column}. This does not prove they are unrelated; the sample may be too small to detect one.`));
      }
      return {
        section: {
          heading: item.title, paragraphs,
          tables: [{ caption: `Counts: ${spec.row} (rows) by ${spec.column} (columns)`, columns: [spec.row, ...r.colLabels, 'Total'], rows: [...r.rowLabels.map((l, i) => [l, ...r.counts[i], r.rowTotals[i]]), ['Total', ...r.colTotals, r.n]] }],
        },
        methods: ['Chi-square test of independence: χ² = Σ (O − E)² / E with E = row total × column total / n; no continuity correction. Cramér\'s V = √(χ² / (n·(min(r, c) − 1))).'],
        notes: r.notes,
      };
    }
    case 'correlation': {
      const r = item.result as { method: string; pairs: Array<Correlation & { x: string; y: string }> };
      const ranked = r.pairs.filter((p) => p.r !== null).sort((a, b) => Math.abs(b.r!) - Math.abs(a.r!));
      const paragraphs: ReportParagraph[] = ranked.slice(0, 3).map((p) => calc(`${p.x} and ${p.y}: r = ${f(p.r, 3)} (${strength(p.r!)} ${p.r! >= 0 ? 'positive' : 'negative'}), p = ${pv(p.pValue)}, n = ${p.n}${p.ci95 ? `, 95% CI ${f(p.ci95[0], 3)} to ${f(p.ci95[1], 3)}` : ''}.`));
      paragraphs.push(interp('Correlation describes how two variables move together in this data. It does not show that one causes the other; a third factor may drive both.'));
      return {
        section: { heading: item.title, paragraphs, tables: [{ caption: 'Pairwise correlations (complete pairs)', columns: ['Variable A', 'Variable B', 'r', 'p-value', 'n', '95% CI'], rows: r.pairs.map((p) => [p.x, p.y, p.r, p.pValue, p.n, p.ci95 ? `${f(p.ci95[0], 3)} to ${f(p.ci95[1], 3)}` : null]) }] },
        methods: [r.method === 'pearson' ? 'Pearson r with t-test p-value (df = n − 2) and Fisher-z 95% CI.' : 'Spearman rho (Pearson r of average ranks) with t-approximation p-value.', 'Strength labels: |r| < 0.1 negligible, < 0.3 weak, < 0.5 moderate, otherwise strong (Cohen).'],
        notes: [],
      };
    }
    case 'regression': {
      const r = item.result as RegressionResult & { y: string };
      const slope = r.coefficients[1];
      const paragraphs: ReportParagraph[] = [calc(`R² = ${f(r.rSquared, 3)} (adjusted ${f(r.adjRSquared, 3)}), n = ${r.n}${r.fPValue !== null ? `, F-test p = ${pv(r.fPValue)}` : ''}.`)];
      if (r.predictors.length === 1) paragraphs.push(interp(`In this data, each one-unit increase in ${r.predictors[0]} is associated with a change of ${f(slope.estimate, 3)} in ${r.y} (95% CI ${f(slope.ci95[0], 3)} to ${f(slope.ci95[1], 3)}). This is an association, not a causal effect.`));
      return {
        section: { heading: item.title, paragraphs, tables: [{ caption: 'Coefficients', columns: ['Term', 'Estimate', 'SE', 't', 'p-value', '95% CI'], rows: r.coefficients.map((c) => [c.term, c.estimate, c.se, c.t, c.pValue, `${f(c.ci95[0], 3)} to ${f(c.ci95[1], 3)}`]) }] },
        methods: ['Ordinary least squares: β = (XᵀX)⁻¹Xᵀy; SE from σ̂²(XᵀX)⁻¹ with σ̂² = SSE / (n − k − 1); two-sided t-tests; R² = 1 − SSE/SST.'],
        notes: r.notes,
      };
    }
    case 'ttest': {
      const r = item.result as TTestResult & { groups?: string[] };
      const what = r.test === 'one-sample' ? `mean ${f(r.estimate)}` : `difference in means (${r.groups?.[0]} − ${r.groups?.[1]}) ${f(r.estimate)}`;
      return {
        section: {
          heading: item.title,
          paragraphs: [
            calc(`${what}, 95% CI ${f(r.ci95[0])} to ${f(r.ci95[1])}; t(${f(r.df, 1)}) = ${f(r.statistic, 3)}, p = ${pv(r.pValue)}${r.cohensD !== null ? `, Cohen's d = ${f(r.cohensD, 2)}` : ''}; n = ${r.n.join(' and ')}.`),
            interp(r.pValue < 0.05 ? 'The difference is statistically significant at the 5% level. Judge its practical importance from the size of the difference and its confidence interval.' : 'The data do not show a statistically significant difference at the 5% level; this is not proof that there is no difference.'),
          ],
        },
        methods: [r.test === 'one-sample' ? 'One-sample t-test: t = (x̄ − μ0)/(s/√n), df = n − 1.' : 'Welch two-sample t-test: t = (x̄1 − x̄2)/√(s1²/n1 + s2²/n2) with Welch–Satterthwaite df. Cohen\'s d uses the pooled SD.'],
        notes: r.notes,
      };
    }
    case 'outliers': {
      const r = item.result as { method: string; lowerFence: number; upperFence: number; outliers: Array<{ row: number; value: number }>; total: number; n: number };
      return {
        section: {
          heading: item.title,
          paragraphs: [calc(`${r.total} of ${r.n} values fall outside the fences ${f(r.lowerFence)} and ${f(r.upperFence)}.`), interp('Flagged values should be checked against the source. They may be data-entry errors or genuine extreme cases; they were not removed.')],
          tables: r.total ? [{ caption: 'Flagged values', columns: ['Row', 'Value'], rows: r.outliers.map((o) => [o.row, o.value]) }] : [],
        },
        methods: [r.method], notes: [],
      };
    }
    case 'timeseries': {
      const r = item.result as { points?: Array<{ period: string; value: number | null; change: number | null; percentChange: number | null }>; overall?: { from: string; to: string; change: number; percentChange: number | null; cagr: number | null } | null; trend?: { slopePerPeriod: number; unit: string; rSquared: number } | null; notes: string[]; series?: Record<string, unknown> };
      const paragraphs: ReportParagraph[] = [];
      if (r.overall) paragraphs.push(calc(`From ${r.overall.from} to ${r.overall.to} the value changed by ${f(r.overall.change)}${r.overall.percentChange !== null ? ` (${f(r.overall.percentChange, 1)}%)` : ''}${r.overall.cagr !== null ? `, a compound annual growth rate of ${f(r.overall.cagr, 2)}%` : ''}.`));
      if (r.trend) paragraphs.push(calc(`Linear trend: ${f(r.trend.slopePerPeriod, 3)} ${r.trend.unit} (R² = ${f(r.trend.rSquared, 3)}).`));
      return {
        section: { heading: item.title, paragraphs, tables: r.points ? [{ caption: 'Values by period', columns: ['Period', 'Value', 'Change', '% change'], rows: r.points.map((p) => [p.period, p.value, p.change, p.percentChange]) }] : [] },
        methods: ['Period-over-period % change = (current − previous)/|previous| × 100, undefined from a zero or missing base. CAGR = (end/start)^(1/years) − 1, only for positive endpoints.'],
        notes: r.notes ?? [],
      };
    }
  }
}

export interface AnalysisReportOptions {
  title: string;
  subtitle?: string;
  researchQuestion?: string;
  citations?: ReportCitation[];
  generatedAt?: string;
  extraParagraphs?: { summary?: ReportParagraph[]; conclusion?: ReportParagraph[]; recommendations?: string[] };
}

export function buildAnalysisReport(analysis: AnalysisResult, charts: ChartSpec[], opts: AnalysisReportOptions): ReportInput {
  const methods: string[] = [`Quartiles and percentiles: ${QUANTILE_METHOD}`];
  const limitations = new Set<string>();
  const sections: ReportSection[] = [];
  for (const item of analysis.results) {
    if (!item.ok) { limitations.add(`Analysis "${item.title}" could not be run: ${item.error}`); continue; }
    const { section, methods: m, notes } = sectionFor(item);
    section.charts = charts.filter((c) => c.sourceAnalysis === item.id);
    sections.push(section);
    methods.push(...m);
    notes.forEach((n) => limitations.add(n));
  }
  for (const issue of analysis.quality.issues.filter((i) => i.severity !== 'info')) limitations.add(`${issue.column ? `${issue.column}: ` : ''}${issue.message}`);
  limitations.add('Results describe this dataset only. Generalising to a wider population needs a representative sample and, for surveys, the survey design.');

  const q = analysis.quality;
  const summary: ReportParagraph[] = [
    calc(`${analysis.dataset.rowsAnalyzed} rows and ${analysis.dataset.columns.length} columns analysed${analysis.dataset.rowsAnalyzed !== analysis.dataset.rowsLoaded ? ` (of ${analysis.dataset.rowsLoaded} loaded, after filters)` : ''}; ${q.completeRows} rows have no missing values and ${q.duplicateRows} exactly duplicate an earlier row.`),
    ...sections.flatMap((s) => (s.paragraphs ?? []).filter((p) => p.kind === 'calculated').slice(0, 1)),
    ...(opts.extraParagraphs?.summary ?? []),
  ];
  return {
    title: opts.title,
    subtitle: opts.subtitle ?? `Statistical report on ${analysis.dataset.name}`,
    summary,
    researchQuestion: opts.researchQuestion,
    datasetDescription: [
      calc(`File: ${analysis.dataset.name} (${analysis.dataset.format.toUpperCase()}), ${analysis.dataset.rowsLoaded} rows.`),
      { text: `Columns: ${analysis.dataset.columns.map((c) => `${c.name} (${c.type}${c.missing ? `, ${c.missing} missing` : ''})`).join('; ')}.` },
    ],
    methodology: analysis.transformations,
    sections: [
      {
        heading: 'Data quality',
        paragraphs: [calc(`${q.issues.filter((i) => i.severity === 'warning').length} warning(s) and ${q.issues.filter((i) => i.severity === 'info').length} note(s).`)],
        bullets: q.issues.map((i) => ({ text: `${i.column ? `${i.column}: ` : ''}${i.message}` })),
        tables: [{ caption: 'Missing values by column', columns: ['Column', 'Missing', '%'], rows: q.missingByColumn.map((m) => [m.column, m.missing, m.percent]) }],
      },
      ...sections,
    ],
    limitations: [...limitations],
    conclusion: opts.extraParagraphs?.conclusion,
    recommendations: opts.extraParagraphs?.recommendations,
    citations: opts.citations,
    reproducibility: {
      engineVersion: analysis.engineVersion, datasetSha256: analysis.dataset.sha256, generatedAt: opts.generatedAt ?? new Date().toISOString(),
      transformations: analysis.transformations, methods,
    },
  };
}
