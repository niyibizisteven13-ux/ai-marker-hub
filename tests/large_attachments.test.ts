import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { isBase64 } from '../server/utils/base64.js';
import { FileStore } from '../server/services/ai/files/FileStore.js';
import { readAttachment } from '../server/services/ai/tools/dataTools.js';
import { ingestUploads } from '../server/services/ai/ingest.js';

// Books and other long files in chat: no crash on large uploads, the model sees the start of the file and
// can jump to a chapter, and the stored file id is reported so later messages can refer back to it.
// SYNTHETIC book; no real documents.

async function book(chapters: number, pagesPerChapter: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let c = 1; c <= chapters; c++) {
    for (let p = 1; p <= pagesPerChapter; p++) {
      const page = doc.addPage([600, 800]);
      if (p === 1) page.drawText(`Chapter ${c}: Topic ${c}`, { x: 40, y: 760, size: 16, font });
      for (let l = 0; l < 40; l++) page.drawText(`Section ${c}.${p} explains idea ${l} of chapter ${c} in detail.`, { x: 40, y: 730 - l * 17, size: 10, font });
    }
  }
  return Buffer.from(await doc.save());
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'large-att-'));
const files = new FileStore({ dir: root, secret: 'test-secret-1234567890' });
const ctx = { userId: 'u-book', files, services: {} } as any;
test.after(() => fs.rm(root, { recursive: true, force: true }));

test('base64 check handles a 16 MB attachment without overflowing the regex stack', () => {
  const big = 'QUJD'.repeat(4_000_000);
  assert.equal(isBase64(big), true);
  assert.equal(isBase64(`${big}=`), false, 'length must be a multiple of 4');
  assert.equal(isBase64('QUJ$'), false);
  assert.equal(isBase64('QQ=='), true);
  assert.equal(isBase64(42), false);
});

test('a long PDF: the start goes to the model with the stored id, and read_attachment jumps to a chapter', async () => {
  const pdf = await book(8, 6);
  const r = await ingestUploads('Teach me chapter 5', [{ type: 'document', base64: pdf.toString('base64'), mediaType: 'application/pdf', name: 'Book.pdf' }], ctx, { vision: true });
  assert.equal(r.stored.length, 1);
  assert.equal(r.stored[0].name, 'Book.pdf');
  const text = (r.parts[0] as any).text as string;
  assert.ok(text.length < 32_000, 'only the start of the book is placed in the prompt');
  assert.match(text, new RegExp(`call read_attachment with fileId ${r.stored[0].fileId} and page, find`));
  assert.match(text, new RegExp(`call analyze_document with fileId ${r.stored[0].fileId}`), 'whole-book questions are pointed at analyze_document');

  const out = await readAttachment.execute({ fileId: r.stored[0].fileId, find: 'Chapter 5', maxChars: 3000 }, ctx);
  assert.match(out.text, /Chapter 5: Topic 5/);
  assert.doesNotMatch(out.text, /Chapter 4: Topic 4/, 'reading starts at chapter 5');
  const next = Number(/call read_attachment with offset (\d+)/.exec(out.text)?.[1]);
  assert.ok(next > 0, 'the reply says where to continue');
  const cont = await readAttachment.execute({ fileId: r.stored[0].fileId, offset: next, maxChars: 3000 }, ctx);
  assert.match(cont.text, /Section 5\.\d/);

  const missing = await readAttachment.execute({ fileId: r.stored[0].fileId, find: 'Chapter 99' }, ctx);
  assert.match(missing.text, /was not found/);
});

test('read_attachment never opens another user\'s file', async () => {
  const meta = await files.put({ userId: 'someone-else', name: 'private.txt', mime: 'text/plain', kind: 'text', data: Buffer.from('secret notes') });
  const out = await readAttachment.execute({ fileId: meta.id, find: 'secret' }, ctx);
  assert.doesNotMatch(out.text ?? '', /secret notes/);
});
