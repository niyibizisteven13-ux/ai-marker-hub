import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { TEXT_EXTENSIONS } from './mime.js';
import { truncate } from '../util/text.js';

export interface ExtractResult {
  kind: 'text' | 'image' | 'unsupported';
  text?: string;
  note?: string;
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']);

const extOf = (name: string) => (name.split('.').pop() ?? '').toLowerCase();

function stripTags(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * Turns an uploaded or generated file into text the model can read.
 * (Do not decode PDF/DOCX/XLSX as UTF-8: that produces garbage.)
 */
export async function extractText(file: { name: string; mime?: string; data: Buffer }, opts: { maxChars?: number } = {}): Promise<ExtractResult> {
  const maxChars = opts.maxChars ?? 120_000;
  const ext = extOf(file.name);
  const mime = (file.mime ?? '').toLowerCase();

  if (IMAGE_EXT.has(ext) || mime.startsWith('image/')) return { kind: 'image' };

  try {
    if (ext === 'docx' || mime.includes('wordprocessingml')) {
      const { value } = await mammoth.extractRawText({ buffer: file.data });
      return { kind: 'text', text: truncate(value.trim(), maxChars) };
    }
    if (ext === 'xlsx' || mime.includes('spreadsheetml')) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(file.data as any);
      const parts: string[] = [];
      let notes = '';
      for (const ws of wb.worksheets) {
        parts.push(`## Sheet: ${ws.name}`);
        let n = 0;
        ws.eachRow({ includeEmpty: false }, (row) => {
          if (n++ >= 500) return;
          const vals = (row.values as any[]).slice(1).map((v) => {
            if (v && typeof v === 'object') return 'result' in v ? String(v.result ?? '') : 'text' in v ? String(v.text) : v instanceof Date ? v.toISOString().slice(0, 10) : JSON.stringify(v);
            return v ?? '';
          });
          parts.push(vals.join('\t'));
        });
        if (ws.rowCount > 500) notes += `Sheet "${ws.name}" has ${ws.rowCount} rows; only the first 500 are shown. `;
      }
      return { kind: 'text', text: truncate(parts.join('\n'), maxChars), note: notes || undefined };
    }
    if (ext === 'pptx' || mime.includes('presentationml')) {
      const zip = await JSZip.loadAsync(file.data);
      const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
      const out: string[] = [];
      for (const [i, f] of slides.entries()) {
        const xml = await zip.file(f)!.async('string');
        const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
        out.push(`## Slide ${i + 1}\n${texts.join('\n')}`);
      }
      return { kind: 'text', text: truncate(out.join('\n\n'), maxChars) };
    }
    if (ext === 'pdf' || mime === 'application/pdf') {
      const parser = new PDFParse({ data: new Uint8Array(file.data) });
      try {
        const res = await parser.getText({ partial: Array.from({ length: 200 }, (_, i) => i + 1) } as any).catch(() => parser.getText());
        const text = res.text.trim();
        // pdf-parse adds "-- 1 of N --" page markers; a scan has only those and no real text.
        const meaningful = text.replace(/^--\s*\d+\s+of\s+\d+\s*--$/gm, '').trim();
        if (!meaningful) return { kind: 'text', text: '', note: 'This PDF has no extractable text (it may be a scan). Ask for a photo or use OCR/vision.' };
        return { kind: 'text', text: truncate(text, maxChars) };
      } finally {
        await parser.destroy?.();
      }
    }
    if (ext === 'html' || ext === 'htm' || mime.includes('html')) {
      return { kind: 'text', text: truncate(stripTags(file.data.toString('utf8')), maxChars) };
    }
    if (TEXT_EXTENSIONS[ext] || ext === 'tsv' || ext === 'log' || mime.startsWith('text/') || mime === 'application/json') {
      return { kind: 'text', text: truncate(file.data.toString('utf8').replace(/^\ufeff/, ''), maxChars) };
    }
    // Unknown type: accept it only if it looks like text.
    const sample = file.data.subarray(0, 4096);
    if (!sample.includes(0)) return { kind: 'text', text: truncate(file.data.toString('utf8'), maxChars) };
  } catch (err: any) {
    return { kind: 'unsupported', note: `Could not read ${file.name}: ${String(err?.message ?? err).slice(0, 200)}` };
  }
  return { kind: 'unsupported', note: `Unsupported file type: .${ext || 'unknown'}` };
}
