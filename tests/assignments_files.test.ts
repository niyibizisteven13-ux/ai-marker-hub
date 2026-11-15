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
