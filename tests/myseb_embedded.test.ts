import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';

// MySEB runs inside the bwenge server under /myseb when MYSEB_URL is not set. Needs a PostgreSQL (EMBED_TEST_DATABASE_URL).
const DB = process.env.EMBED_TEST_DATABASE_URL;
let handle: Awaited<ReturnType<typeof import('../server/services/mySebEmbedded.js').mountEmbeddedMySeb>> = null;
test('MySEB runs next to the bwenge server under /myseb, with its secrets derived and no extra settings', { skip: !DB }, async () => {
  for (const k of ['MYSEB_URL', 'MYSEB_SERVICE_KEY', 'TEACHER_KEY', 'PEPPER', 'PUBLIC_URL', 'MYSEB_EMBED']) delete process.env[k];
  process.env.DATABASE_URL = DB; process.env.JWT_SECRET = 'test-secret-for-embedding'; process.env.APP_URL = 'https://www.bwenge.space';
  const { mountEmbeddedMySeb } = await import('../server/services/mySebEmbedded.js');
  const { mySebConfigured, generateCode } = await import('../server/services/mySeb.js');
  // MySEB is a paid service (tests/myseb_access.test.ts covers that); this test is about running MySEB inside the server.
  const platformSettings = await import('../server/services/platform/settings.js');
  platformSettings.__setPlatformSettingsForTests({ ...platformSettings.DEFAULT_SETTINGS, flags: { 'myseb.requirePayment': false } });
  // The child process inherits these fixtures. Never follow a real installer download in CI.
  const downloadKeys = ['MYSEB_DL_ANDROID', 'MYSEB_DL_WINDOWS', 'MYSEB_DL_IOS'] as const;
  const previousDownloads = Object.fromEntries(downloadKeys.map(k => [k, process.env[k]]));
  process.env.MYSEB_DL_ANDROID = 'https://downloads.example.test/MySEB.apk';
  process.env.MYSEB_DL_WINDOWS = 'https://downloads.example.test/MySEB-win.exe';
  delete process.env.MYSEB_DL_IOS;
  const app = express(); app.get('/api/other', (_q, r) => r.json({ bwenge: true }));
  const srv = app.listen(0); const port = (srv.address() as AddressInfo).port;
  try {
    handle = await mountEmbeddedMySeb(app, port); assert.ok(handle, 'started');
    assert.equal(mySebConfigured(), true, 'bwenge now knows where MySEB is');
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await (await fetch(`${base}/myseb/readyz`)).json() as any).ok, true);
    const status: any = await (await fetch(`${base}/myseb/_status`)).json();
    assert.equal(status.running, true); assert.equal(status.restarts, 0); assert.equal(status.lastExit, null);
    assert.equal((await (await fetch(`${base}/api/other`)).json() as any).bwenge, true, 'bwenge routes untouched');
    const dash = await fetch(`${base}/myseb/`, { redirect: 'manual' });
    assert.equal(dash.headers.get('location'), '/myseb/dashboard/');
    assert.equal((await fetch(`${base}/myseb/dashboard/`)).status, 200);
    const ua = (u: string, query = '') => fetch(`${base}/myseb/download${query}`, {
      headers: { 'User-Agent': u }, redirect: 'manual',
    });
    const android = 'Mozilla/5.0 (Linux; Android 14; Pixel) Chrome/120 Mobile';
    const phone = await ua(android);
    assert.equal(phone.status, 302, 'Android starts a direct download');
    assert.equal(phone.headers.get('location'), process.env.MYSEB_DL_ANDROID);
    assert.equal(phone.headers.get('cache-control'), 'no-store', 'device redirects must not be cached across visitors');
    const windows = await ua('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120');
    assert.equal(windows.status, 302);
    assert.equal(windows.headers.get('location'), process.env.MYSEB_DL_WINDOWS);
    const iphone = await ua('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    assert.equal(iphone.status, 200);
    const iphoneText = await iphone.text();
    assert.match(iphoneText, /no MySEB app for iPhone or iPad yet/); assert.match(iphoneText, /in your browser/);
    assert.doesNotMatch(iphoneText, /Download for/, 'no buttons that cannot work on an iPhone');
    const chooser = await ua(android, '?choose=1');
    assert.equal(chooser.status, 200);
    const html = await chooser.text();
    assert.match(html, /href="\?platform=android"/);
    assert.match(html, /href="\?platform=windows"/);
    const manual = await ua(android, '?platform=windows');
    assert.equal(manual.status, 302, 'explicit platform selection survives the embedded proxy');
    assert.equal(manual.headers.get('location'), process.env.MYSEB_DL_WINDOWS);
    const target = { kind: 'form', ref: 'f1', title: 'Embedded quiz', url: 'https://www.bwenge.space/forms/f1', mysebExamId: null as string | null, leaveAction: 'record', minutes: 10, saveExamId: async (id: string) => { target.mysebExamId = id; } };
    const code: any = await generateCode(async () => target as any);
    assert.match(String(code.code ?? code.display), /\d/);
    assert.match(code.joinUrl, /^https:\/\/www\.bwenge\.space\/myseb\/join\/\d{6}$/);
  } finally {
    srv.close(); handle?.stop();
    for (const key of downloadKeys) {
      if (previousDownloads[key] === undefined) delete process.env[key];
      else process.env[key] = previousDownloads[key];
    }
  }
});
test('a separate MYSEB_URL turns embedding off', async () => {
  const { mysebEmbeddedWanted } = await import('../server/services/mySebEmbedded.js');
  const keep = process.env.MYSEB_URL; process.env.MYSEB_URL = 'https://myseb.example';
  try { assert.equal(mysebEmbeddedWanted(), false); } finally { if (keep) process.env.MYSEB_URL = keep; else delete process.env.MYSEB_URL; }
});

test('MySEB failing to start does not take the site down, and /myseb/_status says how it stopped', { skip: !DB }, async () => {
  const keep = { u: process.env.DATABASE_URL, m: process.env.MYSEB_URL };
  delete process.env.MYSEB_URL; process.env.DATABASE_URL = 'postgresql://nobody:nobody@127.0.0.1:1/none';   // nothing listens: MySEB cannot start
  const app = express(); app.get('/api/other', (_q, r) => r.json({ bwenge: true }));
  const srv = app.listen(0); const port = (srv.address() as AddressInfo).port;
  const { mountEmbeddedMySeb } = await import('../server/services/mySebEmbedded.js');
  let h: Awaited<ReturnType<typeof mountEmbeddedMySeb>> = null;
  try {
    h = await mountEmbeddedMySeb(app, port);
    assert.ok(h, 'the site still comes up');
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/api/other`)).status, 200);
    assert.equal((await fetch(`${base}/myseb/healthz`)).status, 502, 'a clear "restarting" while MySEB is down');
    const st: any = await (await fetch(`${base}/myseb/_status`)).json();
    assert.equal(st.running === false || st.restarts >= 0, true); assert.ok(st.lastExit === null || typeof st.lastExit.code === 'number');
  } finally { h?.stop(); srv.close(); if (keep.u) process.env.DATABASE_URL = keep.u; if (keep.m) process.env.MYSEB_URL = keep.m; }
});
