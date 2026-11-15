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
  const app = express(); app.get('/api/other', (_q, r) => r.json({ bwenge: true }));
  const srv = app.listen(0); const port = (srv.address() as AddressInfo).port;
  try {
    handle = await mountEmbeddedMySeb(app, port); assert.ok(handle, 'started');
    assert.equal(mySebConfigured(), true, 'bwenge now knows where MySEB is');
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await (await fetch(`${base}/myseb/readyz`)).json() as any).ok, true);
    assert.equal((await (await fetch(`${base}/api/other`)).json() as any).bwenge, true, 'bwenge routes untouched');
    const dash = await fetch(`${base}/myseb/`, { redirect: 'manual' });
    assert.equal(dash.headers.get('location'), '/myseb/dashboard/');
    assert.equal((await fetch(`${base}/myseb/dashboard/`)).status, 200);
    const ua = (u: string) => fetch(`${base}/myseb/download`, { headers: { 'User-Agent': u } }).then((r) => r.text());
    const phone = await ua('Mozilla/5.0 (Linux; Android 14; Pixel) Chrome/120 Mobile');
    assert.ok(phone.indexOf('Download for Android phone') < phone.indexOf('Download for Windows laptop'), 'a phone sees its own download first');
    assert.match(phone, /releases\/latest\/download\/MySEB\.apk/);
    assert.match(await ua('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120'), /MySEB-win\.exe/);
    assert.match(await ua('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), /not supported yet/);
    const target = { kind: 'form', ref: 'f1', title: 'Embedded quiz', url: 'https://www.bwenge.space/forms/f1', mysebExamId: null as string | null, leaveAction: 'record', minutes: 10, saveExamId: async (id: string) => { target.mysebExamId = id; } };
    const code: any = await generateCode(async () => target as any);
    assert.match(String(code.code ?? code.display), /\d/);
    assert.match(code.joinUrl, /^https:\/\/www\.bwenge\.space\/myseb\/join\/\d{6}$/);
  } finally { srv.close(); handle?.stop(); }
});
test('a separate MYSEB_URL turns embedding off', async () => {
  const { mysebEmbeddedWanted } = await import('../server/services/mySebEmbedded.js');
  const keep = process.env.MYSEB_URL; process.env.MYSEB_URL = 'https://myseb.example';
  try { assert.equal(mysebEmbeddedWanted(), false); } finally { if (keep) process.env.MYSEB_URL = keep; else delete process.env.MYSEB_URL; }
});
