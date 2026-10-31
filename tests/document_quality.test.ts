import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { checkMath, collectAssignments, evaluate } from '../server/services/documents/mathcheck.js';
import { summarize, verifyPage } from '../server/services/documents/verify.js';
import { mergeTileReadings, planTiles, shouldTile, tileToPage, type Tile } from '../server/services/documents/tiling.js';
import { processDocument } from '../server/services/documents/pipeline.js';
import { answerFromDocument } from '../server/services/documents/ask.js';
import { alignWords, reviewCalibration } from '../server/services/documents/metrics.js';
import { createTelegramTranscriber } from '../server/services/documents/telegramTranscribe.js';
import type { RecognizedElement, RecognizedPage } from '../server/services/documents/recognize.js';
import type { ProviderAdapter, ProviderRequest } from '../server/services/ai/providers/types.js';
import { FileStore } from '../server/services/ai/files/FileStore.js';
import { FileJobQueue } from '../server/services/ai/jobs/fileJobQueue.js';
import { OwnedRecordStore } from '../server/services/storage/ownedRecordStore.js';
import { createDocumentService } from '../server/services/documents/service.js';

const el = (over: Partial<RecognizedElement>): RecognizedElement => ({
  id: 'e1', type: 'paragraph', text: 'x', latex: null, table: null, region: { x0: 50, y0: 50, x1: 950, y1: 120 },
  legibility: 'clear', uncertainSpans: [], crossedOut: false, handwritten: true, language: 'en', ...over,
});

function scripted(fn: (req: ProviderRequest, call: number) => unknown) {
  const requests: ProviderRequest[] = [];
  const adapter: ProviderAdapter = {
    name: 'fake',
    async *stream(req) {
      requests.push(req);
      yield { type: 'text', text: JSON.stringify(fn(req, requests.length)) };
      yield { type: 'usage', input: 100, output: 10 };
    },
  };
  return { adapter, requests };
}

const blank = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } })
  .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="200" y="400" font-size="60" fill="#111">Demand notes</text></svg>`), top: 0, left: 0 }]).png().toBuffer();

// ── Arithmetic (algebraic verification, separate from transcription) ─────────
test('arithmetic: safe evaluation, chains, written precision, variables and conflicts', () => {
  assert.equal(evaluate('200 × 5'), 1000);
  assert.equal(evaluate('P x Q', new Map([['P', 2], ['Q', 3]])), 6);
  assert.equal(evaluate('\\frac{10}{4}'), 2.5);
  assert.equal(evaluate('process.exit(1)'), null, 'no code execution, unknown names are not evaluated');
  assert.equal(evaluate('2 +'), null);
  assert.equal(checkMath('TR = 200 × 5 = 1000').status, 'consistent');
  const bad = checkMath('TR = 200 × 5 = 1100');
  assert.equal(bad.status, 'inconsistent');
  assert.match(bad.note!, /writer made an arithmetic error or a number was misread/);
  assert.equal(checkMath('10/3 = 3.33').status, 'consistent', 'rounded to the precision written');
  assert.equal(checkMath('10/3 = 3.4').status, 'inconsistent');
  assert.equal(checkMath('P = 200').status, 'not_checkable', 'a definition is not a claim');
  const { vars, conflicts } = collectAssignments([{ id: 'a', text: 'P = 200, Q = 5' }, { id: 'b', text: 'TR = 1100' }, { id: 'c', text: 'Z = 1; Z = 2' }]);
  assert.deepEqual(conflicts, ['Z']);
  assert.equal(checkMath('TR = P × Q', vars).status, 'inconsistent');
});

test('pipeline: document-wide arithmetic inconsistency is a separate check and a review signal', async () => {
  const page: RecognizedPage = {
    languages: ['en'], readingOrder: ['e1', 'e2', 'e3'], notes: [],
    elements: [
      el({ id: 'e1', text: 'P = 200 and Q = 5' }),
      el({ id: 'e2', type: 'equation', text: 'TR = P × Q', latex: 'TR = P \\times Q', region: { x0: 50, y0: 150, x1: 500, y1: 200 } }),
      el({ id: 'e3', text: 'TR = 1100', region: { x0: 50, y0: 220, x1: 500, y1: 260 } }),
    ],
  };
  const { adapter } = scripted(() => page);
  const r = await processDocument(await blank(1240, 1754), 'p.png', { adapter, model: 'm' }, { crossCheck: false, tiling: 'off' });
  const eq = r.pages[0].elements.find((e) => e.id === 'p1-e2')!;
  assert.equal(eq.mathCheck?.status, 'inconsistent');
  assert.ok(eq.signals.some((s) => s.source === 'math_inconsistent'));
  assert.equal(eq.needsReview, true);
  assert.equal(eq.checks.latex?.valid, true, 'transcription checks are unaffected by the arithmetic result');
});

// ── Uncertainty signals and language-aware OCR ───────────────────────────────
test('uncertainty: signals combine with a configurable threshold; OCR skips unsupported languages', async () => {
  const medium = summarize({ signals: [{ source: 'model_ambiguity', severity: 'medium', detail: 'x' }] }, 'medium');
  assert.deepEqual([medium.uncertainty, medium.needsReview], ['medium', true]);
  assert.equal(summarize({ signals: [{ source: 'model_ambiguity', severity: 'medium', detail: 'x' }] }, 'high').needsReview, false);
  assert.equal(summarize({ signals: [{ source: 'illegible_marker', severity: 'high', detail: 'x' }] }, 'high').needsReview, true);
  assert.equal(summarize({ signals: [] }).uncertainty, 'low');

  let ocrCalls = 0;
  const v = await verifyPage({
    languages: ['rw', 'en'], readingOrder: [], notes: [],
    elements: [el({ id: 'rw', text: 'Isoko ry\'ibicuruzwa', language: 'rw' }), el({ id: 'en', text: 'Market supply', language: 'en' }), el({ id: 'unk', text: 'abc def', language: 'unknown' })],
  }, { cropper: async () => Buffer.alloc(0), ocr: async () => { ocrCalls++; return { text: 'Market supply', confidence: 95 }; }, ocrLanguages: ['en'], pageQualityWarnings: ['Low contrast between ink and paper (30 grey levels).'] });
  assert.equal(ocrCalls, 1);
  assert.deepEqual(v.elements.map((e) => e.checks.ocr?.status), ['unsupported_language', 'corroborated', 'unsupported_language']);
  assert.ok(v.elements.every((e) => e.signals.some((s) => s.source === 'page_quality')), 'page quality applies to handwritten elements');
  assert.ok(!v.elements[0].signals.some((s) => s.source === 'ocr_conflict'), 'unsupported language is not evidence against the reading');
});

// ── Tiling ───────────────────────────────────────────────────────────────────
test('tiling: plan covers the page with overlapping tiles whose cores partition it; mapping to page space', () => {
  assert.equal(shouldTile(1900, 1400, 'auto', 2000), false);
  assert.equal(shouldTile(3600, 5000, 'auto', 2000), true);
  assert.equal(shouldTile(800, 800, 'always', 2000), true);
  assert.equal(shouldTile(9000, 9000, 'off', 2000), false);
  const tiles = planTiles(3600, 5000, { maxTiles: 4 });
  assert.ok(tiles.length <= 4 && tiles.length >= 2);
  for (const t of tiles) assert.ok(t.x >= 0 && t.y >= 0 && t.x + t.width <= 3600 && t.y + t.height <= 5000);
  const coreArea = tiles.reduce((a, t) => a + (t.core.x1 - t.core.x0) * (t.core.y1 - t.core.y0), 0);
  assert.ok(Math.abs(coreArea - 1_000_000) < 1000, 'cores cover the page exactly once');
  assert.ok(tiles.some((t, i) => tiles.some((u, j) => i !== j && t.x < u.x + u.width && u.x < t.x + t.width && t.y < u.y + u.height && u.y < t.y + t.height && (t.x + t.width > u.x && t.x < u.x) )), 'neighbouring tiles overlap');
  const t: Tile = { index: 0, row: 0, col: 1, x: 1000, y: 0, width: 1000, height: 2000, core: { x0: 0, y0: 0, x1: 1000, y1: 1000 } };
  assert.deepEqual(tileToPage({ x0: 0, y0: 0, x1: 1000, y1: 500 }, t, 2000, 4000), { x0: 500, y0: 0, x1: 1000, y1: 250 });
});

test('tiling merge: agreement, disagreement (close-up wins, alternate kept), boundary elements, de-duplicated tile-only text', () => {
  const tiles: Tile[] = [
    { index: 0, row: 0, col: 0, x: 0, y: 0, width: 1100, height: 2000, core: { x0: 0, y0: 0, x1: 500, y1: 1000 } },
    { index: 1, row: 0, col: 1, x: 900, y: 0, width: 1100, height: 2000, core: { x0: 500, y0: 0, x1: 1000, y1: 1000 } },
  ];
  const page = {
    readingOrder: ['a', 'b', 'c'],
    elements: [
      el({ id: 'a', text: 'Demand rises', region: { x0: 50, y0: 50, x1: 400, y1: 100 } }),
      el({ id: 'b', text: 'P = 200', region: { x0: 50, y0: 300, x1: 400, y1: 350 } }),
      el({ id: 'c', text: 'Long line across both halves', region: { x0: 100, y0: 600, x1: 900, y1: 650 } }),
    ],
  };
  const te = (tile: Tile, over: Partial<RecognizedElement>) => ({ tile, element: el(over) });
  const merged = mergeTileReadings(page, [
    te(tiles[0], { id: 'x1', text: 'Demand rises', region: { x0: 60, y0: 55, x1: 390, y1: 95 } }),
    te(tiles[0], { id: 'x2', text: 'P = 280', region: { x0: 60, y0: 305, x1: 390, y1: 345 } }),
    te(tiles[0], { id: 'x3', text: 'Long line across both', region: { x0: 110, y0: 605, x1: 480, y1: 645 } }),
    te(tiles[0], { id: 'x4', text: 'small footnote', region: { x0: 420, y0: 900, x1: 520, y1: 930 } }),
    te(tiles[1], { id: 'y1', text: 'small footnote', region: { x0: 425, y0: 902, x1: 525, y1: 932 } }),
  ], tiles);
  const by = Object.fromEntries(merged.elements.map((e) => [e.id, e]));
  assert.equal(by.a.text, 'Demand rises');
  assert.equal(by.b.text, 'P = 280', 'close-up reading used inside the tile core');
  assert.deepEqual(merged.alternates.b, [{ source: 'full_page', text: 'P = 200' }]);
  assert.equal(merged.signals.b[0].source, 'tile_disagreement');
  assert.equal(merged.signals.b[0].severity, 'high');
  assert.equal(by.c.text, 'Long line across both halves', 'an element crossing tile cores is not replaced');
  assert.ok(merged.alternates.c);
  const added = merged.elements.filter((e) => e.id.startsWith('t'));
  assert.equal(added.length, 1, 'tile-only text found in both overlapping tiles is kept once');
  assert.equal(merged.stats.duplicatesRemoved, 1);
  assert.deepEqual(merged.readingOrder.at(-1), added[0].id, 'inserted by vertical position');
  assert.equal(merged.signals[added[0].id][0].source, 'tile_only');
});

test('pipeline with tiles: full page for context, tiles for detail, coordinates in page space, usage summed', async () => {
  const full: RecognizedPage = { languages: ['en'], readingOrder: ['e1'], notes: [], elements: [el({ id: 'e1', text: 'P = 200', region: { x0: 50, y0: 50, x1: 300, y1: 90 } })] };
  const { adapter, requests } = scripted((req) => {
    const prompt = String((req.messages[1].content as Array<{ type: string; text?: string }>).find((p) => p.type === 'text')?.text);
    if (!/close-up tile \(row 1, column 1\)/.test(prompt)) {
      return /close-up/.test(prompt) ? { languages: ['en'], readingOrder: [], notes: [], elements: [] } : full;
    }
    // Tile (0,0) re-reads the same line at higher resolution (tile-relative coordinates).
    return { languages: ['en'], readingOrder: ['t1'], notes: [], elements: [el({ id: 't1', text: 'P = 280', region: { x0: 80, y0: 80, x1: 500, y1: 160 } })] };
  });
  const r = await processDocument(await blank(3600, 5000), 'big.png', { adapter, model: 'm' }, { crossCheck: false, tiling: 'always', maxTilesPerPage: 4 });
  const p = r.pages[0];
  assert.ok(p.tiling && p.tiling.tiles >= 2);
  assert.equal(requests.length, 1 + p.tiling!.tiles);
  assert.equal(p.tiling!.replaced, 1);
  const e = p.elements[0];
  assert.equal(e.text, 'P = 280');
  assert.deepEqual(e.alternateReadings, [{ source: 'full_page', text: 'P = 200' }]);
  assert.equal(e.needsReview, true);
  assert.equal(r.usage.input, 100 * requests.length);
  assert.ok(r.limitations.some((l) => /close-up tiles/.test(l)));
});

test('auto tiling: a large clear page is read once; close-ups only when the full reading found unclear writing', async () => {
  const clear: RecognizedPage = { languages: ['en'], readingOrder: ['e1'], notes: [], elements: [el({ id: 'e1', text: 'P = 200' })] };
  const one = scripted(() => clear);
  const a = await processDocument(await blank(3600, 5000), 'big.png', { adapter: one.adapter, model: 'm' }, { crossCheck: false, tiling: 'auto', maxTilesPerPage: 4 });
  assert.equal(one.requests.length, 1, 'no close-ups for a clear page');
  assert.equal(a.pages[0].tiling, undefined);
  const unclear: RecognizedPage = { ...clear, elements: [el({ id: 'e1', text: 'P = 200', legibility: 'partly_unclear' })] };
  const two = scripted((req) => (/close-up/.test(JSON.stringify(req.messages)) ? { languages: ['en'], readingOrder: [], notes: [], elements: [] } : unclear));
  const b = await processDocument(await blank(3600, 5000), 'big.png', { adapter: two.adapter, model: 'm' }, { crossCheck: false, tiling: 'auto', maxTilesPerPage: 4 });
  assert.ok(b.pages[0].tiling && b.pages[0].tiling.tiles >= 2);
  assert.equal(two.requests.length, 1 + b.pages[0].tiling!.tiles);
});

// ── Answer support validation ───────────────────────────────────────────────
test('answers: citation validation and support validation are separate layers', async () => {
  const page: RecognizedPage = { languages: ['en'], readingOrder: [], notes: [], elements: [el({ id: 'e1', text: 'If P = 200 and Q = 5' }), el({ id: 'e2', text: 'Demand is elastic', region: { x0: 50, y0: 200, x1: 900, y1: 260 } })] };
  const doc = await processDocument(await blank(1240, 1754), 'n.png', { adapter: scripted(() => page).adapter, model: 'm' }, { crossCheck: false, tiling: 'off' });
  const qa = (answer: object, judge?: object) => scripted((_req, n) => (n === 1 ? answer : judge ?? { claims: [] })).adapter;

  const good = await answerFromDocument(qa(
    { answer: 'Total revenue is 200 × 5 = 1000.', citations: [{ elementId: 'p1-e1', quote: 'P = 200 and Q = 5' }], insufficientEvidence: false },
    { claims: [{ claim: 'Total revenue is 1000', verdict: 'inferred', elementIds: ['p1-e1'], reason: 'P × Q' }] },
  ), 'm', doc, [], 'What is TR?');
  assert.equal(good.support.status, 'supported');
  assert.deepEqual(good.support.calculations, [{ expression: '200 × 5 = 1000', stated: 1000, computed: 1000, correct: true }]);
  assert.equal(good.support.judge, 'model');

  const wrongCalc = await answerFromDocument(qa({ answer: 'Total revenue is 200 × 5 = 1100.', citations: [{ elementId: 'p1-e1', quote: 'P = 200' }], insufficientEvidence: false }), 'm', doc, [], 'q', { supportCheck: false });
  assert.equal(wrongCalc.support.status, 'partially_supported');
  assert.ok(wrongCalc.warnings.some((w) => /calculation in the answer is wrong/.test(w)));
  assert.equal(wrongCalc.support.judge, 'skipped');

  const invented = await answerFromDocument(qa(
    { answer: 'Demand is elastic, so revenue rose 40%.', citations: [{ elementId: 'p1-e2', quote: 'Demand is elastic' }], insufficientEvidence: false },
    { claims: [{ claim: 'Demand is elastic', verdict: 'explicit', elementIds: ['p1-e2'], reason: 'stated' }, { claim: 'revenue rose 40%', verdict: 'inferred', elementIds: ['p1-e1'], reason: 'uses e1' }] },
  ), 'm', doc, [], 'q');
  assert.deepEqual(invented.support.numbers.unsupported, ['40']);
  assert.equal(invented.support.claims![1].verdict, 'unsupported', 'evidence outside the verified citations does not count');
  assert.equal(invented.support.status, 'partially_supported');

  const uncited = await answerFromDocument(qa({ answer: 'Prices fell.', citations: [{ elementId: 'p1-e9', quote: 'nothing' }], insufficientEvidence: false }), 'm', doc, [], 'q');
  assert.equal(uncited.support.status, 'unsupported');
  const none = await answerFromDocument(qa({ answer: 'The page does not say.', citations: [], insufficientEvidence: true }), 'm', doc, [], 'q');
  assert.equal(none.support.status, 'no_answer');
});

// ── Review-policy metrics ───────────────────────────────────────────────────
test('false-confidence rate, error capture and review load', () => {
  assert.deepEqual(alignWords(['a', 'b', 'c'], ['a', 'x', 'c']).hypCorrect, [true, false, true]);
  assert.equal(alignWords(['a', 'b', 'c'], ['a', 'c']).missedReferenceWords, 1);
  const m = reviewCalibration('the price is 280 and demand rose', [
    { text: 'the price is 200', flagged: false }, // one wrong word shown as reliable
    { text: 'and demand rase', flagged: true }, // one wrong word, flagged
  ]);
  assert.equal(m.words, 7);
  assert.equal(m.wrongWords, 2);
  assert.equal(m.falseConfidenceRate, 1 / 4);
  assert.equal(m.errorCapture, 1 / 2);
  assert.equal(m.reviewLoad, 3 / 7);
});

// ── Idempotent handlers, notifications, Telegram ─────────────────────────────
test('records keyed by job id are idempotent and owner-bound; queue notifies once per settled job', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'idem-'));
  const store = new OwnedRecordStore<any>(dir);
  const id = crypto.randomUUID();
  const a = await store.put(id, 'u1', { v: 1 });
  await new Promise((r) => setTimeout(r, 5));
  const b = await store.put(id, 'u1', { v: 2 });
  assert.equal(b.createdAt, a.createdAt);
  assert.equal((await store.get(id, 'u1')).v, 2);
  assert.equal((await fs.readdir(dir)).filter((f) => f.endsWith('.json')).length, 1);
  await assert.rejects(store.put(id, 'u2', { v: 3 }), /another user/);

  const q = new FileJobQueue({ storageDir: path.join(dir, 'jobs') });
  q.register('t', async () => 'ok');
  const seen: string[] = [];
  q.onSettled((j) => { seen.push(`${j.id}:${j.status}`); });
  const { job } = await q.submit({ type: 't', ownerId: 'u', payload: {} });
  for (let i = 0; i < 100 && !seen.length; i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(seen, [`${job.id}:completed`]);
  await q.stop();
});

test('Telegram: asynchronous submit with immediate reply, completion and failure notifications', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tg-'));
  const fileStore = new FileStore({ dir: path.join(dir, 'files'), secret: crypto.randomBytes(32).toString('hex') });
  const queue = new FileJobQueue({ storageDir: path.join(dir, 'jobs') });
  const store = new OwnedRecordStore<any>(path.join(dir, 'records'));
  const page: RecognizedPage = { languages: ['en'], readingOrder: ['e1', 'e2'], notes: [], elements: [el({ id: 'e1', text: 'Demand notes' }), el({ id: 'e2', text: 'P = 2[illegible]0', legibility: 'partly_unclear', region: { x0: 50, y0: 200, x1: 900, y1: 260 } })] };
  const { adapter } = scripted(() => page);
  const documents = createDocumentService({ fileStore, queue, store, vision: () => ({ adapter, model: 'm' }), agent: () => ({ adapter, model: 'm' }) });
  const sent: Array<{ chatId: string; text: string }> = [];
  const img = await blank(1240, 1754);
  const bot = {
    sendMessage: async (chatId: string, text: string) => { sent.push({ chatId, text }); },
    downloadTelegramFile: async (fileId: string) => (fileId === 'missing' ? null : { buffer: img, filePath: 'photos/file_1.jpg' }),
  };
  const tg = createTelegramTranscriber({ bot, documents, queue, fileStore, baseUrl: 'https://bwenge.example' });
  tg.register();

  assert.equal(await tg.submit('chat1', 'telegram-chat1', { fileId: 'f', fileName: 'p.jpg' }), null);
  assert.match(sent.at(-1)!.text, /Link this chat/);
  assert.equal(await tg.submit('chat1', 'user-1', { fileId: 'missing', fileName: 'p.jpg' }, 'rw'), null);
  assert.match(sent.at(-1)!.text, /Sinashoboye/);

  const jobId = await tg.submit('chat1', 'user-1', { fileId: 'f', fileName: 'page.jpg' });
  assert.ok(jobId);
  assert.match(sent.at(-1)!.text, /Reading your document \(job/);
  await tg.submit('chat1', 'user-1', { fileId: 'f', fileName: 'page.jpg' });
  assert.match(sent.at(-1)!.text, /already being processed/);
  for (let i = 0; i < 300 && !sent.some((s) => /Transcription ready/.test(s.text)); i++) await new Promise((r) => setTimeout(r, 20));
  const done = sent.find((s) => /Transcription ready/.test(s.text))!;
  assert.equal(done.chatId, 'chat1');
  assert.match(done.text, /1 page\(s\), 1 part\(s\) flagged for checking/);
  assert.match(done.text, /Demand notes/);
  assert.match(done.text, /https:\/\/bwenge\.example\/api\/files\/[0-9a-f-]{36}\?exp=\d+&sig=/);

  await tg.onSettled({ type: 'document.process', status: 'failed', payload: { notifyTelegramChatId: 'chat2' }, error: { code: 'X', message: 'Too many pages.' } } as any);
  assert.deepEqual(sent.at(-1), { chatId: 'chat2', text: '❌ Too many pages.' });
  await queue.stop();
});
