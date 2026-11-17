import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { detectPlatform } from '../src/utils/device.js';
import { count, isRepeat, resetBuildForTests, siteBuild, summary } from '../server/services/appDownloads.js';
import appRoutes from '../server/routes/appRoutes.js';

// The Get the app page: the right device, counted downloads, and the installable-app files.
const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  chromeos: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/126 Safari/537.36',
};

test('every kind of device is told apart (an iPad asking for the desktop site is not a Mac)', () => {
  assert.equal(detectPlatform(UA.android), 'android'); assert.equal(detectPlatform(UA.iphone), 'ios'); assert.equal(detectPlatform(UA.windows), 'windows');
  assert.equal(detectPlatform(UA.mac, 0), 'mac'); assert.equal(detectPlatform(UA.ipadDesktop, 5), 'ios'); assert.equal(detectPlatform(UA.linux), 'linux');
  assert.equal(detectPlatform(UA.chromeos), 'other'); assert.equal(detectPlatform(''), 'other');
});

test('downloads are counted per app and device, per day, and shown newest-total first', async () => {
  const day = Date.parse('2026-11-17T10:00:00Z');
  await count('myseb', 'windows', 'click', day); await count('myseb', 'windows', 'click', day + 60_000); await count('myseb', 'windows', 'click', day - 3 * 86_400_000);
  await count('bwenge', 'android', 'click', day); await count('bwenge', 'android', 'installed', day);
  const s = await summary(day + 3600_000);
  const w = s.rows.find((r) => r.app === 'myseb' && r.platform === 'windows')!; assert.deepEqual([w.click, w.installed, w.last7, w.last30], [3, 0, 3, 3]);
  const a = s.rows.find((r) => r.app === 'bwenge' && r.platform === 'android')!; assert.deepEqual([a.click, a.installed], [1, 1]);
  assert.equal(s.rows[0].app, 'myseb', 'the most downloaded is first'); assert.ok(s.total.click >= 4 && s.total.installed >= 1);
  const d = s.days.find((x) => x.day === '2026-11-17')!; assert.equal(d.click, 3, 'two myseb + one bwenge on the day');
});

test('the same person pressing twice within a minute is one download', () => {
  const t = 1_000_000; assert.equal(isRepeat('1.2.3.4', 'bwenge', 'linux', 'click', t), false);
  assert.equal(isRepeat('1.2.3.4', 'bwenge', 'linux', 'click', t + 30_000), true);
  assert.equal(isRepeat('1.2.3.4', 'bwenge', 'linux', 'click', t + 61_000), false, 'a minute later it counts again');
  assert.equal(isRepeat('5.6.7.8', 'bwenge', 'linux', 'click', t + 1_000), false, 'another person');
  assert.equal(isRepeat('1.2.3.4', 'bwenge', 'linux', 'installed', t + 1_000), false, 'another kind');
});

test('the site version comes from the commit, or else from the built page, and is steady', () => {
  resetBuildForTests(); assert.equal(siteBuild({ VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890' } as any, '/nowhere'), 'abcdef123456');
  resetBuildForTests(); const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-dist-')); fs.writeFileSync(path.join(dir, 'index.html'), '<script src="/assets/a1.js">');
  const a = siteBuild({} as any, dir); assert.match(a, /^[0-9a-f]{12}$/); assert.equal(siteBuild({} as any, dir), a);
  resetBuildForTests(); fs.writeFileSync(path.join(dir, 'index.html'), '<script src="/assets/b2.js">'); assert.notEqual(siteBuild({} as any, dir), a, 'a new build is a new version');
  fs.rmSync(dir, { recursive: true }); resetBuildForTests(); assert.equal(siteBuild({} as any, '/nowhere'), 'dev');
  resetBuildForTests();
});

const app = express(); app.use(express.json()); app.use('/api/app', appRoutes);
const srv = app.listen(0); const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/app`; test.after(() => srv.close());

test('the routes: count only known apps, devices and kinds; MySEB downloads are counted then sent on; the version is public', async () => {
  const post = (b: unknown) => fetch(`${base}/count`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  assert.equal((await post({ app: 'bwenge', platform: 'linux', kind: 'click' })).status, 200);
  for (const bad of [{ app: 'x', platform: 'linux', kind: 'click' }, { app: 'bwenge', platform: 'beos', kind: 'click' }, { app: 'bwenge', platform: 'linux', kind: 'drop table' }, {}]) assert.equal((await post(bad)).status, 400, JSON.stringify(bad));
  const go = await fetch(`${base}/go/myseb/linux`, { redirect: 'manual' }); assert.equal(go.status, 302); assert.equal(go.headers.get('location'), '/myseb/download?platform=linux');
  assert.equal((await fetch(`${base}/go/bwenge/linux`, { redirect: 'manual' })).status, 404, 'Bwenge has nothing to download here'); assert.equal((await fetch(`${base}/go/myseb/beos`, { redirect: 'manual' })).status, 404);
  const v = await (await fetch(`${base}/version`)).json(); assert.equal(typeof v.build, 'string');
});

test('the installable app files exist: a manifest with real PNG icons, a worker, and the page links the manifest', () => {
  const root = process.cwd(); const m = JSON.parse(fs.readFileSync(path.join(root, 'public/manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone'); assert.equal(m.start_url, '/'); assert.equal(m.id, '/');
  for (const sizes of ['192x192', '512x512']) assert.ok(m.icons.some((i: any) => i.sizes === sizes && i.type === 'image/png' && i.purpose === 'any'), sizes);
  assert.ok(m.icons.some((i: any) => i.purpose === 'maskable'));
  for (const i of m.icons) { const f = path.join(root, 'public', i.src); assert.ok(fs.existsSync(f), i.src); assert.equal(fs.readFileSync(f).subarray(1, 4).toString(), 'PNG', `${i.src} is a PNG`); }
  assert.match(fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8'), /addEventListener\('fetch'/);
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /rel="manifest" href="\/manifest\.webmanifest"/);
});
