import { chiSquareSf, fSf, normalQuantile, tQuantile, tTwoSidedP } from './distributions.js';

/**
 * Deterministic statistics. Every function documents its method, refuses to produce a number
 * when the statistic is undefined (returning null plus a reason), and never treats missing as zero.
 */

export interface Undefined { value: null; reason: string }
export type Maybe<T> = T | null;

const round = (x: number, d = 10) => (Number.isFinite(x) ? Number(x.toFixed(d)) : x);

function sorted(xs: number[]): number[] {
  return [...xs].sort((a, b) => a - b);
}

/** Quantile, R type 7 / NumPy "linear": h = (n−1)p, linear interpolation between order statistics. */
export function quantile(sortedValues: number[], p: number): number {
  const n = sortedValues.length;
  if (!n) return NaN;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sortedValues[lo] + (h - lo) * (sortedValues[hi] - sortedValues[lo]);
}

export const QUANTILE_METHOD = 'Linear interpolation between order statistics (R type 7 / NumPy default): h = (n − 1)·p.';

function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Two-pass central moment sum Σ(x − x̄)^k. */
function centralSum(xs: number[], m: number, k: number): number {
  let s = 0;
  for (const x of xs) s += (x - m) ** k;
  return s;
}

export interface DescriptiveSummary {
  n: number;
  missing: number;
  mean: Maybe<number>;
  median: Maybe<number>;
  modes: number[];
  modeNote: string;
  min: Maybe<number>;
  max: Maybe<number>;
  range: Maybe<number>;
  variance: Maybe<number>;
  sd: Maybe<number>;
  q1: Maybe<number>;
  q3: Maybe<number>;
  iqr: Maybe<number>;
  percentiles: Record<string, number>;
  cv: Maybe<number>;
  skewness: Maybe<number>;
  excessKurtosis: Maybe<number>;
  standardError: Maybe<number>;
  ci95: Maybe<[number, number]>;
  sum: Maybe<number>;
  notes: string[];
  methods: string[];
}

/**
 * Descriptive statistics for one numeric variable. Missing values (null/NaN) are counted and excluded.
 * Sample variance uses n − 1. Skewness is the adjusted Fisher–Pearson G1 (as in pandas/Excel),
 * excess kurtosis is G2; both need enough observations and non-zero spread.
 */
export function describe(values: Array<number | null | undefined>, opts: { percentiles?: number[]; confidence?: number } = {}): DescriptiveSummary {
  const xs = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const missing = values.length - xs.length;
  const notes: string[] = [];
  const methods = [
    'Missing values excluded (listwise for this variable).',
    'Variance and SD use the sample (n − 1) denominator.',
    `Quartiles/percentiles: ${QUANTILE_METHOD}`,
  ];
  const n = xs.length;
  const empty: DescriptiveSummary = {
    n, missing, mean: null, median: null, modes: [], modeNote: 'No observations.', min: null, max: null, range: null,
    variance: null, sd: null, q1: null, q3: null, iqr: null, percentiles: {}, cv: null, skewness: null, excessKurtosis: null,
    standardError: null, ci95: null, sum: null, notes, methods,
  };
  if (n === 0) { notes.push('No non-missing numeric values; no statistics computed.'); return empty; }

  const s = sorted(xs);
  const m = mean(xs);
  const m2 = centralSum(xs, m, 2);
  const variance = n > 1 ? m2 / (n - 1) : null;
  const sd = variance !== null ? Math.sqrt(variance) : null;
  if (n === 1) notes.push('Only one observation: variance, SD, standard error and confidence interval are undefined.');

  // Mode: all values sharing the highest frequency; none if every value is unique.
  const freq = new Map<number, number>();
  for (const x of xs) freq.set(x, (freq.get(x) ?? 0) + 1);
  const top = Math.max(...freq.values());
  const modes = top > 1 ? [...freq.entries()].filter(([, c]) => c === top).map(([v]) => v).sort((a, b) => a - b) : [];
  const modeNote = top > 1 ? (modes.length > 1 ? `Multimodal: ${modes.length} values each occur ${top} times.` : `Occurs ${top} times.`) : 'No mode: every value occurs once.';

  const pcts: Record<string, number> = {};
  for (const p of opts.percentiles ?? [5, 10, 25, 50, 75, 90, 95]) pcts[`p${p}`] = round(quantile(s, p / 100));

  let cv: number | null = null;
  if (sd !== null) {
    if (s[0] < 0) notes.push('Coefficient of variation not reported: the variable has negative values (CV is meaningful only on a ratio scale).');
    else if (m === 0) notes.push('Coefficient of variation undefined: the mean is 0.');
    else cv = sd / m;
  }

  let skewness: number | null = null;
  let excessKurtosis: number | null = null;
  if (m2 === 0) notes.push('All values are identical: skewness and kurtosis are undefined.');
  else {
    const mm2 = m2 / n;
    if (n >= 3) {
      const g1 = centralSum(xs, m, 3) / n / mm2 ** 1.5;
      skewness = (Math.sqrt(n * (n - 1)) / (n - 2)) * g1;
    } else notes.push('Skewness needs at least 3 observations.');
    if (n >= 4) {
      const g2 = centralSum(xs, m, 4) / n / mm2 ** 2 - 3;
      excessKurtosis = ((n - 1) / ((n - 2) * (n - 3))) * ((n + 1) * g2 + 6);
    } else notes.push('Kurtosis needs at least 4 observations.');
  }
  if (skewness !== null) methods.push('Skewness: adjusted Fisher–Pearson G1 = √(n(n−1))/(n−2) · m3/m2^1.5.');

  const confidence = opts.confidence ?? 0.95;
  const se = sd !== null ? sd / Math.sqrt(n) : null;
  let ci95: [number, number] | null = null;
  if (se !== null && n > 1) {
    const tcrit = tQuantile(1 - (1 - confidence) / 2, n - 1);
    ci95 = [round(m - tcrit * se), round(m + tcrit * se)];
    methods.push(`Confidence interval for the mean: x̄ ± t(${confidence}, n−1)·s/√n (assumes independent observations; approximately normal mean).`);
    if (n < 30 && skewness !== null && Math.abs(skewness) > 1) notes.push('Small, skewed sample: the t-based confidence interval may be unreliable.');
  }

  const q1 = quantile(s, 0.25);
  const q3 = quantile(s, 0.75);
  return {
    n, missing,
    mean: round(m), median: round(quantile(s, 0.5)), modes, modeNote,
    min: s[0], max: s[n - 1], range: round(s[n - 1] - s[0]),
    variance: variance === null ? null : round(variance), sd: sd === null ? null : round(sd),
    q1: round(q1), q3: round(q3), iqr: round(q3 - q1), percentiles: pcts,
    cv: cv === null ? null : round(cv), skewness: skewness === null ? null : round(skewness),
    excessKurtosis: excessKurtosis === null ? null : round(excessKurtosis),
    standardError: se === null ? null : round(se), ci95, sum: round(xs.reduce((a, b) => a + b, 0)),
    notes, methods,
  };
}

export interface WeightedSummary { n: number; sumWeights: number; mean: Maybe<number>; sd: Maybe<number>; notes: string[] }

/**
 * Weighted mean and SD (frequency/analytic weights, denominator Σw − 1 when Σw > 1).
 * This does not account for survey design (strata, clusters): design-based standard errors are not computed.
 */
export function weightedDescribe(values: Array<number | null>, weights: Array<number | null>): WeightedSummary {
  const pairs: Array<[number, number]> = [];
  let dropped = 0;
  values.forEach((v, i) => {
    const w = weights[i];
    if (typeof v === 'number' && Number.isFinite(v) && typeof w === 'number' && Number.isFinite(w) && w >= 0) pairs.push([v, w]);
    else dropped++;
  });
  const notes = ['Survey design (strata/clusters) is not modelled: weighted estimates are point estimates; their standard errors are not design-based.'];
  if (dropped) notes.push(`${dropped} row(s) excluded for a missing value or a missing/negative weight.`);
  const sw = pairs.reduce((a, [, w]) => a + w, 0);
  if (!pairs.length || sw === 0) return { n: pairs.length, sumWeights: sw, mean: null, sd: null, notes: [...notes, 'Weights sum to 0: weighted mean undefined.'] };
  const m = pairs.reduce((a, [v, w]) => a + v * w, 0) / sw;
  const ss = pairs.reduce((a, [v, w]) => a + w * (v - m) ** 2, 0);
  return { n: pairs.length, sumWeights: round(sw), mean: round(m), sd: sw > 1 ? round(Math.sqrt(ss / (sw - 1))) : null, notes };
}

export interface FrequencyRow { value: string; count: number; percent: number; validPercent: Maybe<number> }

/** Frequency table. Percent is of all rows; valid percent excludes missing. Sorted by count, then label. */
export function frequencyTable(values: Array<string | null>): { rows: FrequencyRow[]; total: number; missing: number } {
  const total = values.length;
  const counts = new Map<string, number>();
  let missing = 0;
  for (const v of values) {
    if (v === null || v === '') missing++;
    else counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const valid = total - missing;
  const rows = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([value, count]) => ({ value, count, percent: round((100 * count) / total, 4), validPercent: valid ? round((100 * count) / valid, 4) : null }));
  return { rows, total, missing };
}

export interface CrossTab {
  rowLabels: string[];
  colLabels: string[];
  counts: number[][];
  rowTotals: number[];
  colTotals: number[];
  n: number;
  excludedMissing: number;
  chiSquare: Maybe<{ statistic: number; df: number; pValue: number; cramersV: number; lowExpectedCells: number; totalCells: number }>;
  notes: string[];
}

/** Cross-tabulation with Pearson's chi-square test of independence (no continuity correction). */
export function crossTab(rowsIn: Array<string | null>, colsIn: Array<string | null>): CrossTab {
  const notes: string[] = [];
  const pairs: Array<[string, string]> = [];
  rowsIn.forEach((r, i) => { const c = colsIn[i]; if (r && c) pairs.push([r, c]); });
  const excludedMissing = rowsIn.length - pairs.length;
  if (excludedMissing) notes.push(`${excludedMissing} row(s) with a missing value in either variable were excluded.`);
  const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  const rowLabels = [...new Set(pairs.map((p) => p[0]))].sort(natural);
  const colLabels = [...new Set(pairs.map((p) => p[1]))].sort(natural);
  const counts = rowLabels.map(() => colLabels.map(() => 0));
  for (const [r, c] of pairs) counts[rowLabels.indexOf(r)][colLabels.indexOf(c)]++;
  const rowTotals = counts.map((r) => r.reduce((a, b) => a + b, 0));
  const colTotals = colLabels.map((_, j) => counts.reduce((a, r) => a + r[j], 0));
  const n = pairs.length;

  let chiSquare: CrossTab['chiSquare'] = null;
  if (rowLabels.length < 2 || colLabels.length < 2) notes.push('Chi-square test needs at least 2 categories in each variable.');
  else {
    let stat = 0;
    let low = 0;
    for (let i = 0; i < rowLabels.length; i++) {
      for (let j = 0; j < colLabels.length; j++) {
        const e = (rowTotals[i] * colTotals[j]) / n;
        if (e < 5) low++;
        stat += (counts[i][j] - e) ** 2 / e;
      }
    }
    const df = (rowLabels.length - 1) * (colLabels.length - 1);
    const totalCells = rowLabels.length * colLabels.length;
    chiSquare = {
      statistic: round(stat), df, pValue: round(chiSquareSf(stat, df), 12),
      cramersV: round(Math.sqrt(stat / (n * Math.min(rowLabels.length - 1, colLabels.length - 1)))),
      lowExpectedCells: low, totalCells,
    };
    if (low / totalCells > 0.2) notes.push(`${low} of ${totalCells} cells have an expected count below 5: the chi-square approximation may be unreliable (consider merging categories or an exact test).`);
    notes.push('A significant chi-square shows association, not causation, and is sensitive to sample size; see Cramér\'s V for strength.');
  }
  return { rowLabels, colLabels, counts, rowTotals, colTotals, n, excludedMissing, chiSquare, notes };
}

function pairwise(x: Array<number | null>, y: Array<number | null>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  x.forEach((a, i) => {
    const b = y[i];
    if (typeof a === 'number' && Number.isFinite(a) && typeof b === 'number' && Number.isFinite(b)) out.push([a, b]);
  });
  return out;
}

function pearsonOf(pairs: Array<[number, number]>): number {
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let sxy = 0, sxx = 0, syy = 0;
  for (const [a, b] of pairs) { sxy += (a - mx) * (b - my); sxx += (a - mx) ** 2; syy += (b - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}

function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export interface Correlation {
  method: 'pearson' | 'spearman';
  n: number;
  r: Maybe<number>;
  pValue: Maybe<number>;
  ci95: Maybe<[number, number]>;
  notes: string[];
}

/** Pearson or Spearman correlation on pairwise-complete observations. */
export function correlation(x: Array<number | null>, y: Array<number | null>, method: 'pearson' | 'spearman' = 'pearson'): Correlation {
  let pairs = pairwise(x, y);
  const notes = ['Correlation measures association only; it does not show that one variable causes the other.'];
  const n = pairs.length;
  if (n < 3) return { method, n, r: null, pValue: null, ci95: null, notes: [...notes, 'At least 3 complete pairs are needed.'] };
  if (method === 'spearman') {
    const rx = ranks(pairs.map((p) => p[0]));
    const ry = ranks(pairs.map((p) => p[1]));
    pairs = rx.map((v, i) => [v, ry[i]]);
    notes.push('Spearman rho is Pearson correlation of ranks (ties get average ranks); p-value uses the t approximation.');
  }
  const r = pearsonOf(pairs);
  if (!Number.isFinite(r)) return { method, n, r: null, pValue: null, ci95: null, notes: [...notes, 'One variable is constant: correlation is undefined.'] };
  const df = n - 2;
  const pValue = Math.abs(r) >= 1 ? 0 : tTwoSidedP(r * Math.sqrt(df / (1 - r * r)), df);
  let ci95: [number, number] | null = null;
  if (method === 'pearson' && n > 3 && Math.abs(r) < 1) {
    const z = Math.atanh(r);
    const se = 1 / Math.sqrt(n - 3);
    const zc = normalQuantile(0.975);
    ci95 = [round(Math.tanh(z - zc * se)), round(Math.tanh(z + zc * se))];
    notes.push('95% CI via Fisher z-transformation.');
  }
  if (n < 10) notes.push(`Only ${n} pairs: the estimate is very uncertain.`);
  return { method, n, r: round(r), pValue: round(pValue, 12), ci95, notes };
}

export interface RegressionResult {
  n: number;
  predictors: string[];
  coefficients: Array<{ term: string; estimate: number; se: number; t: number; pValue: number; ci95: [number, number] }>;
  rSquared: number;
  adjRSquared: number;
  residualSe: number;
  dfResidual: number;
  fStatistic: Maybe<number>;
  fPValue: Maybe<number>;
  notes: string[];
}

function invert(a: number[][]): number[][] | null {
  const n = a.length;
  const m = a.map((row, i) => [...row, ...row.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    const piv = m[c][c];
    for (let j = 0; j < 2 * n; j++) m[c][j] /= piv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c];
      if (f) for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[c][j];
    }
  }
  return m.map((row) => row.slice(n));
}

/** Ordinary least squares y = b0 + Σ bk·xk on complete cases, with classical (homoscedastic) standard errors. */
export function linearRegression(y: Array<number | null>, xs: Record<string, Array<number | null>>): RegressionResult | { error: string } {
  const names = Object.keys(xs);
  if (!names.length) return { error: 'At least one predictor is required.' };
  const rows: number[][] = [];
  const ys: number[] = [];
  y.forEach((v, i) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    const row = names.map((k) => xs[k][i]);
    if (row.every((c) => typeof c === 'number' && Number.isFinite(c))) { rows.push([1, ...(row as number[])]); ys.push(v); }
  });
  const n = ys.length;
  const k = names.length + 1;
  const df = n - k;
  if (df < 1) return { error: `Not enough complete observations (${n}) for ${names.length} predictor(s).` };
  const xtx = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => rows.reduce((a, r) => a + r[i] * r[j], 0)));
  const inv = invert(xtx);
  if (!inv) return { error: 'Predictors are perfectly collinear (or constant); coefficients are not identifiable.' };
  const xty = Array.from({ length: k }, (_, i) => rows.reduce((a, r, idx) => a + r[i] * ys[idx], 0));
  const beta = inv.map((row) => row.reduce((a, v, j) => a + v * xty[j], 0));
  const fitted = rows.map((r) => r.reduce((a, v, j) => a + v * beta[j], 0));
  const sse = ys.reduce((a, v, i) => a + (v - fitted[i]) ** 2, 0);
  const my = mean(ys);
  const sst = ys.reduce((a, v) => a + (v - my) ** 2, 0);
  const sigma2 = sse / df;
  const tcrit = tQuantile(0.975, df);
  const terms = ['(Intercept)', ...names];
  const coefficients = beta.map((b, i) => {
    const se = Math.sqrt(sigma2 * inv[i][i]);
    const t = b / se;
    return { term: terms[i], estimate: round(b), se: round(se), t: round(t), pValue: round(tTwoSidedP(t, df), 12), ci95: [round(b - tcrit * se), round(b + tcrit * se)] as [number, number] };
  });
  const r2 = sst > 0 ? 1 - sse / sst : NaN;
  const p = names.length;
  const fStat = sst > 0 && sse > 0 ? ((sst - sse) / p) / (sse / df) : null;
  const notes = [
    'Ordinary least squares on complete cases; classical standard errors assume independent, homoscedastic, approximately normal errors and a linear relationship. These assumptions were not formally tested.',
    'Coefficients describe association in this data, not causal effects.',
  ];
  if (n < 10 * p) notes.push(`Only ${n} observations for ${p} predictor(s): estimates may be unstable.`);
  if (y.length - n) notes.push(`${y.length - n} row(s) excluded for missing values.`);
  return {
    n, predictors: names, coefficients, rSquared: round(r2), adjRSquared: round(1 - (1 - r2) * (n - 1) / df),
    residualSe: round(Math.sqrt(sigma2)), dfResidual: df,
    fStatistic: fStat === null ? null : round(fStat), fPValue: fStat === null ? null : round(fSf(fStat, p, df), 12), notes,
  };
}

export interface TTestResult {
  test: 'one-sample' | 'welch-two-sample';
  statistic: number;
  df: number;
  pValue: number;
  estimate: number;
  ci95: [number, number];
  cohensD: Maybe<number>;
  n: number[];
  notes: string[];
}

export function oneSampleTTest(values: Array<number | null>, mu0: number): TTestResult | { error: string } {
  const d = describe(values);
  if (d.n < 2 || d.sd === null || d.sd === 0) return { error: 'One-sample t-test needs at least 2 observations with non-zero spread.' };
  const t = (d.mean! - mu0) / d.standardError!;
  const df = d.n - 1;
  const tc = tQuantile(0.975, df);
  return {
    test: 'one-sample', statistic: round(t), df, pValue: round(tTwoSidedP(t, df), 12), estimate: d.mean!,
    ci95: [round(d.mean! - tc * d.standardError!), round(d.mean! + tc * d.standardError!)], cohensD: round((d.mean! - mu0) / d.sd), n: [d.n],
    notes: [`H0: mean = ${mu0}. Assumes independent observations and an approximately normal mean.`, 'A p-value is not the probability that H0 is true; also consider the effect size and CI.'],
  };
}

/** Welch's two-sample t-test (does not assume equal variances). */
export function welchTTest(a: Array<number | null>, b: Array<number | null>): TTestResult | { error: string } {
  const da = describe(a);
  const db = describe(b);
  if (da.n < 2 || db.n < 2 || da.variance === null || db.variance === null) return { error: 'Each group needs at least 2 observations.' };
  const va = da.variance / da.n;
  const vb = db.variance / db.n;
  const se = Math.sqrt(va + vb);
  if (se === 0) return { error: 'Both groups have zero variance; the test is undefined.' };
  const diff = da.mean! - db.mean!;
  const t = diff / se;
  const df = (va + vb) ** 2 / (va ** 2 / (da.n - 1) + vb ** 2 / (db.n - 1));
  const tc = tQuantile(0.975, df);
  const pooledSd = Math.sqrt(((da.n - 1) * da.variance + (db.n - 1) * db.variance) / (da.n + db.n - 2));
  return {
    test: 'welch-two-sample', statistic: round(t), df: round(df), pValue: round(tTwoSidedP(t, df), 12), estimate: round(diff),
    ci95: [round(diff - tc * se), round(diff + tc * se)], cohensD: pooledSd > 0 ? round(diff / pooledSd) : null, n: [da.n, db.n],
    notes: ['H0: the two group means are equal. Welch–Satterthwaite degrees of freedom; independent groups assumed.', 'Statistical significance is not the same as practical importance.'],
  };
}

export interface OutlierResult { method: string; lowerFence: number; upperFence: number; outliers: Array<{ index: number; value: number }>; n: number }

/** Tukey's fences: values below Q1 − k·IQR or above Q3 + k·IQR (k = 1.5 by default). */
export function tukeyOutliers(values: Array<number | null>, k = 1.5): OutlierResult | { error: string } {
  const xs = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => typeof p.v === 'number' && Number.isFinite(p.v));
  if (xs.length < 4) return { error: 'At least 4 observations are needed to identify outliers.' };
  const s = sorted(xs.map((p) => p.v));
  const q1 = quantile(s, 0.25);
  const q3 = quantile(s, 0.75);
  const lower = q1 - k * (q3 - q1);
  const upper = q3 + k * (q3 - q1);
  return {
    method: `Tukey's fences, k = ${k}: below Q1 − ${k}·IQR or above Q3 + ${k}·IQR (${QUANTILE_METHOD}) An outlier is a value to check, not an error to delete.`,
    lowerFence: round(lower), upperFence: round(upper),
    outliers: xs.filter((p) => p.v < lower || p.v > upper).map((p) => ({ index: p.i, value: p.v })), n: xs.length,
  };
}

export interface SeriesPoint { period: string; value: Maybe<number>; change: Maybe<number>; percentChange: Maybe<number> }

/**
 * Time series summary: points in period order, period-over-period changes (undefined after a missing value
 * or from a zero base), overall change, CAGR when periods are years and both endpoints are positive, and a linear trend.
 */
export function timeSeries(periods: string[], values: Array<number | null>) {
  const notes: string[] = [];
  const pts = periods.map((p, i) => ({ period: p, value: values[i] }));
  const seen = new Set<string>();
  for (const p of pts) { if (seen.has(p.period)) notes.push(`Period "${p.period}" appears more than once; aggregate before a time-series analysis.`); seen.add(p.period); }
  pts.sort((a, b) => a.period.localeCompare(b.period, undefined, { numeric: true }));
  const out: SeriesPoint[] = pts.map((p, i) => {
    const prev = i > 0 ? pts[i - 1].value : null;
    const cur = p.value;
    const ok = typeof prev === 'number' && typeof cur === 'number';
    return {
      period: p.period, value: cur ?? null,
      change: ok ? round(cur - prev) : null,
      percentChange: ok && prev !== 0 ? round(((cur - prev) / Math.abs(prev)) * 100) : null,
    };
  });
  const valid = out.filter((p) => typeof p.value === 'number') as Array<SeriesPoint & { value: number }>;
  let overall: { from: string; to: string; change: number; percentChange: Maybe<number>; cagr: Maybe<number> } | null = null;
  if (valid.length >= 2) {
    const a = valid[0];
    const b = valid[valid.length - 1];
    const years = [a.period, b.period].every((p) => /^\d{4}$/.test(p)) ? Number(b.period) - Number(a.period) : null;
    overall = {
      from: a.period, to: b.period, change: round(b.value - a.value),
      percentChange: a.value !== 0 ? round(((b.value - a.value) / Math.abs(a.value)) * 100) : null,
      cagr: years && years > 0 && a.value > 0 && b.value > 0 ? round(((b.value / a.value) ** (1 / years) - 1) * 100) : null,
    };
    if (years === null) notes.push('CAGR not computed: periods are not plain years.');
    else if (overall.cagr === null) notes.push('CAGR not computed: it needs positive start and end values.');
  } else notes.push('Fewer than 2 non-missing points: no change can be computed.');
  const numericX = valid.every((p) => /^\d{4}(\.\d+)?$/.test(p.period));
  const trend = valid.length >= 3
    ? linearRegression(valid.map((p) => p.value), { [numericX ? 'year' : 'periodIndex']: valid.map((p, i) => (numericX ? Number(p.period) : i)) })
    : null;
  if (out.some((p) => p.value === null)) notes.push('Missing periods are shown as gaps; changes next to them are undefined.');
  return { points: out, overall, trend: trend && !('error' in trend) ? { slopePerPeriod: trend.coefficients[1].estimate, pValue: trend.coefficients[1].pValue, rSquared: trend.rSquared, unit: numericX ? 'per year' : 'per period step' } : null, notes };
}

/** Histogram bins by Freedman–Diaconis (falls back to Sturges when IQR = 0). */
export function histogramBins(values: number[]): { method: string; edges: number[]; counts: number[] } {
  const s = sorted(values.filter(Number.isFinite));
  const n = s.length;
  if (!n) return { method: 'none', edges: [], counts: [] };
  const min = s[0];
  const max = s[n - 1];
  if (min === max) return { method: 'single value', edges: [min, max], counts: [n] };
  const iqr = quantile(s, 0.75) - quantile(s, 0.25);
  let k: number;
  let method: string;
  if (iqr > 0) { const h = (2 * iqr) / Math.cbrt(n); k = Math.ceil((max - min) / h); method = 'Freedman–Diaconis (bin width 2·IQR/∛n)'; }
  else { k = Math.ceil(Math.log2(n) + 1); method = 'Sturges (⌈log2 n⌉ + 1 bins)'; }
  k = Math.min(Math.max(k, 1), 60);
  const width = (max - min) / k;
  const edges = Array.from({ length: k + 1 }, (_, i) => round(min + i * width));
  const counts = new Array(k).fill(0);
  for (const v of s) counts[Math.min(k - 1, Math.floor((v - min) / width))]++;
  return { method, edges, counts };
}
