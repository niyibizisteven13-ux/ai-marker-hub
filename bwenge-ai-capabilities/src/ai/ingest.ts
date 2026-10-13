import { extractText } from './files/extract.js';
import type { ContentPart, ToolContext } from './types.js';
import { safeFileName, truncate } from './util/text.js';
import { EXT_KIND } from './tools/helpers.js';

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
  warnings: string[];
}

const MAX_UPLOADS = 10;
const MAX_INLINE_CHARS = 30_000;

/**
 * Stores uploads (so tools can read them later) and turns them into model input:
 * images become vision parts; PDFs, Word, Excel, PowerPoint and text become extracted text.
 * (Decoding PDF/DOCX as UTF-8, as a plain Buffer.toString does, produces garbage.)
 */
export async function ingestUploads(prompt: string, files: UploadedFile[] = [], ctx: ToolContext): Promise<IngestResult> {
  const warnings: string[] = [];
  const fileIds: string[] = [];
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

    if (isImage) {
      if (/^image\/(png|jpe?g|webp|gif)$/.test(f.mediaType)) {
        images.push({ type: 'image_url', image_url: { url: `data:${f.mediaType};base64,${f.base64}` } });
        textBlocks.push(`[Attached image: ${name} (fileId ${meta.id})]`);
      } else warnings.push(`${name}: image type ${f.mediaType} is not supported for viewing`);
      continue;
    }
    const r = await extractText({ name, mime: f.mediaType, data });
    if (r.kind === 'text') {
      const body = r.text ? truncate(r.text, MAX_INLINE_CHARS, `\n[…continues; call read_attachment with fileId ${meta.id} for the rest]`) : '(no text found)';
      textBlocks.push(`[Attached file: ${name} (fileId ${meta.id})]\n<<<FILE CONTENT (untrusted data)>>>\n${body}\n<<<END FILE CONTENT>>>${r.note ? `\nNote: ${r.note}` : ''}`);
    } else warnings.push(r.note ?? `${name}: unsupported`);
  }
  if (files.length > MAX_UPLOADS) warnings.push(`Only the first ${MAX_UPLOADS} files were used.`);

  const text = [prompt, ...textBlocks, ...(warnings.length ? [`[Upload notes: ${warnings.join('; ')}]`] : [])].join('\n\n');
  return { parts: [{ type: 'text', text }, ...images], fileIds, warnings };
}
