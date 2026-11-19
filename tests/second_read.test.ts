// Reading handwritten pages twice: a second, independent look at pages too small for close-ups; any difference is flagged.
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createCanvas } from '@napi-rs/canvas';
import { processDocument, wantSecondRead } from '../server/services/documents/pipeline.js';
import { planBands } from '../server/services/documents/tiling.js';
import type { ProviderAdapter, ProviderRequest } from '../server/services/ai/providers/types.js';

function page() {
  const c = createCanvas(900, 600); const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 600); g.fillStyle = '#222'; g.font = '30px sans-serif';
  for (let i = 0; i < 6; i++) g.fillText(`The demand curve shifts right ${i}`, 50, 90 + i * 70);
  return c.toBuffer('image/png');
}
const el = (text: string, region: { x0: number; y0: number; x1: number; y1: number }, handwritten = true) => ({
  id: 'e1', type: 'paragraph' as const, text, latex: null, table: null, region, legibility: 'clear' as const, uncertainSpans: [], crossedOut: false, handwritten, language: 'en',
});
/** A model that reads the whole page as `full` and, when shown a close-up band, as `band`. */
function fake(full: string, band: string, handwritten = true) {
  const calls: string[] = [];
  const adapter: ProviderAdapter = {
    name: 'fake',
    async *stream(req: ProviderRequest) {
      const isBand = JSON.stringify(req.messages).includes('close-up tile');
      calls.push(isBand ? 'band' : 'full');
      const out = isBand
        ? { languages: ['en'], notes: [], readingOrder: ['e1'], elements: [el(band, { x0: 50, y0: 90, x1: 950, y1: 200 }, handwritten)] }   // tile coordinates (band 1 is the top 55% of the page)
        : { languages: ['en'], notes: [], readingOrder: ['e1'], elements: [el(full, { x0: 40, y0: 40, x1: 960, y1: 120 }, handwritten)] };
      yield { type: 'text', text: JSON.stringify(out) };
      yield { type: 'usage', input: 100, output: 20 };
    },
  };
  return { adapter, calls };
}
const run = (f: ReturnType<typeof fake>, opts: Parameters<typeof processDocument>[3] = {}) =>
  processDocument(page(), 'p.png', { adapter: f.adapter, model: 'm', fallbackModel: null }, { crossCheck: false, forceRecognition: true, ...opts });

test('bands cover the whole page with a small overlap, and their cores tile it exactly', () => {
  const b = planBands(900, 1000, 2);
  assert.equal(b.length, 2);
  assert.deepEqual(b.map((t) => [t.core.y0, t.core.y1]), [[0, 500], [500, 1000]]);
  assert.ok(b[0].y === 0 && b[1].y + b[1].height === 1000, 'first starts at the top, last ends at the bottom');
  assert.ok(b[0].y + b[0].height > b[1].y, 'the bands overlap, so a line on the seam is whole in one of them');
  assert.ok(b.every((t) => t.x === 0 && t.width === 900));
  assert.equal(planBands(900, 1000, 9).length, 4, 'at most four bands');
});

test('who gets a second reading: handwriting in auto, everything in always, nothing when off or empty', () => {
  const hand = { elements: [{ handwritten: true }] }, typed = { elements: [{ handwritten: false }] };
  assert.equal(wantSecondRead('off', hand), false);
  assert.equal(wantSecondRead('auto', hand), true);
  assert.equal(wantSecondRead('auto', typed), false);
  assert.equal(wantSecondRead('always', typed), true);
  assert.equal(wantSecondRead('always', { elements: [] }), false);
});

test('off by default: one reading, exactly as before', async () => {
  const f = fake('The demand curve shifts right', 'The demand curve shifts right');
  const r = await run(f);
  assert.deepEqual(f.calls, ['full']);
  assert.equal(r.pages[0].secondRead, undefined);
});

test('two readings that agree: the answer stays, nothing is flagged, and the limitation says it was read twice', async () => {
  const f = fake('The demand curve shifts right', 'The demand curve shifts right');
  const r = await run(f, { secondRead: 'auto' });
  assert.deepEqual(f.calls, ['full', 'band', 'band']);
  assert.equal(r.pages[0].secondRead, true);
  const e = r.pages[0].elements[0];
  assert.equal(e.text, 'The demand curve shifts right');
  assert.ok(!e.signals.some((s) => s.source === 'tile_disagreement'));
  assert.equal(e.needsReview, false);
  assert.ok(r.limitations.some((l) => /read twice/.test(l)));
});

test('two readings that differ: flagged for review, with both readings kept', async () => {
  const f = fake('The demand curve shifts right', 'The demand curve shifts left');
  const r = await run(f, { secondRead: 'auto' });
  const e = r.pages[0].elements[0];
  assert.ok(e.signals.some((s) => s.source === 'tile_disagreement' && s.severity === 'high'));
  assert.equal(e.needsReview, true);
  assert.equal(r.needsReview, true);
  const texts = [e.text, ...((e as any).alternateReadings ?? []).map((a: any) => a.text)];
  assert.ok(texts.some((t) => /right/.test(t)) && texts.some((t) => /left/.test(t)), `both readings kept: ${texts.join(' | ')}`);
});

test('auto leaves typed pages alone; always reads them too', async () => {
  const typed = fake('Printed text', 'Printed text', false);
  await run(typed, { secondRead: 'auto' });
  assert.deepEqual(typed.calls, ['full']);
  const all = fake('Printed text', 'Printed text', false);
  await run(all, { secondRead: 'always' });
  assert.deepEqual(all.calls, ['full', 'band', 'band']);
});

test('a page already read in close-ups is not read a third time', async () => {
  const big = await sharp({ create: { width: 3600, height: 2400, channels: 3, background: '#fff' } }).composite([{ input: page(), left: 100, top: 100 }]).png().toBuffer();
  const f = fake('The demand curve shifts right', 'The demand curve shifts right');
  const r = await processDocument(big, 'big.png', { adapter: f.adapter, model: 'm', fallbackModel: null }, { crossCheck: false, forceRecognition: true, secondRead: 'auto', tiling: 'always' });
  assert.ok(f.calls.length >= 2 && f.calls.length <= 5, `full page plus its tiles only: ${f.calls.join(',')}`);
  assert.equal(r.pages[0].secondRead, undefined, 'close-ups, not a second read');
});
