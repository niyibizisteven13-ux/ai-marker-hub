import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import sharp from 'sharp';
import { storeStampImage, readStampImage } from '../server/services/biz/stampImages.js';

test('stamp storage keeps the original alpha and bytes, including large uploads and replaced images', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'meal-stamps-'));
  const previous = process.env.BIZ_MEDIA_DIR;
  process.env.BIZ_MEDIA_DIR = root;
  try {
    const source = sharp({ create: { width: 1600, height: 1600, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0 } } });
    const png = await source.clone().png({ compressionLevel: 0 }).toBuffer();
    assert(png.length > 6 * 1024 * 1024);
    const first = await storeStampImage('canteen', Readable.from(png));
    const second = await storeStampImage('canteen', Readable.from(await source.clone().webp().toBuffer()));
    for (const [id, mime] of [[first, 'image/png'], [second, 'image/webp']]) {
      const asset = await readStampImage('canteen', id);
      assert(asset);
      assert.equal(asset.mime, mime);
      const bytes = await buffer((await asset.open()).stream);
      assert.equal((await sharp(bytes).metadata()).hasAlpha, true);
      if (id === first) assert.deepEqual(bytes, png);
    }
    assert.equal(await readStampImage('another-business', first), null);
    await assert.rejects(storeStampImage('canteen', Readable.from('invalid image')));
    assert.deepEqual((await readdir(path.join(root, 'canteen', 'stamps'))).sort(), [first, second].sort());
  } finally {
    if (previous === undefined) delete process.env.BIZ_MEDIA_DIR; else process.env.BIZ_MEDIA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
