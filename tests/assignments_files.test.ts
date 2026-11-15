import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { OwnedRecordStore } from '../server/services/storage/ownedRecordStore.js';
import { AssignmentError, createAssignmentService, type AssignmentFiles, type AssignmentRecord } from '../server/services/assignments/service.js';
import { extractText } from '../server/services/ai/files/extract.js';

// Students hand in whatever the work is: code, spreadsheets, slides, a whole folder (ZIP), a notebook, a video.
// Each becomes pages the marker can read; the original files stay as they are for the lecturer's viewer.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'handin-'));
const mem = new Map<string, { owner: string; name: string; mime: string; data: Buffer }>();
const files: AssignmentFiles = {
  async save(userId, name, mime, data) { const id = randomUUID(); mem.set(id, { owner: userId, name, mime, data }); return { id, name, mime, size: data.length }; },
  async read(userId, id) { const f = mem.get(id); if (!f || f.owner !== userId) throw new AssignmentError('NOT_FOUND', 'File not found.', 404); return f; },
};
const svc = createAssignmentService({ store: new OwnedRecordStore<AssignmentRecord>(path.join(dir, 'r')), files, tokenDir: path.join(dir, 'l'), baseUrl: () => 'https://x.test' });
test.after(() => fs.rm(dir, { recursive: true, force: true }));
const tokenOf = (l: string) => l.split('/a/')[1];
const photo = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#fafafa' } }).jpeg().toBuffer();
const pdfText = async (buf: Buffer) => (await extractText({ name: 'x.pdf', mime: 'application/pdf', data: buf })).text ?? '';
const pages = async (buf: Buffer) => (await PDFDocument.load(buf)).getPageCount();

const PY = 'def fib(n):\n    return n if n < 2 else fib(n - 1) + fib(n - 2)\n\nprint(fib(10))\n';
const xlsx = async () => { const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Budget'); ws.addRow(['Item', 'Cost']); ws.addRow(['Books', 12000]); return Buffer.from(await wb.xlsx.writeBuffer()); };
const pptx = async () => { const z = new JSZip(); z.file('ppt/slides/slide1.xml', '<p:sld><a:t>Photosynthesis overview</a:t></p:sld>'); z.file('[Content_Types].xml', '<Types/>'); return Buffer.from(await z.generateAsync({ type: 'nodebuffer' })); };
const folder = async () => {
  const z = new JSZip();
  z.file('project/main.py', PY); z.file('project/utils/helpers.js', 'export const double = (x) => x * 2;\n');
  z.file('project/README.md', '# Project\nRun main.py'); z.file('project/diagram.jpg', photo);
  z.file('project/node_modules/lib/index.js', 'SHOULD NOT APPEAR'); z.file('project/.git/config', 'SHOULD NOT APPEAR'); z.file('project/data.bin', Buffer.from([0, 1, 2, 3, 0, 255]));
  return Buffer.from(await z.generateAsync({ type: 'nodebuffer' }));
};

test('code, a spreadsheet, slides, a notebook and a folder are accepted and become readable pages', async () => {
  const a = await svc.create('t1', { title: 'Mixed project', instructions: 'Hand in your work in any form.' });
  const token = tokenOf(a.link);
  const nb = Buffer.from(JSON.stringify({ cells: [{ cell_type: 'markdown', source: ['# Analysis'] }, { cell_type: 'code', source: ['import math\n', 'print(math.pi)'] }] }));
  const r = await svc.submit(token, { studentName: 'Uwase', studentId: 'S1', files: [
    { name: 'fib.py', data: Buffer.from(PY) }, { name: 'budget.xlsx', data: await xlsx() }, { name: 'talk.pptx', data: await pptx() },
    { name: 'analysis.ipynb', data: nb }, { name: 'project.zip', data: await folder() }, { name: 'demo.mp4', data: Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(100)]) },
  ] });
  assert.equal(r.files, 6);
  const out = await svc.prepareMarking('t1', a.id);
  assert.equal(out.skipped.length, 0);
  const pdf = (await files.read('t1', out.scripts[0].id)).data;
  const text = await pdfText(pdf);
  assert.match(text, /fib\(n - 1\) \+ fib\(n - 2\)/, 'code is on the page');
  assert.match(text, /File: fib\.py/);
  assert.match(text, /Books/); assert.match(text, /12000/);
  assert.match(text, /Photosynthesis overview/);
  assert.match(text, /import math/); assert.match(text, /# \[text cell 1\]/);
  assert.match(text, /Folder: project\.zip/, 'a folder starts with its contents');
  assert.match(text, /project\/utils\/helpers\.js/);
  assert.match(text, /double = \(x\) => x \* 2/, 'files inside the folder are shown');
  assert.match(text, /Run main\.py/);
  assert.ok(!/SHOULD NOT APPEAR/.test(text), 'libraries and git data are left out');
  assert.match(text, /data\.bin/, 'binary files are named as not shown');
  assert.ok((await pages(pdf)) >= 8);
});

test('the lecturer can open every file as handed in (stored unchanged, with the right type)', async () => {
  const a = await svc.create('t1', { title: 'Viewer', instructions: 'x' });
  await svc.submit(tokenOf(a.link), { studentName: 'Keza', files: [{ name: 'App.java', data: Buffer.from('class App {}') }, { name: 'sheet.csv', data: Buffer.from('a,b\n1,2\n') }, { name: 'all.zip', data: await folder() }] });
  const dash = await svc.get('t1', a.id);
  const f = dash.submissions[0].files;
  assert.deepEqual(f.map((x) => x.mime), ['text/plain', 'text/csv', 'application/zip']);
  assert.equal((await svc.file('t1', a.id, f[2].id)).data.subarray(0, 2).toString(), 'PK');
});

test('wrong or unsafe files are refused: a program, a fake ZIP, a binary posing as code, an empty folder, too many files', async () => {
  const a = await svc.create('t1', { title: 'Safety', instructions: 'x' });
  const token = tokenOf(a.link);
  await assert.rejects(svc.submit(token, { studentName: 'A', files: [{ name: 'run.exe', data: Buffer.from('MZ') }] }), /photos, PDF, Word/);
  await assert.rejects(svc.submit(token, { studentName: 'A', files: [{ name: 'fake.zip', data: Buffer.from('this is not a zip') }] }), /does not match/);
  await assert.rejects(svc.submit(token, { studentName: 'A', files: [{ name: 'evil.py', data: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0]) }] }), /does not match/);
  await assert.rejects(svc.submit(token, { studentName: 'A', files: [{ name: 'fake.mp4', data: Buffer.from('not a video at all') }] }), /does not match/);
  // An empty folder is accepted as a hand-in but cannot be marked: the lecturer is told why.
  const empty = Buffer.from(await new JSZip().file('only/.DS_Store', 'x').generateAsync({ type: 'nodebuffer' }));
  await svc.submit(token, { studentName: 'Empty', files: [{ name: 'empty.zip', data: empty }] });
  const out = await svc.prepareMarking('t1', a.id).catch((e) => e);
  assert.ok(out instanceof AssignmentError || out.skipped?.length, 'nothing to mark');
  const skipped = out.skipped ?? [];
  assert.match(String(skipped[0]?.reason ?? out.message), /no files|None of the submissions/);
});

test('a folder with a huge claimed size or too many files is refused with a clear reason', async () => {
  const { folderToPdf } = await import('../server/services/assignments/handIn.js');
  const many = new JSZip(); for (let i = 0; i < 320; i++) many.file(`f${i}.txt`, 'x');
  await assert.rejects(folderToPdf('many.zip', Buffer.from(await many.generateAsync({ type: 'nodebuffer' }))), /limit is 300/);
  await assert.rejects(folderToPdf('broken.zip', Buffer.from('PK\u0003\u0004 nope')), /could not be opened/);
});

test('a video or recording alone is kept but is not turned into pages', async () => {
  const a = await svc.create('t1', { title: 'Video only', instructions: 'x' });
  await svc.submit(tokenOf(a.link), { studentName: 'V', files: [{ name: 'demo.mov', data: Buffer.concat([Buffer.alloc(4), Buffer.from('ftypqt  '), Buffer.alloc(50)]) }] });
  const out = await svc.prepareMarking('t1', a.id).catch((e) => e);
  assert.match(String(out.message ?? out.skipped?.[0]?.reason), /voice recording or video|None of the submissions/);
});

// ── Code tests on a task ─────────────────────────────────────────────────────────────
import { localUnsafeRunner } from '../server/services/codeRunner/local.js';
const codeSvc = createAssignmentService({ store: new OwnedRecordStore<AssignmentRecord>(path.join(dir, 'rc')), files, tokenDir: path.join(dir, 'lc'), baseUrl: () => 'https://x.test', codeRunner: async () => ({ runner: localUnsafeRunner, reason: 'test' }) });
const noRunnerSvc = createAssignmentService({ store: new OwnedRecordStore<AssignmentRecord>(path.join(dir, 'rn')), files, tokenDir: path.join(dir, 'ln'), baseUrl: () => 'https://x.test', codeRunner: async () => ({ runner: null, reason: 'Code testing needs Docker on the server.' }) });
const waitFor = async (fn: () => Promise<boolean>, ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error('timed out waiting'); };
const tests = { language: 'python', showStudents: 'full', tests: [{ name: 'sum', input: '2 3', expected: '5', points: 4 }, { name: 'hidden', input: '10 20', expected: '30', points: 6, hidden: true }] };

test('a task with code tests: the program is run when handed in, marked by the tests, and shown to the lecturer and the student', async () => {
  await assert.rejects(codeSvc.create('t1', { title: 'Bad', instructions: 'x', codeTests: { language: 'python', tests: [] } }), /at least one test/);
  const a = await codeSvc.create('t1', { title: 'Sum two numbers', instructions: 'Read two numbers and print their sum.', codeTests: tests });
  const token = tokenOf(a.link);
  const pub = await codeSvc.publicView(token);
  assert.deepEqual([pub.codeLanguage, pub.codeMain], ['Python', 'main.py']);
  assert.ok(!JSON.stringify(pub).includes('"expected"'), 'the tests are not sent to students');
  const good = await codeSvc.submit(token, { studentName: 'Uwase', studentId: 'S1', files: [{ name: 'main.py', data: Buffer.from('a, b = map(int, input().split())\nprint(a + b)\n') }] });
  assert.equal(good.codeTests, true);
  await codeSvc.submit(token, { studentName: 'Eric', studentId: 'S2', files: [{ name: 'main.py', data: Buffer.from('a, b = map(int, input().split())\nprint(a * b)\n') }] });
  // Typed code counts too (no file was sent).
  await codeSvc.submit(token, { studentName: 'Keza', studentId: 'S3', text: 'a, b = map(int, input().split())\nprint(a + b)\n' });
  // A whole folder.
  const z = new JSZip(); z.file('proj/main.py', 'from util import add\na, b = map(int, input().split())\nprint(add(a, b))\n'); z.file('proj/util.py', 'def add(a, b):\n    return a + b\n');
  await codeSvc.submit(token, { studentName: 'Divine', studentId: 'S4', files: [{ name: 'proj.zip', data: Buffer.from(await z.generateAsync({ type: 'nodebuffer' })) }] });
  await waitFor(async () => (await codeSvc.get('t1', a.id)).submissions.every((s: any) => s.marking?.state === 'marked'));
  const dash = await codeSvc.get('t1', a.id);
  const by: any = Object.fromEntries(dash.submissions.map((s: any) => [s.studentId, s]));
  assert.deepEqual([by.S1.marking.total, by.S1.marking.maxTotal, by.S1.marking.percent], [10, 10, 100]);
  assert.deepEqual([by.S2.marking.total, by.S2.marking.percent], [0, 0]);
  assert.equal(by.S3.marking.percent, 100, 'typed code');
  assert.equal(by.S4.marking.percent, 100, 'a folder with two files');
  assert.equal(by.S1.codeResult.tests.length, 2);
  assert.equal(by.S2.codeResult.tests[0].got, '6', 'the lecturer sees what the program printed');
  // What the student sees: their own result, the hidden test without its answer.
  const result: any = await codeSvc.publicResult(token, (await (codeSvc as any).get('t1', a.id)).submissions.find((s: any) => s.studentId === 'S2').resultLink.split('/result/')[1]);
  assert.equal(result.state, 'code');
  assert.deepEqual([result.code.passed, result.code.total], [0, 2]);
  assert.equal(result.code.tests[1].expected, undefined, 'a hidden test keeps its answer back');
  assert.equal(result.code.tests[0].expected, '5');
});

test('code tests can be changed and run again by the lecturer; without a runner the reason is clear; students may be shown nothing', async () => {
  const a = await codeSvc.create('t1', { title: 'Rerun', instructions: 'x', codeTests: { ...tests, showStudents: 'none' } });
  const token = tokenOf(a.link);
  await codeSvc.submit(token, { studentName: 'A', studentId: 'R1', files: [{ name: 'main.py', data: Buffer.from('print(5)\n') }] });
  await waitFor(async () => (await codeSvc.get('t1', a.id)).submissions[0].marking?.state === 'marked');
  const one: any = (await codeSvc.get('t1', a.id)).submissions[0];
  const res: any = await codeSvc.publicResult(token, one.resultLink.split('/result/')[1]);
  assert.deepEqual(res.code, { hidden: true });
  // The lecturer fixes a wrong expected output, and runs the tests again.
  await codeSvc.update('t1', a.id, { codeTests: { language: 'python', tests: [{ input: '', expected: '5', points: 3 }] } });
  assert.deepEqual(await codeSvc.runTests('t1', a.id), { started: 1 });
  await waitFor(async () => (await codeSvc.get('t1', a.id)).submissions[0].marking?.maxTotal === 3);
  assert.equal((await codeSvc.get('t1', a.id)).submissions[0].marking?.percent, 100);
  await codeSvc.update('t1', a.id, { codeTests: null });
  await assert.rejects(codeSvc.runTests('t1', a.id), /no code tests/i);
  assert.equal((await codeSvc.codeStatus()).available, true);

  const b = await noRunnerSvc.create('t1', { title: 'No runner', instructions: 'x', codeTests: tests });
  await noRunnerSvc.submit(tokenOf(b.link), { studentName: 'A', studentId: 'N1', files: [{ name: 'main.py', data: Buffer.from('print(5)\n') }] });
  await waitFor(async () => !!(await noRunnerSvc.get('t1', b.id)).submissions[0].marking);
  const m: any = (await noRunnerSvc.get('t1', b.id)).submissions[0].marking;
  assert.equal(m.state, 'failed'); assert.match(m.error, /needs Docker/);
  await assert.rejects(noRunnerSvc.runTests('t1', b.id), (e: any) => e.status === 503 && /Docker/.test(e.message));
  assert.equal((await noRunnerSvc.codeStatus()).available, false);
});
