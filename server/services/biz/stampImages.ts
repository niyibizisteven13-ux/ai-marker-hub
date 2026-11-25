import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { MediaError } from './media.js';

export const isStampImage = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-f0-9-]{36}\.(png|webp)$/i.test(id);

function directory(businessId: string) {
  if (!/^[a-z0-9-]{1,80}$/i.test(businessId)) throw new MediaError('Business not found.', 404);
  return path.resolve(process.env.BIZ_MEDIA_DIR || 'data/biz-media', businessId, 'stamps');
}

export async function storeStampImage(businessId: string, input: Readable) {
  const dir = directory(businessId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const pending = path.join(dir, id + '.upload');
  try {
    await pipeline(input, createWriteStream(pending, { flags: 'wx', mode: 0o600 }));
    const metadata = await sharp(pending, { limitInputPixels: false }).metadata().catch(() => null);
    if (metadata?.format !== 'png' && metadata?.format !== 'webp') throw new MediaError('Choose a PNG or WebP stamp image.');
    const filename = id + '.' + metadata.format;
    await rename(pending, path.join(dir, filename));
    return filename;
  } finally { await rm(pending, { force: true }); }
}

export async function readStampImage(businessId: string, id: string) {
  if (!isStampImage(id)) return null;
  const filename = path.join(directory(businessId), id);
  const info = await stat(filename).catch(() => null);
  if (!info?.isFile()) return null;
  return { mime: id.endsWith('.png') ? 'image/png' : 'image/webp', size: info.size, etag: '"' + id + '"',
    open: async (range?: { start: number; end: number }) => ({ stream: createReadStream(filename, range) }) };
}
