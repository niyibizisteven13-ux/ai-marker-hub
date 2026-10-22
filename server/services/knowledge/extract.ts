import { readFile, stat } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { parse as parseCsv } from 'csv-parse/sync';
import sanitizeHtml from 'sanitize-html';
import { extensionOf } from './paths.js';

/**
 * Text extraction for indexing and previews. Keeps location (page, slide, sheet, section) so every chunk
 * can be cited. Parsers only read; nothing in a document is executed. Untrusted content stays data.
 */

export interface Segment { text: string; page?: number; slide?: number; sheet?: string; section?: string }
export interface SheetData { name: string; columns: string[]; rows: string[][]; totalRows: number; truncated: boolean }
export interface Extracted {
  supported: boolean;
  method: 'text' | 'markdown' | 'json' | 'html' | 'rtf' | 'pdf_text' | 'pdf_text+ocr' | 'ocr' | 'docx' | 'spreadsheet' | 'slides' | 'none';
  segments: Segment[];
  sheets: SheetData[];
  pages?: number;
  warnings: string[];
}
export type Ocr = (png: Buffer) => Promise<{ text: string; confidence: number }>;

export class ExtractionError extends Error {
  constructor(public code: 'ENCRYPTED' | 'MALFORMED' | 'TOO_LARGE', message: string) {
    super(message);
  }
}

export interface ExtractOptions {
  ocr?: Ocr;
  /** Characters kept in total; the rest is reported as truncated. */
  maxChars?: number;
  maxSheetRows?: number;
  /** Files above this size are not parsed in memory. */
  maxParseBytes?: number;
}

const env = (k: string, d: number) => (Number(process.env[k]) > 0 ? Number(process.env[k]) : d);
const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'yaml', 'yml', 'xml', 'log']);

export function decodeText(buf: Buffer): string {
  return buf.toString('utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
}

export function htmlToText(html: string): string {
  // Scripts, styles and other non-text elements are dropped with their content.
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {}, nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe', 'object', 'template'] })
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

/** Safe subset of HTML for an explorer preview (no scripts, styles, forms, frames, event handlers or remote images). */
export function safePreviewHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 'code', 'pre', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'span', 'div', 'sub', 'sup'],
    allowedAttributes: { a: ['href'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' }) },
  });
}

export function rtfToText(rtf: string): string {
  return rtf
    .replace(/\{\\\*[^{}]*\}/g, '')
    .replace(/\\'([0-9a-fA-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\par[d]?\b ?/g, '\n').replace(/\\line\b ?/g, '\n').replace(/\\tab\b ?/g, '\t')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '').replace(/\\([{}\\])/g, '$1').replace(/[{}]/g, '')
    .replace(/\n\s*\n+/g, '\n\n').trim();
}

function markdownSections(text: string): Segment[] {
  const out: Segment[] = [];
  let section: string | undefined;
  let buf: string[] = [];
  const flush = () => { const t = buf.join('\n').trim(); if (t) out.push({ text: t, section }); buf = []; };
  for (const line of text.split('\n')) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flush(); section = h[2].trim().slice(0, 200); }
    buf.push(line);
  }
  flush();
  return out;
}

/** Mammoth HTML → heading-based sections; tables become "a | b | c" rows. */
function docxSections(html: string): Segment[] {
  // Each table row becomes one paragraph "cell | cell | cell" (cells may contain their own <p> elements).
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const blocks = html.replace(/<table[\s\S]*?<\/table>/g, (t) => [...t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((r) => `<p>${esc([...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => htmlToText(c[1]).replace(/\s+/g, ' ')).join(' | '))}</p>`).join(''));
  const out: Segment[] = [];
  let section: string | undefined;
  let buf: string[] = [];
  const flush = () => { const t = buf.join('\n').trim(); if (t) out.push({ text: t, section }); buf = []; };
  for (const m of blocks.matchAll(/<(h[1-6]|p|li)[^>]*>([\s\S]*?)<\/\1>/g)) {
    const text = htmlToText(m[2]);
    if (!text) continue;
    if (m[1].startsWith('h')) { flush(); section = text.slice(0, 200); }
    buf.push(m[1] === 'li' ? `- ${text}` : text);
  }
  flush();
  return out;
}

/** Sheet rows → chunks that repeat the column names, so each chunk is understandable on its own. */
export function sheetSegments(sheet: SheetData, maxChars = 1500): Segment[] {
  const out: Segment[] = [];
  const header = `Sheet "${sheet.name}" columns: ${sheet.columns.join(' | ')}`;
  let rows: string[] = [];
  let first = 2;
  const flush = (last: number) => { if (rows.length) out.push({ text: `${header}\n${rows.join('\n')}`, sheet: sheet.name, section: `rows ${first}-${last}` }); rows = []; };
  sheet.rows.forEach((r, i) => {
    const line = `Row ${i + 2}: ${r.map((v, c) => (v === '' ? '' : `${sheet.columns[c] || `col${c + 1}`}=${v}`)).filter(Boolean).join('; ')}`;
    if (rows.length && header.length + rows.join('\n').length + line.length > maxChars) { flush(i + 1); first = i + 2; }
    rows.push(line.slice(0, maxChars));
  });
  flush(sheet.rows.length + 1);
  return out;
}

export async function readXlsx(buf: Buffer, maxRows: number): Promise<SheetData[]> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf as any); } catch { throw new ExtractionError('MALFORMED', 'The workbook could not be opened (damaged or password-protected).'); }
  return wb.worksheets.map((ws) => {
    const all: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (all.length > maxRows) return;
      const vals = (row.values as unknown[]).slice(1).slice(0, 200).map((v) => {
        if (v === null || v === undefined) return '';
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === 'object') { const o = v as any; return String(o.result ?? o.text ?? (o.richText ? o.richText.map((x: any) => x.text).join('') : o.hyperlink ?? '')); }
        return String(v);
      });
      all.push(vals);
    });
    const columns = (all[0] ?? []).map((c, i) => c || `Column ${i + 1}`);
    return { name: ws.name, columns, rows: all.slice(1, maxRows + 1), totalRows: Math.max(0, ws.actualRowCount - 1), truncated: ws.actualRowCount - 1 > maxRows };
  });
}

export function readCsv(text: string, delimiter: string, maxRows: number): SheetData {
  let records: string[][];
  try {
    records = parseCsv(text, { delimiter, relax_column_count: true, relax_quotes: true, skip_empty_lines: true, to: maxRows + 1 }) as string[][];
  } catch {
    throw new ExtractionError('MALFORMED', 'The CSV could not be parsed.');
  }
  const totalRows = Math.max(0, text.split('\n').filter((l) => l.trim()).length - 1);
  return { name: 'Sheet1', columns: (records[0] ?? []).map((c, i) => c || `Column ${i + 1}`), rows: records.slice(1), totalRows, truncated: totalRows > maxRows };
}

export async function pptxSlides(buf: Buffer): Promise<Array<{ slide: number; text: string; notes: string }>> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(buf); } catch { throw new ExtractionError('MALFORMED', 'The presentation could not be opened.'); }
  const names = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]));
  const out = [];
  for (const f of names) {
    const n = Number(/slide(\d+)\.xml$/.exec(f)![1]);
    const xml = await zip.file(f)!.async('string');
    const notesXml = await zip.file(`ppt/notesSlides/notesSlide${n}.xml`)?.async('string');
    const texts = (x: string) => [...x.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((p) => [...p[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join('')).filter(Boolean).join('\n');
    const decode = (x: string) => x.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    out.push({ slide: n, text: decode(texts(xml)), notes: notesXml ? decode(texts(notesXml)).replace(/^\d+$/gm, '').trim() : '' });
  }
  return out;
}

async function pdfPages(buf: Buffer, ocr: Ocr | undefined, warnings: string[]): Promise<{ segments: Segment[]; pages: number; ocrPages: number }> {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    let res;
    try { res = await parser.getText(); } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (/password|encrypt/i.test(msg) || (e as any)?.name === 'PasswordException') throw new ExtractionError('ENCRYPTED', 'The PDF is password-protected; remove the password and upload it again.');
      throw new ExtractionError('MALFORMED', 'The PDF could not be read (it may be damaged).');
    }
    const segments: Segment[] = [];
    let ocrPages = 0;
    for (const p of res.pages) {
      let text = (p.text ?? '').trim();
      if (text.replace(/\s+/g, '').length < 25) {
        if (ocr) {
          try {
            const shot = await parser.getScreenshot({ partial: [p.num], scale: 2, imageBuffer: true, imageDataUrl: false });
            const img = shot.pages[0]?.data;
            if (img) { const r = await ocr(Buffer.from(img)); if (r.text.trim()) { text = r.text.trim(); ocrPages++; if (r.confidence < 60) warnings.push(`Page ${p.num}: OCR confidence is low (${Math.round(r.confidence)}).`); } }
          } catch { warnings.push(`Page ${p.num}: OCR failed.`); }
        } else warnings.push(`Page ${p.num} has no text layer and OCR is not available.`);
      }
      if (text) segments.push({ text, page: p.num });
    }
    return { segments, pages: res.total, ocrPages };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

/** Extracts indexable content from a local file (a temporary copy of the stored object). */
export async function extractForIndex(localPath: string, name: string, opts: ExtractOptions = {}): Promise<Extracted> {
  const ext = extensionOf(name);
  const maxChars = opts.maxChars ?? env('KNOWLEDGE_MAX_INDEX_CHARS', 2_000_000);
  const maxRows = opts.maxSheetRows ?? env('KNOWLEDGE_MAX_SHEET_ROWS', 5000);
  const size = (await stat(localPath)).size;
  if (size > (opts.maxParseBytes ?? env('KNOWLEDGE_MAX_PARSE_BYTES', 60 * 1024 * 1024))) {
    return { supported: false, method: 'none', segments: [], sheets: [], warnings: [`The file is too large to index (${Math.round(size / 1048576)} MB); it is stored and can be downloaded.`] };
  }
  const warnings: string[] = [];
  const done = (r: Omit<Extracted, 'warnings' | 'supported'> & { supported?: boolean }): Extracted => {
    let total = 0;
    const segments: Segment[] = [];
    for (const s of r.segments) {
      if (total >= maxChars) { warnings.push(`Only the first ${maxChars.toLocaleString()} characters were indexed.`); break; }
      const t = s.text.slice(0, maxChars - total);
      total += t.length;
      segments.push({ ...s, text: t });
    }
    return { supported: r.supported ?? true, method: r.method, segments, sheets: r.sheets, pages: r.pages, warnings };
  };

  if (TEXT_EXT.has(ext)) {
    const text = decodeText(await readFile(localPath));
    return done({ method: ext === 'md' || ext === 'markdown' ? 'markdown' : 'text', segments: ext === 'md' || ext === 'markdown' ? markdownSections(text) : [{ text }], sheets: [] });
  }
  if (ext === 'json') {
    const raw = decodeText(await readFile(localPath));
    let text = raw;
    try { text = JSON.stringify(JSON.parse(raw), null, 2); } catch { warnings.push('The JSON is not valid; indexed as text.'); }
    return done({ method: 'json', segments: [{ text }], sheets: [] });
  }
  if (ext === 'html' || ext === 'htm') return done({ method: 'html', segments: [{ text: htmlToText(decodeText(await readFile(localPath))) }], sheets: [] });
  if (ext === 'rtf') return done({ method: 'rtf', segments: [{ text: rtfToText(decodeText(await readFile(localPath))) }], sheets: [] });
  if (ext === 'csv' || ext === 'tsv') {
    const sheet = readCsv(decodeText(await readFile(localPath)), ext === 'tsv' ? '\t' : ',', maxRows);
    if (sheet.truncated) warnings.push(`Only the first ${maxRows.toLocaleString()} rows were indexed.`);
    return done({ method: 'spreadsheet', segments: sheetSegments(sheet), sheets: [sheet] });
  }
  if (ext === 'xlsx') {
    const sheets = await readXlsx(await readFile(localPath), maxRows);
    for (const s of sheets) if (s.truncated) warnings.push(`Sheet "${s.name}": only the first ${maxRows.toLocaleString()} rows were indexed.`);
    return done({ method: 'spreadsheet', segments: sheets.flatMap((s) => sheetSegments(s)), sheets });
  }
  if (ext === 'docx') {
    let html: string;
    try { html = (await mammoth.convertToHtml({ buffer: await readFile(localPath) })).value; } catch { throw new ExtractionError('MALFORMED', 'The Word document could not be opened.'); }
    return done({ method: 'docx', segments: docxSections(html), sheets: [] });
  }
  if (ext === 'pptx') {
    const slides = await pptxSlides(await readFile(localPath));
    return done({ method: 'slides', segments: slides.filter((s) => s.text || s.notes).map((s) => ({ text: [s.text, s.notes ? `Speaker notes: ${s.notes}` : ''].filter(Boolean).join('\n'), slide: s.slide, section: `Slide ${s.slide}` })), sheets: [] });
  }
  if (ext === 'pdf') {
    const r = await pdfPages(await readFile(localPath), opts.ocr, warnings);
    return done({ method: r.ocrPages ? (r.ocrPages === r.segments.length ? 'ocr' : 'pdf_text+ocr') : 'pdf_text', segments: r.segments, sheets: [], pages: r.pages });
  }
  if (['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'gif'].includes(ext)) {
    if (!opts.ocr) return { supported: false, method: 'none', segments: [], sheets: [], warnings: ['OCR is not available, so the image was stored without indexing.'] };
    const sharp = (await import('sharp')).default;
    const png = await sharp(localPath, { limitInputPixels: 80_000_000 }).rotate().png().toBuffer().catch(() => { throw new ExtractionError('MALFORMED', 'The image could not be decoded.'); });
    const r = await opts.ocr(png);
    if (r.confidence < 60) warnings.push(`OCR confidence is low (${Math.round(r.confidence)}).`);
    return done({ method: 'ocr', segments: r.text.trim() ? [{ text: r.text.trim(), page: 1 }] : [], sheets: [] });
  }
  return { supported: false, method: 'none', segments: [], sheets: [], warnings: [`.${ext || 'unknown'} files are stored and downloadable but not indexed.`] };
}
