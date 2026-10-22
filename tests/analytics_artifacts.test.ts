import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { DatasetError, loadDataset, numericColumn, qualityReport, textColumn } from '../server/services/analytics/dataset.js';
import { runAnalysis } from '../server/services/analytics/analyze.js';
import { chartsForAnalysis, validateChartSpec } from '../server/services/analytics/charts.js';
import { buildAnalysisReport } from '../server/services/analytics/reportBuilder.js';
import { escapeHtml, renderReportHtml, validateHtmlArtifact } from '../server/services/analytics/htmlReport.js';
import { numbersIn, unsupportedNumbers } from '../server/services/analytics/narrative.js';

const csv = (lines: string[]) => Buffer.from(lines.join('\n'));

test('CSV loading: delimiter detection, types, missing and invalid values', async () => {
  const ds = await loadDataset(csv(['name;score;group;when', 'a;10;x;2020-01-01', 'b;n/a;y;2020-02-01', 'c;"1,250";x;2020-03-01', 'd;12.5%;y;2020-04-01', 'e;oops;x;2020-05-01', 'f;7;y;2020-06-01', 'g;8;x;2020-07-01', 'h;9;y;2020-08-01', 'i;11;x;2020-09-01', 'j;3;y;2020-10-01']), 'scores.csv');
  const byName = Object.fromEntries(ds.columns.map((c) => [c.name, c]));
  assert.equal(byName.score.type, 'numeric');
  assert.equal(byName.score.missing, 1);
  assert.equal(byName.score.invalid, 1);
  assert.deepEqual(byName.score.invalidExamples, ['oops']);
  assert.equal(byName.group.type, 'categorical');
  assert.equal(byName.when.type, 'datetime');
  const nums = numericColumn(ds, 'score');
  assert.equal(nums[1], null, 'n/a is missing, not 0');
  assert.equal(nums[2], 1250);
  assert.equal(nums[3], 12.5);
  assert.equal(nums[4], null, 'invalid text is excluded, not 0');
  const q = qualityReport(ds);
  assert.ok(q.issues.some((i) => i.column === 'score' && /not valid numbers/.test(i.message)));
});

test('CSV edge cases: ragged rows, duplicate headers, duplicates, "x" is a value not missing', async () => {
  const ds = await loadDataset(csv(['q,q,,answer', '1,2,3,x', '1,2,3,x', '4,5', '6,7,8,9,10']), 'f.csv');
  assert.deepEqual(ds.columns.map((c) => c.name), ['q', 'q_2', 'column_3', 'answer']);
  assert.ok(ds.warnings.some((w) => /different number of fields/.test(w)));
  assert.ok(ds.warnings.some((w) => /renamed/.test(w)));
  assert.equal(qualityReport(ds).duplicateRows, 1);
  assert.equal(textColumn(ds, 'answer')[0], 'x');
  const withCustom = await loadDataset(csv(['a', '1', '-99', '3']), 'm.csv', undefined, { missingValues: ['-99'] });
  assert.deepEqual(numericColumn(withCustom, 'a'), [1, null, 3]);
});

test('malformed, empty, oversized and unsupported files are rejected with clear codes', async () => {
  await assert.rejects(loadDataset(Buffer.from('{"a": 1'), 'x.json'), (e: any) => e instanceof DatasetError && e.code === 'MALFORMED');
  await assert.rejects(loadDataset(Buffer.from('[1,2,3]'), 'x.json'), (e: any) => e.code === 'MALFORMED');
  await assert.rejects(loadDataset(csv(['a,b']), 'x.csv'), (e: any) => e.code === 'EMPTY');
  await assert.rejects(loadDataset(Buffer.alloc(100), 'x.csv', undefined, { maxBytes: 10 }), (e: any) => e.code === 'TOO_LARGE');
  await assert.rejects(loadDataset(csv(['a', ...Array(20).fill('1')]), 'x.csv', undefined, { maxRows: 5 }), (e: any) => e.code === 'TOO_LARGE');
  await assert.rejects(loadDataset(Buffer.from('MZ'), 'x.exe'), (e: any) => e.code === 'UNSUPPORTED_FORMAT');
  await assert.rejects(loadDataset(Buffer.from('not a zip'), 'x.xlsx'), (e: any) => e.code === 'MALFORMED');
});

test('XLSX and JSON datasets load with the same semantics', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(['district', 'rate']);
  ws.addRow(['Gasabo', 12.5]);
  ws.addRow(['Huye', null]);
  ws.addRow(['Nyagatare', 9]);
  const x = await loadDataset(Buffer.from(await wb.xlsx.writeBuffer()), 'd.xlsx');
  assert.deepEqual(numericColumn(x, 'rate'), [12.5, null, 9]);
  const j = await loadDataset(Buffer.from(JSON.stringify({ rows: [{ a: 1, b: 'x' }, { a: null, b: 'y' }] })), 'd.json');
  assert.deepEqual(numericColumn(j, 'a'), [1, null]);
});

test('analysis: unknown columns and wrong types are reported per analysis, not crashes; filters are logged', async () => {
  const ds = await loadDataset(csv(['g,v', ...Array.from({ length: 30 }, (_, i) => `${i % 2 ? 'a' : 'b'},${i}`)]), 'f.csv');
  const r = runAnalysis(ds, { analyses: [{ type: 'describe', columns: ['nope'] }, { type: 'regression', y: 'v', x: ['g'] }, { type: 'describe', columns: ['v'] }], filters: [{ column: 'g', op: 'eq', value: 'a' }] });
  assert.equal(r.results[0].ok, false);
  assert.match(r.results[0].error!, /does not exist/);
  assert.match(r.results[1].error!, /not numeric/);
  assert.equal(r.results[2].ok, true);
  assert.equal(r.dataset.rowsAnalyzed, 15);
  assert.ok(r.transformations.some((t) => /Filter g eq "a": 30 → 15 rows/.test(t)));
  assert.equal(r.engineVersion, 'bwenge-stats-1.0.0');
  assert.deepEqual(runAnalysis(ds), runAnalysis(ds), 'deterministic');
});

async function sampleReport(title: string, category: string) {
  const ds = await loadDataset(csv(['grp,score,hours', ...Array.from({ length: 40 }, (_, i) => `"${i % 2 ? category : 'B'}",${50 + ((i * 7) % 40)},${(i * 3) % 10}`)]), 'sample.csv');
  const a = runAnalysis(ds, { analyses: [{ type: 'describe', columns: ['score'], groupBy: 'grp' }, { type: 'frequency', column: 'grp' }, { type: 'regression', y: 'score', x: ['hours'] }] });
  const charts = chartsForAnalysis(ds, a);
  return { a, charts, report: buildAnalysisReport(a, charts, { title, citations: [{ title: 'Source <b>X</b>', url: 'javascript:alert(1)' }, { title: 'NISR', url: 'https://www.statistics.gov.rw/' }] }) };
}

test('charts carry titles, captions, alt text, provenance and their data table', async () => {
  const { charts } = await sampleReport('T', 'A');
  assert.ok(charts.length >= 3);
  for (const c of charts) assert.deepEqual(validateChartSpec(c), [], c.id);
  assert.ok(charts.some((c) => c.chartType === 'scatter-trend'));
  const bad = { ...charts[0], vegaLite: { data: { url: 'https://evil.example/data.csv' } } };
  assert.ok(validateChartSpec(bad).some((p) => /external data/.test(p)));
});

test('HTML report: injection in titles, categories and citations is neutralised; output validates', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const { report } = await sampleReport('Report <script>alert("x")</script>', evil);
  const { html, charts } = await renderReportHtml(report);
  assert.ok(charts.every((c) => c.ok), JSON.stringify(charts));
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img src=x/i);
  const tagsWithoutQuotedValues = (html.match(/<[a-zA-Z][^>]*>/g) ?? []).map((t) => t.replace(/"[^"]*"|'[^']*'/g, '""')).join('\n');
  assert.doesNotMatch(tagsWithoutQuotedValues, /\son[a-z]+\s*=/i, 'no tag carries an event handler attribute');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/, 'the label is shown as text');
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.match(html, /&lt;script&gt;alert/);
  assert.match(html, /href="https:\/\/www\.statistics\.gov\.rw\/"/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /<svg role="img" aria-label=/);
  assert.match(html, /Reproducibility/);
  assert.deepEqual(validateHtmlArtifact(html, { forbiddenStrings: ['/srv/secret-dir'] }), { valid: true, problems: [] });
});

test('artifact validator rejects active content, external resources, paths and secrets', () => {
  const base = (body: string) => `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'"></head><body>${body}</body></html>`;
  const cases: Array<[string, RegExp]> = [
    ['<script>1</script>', /script/],
    ['<div onclick="x()">a</div>', /event handler/],
    ['<img src="https://tracker.example/p.gif">', /external resource/],
    ['<a href="javascript:alert(1)">x</a>', /script URL/],
    ['<a href="jav&#x61;script:alert(1)">x</a>', /script URL/],
    ['<svg><use xlink:href="//evil.example/s.svg#a"/></svg>', /external resource/],
    ['<iframe></iframe>', /disallowed element/],
    ['<p>/home/deploy/app/.env</p>', /server file path/],
    ['<p>sk-ant-api03-abcdefghijklmnopqrstuvwxyz</p>', /credential/],
    ['<style>@import url(https://x.example/a.css)</style>', /CSS loads/],
  ];
  for (const [body, re] of cases) {
    const v = validateHtmlArtifact(base(body));
    assert.equal(v.valid, false, body);
    assert.ok(v.problems.some((p) => re.test(p)), `${body}: ${v.problems}`);
  }
  assert.ok(validateHtmlArtifact('<p>x</p>').problems.includes('missing doctype'));
  assert.ok(validateHtmlArtifact(base('x'.repeat(200)), { maxBytes: 100 }).problems.some((p) => /limit/.test(p)));
  assert.ok(validateHtmlArtifact(base('<p>/opt/secret-store/abc</p>'), { forbiddenStrings: ['/opt/secret-store'] }).problems.some((p) => /forbidden/.test(p)));
  assert.equal(escapeHtml(`<"'&>`), '&lt;&quot;&#39;&amp;&gt;');
  assert.equal(validateHtmlArtifact(base('<p aria-label="&lt;img src=x onerror=alert(1)&gt;">ok</p><p>&lt;b onclick=x&gt;</p>')).valid, true, 'escaped text is not markup');
});

test('AI interpretation is rejected when it introduces numbers not in the calculations', () => {
  const facts = 'score: n = 61, mean 68.52 (95% CI 64.54 to 72.51), median 68. r = 0.27, p = 0.035.';
  assert.deepEqual(numbersIn('1,234.50 and −3'), ['1234.5', '-3']);
  assert.deepEqual(unsupportedNumbers('The average score was 68.52 and the median 68 across 61 students.', facts), []);
  assert.deepEqual(unsupportedNumbers('Scores rose by 12.4% and 80 students passed.', facts), ['12.4', '80']);
});
