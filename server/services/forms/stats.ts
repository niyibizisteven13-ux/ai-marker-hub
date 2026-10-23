/**
 * Deterministic statistics for form responses. The model plans and explains; every number is computed here.
 * Pure functions (no I/O), so they are easy to test against known values.
 */

export function lgamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const k of c) ser += k / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Regularized upper incomplete gamma Q(a, x). */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let sum = 1 / a, del = sum, ap = a;
    for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-14) break; }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a); b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}

function betacf(a: number, b: number, x: number): number {
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-300) d = 1e-300;
  d = 1 / d; let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function betaI(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

export const chiSquareP = (chi2: number, df: number) => gammaQ(df / 2, chi2 / 2);
export const fP = (f: number, d1: number, d2: number) => (f <= 0 ? 1 : betaI(d2 / 2, d1 / 2, d2 / (d2 + d1 * f)));
export const tTwoSidedP = (t: number, df: number) => betaI(df / 2, 0.5, df / (df + t * t));

const r = (n: number, d = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : NaN);

export function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface Describe { n: number; mean: number; sd: number; median: number; q1: number; q3: number; min: number; max: number; skewness: number | null; outliers: number }

export function describe(values: number[]): Describe {
  const x = values.filter(Number.isFinite).sort((a, b) => a - b);
  const n = x.length;
  if (!n) return { n: 0, mean: NaN, sd: NaN, median: NaN, q1: NaN, q3: NaN, min: NaN, max: NaN, skewness: null, outliers: 0 };
  const mean = x.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(x.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const q1 = quantile(x, 0.25), q3 = quantile(x, 0.75), iqr = q3 - q1;
  const skewness = n > 2 && sd > 0 ? (n / ((n - 1) * (n - 2))) * x.reduce((a, b) => a + ((b - mean) / sd) ** 3, 0) : null;
  return { n, mean: r(mean), sd: r(sd), median: r(quantile(x, 0.5)), q1: r(q1), q3: r(q3), min: x[0], max: x[n - 1], skewness: skewness === null ? null : r(skewness), outliers: x.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr).length };
}

export interface Crosstab {
  rows: string[]; cols: string[]; counts: number[][]; n: number;
  chi2: number | null; df: number | null; p: number | null; cramersV: number | null; warnings: string[];
}

/** Contingency table with Pearson's chi-square test of independence and Cramér's V. */
export function crosstab(pairs: Array<[string, string]>, rowOrder: string[] = [], colOrder: string[] = []): Crosstab {
  const rows = [...new Set([...rowOrder.filter((x) => pairs.some((p) => p[0] === x)), ...pairs.map((p) => p[0])])];
  const cols = [...new Set([...colOrder.filter((x) => pairs.some((p) => p[1] === x)), ...pairs.map((p) => p[1])])];
  const counts = rows.map(() => cols.map(() => 0));
  for (const [a, b] of pairs) counts[rows.indexOf(a)][cols.indexOf(b)]++;
  const n = pairs.length;
  const warnings: string[] = [];
  if (rows.length < 2 || cols.length < 2 || n === 0) return { rows, cols, counts, n, chi2: null, df: null, p: null, cramersV: null, warnings: ['A test needs at least two categories in each variable.'] };
  const rt = counts.map((row) => row.reduce((a, b) => a + b, 0));
  const ct = cols.map((_, j) => counts.reduce((a, row) => a + row[j], 0));
  let chi2 = 0, small = 0;
  for (let i = 0; i < rows.length; i++) for (let j = 0; j < cols.length; j++) {
    const e = (rt[i] * ct[j]) / n;
    if (e < 5) small++;
    if (e > 0) chi2 += (counts[i][j] - e) ** 2 / e;
  }
  const df = (rows.length - 1) * (cols.length - 1);
  if (small / (rows.length * cols.length) > 0.2) warnings.push(`${small} of ${rows.length * cols.length} cells expect fewer than 5 responses, so the chi-square p-value is unreliable; combine categories or collect more responses.`);
  return { rows, cols, counts, n, chi2: r(chi2, 3), df, p: r(chiSquareP(chi2, df), 4), cramersV: r(Math.sqrt(chi2 / (n * (Math.min(rows.length, cols.length) - 1))), 3), warnings };
}

export interface GroupComparison {
  groups: Array<{ group: string } & Describe>;
  f: number | null; df1: number | null; df2: number | null; p: number | null; etaSquared: number | null; warnings: string[];
}

/** Numeric outcome across groups: descriptives per group and one-way ANOVA. */
export function compareGroups(pairs: Array<[string, number]>, order: string[] = []): GroupComparison {
  const names = [...new Set([...order.filter((g) => pairs.some((p) => p[0] === g)), ...pairs.map((p) => p[0])])];
  const by = names.map((g) => pairs.filter((p) => p[0] === g).map((p) => p[1]).filter(Number.isFinite));
  const groups = names.map((g, i) => ({ group: g, ...describe(by[i]) }));
  const warnings: string[] = [];
  const valid = by.filter((v) => v.length >= 2);
  if (valid.length < 2) return { groups, f: null, df1: null, df2: null, p: null, etaSquared: null, warnings: ['A comparison needs at least two groups with two or more responses each.'] };
  const all = valid.flat(), grand = all.reduce((a, b) => a + b, 0) / all.length;
  const ssb = valid.reduce((a, v) => a + v.length * ((v.reduce((s, x) => s + x, 0) / v.length) - grand) ** 2, 0);
  const ssw = valid.reduce((a, v) => { const m = v.reduce((s, x) => s + x, 0) / v.length; return a + v.reduce((s, x) => s + (x - m) ** 2, 0); }, 0);
  const df1 = valid.length - 1, df2 = all.length - valid.length;
  if (df2 <= 0 || ssw === 0) return { groups, f: null, df1, df2, p: null, etaSquared: null, warnings: ['Not enough variation within groups for a test.'] };
  const f = (ssb / df1) / (ssw / df2);
  if (valid.some((v) => v.length < 10)) warnings.push('Some groups have fewer than 10 responses; treat the test as indicative only.');
  const sds = groups.filter((g) => g.n >= 2).map((g) => g.sd);
  if (sds.length && Math.max(...sds) > 2 * Math.min(...sds.filter((x) => x > 0), Infinity)) warnings.push('Group spreads differ a lot; ANOVA assumes similar variances, so also compare the medians.');
  return { groups, f: r(f, 3), df1, df2, p: r(fP(f, df1, df2), 4), etaSquared: r(ssb / (ssb + ssw), 3), warnings };
}

export interface Correlation { n: number; pearson: number | null; spearman: number | null; p: number | null; warnings: string[] }

const ranks = (v: number[]) => {
  const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(v.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) out[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
};
const pearsonOf = (x: number[], y: number[]) => {
  const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
};

/** Pearson and Spearman correlation with the p-value of Pearson's r. */
export function correlate(pairs: Array<[number, number]>): Correlation {
  const p = pairs.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  const n = p.length;
  if (n < 3) return { n, pearson: null, spearman: null, p: null, warnings: ['A correlation needs at least 3 complete pairs.'] };
  const x = p.map((q) => q[0]), y = p.map((q) => q[1]);
  const pr = pearsonOf(x, y), sr = pearsonOf(ranks(x), ranks(y));
  if (!Number.isFinite(pr)) return { n, pearson: null, spearman: null, p: null, warnings: ['One of the variables does not vary.'] };
  const t = pr * Math.sqrt((n - 2) / Math.max(1e-12, 1 - pr * pr));
  const warnings = ['A correlation shows association, not cause.'];
  if (n < 30) warnings.push('With fewer than 30 pairs, the estimate is imprecise.');
  return { n, pearson: r(pr, 3), spearman: Number.isFinite(sr) ? r(sr, 3) : null, p: r(tTwoSidedP(t, n - 2), 4), warnings };
}
