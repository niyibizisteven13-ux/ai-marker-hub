import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { imageQuality, precheckFile } from '../server/services/exams/precheck.js';

// SYNTHETIC images and PDFs: checks the Mark page summary, not real-photo accuracy.

async function sharpPage(): Promise<Buffer> {
  // Black text-like stripes on white: plenty of edges.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><rect width="100%" height="100%" fill="white"/>${Array.from({ length: 40 }, (_, i) => `<rect x="80" y="${60 + i * 36}" width="${600 + (i % 5) * 80}" height="6" fill="black"/>`).join('')}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

test('precheck: a sharp page passes, a blurred one, a dark one and a tiny one are flagged', async () => {
  const good = await sharpPage();
  assert.deepEqual(await imageQuality(good), []);
  assert.ok((await imageQuality(await sharp(good).blur(12).toBuffer())).includes('blurry'));
  assert.ok((await imageQuality(await sharp(good).linear(0.2, 0).toBuffer())).includes('dark'));
  assert.ok((await imageQuality(await sharp(good).resize(300).toBuffer())).includes('small'));
  assert.deepEqual(await imageQuality(Buffer.from('not an image')), ['unreadable']);
});

test('precheck: typed PDF pages, scanned pages and students in a ZIP', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const typed = doc.addPage([595, 842]);
  typed.drawText('Question 1. Solve x + 2 = 6 and show your working clearly on this page.', { x: 40, y: 780, size: 11, font });
  const png = await doc.embedPng(await sharpPage());
  doc.addPage([595, 842]).drawImage(png, { x: 0, y: 0, width: 595, height: 842 });
  const pdf = Buffer.from(await doc.save());
  const c = await precheckFile({ name: 'paper.pdf', mime: 'application/pdf', data: pdf });
  assert.equal(c.kind, 'pdf');
  assert.equal(c.pages, 2);
  assert.equal(c.typedPages, 1, 'the image-only page counts as a scan or handwriting');

  const zip = new JSZip();
  zip.file('Alice/p1.png', await sharpPage());
  zip.file('Alice/p2.png', await sharpPage());
  zip.file('Bob/p1.png', await sharp(await sharpPage()).blur(12).toBuffer());
  zip.file('__MACOSX/._junk', 'x');
  const z = await precheckFile({ name: 'class.zip', data: await zip.generateAsync({ type: 'nodebuffer' }) });
  assert.equal(z.students, 2, 'one student per folder');
  assert.equal(z.pages, 3);
  assert.ok(z.issues.some((i) => i.entry === 'Bob/p1.png' && i.issue === 'blurry'));
});

test('precheck: the text says which file is the scheme or the question paper, whatever its name', async () => {
  const scheme = await precheckFile({ name: 'Maths S4.txt', data: Buffer.from('MARKING SCHEME\n1. (3 marks) x = 4') });
  assert.equal(scheme.looksLike, 'scheme');
  const paper = await precheckFile({ name: 'S4 maths.txt', data: Buffer.from('Instructions to candidates: answer all questions. Time allowed: 2 hours') });
  assert.equal(paper.looksLike, 'paper');
  const script = await precheckFile({ name: 'alice.txt', data: Buffer.from(`${'x = 6 - 2 = 4. '.repeat(120)} I followed the marking scheme`) });
  assert.equal(script.looksLike, undefined, 'a late mention does not make a script a scheme');
});

test('camera scans: a ZIP with a folder per student is one script per student, also with a single student', async () => {
  const { expandArchives } = await import('../server/services/exams/inputs.js');
  const page = await sharpPage();
  for (const names of [['Uwase Aline'], ['Uwase Aline', 'Mugisha Eric']]) {
    const zip = new JSZip();
    for (const n of names) { zip.file(`scans/${n}/page-01.jpg`, page); zip.file(`scans/${n}/page-02.jpg`, page); }
    const data = await zip.generateAsync({ type: 'nodebuffer' });
    const check = await precheckFile({ name: 'Camera scans.zip', data });
    assert.equal(check.students, names.length);
    assert.equal(check.pages, names.length * 2);
    const scripts = await expandArchives([{ name: 'Camera scans.zip', buffer: data }]);
    assert.deepEqual(scripts.map((s) => s.name), names.map((n) => `${n}.pdf`), 'each student\'s two pages become one PDF');
  }
});

test('camera scans: the scanner\'s pages are packed one folder per student, in order, same names kept apart', async () => {
  const { scansToZip } = await import('../src/utils/scansToZip.js');
  const url = `data:image/jpeg;base64,${(await sharp(await sharpPage()).jpeg().toBuffer()).toString('base64')}`;
  const file = await scansToZip([
    { dataUrl: url, candidateId: 'c1', studentName: 'Aline' }, { dataUrl: url, candidateId: 'c1', studentName: 'Aline' },
    { dataUrl: url, candidateId: 'c2', studentName: 'Aline' }, { dataUrl: url, candidateId: 'c3', studentName: 'Eric/S4' },
  ]);
  const zip = await JSZip.loadAsync(Buffer.from(await file.arrayBuffer()));
  assert.deepEqual(Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort(), ['scans/Aline (2)/page-01.jpg', 'scans/Aline/page-01.jpg', 'scans/Aline/page-02.jpg', 'scans/Eric S4/page-01.jpg']);
  assert.equal((await precheckFile({ name: file.name, data: Buffer.from(await file.arrayBuffer()) })).students, 3);
});

test('quick capture: crops only when the page stands out from the desk, never cutting into a page that fills the photo', async () => {
  const { pageStandsOut } = await import('../src/components/DocumentScanner/imageProcessing.js');
  const w = 400, h = 600;
  const quad = { tl: { x: 60, y: 40 }, tr: { x: 340, y: 40 }, br: { x: 340, y: 560 }, bl: { x: 60, y: 560 } };
  // A white page on a dark desk: safe to crop.
  const onDesk = (x: number, y: number) => (x >= 60 && x <= 340 && y >= 40 && y <= 560 ? 235 : 70);
  assert.equal(pageStandsOut(onDesk, w, h, quad), true);
  // The page fills the photo; the "edges" found are lines of writing: keep the whole photo.
  const filling = (x: number, y: number) => (y % 40 < 3 ? 40 : 235);
  assert.equal(pageStandsOut(filling, w, h, quad), false);
  // A tiny detected region is never trusted.
  assert.equal(pageStandsOut(onDesk, w, h, { tl: { x: 190, y: 290 }, tr: { x: 210, y: 290 }, br: { x: 210, y: 310 }, bl: { x: 190, y: 310 } }), false);
});
