// The accuracy kit: phone-photo conditions, exact pooled error rates, per-tag/language breakdowns, and what the cleanup is worth.
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CONDITIONS, cleanupGain, degrade, formatReport, runCases, summarize, writeEvalCase, type EvalCase } from '../server/services/documents/evalKit.js';
import { processDocument } from '../server/services/documents/pipeline.js';
import type { ProviderAdapter } from '../server/services/ai/providers/types.js';

const TRUTH = 'The demand curve shifts right when income rises';
function page() {
  const c = createCanvas(900, 600); const g = c.getContext('2d');
  g.fillStyle = '#f4f2ea'; g.fillRect(0, 0, 900, 600); g.fillStyle = '#222'; g.font = '30px sans-serif';
  for (let i = 0; i < 6; i++) g.fillText(`${TRUTH} ${i}`, 50, 90 + i * 70);
  return c.toBuffer('image/png');
}
const cases = async (): Promise<EvalCase[]> => [
  { name: 'a.png', image: page(), truth: TRUTH, tags: ['pencil', 'maths'], language: 'en' },
  { name: 'b.png', image: page(), truth: 'Ubwo ndi hano', tags: ['pencil'], language: 'rw' },
];

test('every condition changes the picture (clean does not) and is repeatable', async () => {
  const src = page();
  assert.equal(await degrade(src, 'clean'), src);
  const seen = new Set<string>();
  for (const c of CONDITIONS.filter((x) => x !== 'clean')) {
    const a = await degrade(src, c), b = await degrade(src, c);
    assert.ok(a.equals(b), `${c} is deterministic`);
    assert.ok(!a.equals(src), `${c} changes the page`);
    seen.add(a.toString('base64').slice(0, 200));
  }
  assert.equal(seen.size, CONDITIONS.length - 1, 'each condition is its own picture');
  const desk = await sharp(await degrade(src, 'desk_shadow')).metadata();
  assert.ok((desk.width ?? 0) > 900 && (desk.height ?? 0) > 600, 'a desk around the sheet');
});

test('error rates are pooled exactly (edits over reference length), not averaged', () => {
  // Page 1: 5 of 10 characters wrong (50%). Page 2: 5 of 100 (5%). Pooled 10/110 = 9.1%; an average of the two rates would say 27.5%.
  const row = (name: string, e: number, r: number) => ({ name, condition: 'clean' as const, cleanup: true, tags: [], language: 'x', charEdits: e, charRef: r, wordEdits: 1, wordRef: 2, cer: e / r, wer: 0.5 });
  const pooled = summarize([row('s', 5, 10), row('l', 5, 100)], () => 'all')[0];
  assert.ok(Math.abs(pooled.cer! - 10 / 110) < 1e-9, String(pooled.cer));
  assert.equal(pooled.pages, 2);
});

test('a failed reading counts as everything wrong, never as a pass', async () => {
  const rows = await runCases(await cases(), async () => { throw new Error('model unavailable'); });
  assert.ok(rows.every((r) => r.cer === 1 && r.error));
  assert.match(formatReport(rows), /failed and count as fully wrong: model unavailable/);
});

test('with a reader that only copes when the page is cleaned, the report shows what the cleanup is worth', async () => {
  const rows = [];
  for (const c of await cases()) {
    // Stand-in for a model: perfect on a clean page; on a degraded picture it reads the page only when the cleanup was on.
    const reader = async (img: Buffer, { cleanup }: { cleanup: boolean }) => (img.equals(c.image) || cleanup ? c.truth : '');
    rows.push(...await runCases([c], reader, { conditions: ['clean', 'desk_shadow', 'dim'], modes: [false, true] }));
  }
  // A clean page is read once (nothing to clean); each degraded condition is read both ways.
  assert.equal(rows.filter((r) => r.condition === 'clean').length, 2);
  assert.equal(rows.filter((r) => r.condition === 'desk_shadow').length, 4);
  const gain = cleanupGain(rows).find((g) => g.condition === 'desk_shadow')!;
  assert.equal(gain.asIs, 1); assert.equal(gain.cleaned, 0); assert.equal(gain.gain, 1);
  const text = formatReport(rows);
  assert.match(text, /What the cleanup is worth/); assert.match(text, /desk_shadow\s+as is\s+100\.0%\s+cleaned\s+0\.0%/); assert.match(text, /better/);
});

test('the report breaks results down by condition, tag and language', async () => {
  const cs = await cases();
  const rows = await runCases(cs, async (_i, _m) => TRUTH);   // right for page a, wrong for page b
  const text = formatReport(rows);
  assert.match(text, /By kind of writing/); assert.match(text, /pencil\s+2 readings/); assert.match(text, /maths\s+1 reading /);
  assert.match(text, /By language/); assert.match(text, /rw\s+1 reading/); assert.match(text, /en\s+1 reading/);
  const byLang = Object.fromEntries(summarize(rows, (r) => r.language).map((g) => [g.key, g.cer]));
  assert.equal(byLang.en, 0); assert.ok(byLang.rw! > 0.5);
});

test('the pipeline can switch the cleanup off, to measure it', async () => {
  const img = await sharp({ create: { width: 1300, height: 1000, channels: 3, background: '#2b2118' } })
    .composite([{ input: page(), left: 200, top: 200 }]).png().toBuffer();
  const adapter: ProviderAdapter = { name: 'fake', async *stream() {
    yield { type: 'text', text: JSON.stringify({ languages: ['en'], notes: [], readingOrder: ['e1'], elements: [{ id: 'e1', type: 'paragraph', text: 'x', latex: null, table: null, region: { x0: 50, y0: 50, x1: 950, y1: 120 }, legibility: 'clear', uncertainSpans: [], crossedOut: false, handwritten: true, language: 'en' }] }) };
    yield { type: 'usage', input: 1, output: 1 };
  } };
  const deps = { adapter, model: 'm', fallbackModel: null };
  const on = await processDocument(img, 'p.png', deps, { crossCheck: false, forceRecognition: true });
  const off = await processDocument(img, 'p.png', deps, { crossCheck: false, forceRecognition: true, cleanup: false });
  assert.ok(on && off, 'the pipeline ran');
  assert.ok(on!.pages[0].transforms.some((t) => /Cropped to the sheet/.test(t)));
  assert.ok(!off!.pages[0].transforms.some((t) => /Cropped|uneven lighting/.test(t)));
});

test('a corrected page becomes a new test case, and nothing is overwritten', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'evalcase-'));
  try {
    const base = await writeEvalCase(dir, 'Class 4B / page 1.png', page(), 'Ubwo ndi hano\n', { tags: ['pencil'], language: 'rw' });
    assert.equal(base, 'Class-4B-page-1');
    assert.deepEqual((await fs.readdir(dir)).sort(), ['Class-4B-page-1.jpg', 'Class-4B-page-1.json', 'Class-4B-page-1.txt']);
    assert.equal(await fs.readFile(path.join(dir, `${base}.txt`), 'utf8'), 'Ubwo ndi hano\n');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, `${base}.json`), 'utf8')), { tags: ['pencil'], language: 'rw' });
    await assert.rejects(writeEvalCase(dir, 'Class 4B / page 1', page(), 'x'), /already exists/);
    await assert.rejects(writeEvalCase(dir, 'empty', page(), '   '), /needs the correct text/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
