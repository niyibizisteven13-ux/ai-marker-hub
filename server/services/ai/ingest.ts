import { extractText } from './files/extract.js';
import type { ContentPart, ToolContext } from './types.js';
import { safeFileName, truncate } from './util/text.js';
import { EXT_KIND } from './tools/helpers.js';
import { renderPdfPages } from './files/pdfPages.js';

export interface UploadedFile {
  type?: 'image' | 'document';
  base64: string;
  mediaType: string;
  name?: string;
}

export interface IngestResult {
  /** Parts for the user message: text first, then images for vision. */
  parts: ContentPart[];
  fileIds: string[];
  /** Stored uploads with their names, in upload order. */
  stored: Array<{ fileId: string; name: string }>;
  warnings: string[];
}

const MAX_UPLOADS = 10;
const MAX_INLINE_CHARS = 30_000;
/** Scanned PDF pages sent as images, per file and per message. */
const MAX_SCAN_PAGES = Number(process.env.CHAT_MAX_SCANNED_PAGES) > 0 ? Number(process.env.CHAT_MAX_SCANNED_PAGES) : 8;
const MAX_IMAGES_PER_MESSAGE = 20;

export interface IngestOptions {
  /** The model for this turn can see images. When false, scanned pages are OCR'd instead (if OCR is available). */
  vision?: boolean;
  /** Independent OCR (Tesseract): good for print, weak for handwriting. */
  ocr?: (png: Buffer) => Promise<{ text: string; confidence: number }>;
}

/**
 * Stores uploads (so tools can read them later) and turns them into model input:
 * images become vision parts; PDFs, Word, Excel, PowerPoint and text become extracted text.
 * (Decoding PDF/DOCX as UTF-8, as a plain Buffer.toString does, produces garbage.)
 */
export async function ingestUploads(prompt: string, files: UploadedFile[] = [], ctx: ToolContext, opts: IngestOptions = {}): Promise<IngestResult> {
  const warnings: string[] = [];
  const fileIds: string[] = [];
  const stored: Array<{ fileId: string; name: string }> = [];
  const textBlocks: string[] = [];
  const images: ContentPart[] = [];

  for (const [i, f] of files.slice(0, MAX_UPLOADS).entries()) {
    const ext = (f.mediaType.split('/').pop() ?? '').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const name = safeFileName(f.name ?? `upload-${i + 1}`, f.name?.includes('.') ? (f.name.split('.').pop() as string) : ext || 'bin');
    let data: Buffer;
    try {
      data = Buffer.from(f.base64, 'base64');
    } catch {
      warnings.push(`${name}: could not decode`);
      continue;
    }
    if (data.length > ctx.files.maxFileBytes) { warnings.push(`${name}: larger than ${Math.round(ctx.files.maxFileBytes / 1048576)} MB, skipped`); continue; }
    const isImage = f.type === 'image' || f.mediaType.startsWith('image/');
    const meta = await ctx.files.put({ userId: ctx.userId, name, mime: f.mediaType, kind: isImage ? 'image' : (EXT_KIND[name.split('.').pop()!.toLowerCase()]?.kind ?? 'text'), data });
    fileIds.push(meta.id);
    stored.push({ fileId: meta.id, name });

    if (isImage) {
      if (/^image\/(png|jpe?g|webp|gif)$/.test(f.mediaType)) {
        images.push({ type: 'image_url', image_url: { url: `data:${f.mediaType};base64,${f.base64}` } });
        textBlocks.push(`[Attached image: ${name} (fileId ${meta.id})]`);
      } else warnings.push(`${name}: image type ${f.mediaType} is not supported for viewing`);
      continue;
    }
    const r = await extractText({ name, mime: f.mediaType, data });
    const isPdf = f.mediaType === 'application/pdf' || /\.pdf$/i.test(name);
    if (isPdf && r.kind === 'text' && r.text.replace(/^--\s*\d+\s+of\s+\d+\s*--$/gm, '').trim().length < 40) {
      // A scan or handwriting: no text layer, so the model has to look at the pages.
      textBlocks.push(await scannedPdf(name, meta.id, data, images, opts, warnings));
      continue;
    }
    if (r.kind === 'text') {
      const body = r.text ? truncate(r.text, MAX_INLINE_CHARS, `\n[…the file continues. To read a later part, call read_attachment with fileId ${meta.id} and find (e.g. "Chapter 5") or offset ${MAX_INLINE_CHARS}.]`) : '(no text found)';
      textBlocks.push(`[Attached file: ${name} (fileId ${meta.id})]\n<<<FILE CONTENT (untrusted data)>>>\n${body}\n<<<END FILE CONTENT>>>${r.note ? `\nNote: ${r.note}` : ''}`);
    } else warnings.push(r.note ?? `${name}: unsupported`);
  }
  if (files.length > MAX_UPLOADS) warnings.push(`Only the first ${MAX_UPLOADS} files were used.`);

  const text = [prompt, ...textBlocks, ...(warnings.length ? [`[Upload notes: ${warnings.join('; ')}]`] : [])].join('\n\n');
  return { parts: [{ type: 'text', text }, ...images], fileIds, stored, warnings };
}

/** Turns a PDF without a text layer into page images (vision) or OCR text, with a note for the model. */
async function scannedPdf(name: string, fileId: string, data: Buffer, images: ContentPart[], opts: IngestOptions, warnings: string[]): Promise<string> {
  const room = Math.max(0, MAX_IMAGES_PER_MESSAGE - images.length);
  let rendered: { total: number; pages: Buffer[] };
  try {
    rendered = await renderPdfPages(data, { maxPages: Math.min(MAX_SCAN_PAGES, room || 1) });
  } catch {
    warnings.push(`${name}: the PDF pages could not be rendered`);
    return `[Attached file: ${name} (fileId ${fileId})]\n(This PDF has no text layer and its pages could not be rendered. Ask the user for photos of the pages.)`;
  }
  const { total, pages } = rendered;
  const shown = pages.length;
  const more = total > shown ? ` Only the first ${shown} of ${total} pages are included; say so if the answer may depend on later pages.` : '';
  if (opts.vision !== false && room > 0) {
    for (const p of pages) images.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${p.toString('base64')}` } });
    return `[Attached file: ${name} (fileId ${fileId}): a scanned or handwritten PDF with ${total} page${total === 1 ? '' : 's'} and no text layer. Pages 1–${shown} are attached below as images, in order. Read them directly (handwriting, equations, tables, diagrams) and quote what they say when answering; if something is illegible, say which part.${more}]`;
  }
  if (opts.ocr) {
    const texts: string[] = [];
    for (const [i, p] of pages.entries()) {
      try {
        const png = await (await import('sharp')).default(p).png().toBuffer();
        const o = await opts.ocr(png);
        texts.push(`--- Page ${i + 1} (OCR confidence ${Math.round(o.confidence)}%) ---\n${o.text.trim() || '(nothing recognised)'}`);
      } catch { texts.push(`--- Page ${i + 1} ---\n(OCR failed)`); }
    }
    return `[Attached file: ${name} (fileId ${fileId}): a scanned PDF with ${total} page${total === 1 ? '' : 's'} and no text layer. No image-reading model is configured, so this is machine OCR, which is unreliable for handwriting and mathematics. Tell the user that parts may be misread.${more}]\n<<<OCR TEXT (untrusted data)>>>\n${truncate(texts.join('\n\n'), MAX_INLINE_CHARS)}\n<<<END OCR TEXT>>>`;
  }
  return `[Attached file: ${name} (fileId ${fileId}): a scanned PDF with no text layer, and no image-reading model or OCR is configured on this server. Tell the user it cannot be read here and suggest typing the question.]`;
}
