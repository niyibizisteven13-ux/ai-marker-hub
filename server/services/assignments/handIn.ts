import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { extractText } from '../ai/files/extract.js';
import { pdfSafe } from '../exams/annotate.js';
import { imagesToPdf, typedToPdf } from '../exams/inputs.js';

/**
 * Turns anything a student hands in into pages the marker can read: code and plain text in a monospace page with
 * its file name and line numbers, spreadsheets and slides as their text, and a folder (a ZIP) as a contents listing
 * followed by each readable file. The original files stay unchanged next to the PDF.
 */

import { CODE_EXT, SHEET_EXT, SLIDE_EXT, VIDEO_EXT, SKIP_DIRS } from '../../../shared/handInTypes.js';
export { CODE_EXT, SHEET_EXT, SLIDE_EXT, VIDEO_EXT };
const DOC_EXT = ['docx', 'odt', 'rtf', 'txt', 'md'];
const IMAGE = /\.(png|jpe?g|webp|tiff?|gif|bmp|heic|heif)$/i;
const ext = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();

const MAX_ENTRIES = 300;
const MAX_UNZIPPED = 100 * 1024 * 1024;
const MAX_FILE_TEXT = 200_000;
const MAX_PAGES_PER_FILE = 40;
const MAX_PAGES_TOTAL = 120;

export class HandInError extends Error {}

/** True when the bytes are text (no NUL bytes in the first 4 KB). */
export const looksTextual = (data: Buffer) => !data.subarray(0, 4096).includes(0);

/** Monospace pages: a header with the file name, then the lines with their numbers. Long lines wrap. */
export async function codeToPdf(name: string, text: string, opts: { maxPages?: number } = {}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Courier);
  const bold = await doc.embedFont(StandardFonts.CourierBold);
  const size = 8.5, lead = 11, margin = 40, numW = 4;
  const cols = Math.floor((595 - margin * 2) / (font.widthOfTextAtSize('M', size))) - numW - 1;
  const maxPages = opts.maxPages ?? MAX_PAGES_PER_FILE;
  let page = doc.addPage([595, 842]);
  let y = 842 - margin;
  page.drawText(pdfSafe(`File: ${name}`), { x: margin, y, size: 10, font: bold, color: rgb(0.1, 0.1, 0.4) });
  y -= lead * 2;
  const lines = pdfSafe(text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ')).split('\n');
  let cut = false;
  outer: for (const [i, raw] of lines.entries()) {
    const chunks = raw.length ? raw.match(new RegExp(`.{1,${cols}}`, 'g')) ?? [''] : [''];
    for (const [k, chunk] of chunks.entries()) {
      if (y < margin) {
        if (doc.getPageCount() >= maxPages) { cut = true; break outer; }
        page = doc.addPage([595, 842]); y = 842 - margin;
      }
      if (k === 0) page.drawText(String(i + 1).padStart(numW), { x: margin, y, size, font, color: rgb(0.55, 0.55, 0.6) });
      if (chunk) page.drawText(chunk, { x: margin + (numW + 1) * font.widthOfTextAtSize('M', size), y, size, font, color: rgb(0.05, 0.05, 0.08) });
      y -= lead;
    }
  }
  if (cut) {
    if (y < margin) { page = doc.addPage([595, 842]); y = 842 - margin; }
    page.drawText('... (the rest of this file is not shown on this printout)', { x: margin, y, size, font: bold, color: rgb(0.6, 0.1, 0.1) });
  }
  doc.setTitle(pdfSafe(name)); doc.setProducer('Bwenge.AI');
  return Buffer.from(await doc.save());
}

/** A Jupyter notebook as text: markdown cells as they are, code cells with their code (outputs are left out). */
function notebookText(buf: Buffer): string {
  try {
    const nb = JSON.parse(buf.toString('utf8'));
    return (nb.cells ?? []).map((c: any, i: number) => {
      const src = Array.isArray(c.source) ? c.source.join('') : String(c.source ?? '');
      return `# [${c.cell_type === 'code' ? 'code' : 'text'} cell ${i + 1}]\n${src}`;
    }).join('\n\n');
  } catch { return buf.toString('utf8'); }
}

/** One handed-in file as PDF pages, or null when it is not meant to be marked (a recording, a video). */
export async function fileToPdf(name: string, mime: string, data: Buffer): Promise<Buffer | null> {
  const e = ext(name);
  if (e === 'pdf') return data;
  if (IMAGE.test(name)) return imagesToPdf([data]);
  if (VIDEO_EXT.includes(e)) return null;
  if (e === 'zip') return folderToPdf(name, data);
  if (DOC_EXT.includes(e) && e !== 'txt' && e !== 'md') return typedToPdf({ name, buffer: data, mime });
  if (e === 'ipynb') return codeToPdf(name, notebookText(data));
  if (SHEET_EXT.includes(e) || SLIDE_EXT.includes(e)) {
    const ex = await extractText({ name, mime, data });
    if (ex.kind !== 'text' || !(ex.text ?? '').trim()) throw new HandInError(`${name} has nothing readable in it.`);
    return codeToPdf(name, ex.text!);
  }
  if (CODE_EXT.includes(e) || e === 'txt' || e === 'md' || looksTextual(data)) {
    if (!looksTextual(data)) throw new HandInError(`${name} is not a text file.`);
    return codeToPdf(name, data.toString('utf8').replace(/^﻿/, '').slice(0, MAX_FILE_TEXT));
  }
  throw new HandInError(`${name} cannot be turned into pages for marking.`);
}

/** A folder (ZIP): a contents listing, then each readable file in path order. */
export async function folderToPdf(zipName: string, data: Buffer): Promise<Buffer> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(data); } catch { throw new HandInError(`${zipName} could not be opened as a ZIP file.`); }
  const entries = Object.values(zip.files).filter((x) => !x.dir && !SKIP_DIRS.test(x.name) && !/(^|\/)\./.test(x.name));
  if (!entries.length) throw new HandInError(`${zipName} has no files in it.`);
  if (entries.length > MAX_ENTRIES) throw new HandInError(`${zipName} has ${entries.length} files; the limit is ${MAX_ENTRIES}. Remove build output and libraries.`);
  // Stop a "zip bomb" before anything is unpacked: the sizes the archive claims must fit.
  const claimed = entries.reduce((n, x) => n + (Number((x as any)._data?.uncompressedSize) || 0), 0);
  if (claimed > MAX_UNZIPPED) throw new HandInError(`${zipName} is larger than ${MAX_UNZIPPED / 1048576} MB once unpacked.`);
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const parts: Buffer[] = [];
  const listing: string[] = [`Folder: ${zipName}`, `${entries.length} file${entries.length === 1 ? '' : 's'}`, ''];
  let total = 0, pages = 0;
  const skipped: string[] = [];
  const out: Array<{ name: string; buf: Buffer }> = [];
  for (const x of entries) {
    const buf = await x.async('nodebuffer');
    total += buf.length;
    if (total > MAX_UNZIPPED) throw new HandInError(`${zipName} is larger than ${MAX_UNZIPPED / 1048576} MB once unpacked.`);
    listing.push(`${x.name}  (${buf.length < 1024 ? `${buf.length} B` : `${Math.round(buf.length / 1024)} KB`})`);
    out.push({ name: x.name, buf });
  }
  parts.push(await codeToPdf('contents', listing.join('\n'), { maxPages: 4 }));
  for (const { name, buf } of out) {
    if (pages >= MAX_PAGES_TOTAL) { skipped.push(name); continue; }
    try {
      const e = ext(name);
      // Page photos inside the folder are read like any scan; everything else readable becomes pages.
      const pdf = e === 'pdf' ? buf : IMAGE.test(name) ? await imagesToPdf([buf]) : (CODE_EXT.includes(e) || DOC_EXT.includes(e) || SHEET_EXT.includes(e) || SLIDE_EXT.includes(e) || (looksTextual(buf) && buf.length <= MAX_FILE_TEXT))
        ? await fileToPdf(name, '', buf.length > MAX_FILE_TEXT && CODE_EXT.includes(e) ? buf.subarray(0, MAX_FILE_TEXT) : buf) : null;
      if (!pdf) { skipped.push(name); continue; }
      const n = (await PDFDocument.load(pdf, { ignoreEncryption: true })).getPageCount();
      pages += n; parts.push(pdf);
    } catch { skipped.push(name); }
  }
  if (skipped.length) parts.push(await codeToPdf('not shown', `These files are in the folder but are not shown as pages (binary files, videos, or too many pages):\n\n${skipped.slice(0, 80).join('\n')}`, { maxPages: 3 }));
  return mergePdfs(parts);
}

export async function mergePdfs(parts: Buffer[]): Promise<Buffer> {
  if (parts.length === 1) return parts[0];
  const out = await PDFDocument.create();
  for (const p of parts) {
    const doc = await PDFDocument.load(p, { ignoreEncryption: true });
    for (const page of await out.copyPages(doc, doc.getPageIndices())) out.addPage(page);
  }
  return Buffer.from(await out.save());
}
