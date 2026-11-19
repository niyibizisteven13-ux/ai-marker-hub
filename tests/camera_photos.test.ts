// Phone photos of paper: the desk around the sheet is cropped away, shadows are evened out, a sideways page is flagged,
// and a clean scan is left exactly as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createCanvas } from '@napi-rs/canvas';
import { findPageBox, flattenLighting, preprocessPage, unevenLighting, uprightness, otsuThreshold } from '../server/services/documents/preprocess.js';

/** A sheet of ruled "handwriting" lines. */
function sheet(w = 900, h = 1250, ink = '#222') {
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#f4f2ea'; g.fillRect(0, 0, w, h);
  g.fillStyle = ink; g.font = '30px sans-serif';
  for (let i = 0; i < 16; i++) g.fillText(`Q${i + 1}. The demand curve shifts right when income rises ${i * 7}`, 60, 110 + i * 62);
  return c.toBuffer('image/png');
}
/** The sheet lying on a dark desk. */
async function onDesk(sheetPng: Buffer, margin = 260) {
  const m = await sharp(sheetPng).metadata();
  return sharp({ create: { width: (m.width ?? 0) + margin * 2, height: (m.height ?? 0) + margin * 2, channels: 3, background: '#2b2118' } })
    .composite([{ input: sheetPng, left: margin, top: margin }]).png().toBuffer();
}
/** A shadow falling across the left third of the page. */
async function withShadow(png: Buffer) {
  const m = await sharp(png).metadata();
  const w = m.width ?? 0, h = m.height ?? 0;
  const c = createCanvas(w, h); const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)'); grad.addColorStop(0.5, 'rgba(0,0,0,0.1)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  return sharp(png).composite([{ input: c.toBuffer('image/png') }]).png().toBuffer();
}
const small = async (png: Buffer, side = 200) => { const r = await sharp(png).grayscale().resize({ width: side, height: side, fit: 'inside' }).raw().toBuffer({ resolveWithObject: true }); return { d: new Uint8Array(r.data), w: r.info.width, h: r.info.height }; };

test('a sheet on a desk is found and cropped; a plain sheet is left alone', async () => {
  const photo = await onDesk(sheet());
  const s = await small(photo);
  const box = findPageBox(s.d, s.w, s.h);
  assert.ok(box, 'the sheet is found');
  assert.ok(box!.x0 > 0.1 && box!.x1 < 0.9 && box!.y0 > 0.08 && box!.y1 < 0.92, JSON.stringify(box));
  const pre = await preprocessPage(photo);
  assert.ok(pre.transforms.some((t) => /Cropped to the sheet/.test(t)));
  assert.ok(pre.width < 1100 && pre.height < 1500, `cropped to about the sheet, got ${pre.width}x${pre.height}`);
  const plain = await small(sheet());
  assert.equal(findPageBox(plain.d, plain.w, plain.h), null, 'a full-frame sheet is not cropped');
  assert.ok(!(await preprocessPage(sheet())).transforms.some((t) => /Cropped/.test(t)));
});

test('a shadow across the page is detected and evened out; an evenly lit page is not touched', async () => {
  const shaded = await withShadow(sheet());
  const s = await small(shaded, 160);
  assert.ok(unevenLighting(s.d, s.w, s.h) >= 0.2);
  const even = await small(sheet(), 160);
  assert.ok(unevenLighting(even.d, even.w, even.h) < 0.2);
  const pre = await preprocessPage(shaded, { deskew: false });
  assert.ok(pre.transforms.some((t) => /uneven lighting/.test(t)));
  assert.ok(!pre.transforms.some((t) => /Cropped|Painted/.test(t)), 'a shadowed page is not mistaken for paper on a desk and cut through its writing');
  assert.ok(pre.quality.warnings.some((w) => /shadow or uneven light/.test(w)));
  // After flattening, the paper on the dark side is as bright as the paper on the light side.
  const flat = await flattenLighting(await sharp(shaded).grayscale().png().toBuffer());
  const f = await small(flat, 160);
  assert.ok(unevenLighting(f.d, f.w, f.h) < 0.12, `still uneven: ${unevenLighting(f.d, f.w, f.h)}`);
  assert.ok(!(await preprocessPage(sheet(), { deskew: false })).transforms.some((t) => /uneven lighting/.test(t)));
});

test('a page on its side is flagged; an upright one is not', async () => {
  const up = await small(sheet(), 400);
  const side = await small(await sharp(sheet()).rotate(90).png().toBuffer(), 400);
  assert.ok(uprightness(up.d, up.w, up.h, otsuThreshold(up.d)) > 1);
  assert.ok(uprightness(side.d, side.w, side.h, otsuThreshold(side.d)) < 0.55);
  const pre = await preprocessPage(await sharp(sheet()).rotate(90).png().toBuffer(), { deskew: false });
  assert.ok(pre.quality.warnings.some((w) => /on its side or upside down/.test(w)));
  assert.ok(!(await preprocessPage(sheet())).quality.warnings.some((w) => /on its side/.test(w)));
});

test('the whole thing together: a shadowed, tilted sheet on a desk comes out cropped, even and upright', async () => {
  const photo = await onDesk(await withShadow(await sharp(sheet()).rotate(3, { background: '#f4f2ea' }).png().toBuffer()), 220);
  const pre = await preprocessPage(photo);
  assert.ok(pre.transforms.some((t) => /Cropped/.test(t)) && pre.transforms.some((t) => /uneven lighting/.test(t)) && pre.transforms.some((t) => /Deskewed/.test(t)), pre.transforms.join(' | '));
  assert.ok(Math.abs(pre.deskewDegrees - 3) <= 1, `deskew ${pre.deskewDegrees}`);
});

// ---- the chat path: what the model receives for a photo
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileStore } from '../server/services/ai/files/FileStore.js';
import { ingestUploads } from '../server/services/ai/ingest.js';
import { enhancePhoto } from '../server/services/documents/photo.js';

test('chat: a photo of a page on a desk reaches the model cropped and even, with a note; other pictures are untouched', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'camera-'));
  try {
    const ctx = { userId: 'u-cam', files: new FileStore({ dir: root, secret: 'test-secret-1234567890' }), services: {} } as any;
    const jpeg = await sharp(await onDesk(await withShadow(sheet()))).jpeg({ quality: 90 }).toBuffer();
    const r = await ingestUploads('What does my answer say?', [{ type: 'image', base64: jpeg.toString('base64'), mediaType: 'image/jpeg', name: 'IMG_1.jpg' }], ctx, { vision: true });
    const img = (r.parts as any[]).filter((p) => p.type === 'image_url');
    assert.equal(img.length, 1);
    assert.match(img[0].image_url.url, /^data:image\/jpeg;base64,/);
    const out = Buffer.from(img[0].image_url.url.split(',')[1], 'base64');
    const m = await sharp(out).metadata();
    assert.ok((m.width ?? 0) < 1100, `cropped to the sheet, got ${m.width}x${m.height}`);
    const text = (r.parts[0] as any).text as string;
    assert.match(text, /photo of a page, cleaned up for reading/);
    assert.match(text, /Cropped to the sheet/);
    // Not a page: a plain colour picture is passed through byte for byte.
    const cat = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#3a7bd5' } }).png().toBuffer();
    const e = await enhancePhoto(cat);
    assert.deepEqual([e.jpeg, e.notes], [null, []]);
    const r2 = await ingestUploads('x', [{ type: 'image', base64: cat.toString('base64'), mediaType: 'image/png', name: 'sky.png' }], ctx, { vision: true });
    assert.equal((r2.parts as any[]).find((p) => p.type === 'image_url').image_url.url, `data:image/png;base64,${cat.toString('base64')}`);
    // A clean scan needs no work: passed through.
    assert.equal((await enhancePhoto(sheet())).jpeg, null);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('chat: a shadowed photo with no desk is still recognised as a page and evened out', async () => {
  const e = await enhancePhoto(await sharp(await withShadow(sheet())).jpeg({ quality: 90 }).toBuffer());
  assert.ok(e.jpeg, 'cleaned');
  assert.ok(e.notes.some((n) => /uneven lighting/.test(n)));
});

// ---- zoom_image and the handwriting instructions
import { zoomImage } from '../server/services/ai/tools/documentTools.js';

test('zoom_image: a photo comes back as overlapping close-ups, or one enlarged region; PDFs and strangers are refused', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zoom-'));
  try {
    const files = new FileStore({ dir: root, secret: 'test-secret-1234567890' });
    const jpeg = await sharp(await onDesk(await withShadow(sheet()))).jpeg({ quality: 90 }).toBuffer();
    const meta = await files.put({ userId: 'u1', name: 'page.jpg', mime: 'image/jpeg', kind: 'image', data: jpeg });
    const ctx = { userId: 'u1', files, services: {} } as any;
    const all = await zoomImage.execute({ fileId: meta.id }, ctx);
    assert.ok(!all.isError, all.text);
    assert.equal(all.images?.length, 3);
    assert.match(all.text, /3 overlapping close-ups/); assert.match(all.text, /cleaned for reading/);
    for (const im of all.images!) { assert.equal(im.mime, 'image/jpeg'); assert.ok((await sharp(Buffer.from(im.base64, 'base64')).metadata()).width! <= 1800); }
    const two = await zoomImage.execute({ fileId: meta.id, bands: 2 }, ctx);
    assert.equal(two.images?.length, 2);
    const one = await zoomImage.execute({ fileId: meta.id, region: { x0: 100, y0: 200, x1: 600, y1: 400 } }, ctx);
    assert.equal(one.images?.length, 1); assert.match(one.text, /Close-up/);
    assert.match((await zoomImage.execute({ fileId: meta.id, region: { x0: 100, y0: 200, x1: 105, y1: 205 } }, ctx)).text, /too small/);
    assert.match((await zoomImage.execute({ fileId: meta.id }, { ...ctx, userId: 'someone-else' })).text, /not found/);
    const pdf = await files.put({ userId: 'u1', name: 'a.pdf', mime: 'application/pdf', kind: 'pdf', data: Buffer.from('%PDF-1.4') });
    assert.match((await zoomImage.execute({ fileId: pdf.id }, ctx)).text, /not an image/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

import { buildCapabilitiesPrompt } from '../server/services/ai/capabilitiesPrompt.js';
test('the chat is told how to read handwriting, and to zoom first when it has the tool', () => {
  const withZoom = buildCapabilitiesPrompt({ tools: ['read_attachment', 'zoom_image'] as any, locale: 'en' } as any);
  assert.match(withZoom, /Reading handwriting and photos of paper/);
  assert.match(withZoom, /unclear: best guess\?/);
  assert.match(withZoom, /call zoom_image/);
  const without = buildCapabilitiesPrompt({ tools: ['read_attachment'] as any, locale: 'en' } as any);
  assert.match(without, /Reading handwriting/); assert.doesNotMatch(without, /call zoom_image/);
});
