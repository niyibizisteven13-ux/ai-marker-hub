import test from 'node:test';
import assert from 'node:assert/strict';
import * as d from '../server/services/analytics/distributions.js';
import {
  correlation, crossTab, describe, frequencyTable, histogramBins, linearRegression, oneSampleTTest, quantile, timeSeries, tukeyOutliers, weightedDescribe, welchTTest,
} from '../server/services/analytics/statistics.js';

const close = (a: number | null | undefined, b: number, tol = 1e-6, msg?: string) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}, got ${a}`);

test('distributions match R/SciPy reference values', () => {
  close(d.normalCdf(1.96), 0.9750021048517795, 1e-12);
  close(d.normalQuantile(0.975), 1.959963984540054, 1e-9);
  close(d.tCdf(2, 10), 0.963305982614, 1e-9); // pt(2, 10)
  close(d.tQuantile(0.975, 10), 2.228138851986274, 1e-9);
  close(d.tQuantile(0.975, 1), 12.70620473617471, 1e-7);
  close(d.chiSquareSf(3.841458820694124, 1), 0.05, 1e-9);
  close(d.fSf(4.964602743730711, 1, 10), 0.05, 1e-8);
  assert.ok(Number.isNaN(d.tQuantile(0.5, 0)));
});

// Reference values from pandas: Series([2,4,4,4,5,5,7,9,12,30]).describe()/skew()/kurt()
test('describe() matches pandas on a known sample', () => {
  const r = describe([2, 4, 4, 4, 5, 5, 7, 9, 12, 30]);
  assert.equal(r.n, 10);
  close(r.mean, 8.2);
  close(r.median, 5);
  close(r.variance, 67.06666666666666);
  close(r.sd, 8.189424074174365);
  close(r.q1, 4);
  close(r.q3, 8.5);
  close(r.percentiles.p90, 13.8);
  close(r.skewness, 2.500376091600816, 1e-9);
  close(r.excessKurtosis, 6.757219393098951, 1e-9);
  assert.deepEqual(r.modes, [4]);
  close(r.range, 28);
  assert.ok(r.ci95![0] < 8.2 && r.ci95![1] > 8.2);
});

test('describe(): missing is excluded, never zero; undefined statistics are null with a reason', () => {
  const r = describe([10, null, undefined, NaN, 20]);
  assert.equal(r.n, 2);
  assert.equal(r.missing, 3);
  close(r.mean, 15);
  assert.equal(r.skewness, null);
  assert.match(r.notes.join(' '), /Skewness needs at least 3/);

  const one = describe([5]);
  assert.equal(one.sd, null);
  assert.equal(one.ci95, null);
  assert.match(one.notes.join(' '), /Only one observation/);

  const empty = describe([null, null]);
  assert.equal(empty.mean, null);
  assert.match(empty.notes[0], /No non-missing/);

  const constant = describe([3, 3, 3, 3]);
  assert.equal(constant.skewness, null);
  assert.equal(constant.sd, 0);
  assert.match(constant.notes.join(' '), /identical/);

  assert.equal(describe([-2, 1, 4]).cv, null, 'no CV with negative values');
  assert.equal(describe([-1, 1]).cv, null, 'no CV when mean is 0');
  assert.deepEqual(describe([1, 2, 3]).modes, []);
  assert.match(describe([1, 2, 3]).modeNote, /No mode/);
  assert.deepEqual(describe([1, 1, 2, 2, 3]).modes, [1, 2]);
});

test('quantile uses R type 7', () => {
  close(quantile([1, 2, 3, 4], 0.25), 1.75);
  close(quantile([1, 2, 3, 4], 0.5), 2.5);
  close(quantile([7], 0.9), 7);
});

// Anscombe's quartet, set I. R: lm(y1 ~ x1) — b0 3.0001 (SE 1.1247), b1 0.5001 (SE 0.1179), R² 0.6665, F 17.99
const ax = [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5];
const ay = [8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68];

test('linear regression matches R on Anscombe I', () => {
  const r = linearRegression(ay, { x: ax });
  assert.ok(!('error' in r));
  if ('error' in r) return;
  close(r.coefficients[0].estimate, 3.000090909, 1e-6);
  close(r.coefficients[1].estimate, 0.500090909, 1e-6);
  close(r.coefficients[0].se, 1.124746791, 1e-6);
  close(r.coefficients[1].se, 0.117905501, 1e-6);
  close(r.coefficients[1].pValue, 0.002169629, 1e-6);
  close(r.rSquared, 0.666542460, 1e-6);
  close(r.adjRSquared, 0.629491622, 1e-6);
  close(r.residualSe, 1.236603323, 1e-6);
  close(r.fStatistic, 17.98994297, 1e-5);
  assert.equal(r.dfResidual, 9);
});

test('multiple regression matches NumPy least squares', () => {
  const x = [3, 1, 4, 1, 5, 9, 2, 6], y = [2, 7, 1, 8, 2, 8, 1, 8], z = [1, 1, 2, 3, 5, 8, 13, 21];
  const r = linearRegression(y, { x, z });
  if ('error' in r) throw new Error(r.error);
  close(r.coefficients[0].estimate, 3.38206656, 1e-7);
  close(r.coefficients[1].estimate, 0.16523761, 1e-7);
  close(r.coefficients[2].estimate, 0.08927966, 1e-7);
  close(r.rSquared, 0.073175195250475, 1e-9);
});

test('regression refuses collinear or underdetermined input', () => {
  assert.match((linearRegression([1, 2, 3, 4], { a: [1, 2, 3, 4], b: [2, 4, 6, 8] }) as { error: string }).error, /collinear/);
  assert.match((linearRegression([1, 2], { a: [1, 2] }) as { error: string }).error, /Not enough/);
});

test('Pearson and Spearman correlation', () => {
  const p = correlation(ax, ay);
  close(p.r, 0.81642051634484, 1e-9);
  assert.ok(p.ci95 && p.ci95[0] < 0.8164 && p.ci95[1] > 0.8164);
  assert.match(p.notes[0], /does not show that one variable causes/);
  close(correlation(ax, ay, 'spearman').r, 0.8181818181818182, 1e-9);
  assert.equal(correlation([1, 2], [3, 4]).r, null);
  assert.equal(correlation([1, 1, 1, 1], [1, 2, 3, 4]).r, null);
  assert.equal(correlation([1, null, 3, 4], [2, 5, null, 8]).n, 2);
});

// R: t.test(extra ~ group, data = sleep) -> t = -1.8608, df = 17.776, p = 0.07939, CI -3.3654832 0.2054832
test('Welch t-test matches R on the sleep dataset', () => {
  const g1 = [0.7, -1.6, -0.2, -1.2, -0.1, 3.4, 3.7, 0.8, 0.0, 2.0];
  const g2 = [1.9, 0.8, 1.1, 0.1, -0.1, 4.4, 5.5, 1.6, 4.6, 3.4];
  const r = welchTTest(g1, g2);
  if ('error' in r) throw new Error(r.error);
  close(r.statistic, -1.860813, 1e-5);
  close(r.df, 17.77647, 1e-4);
  close(r.pValue, 0.07939414, 1e-6);
  close(r.ci95[0], -3.3654832, 1e-6);
  close(r.ci95[1], 0.2054832, 1e-6);
  assert.ok('error' in welchTTest([1], [2, 3]));
  assert.ok('error' in welchTTest([1, 1], [1, 1]));
});

test('one-sample t-test', () => {
  // Hand-derived: mean 5.6, Σ(x−x̄)² = 1.44, s² = 0.24, SE = √(0.24/7), t = 0.6 / SE = 3.2403703, df = 6.
  const r = oneSampleTTest([5.1, 4.9, 5.6, 5.8, 6.0, 6.3, 5.5], 5);
  if ('error' in r) throw new Error(r.error);
  close(r.statistic, 0.6 / Math.sqrt(0.24 / 7), 1e-9);
  assert.equal(r.df, 6);
  close(r.pValue, d.tTwoSidedP(0.6 / Math.sqrt(0.24 / 7), 6), 1e-9);
  close(r.cohensD, 0.6 / Math.sqrt(0.24), 1e-9);
});

test('frequency table and cross-tab with chi-square', () => {
  const f = frequencyTable(['a', 'b', 'a', null, 'c', 'a', '']);
  assert.equal(f.missing, 2);
  assert.deepEqual(f.rows[0], { value: 'a', count: 3, percent: 42.8571, validPercent: 60 });

  // 2x2 table [[12,5],[7,9]]: chi-square from NumPy = 2.4305755196815575
  const rows = [...Array(12).fill('A'), ...Array(5).fill('A'), ...Array(7).fill('B'), ...Array(9).fill('B')];
  const cols = [...Array(12).fill('x'), ...Array(5).fill('y'), ...Array(7).fill('x'), ...Array(9).fill('y')];
  const ct = crossTab([...rows, null], [...cols, 'x']);
  assert.equal(ct.n, 33);
  assert.equal(ct.excludedMissing, 1);
  close(ct.chiSquare!.statistic, 2.4305755196815575, 1e-9);
  assert.equal(ct.chiSquare!.df, 1);
  close(ct.chiSquare!.pValue, d.chiSquareSf(2.4305755196815575, 1), 1e-12);
  assert.match(ct.notes.join(' '), /association, not causation/);

  const small = crossTab(['a', 'a', 'b', 'b'], ['x', 'y', 'x', 'y']);
  assert.match(small.notes.join(' '), /expected count below 5/);
  assert.equal(crossTab(['a', 'a'], ['x', 'y']).chiSquare, null);
});

test('Tukey outliers, weighted summary and histogram bins', () => {
  const o = tukeyOutliers([1, 2, 3, 4, 5, 100]);
  if ('error' in o) throw new Error(o.error);
  assert.deepEqual(o.outliers, [{ index: 5, value: 100 }]);
  assert.ok('error' in tukeyOutliers([1, 2, 3]));

  const w = weightedDescribe([10, 20, null], [1, 3, 5]);
  close(w.mean, 17.5);
  assert.match(w.notes.join(' '), /design/);
  assert.equal(weightedDescribe([1, 2], [0, 0]).mean, null);

  const h = histogramBins([1, 2, 2, 3, 3, 3, 4, 4, 5, 9]);
  assert.equal(h.counts.reduce((a, b) => a + b, 0), 10);
  assert.equal(h.edges.length, h.counts.length + 1);
  assert.equal(histogramBins([4, 4, 4]).method, 'single value');
});

test('time series: changes, CAGR, zero and missing bases', () => {
  const r = timeSeries(['2021', '2019', '2020', '2022'], [121, 100, 110, null]);
  assert.deepEqual(r.points.map((p) => p.period), ['2019', '2020', '2021', '2022']);
  close(r.points[1].percentChange, 10);
  assert.equal(r.points[3].change, null);
  close(r.overall!.cagr, 10, 1e-9); // 100 -> 121 over 2 years
  const z = timeSeries(['2019', '2020'], [0, 5]);
  assert.equal(z.points[1].percentChange, null, 'no % change from a zero base');
  assert.equal(z.overall!.cagr, null);
  assert.match(timeSeries(['2020', '2020'], [1, 2]).notes.join(' '), /appears more than once/);
});
