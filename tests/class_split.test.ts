import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { ProviderAdapter } from '../server/services/ai/providers/types.js';
import { cutPdf, pagesPerStudentFrom, splitClassPdf } from '../server/services/exams/classSplit.js';

// A class file: students of different lengths, each script starting with "Name: …" at the top.
const STUDENTS = [['Name: Uwase Aline', 'answers'], ['Name: Mugisha Eric', 'more', 'more'], ['Name: Keza Divine']];
async function classPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const pages of STUDENTS) for (const t of pages) doc.addPage([300, 420]).drawText(t, { x: 20, y: 380, size: 16, font });
  return Buffer.from(await doc.save());
}

test('"N pages per student" is understood in English phrasing; nonsense is ignored', () => {
  assert.equal(pagesPerStudentFrom('Mark these, 4 pages per student'), 4);
  assert.equal(pagesPerStudentFrom('each student has 3 pages'), 3);
  assert.equal(pagesPerStudentFrom('2 pages each'), 2);
  assert.equal(pagesPerStudentFrom('mark the 300 pages'), undefined);
  assert.equal(pagesPerStudentFrom('0 pages per student'), undefined);
});

test('cut every N pages, or where the AI sees a new student start (8 pages per AI call)', async () => {
  const pdf = await classPdf();
  const fixed = await splitClassPdf(pdf, 'Class S3.pdf', { pagesPerStudent: 2 });
  assert.deepEqual(fixed.map((p) => p.pages), [2, 2, 2]);
  assert.equal(fixed[0].name, 'student 1 - Class S3.pdf');

  let calls = 0;
  const ai: ProviderAdapter = {
    name: 'fake',
    async *stream(req) {
      calls++;
      const prompt = JSON.stringify(req.messages);
      const first = Number(/pages (\d+) to/.exec(prompt)![1]);
      const n = (req.messages[1].content as any[]).filter((c) => c.type === 'image_url').length;
      // Pages 1, 3 and 6 start a student (as in STUDENTS).
      const names: Record<number, string> = { 1: 'Uwase Aline', 3: 'Mugisha Eric', 6: 'Keza Divine' };
      const pages = Array.from({ length: n }, (_, i) => ({ page: first + i, startsNewStudent: !!names[first + i], name: names[first + i] ?? null }));
      yield { type: 'text', text: JSON.stringify({ pages }) };
      yield { type: 'usage', input: 10, output: 5 };
    },
  };
  const found = await splitClassPdf(pdf, 'Class S3.pdf', { ai: { adapter: ai, model: 'fake' } });
  assert.deepEqual(found.map((p) => [p.firstPage, p.pages, p.writtenName]), [[1, 2, 'Uwase Aline'], [3, 3, 'Mugisha Eric'], [6, 1, 'Keza Divine']]);
  assert.equal(calls, 1, 'six pages fit in one call');
  const reopened = await PDFDocument.load(found[1].buffer);
  assert.equal(reopened.getPageCount(), 3);

  await assert.rejects(splitClassPdf(pdf, 'x.pdf', {}), /how many pages each student has/);
  const again = await cutPdf(pdf, [4, 1, 4, 99], 'x');
  assert.deepEqual(again.map((p) => p.pages), [3, 3], 'starts are sorted, de-duplicated and kept inside the file');
});
