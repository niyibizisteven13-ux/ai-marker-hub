import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { JSDOM } from 'jsdom';
import { prisma } from '../server/db.js';
import { FileStore } from '../server/services/ai/files/FileStore.js';
import { FileJobQueue } from '../server/services/ai/jobs/fileJobQueue.js';
import { loadDataset, type Dataset } from '../server/services/analytics/dataset.js';
import { AnalysisInputError, analyzeDataset } from '../server/services/outputs/analysis.js';
import { compileChart, renderChartSvg } from '../server/services/outputs/charts.js';
import { verifyFile } from '../server/services/outputs/documents.js';
import { chartWidget, tableWidget, validateSelfContainedHtml } from '../server/services/outputs/html.js';
import { renderMap, MapError } from '../server/services/outputs/map.js';
import { parseMermaid, MermaidError } from '../server/services/outputs/mermaid.js';
import { planOutput } from '../server/services/outputs/planner.js';
import { pythonStatus, runPythonEngine, PythonRunError } from '../server/services/outputs/pythonRunner.js';
import { createOutputService, OutputError } from '../server/services/outputs/service.js';
import { SpecError, validateSpec } from '../server/services/outputs/spec.js';
import { unsupportedNumbers, analysisTables } from '../server/services/outputs/tables.js';
import { buildToolkit } from '../server/services/ai/tools/index.js';

// SYNTHETIC data only. The database is the app's local fallback (no DATABASE_URL).
const db = prisma as any;
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'outputs-test-'));
const fileStore = new FileStore({ dir: path.join(root, 'files'), secret: 'test-secret-1234567890' });
const queue = new FileJobQueue({ storageDir: path.join(root, 'jobs'), concurrency: 2, retryDelayMs: 20, maxActivePerUser: 50 });
const python = pythonStatus(true);

// Anscombe's quartet I: textbook reference values (b0 = 3.0001, b1 = 0.5001, R² = 0.6665, r = 0.8164).
const ANSCOMBE_X = [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5];
const ANSCOMBE_Y = [8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68];
const districts = ['Gasabo', 'Kicukiro', 'Nyarugenge', 'Huye', 'Musanze'];
const csv = ['x,y,district,year,income', ...ANSCOMBE_X.map((x, i) => `${x},${ANSCOMBE_Y[i]},${districts[i % 5]},${2019 + (i % 3)},${i === 4 ? '' : 100000 + i * 5000}`)].join('\n');
const anscombe = await loadDataset(Buffer.from(csv), 'anscombe.csv');

const datasets = new Map<string, { owner: string; ds: Dataset }>();
const svc = createOutputService({
  fileStore, queue,
  readDataset: async (userId, id) => { const d = datasets.get(id); if (!d || d.owner !== userId) throw new Error('not found'); return d.ds; },
});

test.after(async () => { await queue.stop(); await new Promise((r) => setTimeout(r, 200)); await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const uid = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ── Calculations ─────────────────────────────────────────────────────────────
test('analysis: regression, correlation and descriptives match reference values (engine in use reported)', async () => {
  const rep = await analyzeDataset(anscombe, { type: 'dataset', id: 'a', label: 'Anscombe I' }, {
    operations: [{ op: 'regression', y: 'y', x: ['x'] }, { op: 'correlation', columns: ['x', 'y'] }, { op: 'describe', columns: ['x', 'y'] }, { op: 'missing' }],
    units: { income: 'RWF' },
  });
  assert.equal(rep.engine.kind, python.available ? 'python' : 'typescript-fallback');
  const reg = rep.results[0];
  const coef = Object.fromEntries(reg.coefficients.map((c: any) => [c.term, c]));
  near(coef.intercept?.estimate ?? coef['(intercept)']?.estimate ?? coef.const?.estimate, 3.0001, 1e-3, 'b0');
  near(coef.x.estimate, 0.5001, 1e-3, 'b1');
  near(reg.r2, 0.6665, 1e-3, 'R²');
  assert.equal(reg.n, 11);
  assert.match(JSON.stringify(rep), /causation|causal/i, 'association-not-causation note present');
  const corr = rep.results[1];
  near(JSON.stringify(corr).includes('0.816') ? 0.8164 : NaN, 0.8164, 1e-3, 'r');
  const desc = rep.results[2];
  assert.ok(JSON.stringify(desc).includes('"mean"'));
  assert.ok(rep.methodology.length && Array.isArray(rep.limitations));
  assert.equal(rep.units.income, 'RWF');
  const miss = JSON.stringify(rep.results[3]);
  assert.match(miss, /income/, 'missing value in income reported');
});

test('analysis: Python engine and TypeScript fallback agree on shared operations', { skip: !python.available && 'python3 with numpy/pandas not installed' }, async () => {
  const input = { operations: [{ op: 'describe' as const, columns: ['x', 'y'] }, { op: 'regression' as const, y: 'y', x: ['x'] }] };
  const py = await analyzeDataset(anscombe, { type: 'dataset', id: 'a', label: 'A' }, input);
  const ts = await analyzeDataset(anscombe, { type: 'dataset', id: 'a', label: 'A' }, input, { forceFallback: true });
  assert.equal(py.engine.kind, 'python');
  assert.equal(ts.engine.kind, 'typescript-fallback');
  const slope = (r: any) => r.results[1].coefficients.find((c: any) => c.term === 'x').estimate;
  near(slope(py), slope(ts), 1e-9, 'slope agreement');
  near(py.results[1].r2, ts.results[1].r2, 1e-9, 'R² agreement');
});

test('analysis: invalid columns, wrong types and unknown operations are rejected before running', async () => {
  await assert.rejects(analyzeDataset(anscombe, { type: 'dataset', id: 'a', label: 'A' }, { operations: [{ op: 'regression', y: 'nope', x: ['x'] }] }), (e: any) => e instanceof AnalysisInputError && /nope/.test(e.problems.join(' ')));
  await assert.rejects(analyzeDataset(anscombe, { type: 'dataset', id: 'a', label: 'A' }, { operations: [{ op: 'regression', y: 'district', x: ['x'] }] } as any), AnalysisInputError);
  await assert.rejects(analyzeDataset(anscombe, { type: 'dataset', id: 'a', label: 'A' }, { operations: [{ op: 'eval', code: 'import os' }] } as any));
});

test('analysis: filters, group-by, pivot, outliers and moving averages run in the Python engine', { skip: !python.available && 'python3 with numpy/pandas not installed' }, async () => {
  const rep = await analyzeDataset(anscombe, { type: 'dataset', id: 'a', label: 'A' }, {
    filters: [{ column: 'x', op: 'gte', value: 6 }],
    operations: [
      { op: 'groupby', by: ['district'], metrics: [{ column: 'y', agg: 'mean' }, { column: 'y', agg: 'count' }] },
      { op: 'pivot', index: 'district', columns: 'year', values: 'y', agg: 'sum' },
      { op: 'outliers', column: 'y', method: 'iqr' },
      { op: 'moving_average', value: 'y', orderBy: 'x', window: 3 },
      { op: 'distribution', column: 'y', bins: 4 },
    ],
  });
  assert.equal(rep.rowsIn, 11);
  assert.equal(rep.rowsAnalysed, ANSCOMBE_X.filter((x) => x >= 6).length);
  assert.equal(rep.filters[0].rowsAfter, rep.rowsAnalysed);
  for (const r of rep.results) assert.ok(!r.error, JSON.stringify(r).slice(0, 200));
  const tables = analysisTables(rep);
  assert.ok(tables.length >= 5);
  // Group mean for Gasabo among x >= 6: rows i=0 (x10,y8.04) and i=5 (x14,y9.96); i=10 has x=5 (filtered out).
  const g = tables[0].rows.find((r) => r.district === 'Gasabo')!;
  const meanKey = Object.keys(g).find((k) => /mean/.test(k))!;
  near(Number(g[meanKey]), (8.04 + 9.96) / 2, 1e-9, 'group mean');
});

test('python runner: subprocess isolation, clean environment, no network, hard timeout', { skip: !python.available && 'python3 not installed' }, async () => {
  const dir = await fs.mkdtemp(path.join(root, 'probe-'));
  const probe = path.join(dir, 'probe.py');
  await fs.writeFile(probe, [
    'import json, os, socket, sys',
    'req = json.load(sys.stdin)',
    'net = "blocked"',
    'try:',
    '    s = socket.create_connection(("1.1.1.1", 80), timeout=2); net = "open"',
    'except Exception as e:',
    '    net = "blocked"',
    'if req.get("sleep"):',
    '    import time; time.sleep(30)',
    'print(json.dumps({"env": sorted(os.environ.keys()), "net": net, "cwd": os.getcwd()}))',
  ].join('\n'));
  const prev = { path: process.env.ANALYSIS_ENGINE_PATH, secret: process.env.ANTHROPIC_API_KEY };
  process.env.ANALYSIS_ENGINE_PATH = probe;
  process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak';
  try {
    const r = await runPythonEngine({});
    // The empty network namespace is what blocks this probe (the real engine also disables sockets itself).
    if (python.netns) assert.equal(r.output.net, 'blocked');
    assert.equal(r.isolation.networkNamespace, python.netns);
    assert.ok(!r.output.env.includes('ANTHROPIC_API_KEY'), 'secrets are not passed to the subprocess');
    assert.ok(!r.output.env.some((k: string) => /KEY|SECRET|TOKEN|DATABASE/i.test(k)), r.output.env.join(','));
    assert.notEqual(r.output.cwd, process.cwd(), 'runs in a scratch directory');
    assert.equal(r.isolation.process, 'subprocess');
    await assert.rejects(runPythonEngine({ sleep: true }, { timeoutMs: 800 }), (e: any) => e instanceof PythonRunError && e.code === 'TIMEOUT');
  } finally {
    if (prev.path === undefined) delete process.env.ANALYSIS_ENGINE_PATH; else process.env.ANALYSIS_ENGINE_PATH = prev.path;
    if (prev.secret === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev.secret;
  }
});

// ── Planner ──────────────────────────────────────────────────────────────────
test('planner: picks the smallest fitting output and authorises sources', () => {
  const cases: Array<[string, Partial<Parameters<typeof planOutput>[0]>, string, string]> = [
    ['What is photosynthesis?', {}, 'answer', 'prose'],
    ['What is the average income by district?', { hasDataset: true }, 'analysis', 'table'],
    ['List the columns in a table', {}, 'answer', 'table'],
    ['Compare maize yields per year as a chart', { hasDataset: true }, 'chart', 'svg'],
    ['Give me an Excel workbook of these results', { hasDataset: true }, 'document', 'xlsx'],
    ['Put the mean and median per district in Excel', { hasDataset: true }, 'template', 'xlsx'],
    ['Make an interactive dashboard of enrolment', { hasDataset: true }, 'report', 'html'],
    ['Draw a flowchart of the admission process', {}, 'diagram', 'svg'],
    ['Write a Word report with regression results', { hasDataset: true }, 'template', 'docx'],
  ];
  for (const [message, extra, output, format] of cases) {
    const p = planOutput({ message, ...extra });
    assert.equal(p.output, output, `${message} → ${p.output} (${p.reasons.join(' ')})`);
    assert.equal(p.format, format, `${message} → ${p.format}`);
    if (format === 'table' || format === 'prose') assert.equal(p.artifact, false, `${message} needs no file`);
  }
  assert.equal(planOutput({ message: 'What is the average income?', hasDataset: true }).needsComputation, true);
  assert.equal(planOutput({ message: 'Hello!' }).artifact, false);
  const p = planOutput({ message: 'chart it', sources: [{ type: 'dataset', id: 'mine' }, { type: 'dataset', id: 'theirs' }] }, (s) => ({ ok: s.id === 'mine', reason: 'no access' }));
  assert.deepEqual(p.authorizedSources, [{ type: 'dataset', id: 'mine' }]);
  assert.equal(p.rejectedSources[0].id, 'theirs');
});

// ── Spec validation, charts, diagrams, maps ──────────────────────────────────
test('spec: units, sources and data references are enforced', () => {
  const chart = (c: any) => ({ kind: 'chart', title: 'T', sources: [], chart: { type: 'bar', x: { field: 'd', title: 'District', type: 'nominal' }, y: { field: 'v', title: 'Yield', unit: 't/ha' }, data: [{ d: 'A', v: 1 }], sourceNote: 'Synthetic', ...c } });
  assert.ok(validateSpec(chart({})));
  assert.throws(() => validateSpec(chart({ y: { field: 'v', title: 'Yield' } })), (e: any) => e instanceof SpecError && /unit/.test(e.problems.join()));
  assert.throws(() => validateSpec(chart({ y: { field: 'missing', title: 'Y', unit: 'none' } })), (e: any) => /not in the data/.test(e.problems.join()));
  assert.throws(() => validateSpec(chart({ sourceNote: undefined })), SpecError);
  assert.throws(() => validateSpec({ kind: 'document', title: 'x', format: 'xlsx' }), (e: any) => /sheets/.test(e.problems.join()));
  assert.throws(() => validateSpec({ kind: 'chart', title: 'x', chart: {}, extra: 1 }), SpecError);
});

test('charts: titles, axis units, legend, source note and responsive SVG without scripts', async () => {
  const c = { type: 'grouped-bar' as const, x: { field: 'district', title: 'District', type: 'nominal' as const }, y: { field: 'yield', title: 'Yield', unit: 't/ha' }, color: { field: 'year', title: 'Year', type: 'nominal' as const }, sourceNote: 'Synthetic survey 2024' };
  const rows = [{ district: 'Huye', year: '2023', yield: 2.1 }, { district: 'Huye', year: '2024', yield: 2.4 }, { district: 'Musanze', year: '2023', yield: 3.2 }, { district: 'Musanze', year: '2024', yield: 3.0 }];
  const vl: any = compileChart(c, 'Maize yield', rows);
  assert.equal(vl.title.text, 'Maize yield');
  assert.match(JSON.stringify(vl.title), /Source: Synthetic survey 2024/);
  assert.match(JSON.stringify(vl.encoding), /Yield \(t\/ha\)/);
  const svg = await renderChartSvg(c, 'Maize yield', rows);
  assert.match(svg, /viewBox=/);
  assert.doesNotMatch(svg, /<svg[^>]*\swidth="\d/);
  assert.doesNotMatch(svg, /<script|onload=|javascript:/i);
  for (const t of ['Maize yield', 'Yield (t/ha)', 'District', 'Source: Synthetic survey 2024', '2023']) assert.ok(svg.includes(t), `svg has ${t}`);
});

test('mermaid: flowchart subset parses; interactions and other diagram types are refused', () => {
  const g = parseMermaid('flowchart LR\n  A[Apply] --> B{Eligible?}\n  B -->|yes| C([Admit])\n  B -. no .-> D((Reject))\n  click A "javascript:alert(1)"'.replace(/\n  click.*$/, ''), 'Admission');
  assert.equal(g.direction, 'LR');
  assert.deepEqual(g.nodes.map((n) => n.shape), ['box', 'diamond', 'rounded', 'ellipse']);
  assert.equal(g.edges.find((e) => e.to === 'C')!.label, 'yes');
  assert.throws(() => parseMermaid('graph TD\nA-->B\nclick A "javascript:alert(1)"'), MermaidError);
  assert.throws(() => parseMermaid('sequenceDiagram\nA->>B: hi'), /flowcharts/);
  assert.equal(parseMermaid('graph TD\nA["<img src=x onerror=alert(1)>"] --> B').nodes[0].label.includes('<'), false);
});

test('maps: choropleth with no-data areas and legend; bad coordinates refused', () => {
  const sq = (x: number, y: number) => [[[x, y], [x + 0.1, y], [x + 0.1, y + 0.1], [x, y + 0.1], [x, y]]];
  const geojson = { features: [
    { geometry: { type: 'Polygon', coordinates: sq(29.7, -2.0) }, properties: { name: 'A<script>', rate: 12 } },
    { geometry: { type: 'Polygon', coordinates: sq(29.8, -2.0) }, properties: { name: 'B', rate: 30 } },
    { geometry: { type: 'Polygon', coordinates: sq(29.9, -2.0) }, properties: { name: 'C' } },
  ] };
  const m = renderMap({ title: 'Rate', sourceNote: 'Synthetic', geojson, valueField: 'rate', labelField: 'name', unit: '%' });
  assert.match(m.svg, /No data/);
  assert.match(m.svg, /Source: Synthetic/);
  assert.doesNotMatch(m.svg, /<script/);
  assert.equal(m.warnings.length, 1);
  assert.throws(() => renderMap({ title: 'x', sourceNote: 'x', points: [{ lat: 300, lon: 10 }] }), MapError);
});

// ── HTML artifacts ───────────────────────────────────────────────────────────
test('html: widgets are self-contained, escape data, and work offline (search, sort, CSV)', async () => {
  const t = { caption: 'Students', columns: [{ key: 'name', label: 'Name' }, { key: 'score', label: 'Score', unit: '%' }], rows: [{ name: '</script><img src=x onerror=alert(1)>', score: 40 }, { name: 'Aline', score: 90 }, { name: 'Bosco', score: 65 }] };
  const html = tableWidget('Scores', t, [{ label: 'Synthetic', type: 'inline' }]);
  const v = validateSelfContainedHtml(html, [root]);
  assert.ok(v.valid, v.problems.join('; '));
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|https?:\/\/(?!www\.w3\.org)/i, 'no external resources');
  assert.doesNotMatch(html, /<img src=x/);
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  await new Promise((r) => setTimeout(r, 50));
  const doc = dom.window.document;
  const bodyRows = () => [...doc.querySelectorAll('tbody tr')].map((tr) => tr.textContent ?? '');
  assert.equal(bodyRows().length, 3);
  assert.equal(doc.querySelector('img'), null, 'payload not turned into markup');
  const search = doc.querySelector('input') as HTMLInputElement;
  search.value = 'aline';
  search.dispatchEvent(new dom.window.Event('input'));
  assert.deepEqual(bodyRows().length, 1);
  assert.match(bodyRows()[0], /Aline/);
  assert.ok(validateSelfContainedHtml('<html><body><script src="https://cdn.example/x.js"></script></body></html>').problems.length);
  assert.ok(validateSelfContainedHtml(html, ['Students']).problems.length, 'forbidden strings detected');
  dom.window.close();
});

test('html: chart explorer toggles series and keeps a static fallback', async () => {
  const c = { type: 'line' as const, x: { field: 'year', title: 'Year', type: 'ordinal' as const }, y: { field: 'v', title: 'Enrolment', unit: 'students' }, color: { field: 's', title: 'School', type: 'nominal' as const }, sourceNote: 'Synthetic' };
  const rows = [{ year: '2022', v: 10, s: 'A' }, { year: '2023', v: 12, s: 'A' }, { year: '2022', v: 8, s: 'B' }, { year: '2023', v: 9, s: 'B' }];
  const html = chartWidget('Enrolment', c, rows, await renderChartSvg(c, 'Enrolment', rows), []);
  assert.ok(validateSelfContainedHtml(html).valid);
  assert.match(html, /<noscript>/);
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  await new Promise((r) => setTimeout(r, 50));
  const boxes = [...dom.window.document.querySelectorAll('input[type=checkbox]')] as HTMLInputElement[];
  assert.equal(boxes.length, 2);
  const before = dom.window.document.querySelectorAll('path, polyline').length;
  boxes[0].checked = false;
  boxes[0].dispatchEvent(new dom.window.Event('change'));
  assert.ok(dom.window.document.querySelectorAll('path, polyline').length < before, 'series hidden');
  dom.window.close();
});

// ── Artifact lifecycle ───────────────────────────────────────────────────────
async function waitDone(userId: string, id: string) {
  const a = await svc.waitReady(userId, id, 60_000);
  assert.ok(['ready', 'failed'].includes(a.status), `still ${a.status}`);
  return a;
}

test('artifacts: analysis → template files (DOCX, PPTX, XLSX) with engine numbers, real and valid', async () => {
  const user = uid('owner');
  datasets.set('ds-1', { owner: user, ds: anscombe });
  const { artifact } = await svc.create(user, { kind: 'analysis', title: 'Anscombe', dataset: { type: 'dataset', id: 'ds-1' }, analysis: { operations: [{ op: 'regression', y: 'y', x: ['x'] }, { op: 'describe', columns: ['x', 'y'] }], units: { y: 'kg' } } });
  const done = await waitDone(user, artifact.id);
  assert.equal(done.status, 'ready', done.error);
  assert.equal(done.userId, user);
  assert.ok(done.createdAt && done.sha256 && done.revision === 1);

  for (const template of ['statistical_report', 'briefing_deck', 'data_workbook'] as const) {
    const { artifact: t } = await svc.create(user, { kind: 'template', template, title: `T ${template}`, sources: [{ type: 'dataset', id: 'ds-1', label: 'Anscombe' }], analysisArtifactId: artifact.id, summary: 'The slope is 0.5001 and 99.9 is invented.' });
    const a = await waitDone(user, t.id);
    assert.equal(a.status, 'ready', a.error);
    const { meta } = await fileStore.read(a.fileId, user);
    const { data } = await fileStore.read(a.fileId, user);
    assert.equal(await verifyFile(a.format, data), null);
    assert.ok(meta.name.endsWith(`.${a.format}`));
    const zip = await JSZip.loadAsync(data);
    const xml = (await Promise.all(Object.keys(zip.files).filter((n) => /\.xml$/.test(n)).map((n) => zip.file(n)!.async('string')))).join(' ');
    assert.match(xml, /0\.50/, `${template} contains the engine slope`);
    assert.ok(a.warnings.some((w: string) => /99\.9/.test(w)), `${template} flags the unsupported number`);
    if (template === 'data_workbook') {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(data as any);
      assert.ok(wb.getWorksheet('Method'), 'method sheet present');
    }
  }
  const rep = await svc.readAnalysis(user, artifact.id);
  assert.deepEqual(unsupportedNumbers('slope 0.5001, R² 0.667, 11 rows', rep), []);
});

test('artifacts: idempotent create, revisions, retry without duplicates, and owner scoping', async () => {
  const user = uid('owner');
  const other = uid('other');
  const spec = { kind: 'chart', title: 'Scores', sources: [{ type: 'inline', label: 'Teacher entry' }], chart: { type: 'bar', x: { field: 'n', title: 'Name', type: 'nominal' }, y: { field: 's', title: 'Score', unit: '%' }, data: [{ n: 'A', s: 50 }, { n: 'B', s: 70 }], sourceNote: 'Teacher entry' } };
  const first = await svc.create(user, spec);
  assert.equal(first.artifact.status, 'ready');
  assert.equal(first.artifact.format, 'svg');
  assert.ok(first.artifact.previewFileId, 'PNG preview stored');
  const again = await svc.create(user, JSON.parse(JSON.stringify(spec)));
  assert.equal(again.reused, true);
  assert.equal(again.artifact.id, first.artifact.id);
  assert.equal((await svc.list(user)).length, 1);

  const rev = await svc.revise(user, first.artifact.id, { ...spec, title: 'Scores v2' });
  assert.equal(rev.revision, 2);
  assert.equal(rev.rootId, first.artifact.id);
  assert.equal(rev.parentId, first.artifact.id);
  assert.deepEqual((await svc.revisions(user, rev.id)).map((r: any) => r.revision), [1, 2]);

  await assert.rejects(svc.readable(other, first.artifact.id), (e: any) => e instanceof OutputError && e.status === 404);
  await assert.rejects(svc.open(other, first.artifact.id), (e: any) => e.status === 404);
  await assert.rejects(svc.revise(other, first.artifact.id, spec), (e: any) => e.status === 404);
  await assert.rejects(svc.remove(other, first.artifact.id), (e: any) => e.status === 404);

  // A failed render is retried in place: same row, no duplicate.
  const bad = await svc.create(user, { kind: 'image', title: 'Picture', prompt: 'a cow' });
  assert.equal(bad.artifact.status, 'failed');
  assert.match(bad.artifact.error, /not configured/);
  const retried = await svc.create(user, { kind: 'image', title: 'Picture', prompt: 'a cow' });
  assert.equal(retried.artifact.id, bad.artifact.id);
  await assert.rejects(svc.retry(user, first.artifact.id), (e: any) => e.code === 'NOT_FAILED');
  assert.equal((await db.generatedArtifact.findMany({ where: { userId: user } })).length, 3);
});

test('artifacts: sources and referenced analyses are authorised', async () => {
  const user = uid('owner');
  const other = uid('other');
  datasets.set('ds-private', { owner: user, ds: anscombe });
  await assert.rejects(svc.create(other, { kind: 'analysis', title: 'x', dataset: { type: 'dataset', id: 'ds-private' }, analysis: { operations: [{ op: 'missing' }] } }), (e: any) => e.code === 'SOURCE_NOT_FOUND');
  const { artifact } = await svc.create(user, { kind: 'analysis', title: 'mine', dataset: { type: 'dataset', id: 'ds-private' }, analysis: { operations: [{ op: 'describe', columns: ['x'] }] } });
  await waitDone(user, artifact.id);
  await assert.rejects(svc.create(other, { kind: 'template', template: 'data_workbook', title: 'steal', analysisArtifactId: artifact.id }), (e: any) => e.code === 'SOURCE_NOT_FOUND');
  // Chat file attachments are owner-checked too.
  const f = await fileStore.put({ userId: user, name: 'data.csv', mime: 'text/csv', kind: 'text', data: Buffer.from(csv) });
  await assert.rejects(svc.create(other, { kind: 'analysis', title: 'x', dataset: { type: 'file', id: f.id }, analysis: { operations: [{ op: 'missing' }] } }), (e: any) => e.code === 'SOURCE_NOT_FOUND');
  const ok = await svc.create(user, { kind: 'analysis', title: 'file', dataset: { type: 'file', id: f.id }, analysis: { operations: [{ op: 'missing' }] } });
  assert.equal((await waitDone(user, ok.artifact.id)).status, 'ready');
  const allowed = await svc.authorizeSources(other, [{ type: 'file', id: f.id }, { type: 'artifact', id: artifact.id }]);
  assert.deepEqual([...allowed.values()], [false, false]);
});

test('artifacts: link shares expire-capable, revocable, and scoped to the one artifact', async () => {
  const user = uid('owner');
  const { artifact } = await svc.create(user, { kind: 'diagram', title: 'Flow', mermaid: 'graph TD\nA[Start] --> B[End]' });
  assert.equal(artifact.status, 'ready');
  const s = await svc.share(user, artifact.id, { mode: 'link', expiresInHours: 2 });
  assert.ok(s.shareToken && s.shareToken.length >= 30);
  const stored = await db.generatedArtifact.findUnique({ where: { id: artifact.id } });
  assert.notEqual(stored.shareTokenHash, s.shareToken, 'only the hash is stored');
  assert.equal((await svc.byToken('', s.shareToken!)).id, artifact.id);
  const opened = await svc.open('', artifact.id, s.shareToken!);
  opened.stream.destroy();
  await assert.rejects(svc.byToken('', 'x'.repeat(32)), (e: any) => e.status === 404);
  await svc.share(user, artifact.id, { mode: 'private' });
  await assert.rejects(svc.byToken('', s.shareToken!), (e: any) => e.status === 404);
  await assert.rejects(svc.share(user, artifact.id, { mode: 'organization' }), (e: any) => e.code === 'NO_ORGANIZATION');
});

test('artifacts: report, widget, map, document kinds render and validate', async () => {
  const user = uid('owner');
  const table = { columns: [{ key: 'd', label: 'District' }, { key: 'v', label: 'Rate', unit: '%' }], rows: [{ d: 'A', v: 10 }, { d: 'B', v: 20 }] };
  const chart = { type: 'bar', x: { field: 'd', title: 'District', type: 'nominal' }, y: { field: 'v', title: 'Rate', unit: '%' }, data: table.rows, sourceNote: 'Synthetic' };
  const specs: any[] = [
    { kind: 'report', layout: 'dashboard', title: 'Dash', sources: [{ type: 'inline', label: 'Synthetic' }], kpis: [{ label: 'Schools', value: 12 }], sections: [{ heading: 'Rates', text: 'Two districts.', table, chart }] },
    { kind: 'widget', title: 'Explorer', widget: { type: 'table_explorer', table } },
    { kind: 'widget', title: 'KPIs', widget: { type: 'kpi_cards', kpis: [{ label: 'Pass rate', value: 81.5, unit: '%' }] } },
    { kind: 'map', title: 'Points', sourceNote: 'Synthetic', points: [{ lat: -1.95, lon: 30.06, label: 'Kigali', value: 5 }, { lat: -2.6, lon: 29.74, label: 'Huye', value: 2 }] },
    { kind: 'document', format: 'pdf', title: 'Brief', sources: [{ type: 'inline', label: 'Synthetic' }], blocks: [{ type: 'heading', level: 1, text: 'Brief' }, { type: 'table', table }, { type: 'chart', chart }] },
    { kind: 'document', format: 'xlsx', title: 'Book', sheets: [{ name: 'Rates', table }] },
    { kind: 'document', format: 'pptx', title: 'Deck', slides: [{ title: 'Chart', chart }, { title: 'Table', table }, { title: 'Points', bullets: ['One'] }] },
    { kind: 'document', format: 'docx', title: 'Doc', blocks: [{ type: 'paragraph', text: 'Hello' }] },
  ];
  for (const spec of specs) {
    const { artifact } = await svc.create(user, spec);
    const a = await waitDone(user, artifact.id);
    assert.equal(a.status, 'ready', `${spec.kind}/${spec.format ?? ''}: ${a.error}`);
    const { data } = await fileStore.read(a.fileId, user);
    assert.equal(await verifyFile(a.format, data), null);
    if (a.format === 'html') assert.ok(validateSelfContainedHtml(data.toString('utf8')).valid);
  }
});

test('agent tools: analyze_data and create_output are registered and report engine results', async () => {
  const user = uid('owner');
  const services = { outputs: { create: svc.create, waitReady: svc.waitReady, readAnalysis: svc.readAnalysis, attachmentRef: svc.attachmentRef } };
  const kit = buildToolkit(services);
  const names = kit.definitions().map((d: any) => d.name);
  assert.ok(names.includes('analyze_data') && names.includes('create_output'), names.join(','));
  const f = await fileStore.put({ userId: user, name: 'data.csv', mime: 'text/csv', kind: 'text', data: Buffer.from(csv) });
  const ctx = { userId: user, files: fileStore, services } as any;
  const r = await kit.get('analyze_data')!.execute({ source: { type: 'file', id: f.id }, operations: [{ op: 'regression', y: 'y', x: ['x'] }] }, ctx);
  assert.ok(!r.isError, r.text);
  assert.match(r.text, /analysisId: [0-9a-f-]{36}/);
  assert.match(r.text, /0\.50/);
  assert.match(r.text, /not causation/);
  const bad = await kit.get('analyze_data')!.execute({ source: { type: 'file', id: f.id }, operations: [{ op: 'describe', columns: ['nope'] }] }, ctx);
  assert.ok(bad.isError && /nope/.test(bad.text));
  const c = await kit.get('create_output')!.execute({ spec: { kind: 'diagram', title: 'Flow', sources: [], mermaid: 'graph LR\nA-->B' } }, ctx);
  assert.ok(!c.isError, c.text);
  assert.equal(c.attachments?.length, 1);
});
