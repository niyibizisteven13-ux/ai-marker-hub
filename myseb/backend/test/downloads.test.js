import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { downloadRouter, device, releaseLinks, files } from '../src/downloads.js';

const release = { tag_name: 'myseb-v1', assets: Object.values(files).map(name => ({ name, state: 'uploaded', size: 100, browser_download_url: `https://example.com/${name}` })) };
test('detects supported platforms without confusing Android, iPad or ChromeOS', () => {
  for (const [ua, expected] of [['Windows NT 10.0', 'windows'], ['Linux Android 14', 'android'], ['iPhone', 'ios'], ['iPad', 'ios'], ['Macintosh Mobile/15 Safari', 'ios'], ['Macintosh Intel Mac OS X', 'mac'], ['X11 Linux x86_64', 'linux'], ['X11 CrOS x86_64', ''], ['', '']]) assert.equal(device(ua), expected);
});
test('selects real MySEB assets and excludes unrelated, draft and prerelease releases', () => {
  assert.deepEqual(releaseLinks([{ ...release, tag_name: 'apk-latest' }, { ...release, draft: true }, { ...release, prerelease: true }]), {});
  assert.equal(releaseLinks([release]).windows, 'https://example.com/MySEB-win.exe');
  assert.deepEqual(releaseLinks([{ ...release, assets: [] }]), {});
});
test('redirects devices directly; offers honest iOS fallback and manual chooser', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => [release] });
  const app = express(); app.use('/download', downloadRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/download`;
  try {
    for (const [ua, filename] of [['Windows NT', 'MySEB-win.exe'], ['Android', 'MySEB.apk'], ['Macintosh', 'MySEB-mac.dmg'], ['Linux', 'MySEB-linux.AppImage']]) {
      const r = await originalFetch(base, { headers: { 'User-Agent': ua }, redirect: 'manual' });
      assert.equal(r.status, 302); assert.equal(r.headers.get('location'), `https://example.com/${filename}`);
      assert.equal(r.headers.get('cache-control'), 'no-store');
    }
    let r = await originalFetch(base, { headers: { 'User-Agent': 'iPhone' } });
    assert.match(await r.text(), /iPhone and iPad app is not available yet/);
    process.env.MYSEB_DL_IOS = 'https://testflight.apple.com/join/example';
    r = await originalFetch(base + '?platform=ios', { redirect: 'manual' });
    assert.equal(r.headers.get('location'), process.env.MYSEB_DL_IOS);
    process.env.MYSEB_DL_IOS = 'https://example.com/fake.ipa';
    r = await originalFetch(base + '?platform=ios'); assert.equal(r.status, 200);
    r = await originalFetch(base + '?choose=1', { headers: { 'User-Agent': 'Windows NT' } });
    assert.equal(r.status, 200); assert.match(await r.text(), /Download for Windows/);
    r = await originalFetch(base + '?platform=invalid'); assert.equal(r.status, 400);
  } finally { globalThis.fetch = originalFetch; delete process.env.MYSEB_DL_IOS; await new Promise(resolve => server.close(resolve)); }
});
