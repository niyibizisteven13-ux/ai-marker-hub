import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { FileStore } from '../server/services/ai/files/FileStore.js';
import { readAttachment } from '../server/services/ai/tools/dataTools.js';
import { analyzeDocument, splitDocument, viewPages } from '../server/services/ai/tools/documentTools.js';

// A 900-page book in chat: the whole book is read section by section for a task (page-cited notes),
// any page can be opened directly, and scanned pages beyond the first ones can be looked at.
// SYNTHETIC book; no real documents; the model is a local stand-in.

async function book(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 1; p <= pages; p++) {
    const page = doc.addPage([600, 800]);
    page.drawText(`Page ${p} heading`, { x: 40, y: 760, size: 14, font });
    for (let l = 0; l < 20; l++) page.drawText(`Line ${l} on page ${p} talks about ordinary matters of chapter ${Math.ceil(p / 30)}.`, { x: 40, y: 730 - l * 17, size: 10, font });
    if (p === 777) page.drawText('The secret ingredient is cassava flour.', { x: 40, y: 300, size: 10, font });
  }
  return Buffer.from(await doc.save());
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'long-docs-'));
const files = new FileStore({ dir: root, secret: 'test-secret-1234567890', maxFileBytes: 200 * 1024 * 1024 });
test.after(() => fs.rm(root, { recursive: true, force: true }));
const pdf = await book(900);
const meta = await files.put({ userId: 'u-900', name: 'big-book.pdf', mime: 'application/pdf', kind: 'pdf', data: pdf });

test('splitDocument keeps page boundaries and page numbers', () => {
  const text = Array.from({ length: 10 }, (_, i) => `text of page ${i + 1} `.repeat(20) + `\n-- ${i + 1} of 10 --`).join('\n');
  const parts = splitDocument(text, 1_200);
  assert.ok(parts.length > 1);
  assert.equal(parts[0].fromPage, 1);
  assert.equal(parts.at(-1)!.toPage, 10);
  for (let i = 1; i < parts.length; i++) assert.equal(parts[i].fromPage, parts[i - 1].toPage! + 1, 'no page skipped or repeated');
  assert.match(parts[0].text, /\[Page 1\]/);
  assert.equal(splitDocument('x'.repeat(2_500), 1_000).length, 3, 'text without page marks is cut by size');
});

test('analyze_document reads all 900 pages and finds what is on page 777', async () => {
  const seen: string[] = [];
  const llm = {
    async complete(req: { system: string; prompt: string }) {
      seen.push(req.prompt);
      if (/merge notes/i.test(req.system)) return req.prompt.split('Notes:\n')[1];
      const hit = /\[Page (\d+)\][^[]*cassava flour/.exec(req.prompt);
      return hit ? `The secret ingredient is cassava flour (p. ${hit[1]}).` : 'NOTHING RELEVANT';
    },
  };
  const out = await analyzeDocument.execute({ fileId: meta.id, task: 'What is the secret ingredient?' }, { userId: 'u-900', files, services: { llm } } as any);
  assert.ok(!out.isError, out.text);
  assert.match(out.text, /900 pages/);
  assert.match(out.text, /cassava flour \(p\. 777\)/);
  // Every page went to the model exactly once.
  const pagesSent = seen.flatMap((p) => [...p.matchAll(/\[Page (\d+)\]/g)].map((m) => Number(m[1])));
  assert.equal(pagesSent.length, 900);
  assert.equal(new Set(pagesSent).size, 900);
  assert.ok(seen.every((p) => p.length < 120_000), 'each request stays small');
  assert.ok(seen.every((p) => p.includes('untrusted data')), 'document text is marked as data');
});

test('analyze_document can be limited to a page range, and refuses another user\'s file', async () => {
  const seen: string[] = [];
  const llm = { async complete(req: { prompt: string }) { seen.push(req.prompt); return 'notes'; } };
  await analyzeDocument.execute({ fileId: meta.id, task: 'Summarise', fromPage: 100, toPage: 140 }, { userId: 'u-900', files, services: { llm } } as any);
  const pagesSent = seen.flatMap((p) => [...p.matchAll(/\[Page (\d+)\]/g)].map((m) => Number(m[1])));
  assert.ok(pagesSent.includes(100) && pagesSent.includes(140));
  assert.ok(pagesSent.length < 200, 'only the sections around the range');
  const other = await analyzeDocument.execute({ fileId: meta.id, task: 'Summarise' }, { userId: 'someone-else', files, services: { llm } } as any);
  assert.ok(other.isError);
  assert.match(other.text, /file not found/);
});

test('read_attachment opens a given page directly', async () => {
  const out = await readAttachment.execute({ fileId: meta.id, page: 777, maxChars: 3_000 }, { userId: 'u-900', files, services: {} } as any);
  assert.match(out.text, /^[\s\S]*Page 777 heading/);
  assert.doesNotMatch(out.text.slice(0, 400), /page 776/i);
  assert.match(out.text, /cassava flour/);
  const missing = await readAttachment.execute({ fileId: meta.id, page: 5000 }, { userId: 'u-900', files, services: {} } as any);
  assert.match(missing.text, /no page 5000/);
});

test('view_pages shows any page range as images (at most 20 per call)', async () => {
  const out = await viewPages.execute({ fileId: meta.id, fromPage: 450, toPage: 500 }, { userId: 'u-900', files, services: {} } as any);
  assert.ok(!out.isError, out.text);
  assert.equal(out.images?.length, 20);
  assert.equal(out.images![0].label, 'big-book.pdf, page 450');
  assert.match(out.text, /pages 450–469 of 900/);
  assert.match(out.text, /fromPage 470/);
  assert.equal(out.images![0].mime, 'image/jpeg');
});
