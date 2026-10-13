import JSZip from 'jszip';
import { csvCell } from '../../util/text.js';
import { TEXT_EXTENSIONS } from '../mime.js';

export function generateCsv(rows: unknown[][], header?: string[]): Buffer {
  const lines: string[] = [];
  if (header?.length) lines.push(header.map(csvCell).join(','));
  for (const r of rows) lines.push(r.map(csvCell).join(','));
  // BOM so Excel opens UTF-8 (Kinyarwanda/French accents) correctly.
  return Buffer.from('\ufeff' + lines.join('\r\n') + '\r\n', 'utf8');
}

export const MAX_TEXT_BYTES = 5 * 1024 * 1024;

export function generateTextFile(extension: string, content: string): { data: Buffer; ext: string } {
  const ext = extension.replace(/^\./, '').toLowerCase();
  if (!TEXT_EXTENSIONS[ext]) throw new Error(`Unsupported text file type ".${ext}". Allowed: ${Object.keys(TEXT_EXTENSIONS).join(', ')}.`);
  if (typeof content !== 'string') throw new Error('Content must be a string.');
  if (content.includes('\0')) throw new Error('Content looks binary.');
  const data = Buffer.from(content, 'utf8');
  if (data.length > MAX_TEXT_BYTES) throw new Error('Content is larger than 5 MB.');
  return { data, ext };
}

export async function generateZip(entries: Array<{ name: string; data: Buffer }>): Promise<Buffer> {
  if (!entries.length) throw new Error('Archive needs at least one file.');
  if (entries.length > 200) throw new Error('Too many files in the archive (max 200).');
  const zip = new JSZip();
  const used = new Set<string>();
  let total = 0;
  for (const e of entries) {
    let name = e.name.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..').join('/') || 'file';
    let n = 2;
    while (used.has(name)) name = name.replace(/(\.[^./]+)?$/, (ext) => `-${n++}${ext}`);
    used.add(name);
    total += e.data.length;
    if (total > 100 * 1024 * 1024) throw new Error('Archive is larger than 100 MB.');
    zip.file(name, e.data);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
