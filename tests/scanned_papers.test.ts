import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { groupScanPages, scanPaper } from '../src/services/scannedPapers.ts';

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
