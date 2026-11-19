import sharp from 'sharp';
import { findPage, flattenLighting, otsuThreshold, preprocessPage, unevenLighting, uprightness } from './preprocess.js';

/**
 * Chat photos of paper (a phone picture of a handwritten page, a worksheet on a desk) are cleaned up before the model sees them:
 * the desk around the sheet is cropped away, shadows are evened out, a tilted page is straightened, and faint or blurred writing is
 * strengthened. Pictures that are not pages (people, places, diagrams on a screen) are never touched.
 */
export interface EnhancedPhoto {
  /** The cleaned picture as a JPEG, or null when the original is already as good as it can be made (or is not a page). */
  jpeg: Buffer | null;
  /** What was done, in plain words. */
  notes: string[];
  /** What is still wrong with the picture (blur, dim light, sideways), for the user. */
  warnings: string[];
}

const DONE = /^(Cropped|Painted|Evened|Deskewed|Cleaned)/;

/** A page of writing: mostly light paper, some ink, and ink arranged in lines. */
async function looksLikeWrittenPage(data: Buffer): Promise<boolean> {
  const r = await sharp(data, { limitInputPixels: 100_000_000 }).rotate().flatten({ background: '#fff' }).grayscale()
    .resize({ width: 240, height: 240, fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  let v = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.length);
  let w = r.info.width, h = r.info.height;
  // A sheet on a desk: judge the sheet, not the desk around it.
  const found = findPage(v, w, h);
  if (found) {
    const x0 = Math.floor(found.box.x0 * w), y0 = Math.floor(found.box.y0 * h), x1 = Math.ceil(found.box.x1 * w), y1 = Math.ceil(found.box.y1 * h);
    const sub = new Uint8Array((x1 - x0) * (y1 - y0));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sub[(y - y0) * (x1 - x0) + (x - x0)] = v[y * w + x];
    v = sub; w = x1 - x0; h = y1 - y0;
  }
  // A shadow across the page would look like ink: even it out before judging.
  if (unevenLighting(v, w, h) >= 0.2) {
    const flat = await flattenLighting(await sharp(Buffer.from(v), { raw: { width: w, height: h, channels: 1 } }).png().toBuffer());
    const fr = await sharp(flat).removeAlpha().extractChannel(0).raw().toBuffer();
    v = new Uint8Array(fr.buffer, fr.byteOffset, fr.length);
  }
  const thr = otsuThreshold(v);
  if (thr < 70) return false;
  let ink = 0;
  for (const x of v) if (x < thr) ink++;
  const frac = ink / v.length;
  if (frac < 0.01 || frac > 0.4) return false;
  const u = uprightness(v, w, h, thr);
  return u > 0.9 || u < 0.6;                                   // lines of text, either way up or on their side: not a random picture
}

export async function enhancePhoto(data: Buffer, opts: { maxSide?: number } = {}): Promise<EnhancedPhoto> {
  const none: EnhancedPhoto = { jpeg: null, notes: [], warnings: [] };
  try {
    if (!(await looksLikeWrittenPage(data))) return none;
    const pre = await preprocessPage(data, { maxSide: 2400 });
    const notes = pre.transforms.filter((t) => DONE.test(t));
    const warnings = pre.quality.warnings;
    if (!notes.length) return { jpeg: null, notes, warnings };
    const side = opts.maxSide ?? 1800;
    const jpeg = await sharp(pre.processed).resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    return { jpeg, notes, warnings };
  } catch {
    return none;                                                // never lose the picture because the cleanup failed
  }
}
