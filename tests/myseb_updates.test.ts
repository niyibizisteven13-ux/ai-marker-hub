import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { updateFor, stableReleases } from '../myseb/backend/src/updates.js';
const require = createRequire(import.meta.url);
const { createUpdater } = require('../myseb/desktop/src/updater.js');
const release = (version: string) => ({ tag_name: `myseb-v${version}`, assets: ['MySEB-win.exe', 'MySEB.apk', 'MySEB-android-update.json'].map(name => ({ name, size: 100, state: 'uploaded', browser_download_url: `https://github.com/niyibizisteven13-ux/ai-marker-hub/releases/download/myseb-v${version}/${name}` })) });
test('native updates select a newer stable MySEB release for the correct device and reject downgrades', () => {
  const releases = [release('1.0.2'), release('1.0.10'), { ...release('9.0.0'), draft: true }, { ...release('8.0.0'), prerelease: true }, { ...release('7.0.0'), tag_name: 'unrelated-v7.0.0' }];
  assert.equal(stableReleases(releases)[0].tag_name, 'myseb-v1.0.10');
  assert.equal(updateFor(releases, 'windows', '1.0.2').version, '1.0.10');
  assert.equal(updateFor(releases, 'windows', '1.0.10').available, false);
  assert.equal(updateFor(releases, 'windows', '2.0.0').available, false);
  assert.equal(updateFor(releases, 'android', '1.0.0').available, true);
  const unsigned = release('2.0.0'); unsigned.assets = unsigned.assets.filter(a => a.name !== 'MySEB-android-update.json');
  assert.equal(updateFor([unsigned], 'android', '1.0.0').available, false, 'ephemeral Android keys must not be advertised as compatible upgrades');
  const bad = release('3.0.0'); bad.assets[0].browser_download_url = 'https://evil.test/setup.exe';
  assert.equal(updateFor([bad], 'windows', '1.0.0').available, false);
});
test('desktop updater waits for consent and defers installation if an exam starts during download', async () => {
  const updater: any = new EventEmitter();
  let active = false, downloads = 0, installs = 0, before = 0, checks = 0;
  const notifications: any[] = [];
  updater.checkForUpdates = async () => { checks++; updater.emit('update-available', { version: '1.0.2' }); };
  updater.downloadUpdate = async () => { downloads++; active = true; updater.emit('update-downloaded', { version: '1.0.2' }); };
  updater.quitAndInstall = () => installs++;
  const control = createUpdater({ updater, active: () => active, notify: (s: any) => notifications.push(s), beforeInstall: () => before++ });
  await control.check(); assert.equal(downloads, 0); assert.equal(installs, 0);
  active = true; await control.check(); await control.apply(); assert.equal(control.install(), false);
  assert.equal(checks, 1); assert.equal(downloads, 0);
  const previous = notifications.length;
  active = false;
  await control.apply();
  assert.deepEqual(notifications.slice(previous).map(s => s.status), ['downloading']);
  assert.equal(control.install(), false); assert.equal(installs, 0);
  active = false; assert.equal(control.install(), true); assert.equal(installs, 1); assert.equal(before, 1);
  assert.equal(updater.autoInstallOnAppQuit, false);
});

test('update endpoints serve only known release assets and pin versioned installers', async () => {
  const { default: express } = await import('express');
  const { updateRouter } = await import('../myseb/backend/src/updates.js');
  const original = globalThis.fetch;
  const r = release('1.0.20');
  r.assets.push({ name: 'latest.yml', state: 'uploaded', size: 100, browser_download_url: 'https://github.com/niyibizisteven13-ux/ai-marker-hub/releases/download/myseb-v1.0.20/latest.yml' });
  r.assets.push({ name: 'MySEB-1.0.20-win.exe', state: 'uploaded', size: 100, browser_download_url: 'https://github.com/niyibizisteven13-ux/ai-marker-hub/releases/download/myseb-v1.0.20/MySEB-1.0.20-win.exe' });
  globalThis.fetch = async () => new Response(JSON.stringify([r]), { headers: { 'Content-Type': 'application/json' } });
  const server = express().use('/updates', updateRouter).listen(0);
  const base = `http://127.0.0.1:${(server.address() as any).port}/updates`;
  try {
    const check = await original(`${base}/check?platform=windows&version=1.0.1`);
    assert.equal((await check.json()).available, true);
    assert.equal(check.headers.get('cache-control'), 'no-store');
    const manifest = await original(`${base}/latest.yml`, { redirect: 'manual' });
    assert.equal(manifest.status, 302); assert.equal(manifest.headers.get('location'), r.assets.at(-2)!.browser_download_url);
    const installer = await original(`${base}/MySEB-1.0.20-win.exe`, { redirect: 'manual' });
    assert.equal(installer.status, 302);
    assert.equal((await original(`${base}/check?platform=invalid&version=1.0.1`)).status, 400);
    assert.equal((await original(`${base}/other.exe`)).status, 404);
  } finally { globalThis.fetch = original; server.close(); }
});

test('one desktop update confirmation downloads and restarts when MySEB is idle', async () => {
  const updater: any = new EventEmitter();
  let installs = 0;
  updater.checkForUpdates = async () => updater.emit('update-available', { version: '1.0.4' });
  updater.downloadUpdate = async () => updater.emit('update-downloaded', { version: '1.0.4' });
  updater.quitAndInstall = () => installs++;
  const control = createUpdater({ updater, active: () => false, notify: () => {}, beforeInstall: () => {} });
  await control.check();
  assert.equal(installs, 0);
  assert.equal((await control.apply()).status, 'installing');
  assert.equal(installs, 1);
});
