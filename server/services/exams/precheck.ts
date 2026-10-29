import JSZip from 'jszip';
import sharp from 'sharp';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

/**
 * Checks files before marking, for the Mark page summary: pages, typed or handwritten (no text layer),
 * students in a ZIP, and photos that will read badly (blurry, too dark, too small). Cheap: no AI involved.
 */

export type Issue = 'blurry' | 'dark' | 'small' | 'unreadable';
export interface FileCheck {
  name: string;
  kind: 'pdf' | 'image' | 'document' | 'zip' | 'other';
  pages: number;
  /** Pages with a text layer (typed); the others are scans, photos or handwriting. */
  typedPages: number;
  /** Scripts inside a ZIP (one per student file or folder). */
  students?: number;
  issues: Array<{ page?: number; entry?: string; issue: Issue }>;
  /** What the text says the file is, when it says so clearly (a scheme or question paper named like a script). */
  looksLike?: 'scheme' | 'paper';
}

const SCHEME_TEXT = /\b(marking\s*(scheme|guide|key)|mark\s*scheme|answer\s*key|model\s*answers?|memorandum|bar[eè]me|corrig[eé])\b/i;
const PAPER_TEXT = /\b(question\s*paper|answer\s*all\s*(the\s*)?questions|instructions\s*to\s*candidates|time\s*allowed|do\s*not\s*open\s*this)\b/i;
/** Only the first part of the text: a script that quotes "marking scheme" late on is still a script. */
export function looksLike(text: string): FileCheck['looksLike'] {
  const head = text.slice(0, 1500);
  if (SCHEME_TEXT.test(head)) return 'scheme';
  if (PAPER_TEXT.test(head)) return 'paper';
  return undefined;
}

const IMAGE = /\.(png|jpe?g|webp|gif|tiff?|bmp|heic|heif)$/i;
const MAX_RENDERED_PAGES = 12;

/** Sharpness (variance of the Laplacian on a 900 px greyscale copy), brightness and size of one image. */
export async function imageQuality(data: Buffer): Promise<Issue[]> {
  try {
    const img = sharp(data, { limitInputPixels: 100_000_000 }).rotate();
    const meta = await img.metadata();
    const { data: px, info } = await img.clone().greyscale().resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels: c } = info;
    let lumSum = 0;
    let lapSum = 0;
    let lapSq = 0;
    let n = 0;
    for (let i = 0; i < w * h; i++) lumSum += px[i * c];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * c;
        const v = px[i - c] + px[i + c] + px[i - w * c] + px[i + w * c] - 4 * px[i];
        lapSum += v; lapSq += v * v; n++;
      }
    }
    const sharpness = n ? lapSq / n - (lapSum / n) ** 2 : 0;
    const lum = { mean: lumSum / Math.max(1, w * h) };
    const out: Issue[] = [];
    if (sharpness < 25) out.push('blurry');
    if (lum.mean < 70) out.push('dark');
    if (Math.max(meta.width ?? 0, meta.height ?? 0) < 700) out.push('small');
    return out;
  } catch {
    return ['unreadable'];
  }
}

async function checkPdf(name: string, data: Buffer): Promise<FileCheck> {
  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    const text = await parser.getText();
    const pages = text.total ?? text.pages.length;
    const typed = text.pages.filter((p) => (p.text ?? '').replace(/\s+/g, '').length >= 50).length;
    const issues: FileCheck['issues'] = [];
    // Scanned pages: look at the first ones for blur and darkness.
    const scanned = text.pages.filter((p) => (p.text ?? '').replace(/\s+/g, '').length < 50).map((p) => p.num).slice(0, MAX_RENDERED_PAGES);
    if (scanned.length) {
      const shot = await parser.getScreenshot({ partial: scanned, scale: 1.2, imageBuffer: true, imageDataUrl: false });
      for (const [i, p] of shot.pages.entries()) if (p.data) for (const issue of await imageQuality(Buffer.from(p.data))) if (issue !== 'small') issues.push({ page: scanned[i], issue });
    }
    return { name, kind: 'pdf', pages, typedPages: typed, issues, looksLike: looksLike(text.pages.slice(0, 2).map((p) => p.text ?? '').join('\n')) };
  } catch {
    return { name, kind: 'pdf', pages: 0, typedPages: 0, issues: [{ issue: 'unreadable' }] };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function checkZip(name: string, data: Buffer): Promise<FileCheck> {
  try {
    const zip = await JSZip.loadAsync(data);
    const entries = Object.values(zip.files).filter((f) => !f.dir && !/(^|\/)(__MACOSX|\.)/.test(f.name) && (IMAGE.test(f.name) || /\.(pdf|docx|txt)$/i.test(f.name)));
    // As marking reads it: a single wrapping folder is ignored, then one student per folder of photos and one per
    // other file (a student's photos in a folder become one script).
    const roots = new Set(entries.map((e) => e.name.split('/')[0]));
    const strip = roots.size === 1 && entries.every((e) => e.name.includes('/')) ? `${[...roots][0]}/` : '';
    const rel = entries.map((e) => e.name.slice(strip.length));
    const folders = new Set(rel.filter((n) => n.includes('/') && IMAGE.test(n)).map((n) => n.slice(0, n.lastIndexOf('/'))));
    const loose = rel.filter((n) => !(n.includes('/') && IMAGE.test(n))).length;
    const issues: FileCheck['issues'] = [];
    let pages = 0;
    let typed = 0;
    for (const e of entries.slice(0, 60)) {
      const buf = await e.async('nodebuffer');
      if (IMAGE.test(e.name)) { pages++; for (const issue of await imageQuality(buf)) issues.push({ entry: e.name, issue }); }
      else if (/\.pdf$/i.test(e.name)) { const c = await checkPdf(e.name, buf); pages += c.pages; typed += c.typedPages; issues.push(...c.issues.map((x) => ({ ...x, entry: e.name }))); }
      else { pages++; typed++; }
    }
    return { name, kind: 'zip', pages, typedPages: typed, students: folders.size + loose, issues };
  } catch {
    return { name, kind: 'zip', pages: 0, typedPages: 0, issues: [{ issue: 'unreadable' }] };
  }
}

export async function precheckFile(file: { name: string; mime?: string; data: Buffer }): Promise<FileCheck> {
  const { name, mime = '' } = file;
  if (/pdf/i.test(mime) || /\.pdf$/i.test(name)) return checkPdf(name, file.data);
  if (/zip/i.test(mime) || /\.zip$/i.test(name)) return checkZip(name, file.data);
  if (/^image\//i.test(mime) || IMAGE.test(name)) return { name, kind: 'image', pages: 1, typedPages: 0, issues: (await imageQuality(file.data)).map((issue) => ({ issue })) };
  if (/\.(txt|md)$/i.test(name)) return { name, kind: 'document', pages: 1, typedPages: 1, issues: [], looksLike: looksLike(file.data.toString('utf8')) };
  if (/\.docx$/i.test(name)) {
    const text = await mammoth.extractRawText({ buffer: file.data }).then((r) => r.value).catch(() => '');
    return { name, kind: 'document', pages: 1, typedPages: 1, issues: [], looksLike: looksLike(text) };
  }
  if (/\.(doc|odt|rtf)$/i.test(name)) return { name, kind: 'document', pages: 1, typedPages: 1, issues: [] };
  return { name, kind: 'other', pages: 0, typedPages: 0, issues: [] };
}
