import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import JSZip from 'jszip';
import { PROFILE_DOCUMENT_MIMES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, type MediaKind } from './model.js';

/**
 * Photos and short videos of a business page. The kind of a file is decided by its first bytes, never by its name or the type the browser
 * claims: only JPEG, PNG, WebP and GIF pictures and MP4 and WebM videos are accepted (no SVG, no HTML, nothing that could run in a browser).
 */
export interface Sniffed { kind: MediaKind; mime: string; ext: string }

export function sniff(b: Buffer): Sniffed | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'image', mime: 'image/png', ext: 'png' };
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return { kind: 'image', mime: 'image/webp', ext: 'webp' };
  if (b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a') return { kind: 'image', mime: 'image/gif', ext: 'gif' };
  if (b.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = b.subarray(8, 12).toString('latin1');
    if (/^(heic|heix|hevc|mif1|avif|avis)/.test(brand)) return null;                 // photos in formats browsers do not all show
    return { kind: 'video', mime: 'video/mp4', ext: 'mp4' };
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: 'video', mime: 'video/webm', ext: 'webm' };
  return null;
}

export const maxBytesFor = (kind: MediaKind) => kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

// Inspect Office package entries without expanding their contents. Documents are delivered as attachments.
const officeParts = { docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml' } as const;
export async function sniffDocument(data: Buffer, name: string): Promise<Sniffed | null> {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf' && /^%PDF-\d\.\d/.test(data.subarray(0, 8).toString('ascii'))) {
    return { kind: 'document', mime: PROFILE_DOCUMENT_MIMES.pdf, ext };
  }
  if ((ext !== 'docx' && ext !== 'xlsx' && ext !== 'pptx') || data.length < 4 || data.readUInt32LE(0) !== 0x04034b50) return null;
  try {
    const zip = await JSZip.loadAsync(data);
    if (!zip.file('[Content_Types].xml') || !zip.file(officeParts[ext]) ||
      Object.keys(zip.files).some((name) => /(?:^|\/)vbaProject\.bin$/i.test(name))) return null;
    return { kind: 'document', mime: PROFILE_DOCUMENT_MIMES[ext], ext };
  } catch {
    return null;
  }
}

export class MediaError extends Error { constructor(message: string, public status = 400) { super(message); } }

export interface MediaStore {
  put(businessId: string, mediaId: string, ext: string, data: Buffer): Promise<void>;
  /** A readable stream of the bytes (or a part of them), and the total size. */
  open(businessId: string, mediaId: string, ext: string, range?: { start: number; end: number }): Promise<{ stream: Readable; size: number }>;
  /** The size in bytes, or null when there is no such file. */
  size(businessId: string, mediaId: string, ext: string): Promise<number | null>;
  remove(businessId: string, mediaId: string, ext: string): Promise<void>;
  removeAll(businessId: string): Promise<void>;
}

const SAFE = /^[A-Za-z0-9-]{1,80}$/;
/** Files on disk under one folder per business. Ids are checked so no name can point outside the folder. */
export function diskMediaStore(root = process.env.BIZ_MEDIA_DIR || path.resolve(process.cwd(), 'data', 'biz-media')): MediaStore {
  const file = (biz: string, id: string, ext: string) => { if (!SAFE.test(biz) || !SAFE.test(id) || !/^[a-z0-9]{2,5}$/.test(ext)) throw new MediaError('Not found.', 404); return path.join(root, biz, `${id}.${ext}`); };
  return {
    async put(biz, id, ext, data) { const f = file(biz, id, ext); await mkdir(path.dirname(f), { recursive: true, mode: 0o700 }); await writeFile(f, data, { mode: 0o600 }); },
    async open(biz, id, ext, range) {
      const f = file(biz, id, ext); const s = await stat(f).catch(() => null); if (!s) throw new MediaError('Not found.', 404);
      return { stream: createReadStream(f, range ? { start: range.start, end: range.end } : undefined), size: s.size };
    },
    async size(biz, id, ext) { return (await stat(file(biz, id, ext)).catch(() => null))?.size ?? null; },
    async remove(biz, id, ext) { await rm(file(biz, id, ext), { force: true }); },
    async removeAll(biz) { if (!SAFE.test(biz)) return; await rm(path.join(root, biz), { recursive: true, force: true }); },
  };
}

/** An in-memory store for tests. */
export function memoryMediaStore(): MediaStore & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>(); const k = (b: string, i: string, e: string) => `${b}/${i}.${e}`;
  return {
    files,
    async put(b, i, e, d) { files.set(k(b, i, e), Buffer.from(d)); },
    async open(b, i, e, r) { const d = files.get(k(b, i, e)); if (!d) throw new MediaError('Not found.', 404); const { Readable } = await import('node:stream'); return { stream: Readable.from(r ? d.subarray(r.start, r.end + 1) : d), size: d.length }; },
    async size(b, i, e) { return files.get(k(b, i, e))?.length ?? null; },
    async remove(b, i, e) { files.delete(k(b, i, e)); },
    async removeAll(b) { for (const key of [...files.keys()]) if (key.startsWith(`${b}/`)) files.delete(key); },
  };
}
