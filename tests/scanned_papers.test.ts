import { setAccessToken } from '../src/utils/authFetch.ts';
import { DEFAULT_MARKING_LIMITS } from '../shared/markingLimits.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { groupScanPages, scanPaper, registerScannedPapers } from '../src/services/scannedPapers.ts';

test('scanner identity preserves page order and separates students with the same name', () => {
  const pages = [
    { id: 'a1', candidateId: 'a', studentName: 'Alex', dataUrl: '', filter: 'color' as const },
    { id: 'b1', candidateId: 'b', studentName: 'Alex', dataUrl: '', filter: 'color' as const },
    { id: 'a2', candidateId: 'a', studentName: 'Alex', dataUrl: '', filter: 'color' as const },
  ];
  const groups = groupScanPages(pages);
  assert.equal(groups.size, 2);
  assert.deepEqual(groups.get('a')?.map(p => p.id), ['a1', 'a2']);
});

test('high-resolution JPEGs become one ordered paper with bounded page dimensions', async () => {
  const portrait = await sharp({ create: { width: 1200, height: 1800, channels: 3, background: 'white' } }).jpeg().toBuffer();
  const landscape = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: 'white' } }).jpeg().toBuffer();
  const blob = await scanPaper([portrait, landscape].map((b, i) => ({ id: String(i), dataUrl: `data:image/jpeg;base64,${b.toString('base64')}`, filter: 'color' })));
  const pdf = await PDFDocument.load(await blob.arrayBuffer());
  assert.equal(pdf.getPageCount(), 2);
  assert.ok(pdf.getPage(0).getHeight() > pdf.getPage(0).getWidth());
  assert.ok(pdf.getPage(1).getWidth() > pdf.getPage(1).getHeight());
  assert.ok(pdf.getPages().every(p => Math.max(p.getWidth(), p.getHeight()) <= 843));
  await assert.rejects(() => scanPaper([]), /at least one/);
});


test('marking PDF uses the high-resolution source rather than a compressed preview', async () => {
  const original = await sharp({ create: { width: 1400, height: 2100, channels: 3, background: 'white' } }).jpeg().toBuffer();
  const blob = await scanPaper([{ id: 'source', filter: 'color', dataUrl: 'invalid-preview', sourceDataUrl: `data:image/jpeg;base64,${original.toString('base64')}` }]);
  assert.equal((await PDFDocument.load(await blob.arrayBuffer())).getPageCount(), 1);
});


test('scanner registration completes grouped upload before returning and propagates failures', async () => {
  const originalFetch = globalThis.fetch;
  setAccessToken('scan-upload-test');
  const jpeg = await sharp({ create: { width: 800, height: 1100, channels: 3, background: 'white' } }).jpeg().toBuffer();
  const pages = [1, 2].map(i => ({ id: String(i), candidateId: 'same-student', studentName: 'Alex', dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`, filter: 'color' as const }));
  let uploaded = false, reject = false;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/limits')) return Response.json(DEFAULT_MARKING_LIMITS);
    if (String(url).endsWith('/api/exams')) return Response.json({ examId: 'saved-exam' });
    const form = init!.body as FormData;
    assert.equal(form.getAll('scripts').length, 1, 'two pages remain one student');
    uploaded = true;
    return Response.json(reject ? { error: 'Connection interrupted' } : { accepted: [{ id: 'saved-paper' }], rejected: [] }, { status: reject ? 503 : 201 });
  };
  try {
    const saved = await registerScannedPapers(pages);
    assert.equal(uploaded, true);
    assert.equal(saved.firstSubmissionId, 'saved-paper');
    reject = true;
    await assert.rejects(() => registerScannedPapers(pages), /Connection interrupted/);
  } finally { globalThis.fetch = originalFetch; setAccessToken(null); }
});
