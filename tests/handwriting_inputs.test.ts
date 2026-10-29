import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { FileStore } from '../server/services/ai/files/FileStore.js';
import { ingestUploads } from '../server/services/ai/ingest.js';

// Handwriting wherever it is: pages of a typed PDF without typed text, photos inside Word files, and photo
// formats other than JPEG/PNG all reach the vision model as images. SYNTHETIC files.

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'handwriting-'));
const files = new FileStore({ dir: root, secret: 'test-secret-1234567890' });
const ctx = { userId: 'u-hw', files, services: {} } as any;
test.after(() => fs.rm(root, { recursive: true, force: true }));
const images = (r: any) => r.parts.filter((p: any) => p.type === 'image_url');
const photo = (w = 400, h = 300) => sharp({ create: { width: w, height: h, channels: 3, background: '#f4f1e8' } })
  .composite([{ input: Buffer.from(`<svg width="${w}" height="${h}"><path d="M20 150 C80 60 140 240 200 150 S320 60 380 150" stroke="#123" stroke-width="6" fill="none"/></svg>`) }]);

test('a typed PDF with a handwritten page: that page is shown to the model as an image', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText('Question 1: Explain photosynthesis in your own words.', { x: 50, y: 760, size: 12, font });
  const scan = await doc.embedPng(await photo(595, 842).png().toBuffer());
  doc.addPage([595, 842]).drawImage(scan, { x: 0, y: 0, width: 595, height: 842 });
  doc.addPage([595, 842]).drawText('Question 2: Name two parts of a cell.', { x: 50, y: 760, size: 12, font });
  const r = await ingestUploads('Read my answers', [{ type: 'document', base64: Buffer.from(await doc.save()).toString('base64'), mediaType: 'application/pdf', name: 'answers.pdf' }], ctx, { vision: true });
  assert.equal(images(r).length, 1, 'only the untyped page');
  const text = (r.parts[0] as any).text as string;
  assert.match(text, /Question 1: Explain photosynthesis/);
  assert.match(text, /Pages 2 of this PDF have no typed text \(handwriting, a scan or a drawing\)/);
  const none = await ingestUploads('x', [{ type: 'document', base64: Buffer.from(await doc.save()).toString('base64'), mediaType: 'application/pdf', name: 'a.pdf' }], ctx, { vision: false });
  assert.equal(images(none).length, 0, 'a model that cannot see gets no images');
});

test('a Word file with a photo of handwriting: the photo is shown to the model', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>My homework photo is below.</w:t></w:r></w:p></w:body></w:document>');
  zip.file('word/media/image1.png', await photo().png().toBuffer());
  zip.file('word/media/icon.png', await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } }).png().toBuffer());
  const docx = await zip.generateAsync({ type: 'nodebuffer' });
  const r = await ingestUploads('Mark this', [{ type: 'document', base64: docx.toString('base64'), mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', name: 'homework.docx' }], ctx, { vision: true });
  assert.equal(images(r).length, 1, 'the photo, not the tiny icon');
  assert.match((r.parts[0] as any).text, /My homework photo is below/);
  assert.match((r.parts[0] as any).text, /This file contains 2 pictures; 1 of them is attached below as images/);
});

test('a TIFF or BMP photo is converted and shown', async () => {
  const tiff = await photo().tiff().toBuffer();
  const r = await ingestUploads('What does it say?', [{ type: 'image', base64: tiff.toString('base64'), mediaType: 'image/tiff', name: 'note.tiff' }], ctx, { vision: true });
  assert.equal(images(r).length, 1);
  assert.match(images(r)[0].image_url.url, /^data:image\/jpeg;base64,/);
  assert.deepEqual(r.warnings, []);
});
