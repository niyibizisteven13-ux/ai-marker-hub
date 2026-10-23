import JSZip from 'jszip';
import sharp from 'sharp';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { extractText } from '../ai/files/extract.js';
import { pdfSafe } from './annotate.js';
import type { UploadFile } from './service.js';

/**
 * Turns whatever a teacher sends into markable scripts:
 *  - ZIP files (a folder of scripts) are unpacked; a sub-folder of page photos becomes one script named after
 *    the folder ("C014/page1.jpg, C014/page2.jpg" → C014.pdf);
 *  - typed answers (Word, OpenDocument, RTF, text, Markdown, HTML) become a clean printed PDF, which is then
 *    read and marked exactly like a scan (the original file is kept unchanged alongside).
 * PDFs and images pass through untouched.
 */

const IMAGE = /\.(png|jpe?g|webp|tiff?|gif|bmp|heic|heif)$/i;
export const TYPED = /\.(docx|odt|rtf|txt|md|html?)$/i;
const MAX_ENTRIES = 300;
const MAX_UNZIPPED = 250 * 1024 * 1024;

export const isPdf = (f: UploadFile) => f.buffer.subarray(0, 5).toString('latin1') === '%PDF-';
export const isZip = (f: UploadFile) => f.buffer.subarray(0, 4).toString('latin1') === 'PK\u0003\u0004' && !/\.(docx|xlsx|pptx|odt|ods|odp)$/i.test(f.name);
export const isImage = (f: UploadFile) => IMAGE.test(f.name) || /^image\//.test(f.mime ?? '');
export const isTyped = (f: UploadFile) => TYPED.test(f.name);

export class InputError extends Error {}

/** Expands ZIP archives (one level of nesting is enough for "a folder of scripts"). */
export async function expandArchives(files: UploadFile[]): Promise<UploadFile[]> {
  const out: UploadFile[] = [];
  for (const f of files) {
    if (!isZip(f)) { out.push(f); continue; }
    let zip: JSZip;
    try { zip = await JSZip.loadAsync(f.buffer); } catch { throw new InputError(`${f.name} could not be opened as a ZIP file.`); }
    const entries = Object.values(zip.files).filter((e) => !e.dir && !/(^|\/)(__MACOSX|\.)/.test(e.name));
    if (entries.length > MAX_ENTRIES) throw new InputError(`${f.name} contains ${entries.length} files; the limit is ${MAX_ENTRIES}.`);
    let total = 0;
    const read: Array<{ path: string; buffer: Buffer }> = [];
    for (const e of entries) {
      const buffer = await e.async('nodebuffer');
      total += buffer.length;
      if (total > MAX_UNZIPPED) throw new InputError(`${f.name} is larger than ${MAX_UNZIPPED / 1048576} MB once unpacked.`);
      read.push({ path: e.name, buffer });
    }
    // Strip a single wrapping folder ("scripts/C014/p1.jpg" → "C014/p1.jpg").
    const roots = new Set(read.map((r) => r.path.split('/')[0]));
    const strip = roots.size === 1 && read.every((r) => r.path.includes('/')) ? `${[...roots][0]}/` : '';
    const groups = new Map<string, Array<{ name: string; buffer: Buffer }>>();
    for (const r of read) {
      const rel = r.path.slice(strip.length);
      const parts = rel.split('/');
      const name = parts[parts.length - 1];
      if (parts.length > 1 && IMAGE.test(name)) {
        const key = parts.slice(0, -1).join('_');
        groups.set(key, [...(groups.get(key) ?? []), { name, buffer: r.buffer }]);
      } else out.push({ name, buffer: r.buffer });
    }
    for (const [folder, pages] of groups) {
      if (pages.length === 1) { out.push({ name: `${folder}${pages[0].name.slice(pages[0].name.lastIndexOf('.'))}`, buffer: pages[0].buffer }); continue; }
      pages.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      out.push({ name: `${folder}.pdf`, buffer: await imagesToPdf(pages.map((p) => p.buffer)), mime: 'application/pdf' });
    }
  }
  return out;
}

/** Page photos → one PDF (A4-ish, each photo fitted to its own page). */
export async function imagesToPdf(images: Buffer[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (const img of images) {
    const jpg = await sharp(img, { limitInputPixels: 80_000_000 }).rotate().flatten({ background: '#ffffff' }).resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    const meta = await sharp(jpg).metadata();
    const w = meta.width ?? 1240, h = meta.height ?? 1754;
    const scale = 595 / w;
    const page = doc.addPage([595, h * scale]);
    page.drawImage(await doc.embedJpg(jpg), { x: 0, y: 0, width: 595, height: h * scale });
  }
  return Buffer.from(await doc.save());
}

/** Typed answers → a printed A4 PDF that recognition reads like any page (gives every line a position). */
export async function typedToPdf(f: UploadFile): Promise<Buffer> {
  const ex = await extractText({ name: f.name, mime: f.mime, data: f.buffer });
  let text = ex.kind === 'text' ? ex.text ?? '' : '';
  if (/\.rtf$/i.test(f.name)) {
    text = f.buffer.toString('latin1')
      .replace(/\{\\(?:\*|fonttbl|colortbl|stylesheet|info|pict)[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '')
      .replace(/\\par[d]?\b ?/g, '\n').replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '');
  }
  text = text.replace(/\r\n?/g, '\n').trim();
  if (text.length < 2) throw new InputError(`${f.name} has no readable text.`);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = 12, lead = 18, margin = 64, width = 595 - margin * 2;
  let page = doc.addPage([595, 842]);
  let y = 842 - margin;
  const lines: string[] = [];
  for (const para of pdfSafe(text).split('\n')) {
    if (!para.trim()) { lines.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  for (const l of lines) {
    if (y < margin) { page = doc.addPage([595, 842]); y = 842 - margin; }
    if (l) page.drawText(l, { x: margin, y, size, font, color: rgb(0.08, 0.08, 0.1) });
    y -= lead;
  }
  doc.setTitle(pdfSafe(f.name));
  doc.setProducer('Bwenge.AI');
  return Buffer.from(await doc.save());
}
