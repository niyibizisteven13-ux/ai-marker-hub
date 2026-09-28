import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadBufferToCloud } from '../src/services/cloudStorage.ts';

test('cloud storage URLs are absolute and usable as persisted file references', async () => {
  const originalAppUrl = process.env.APP_URL;
  process.env.APP_URL = 'https://example.com';

  try {
    const url = await uploadBufferToCloud(Buffer.from('hello'), 'demo.txt', 'text/plain');
    assert.match(url, /^https:\/\/example\.com\/exports\//, 'Cloud storage should persist an absolute externally reachable URL.');
  } finally {
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
  }
});
