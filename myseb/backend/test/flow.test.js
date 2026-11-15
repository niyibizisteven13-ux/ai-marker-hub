// End-to-end test of the rules in the brief, against a real Postgres (DATABASE_URL, default myseb/myseb@localhost).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TEACHER_KEY = 'tkey'; process.env.PEPPER = 'testpepper'; process.env.PUBLIC_URL = 'http://127.0.0.1:0'; process.env.VERIFY_RATE_PER_MIN = '1000';
const { app } = await import('../src/server.js');
const { migrate, pool, q } = await import('../src/db.js');
const { sweep } = await import('../src/sessions.js');
await migrate();

const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); pool.end(); });

const T = { Authorization: 'Bearer tkey', 'Content-Type': 'application/json' };
const call = async (path, { method = 'GET', headers = {}, body } = {}) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
};
const DESKTOP_UA = 'Mozilla/5.0 MySEB/1.0 (desktop)';
const mk = (s, dev, client = 'desktop', ua = DESKTOP_UA) => ({ 'X-MySEB-Key': s.token, 'X-MySEB-Client': client, 'X-MySEB-Device': dev, 'User-Agent': ua });

let exam, code, a, b;
test('teacher creates exam and a code; only hashes are stored', async () => {
  assert.equal((await call('/api/exams', { method: 'POST', body: { title: 'x' } })).status, 401);
  exam = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Bio', durationMinutes: 30, leaveAction: 'pause' } })).json;
  assert.match(exam.exam_url, /\/exam\/[0-9a-f-]{36}\/$/);
  code = (await call(`/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).json;
  assert.match(code.code, /^\d{6}$/); assert.match(code.display, /^\d{4}-[A-Z]+-\d{2}$/);
  assert.ok(code.secret.startsWith('mseb_')); assert.match(code.qrSvg, /<svg/);
  const { rows } = await q('SELECT code_hash, secret_hash FROM exam_codes WHERE exam_id=$1', [exam.id]);
  assert.ok(!JSON.stringify(rows).includes(code.code) && !JSON.stringify(rows).includes(code.secret));
});

test('verify-code: wrong code, typo in the word, then two students share one code', async () => {
  const bad = await call('/api/verify-code', { method: 'POST', body: { code: '000000', studentName: 'Z', deviceId: 'dev-zzzzzzzz', clientType: 'desktop' } });
  assert.equal(bad.status, 404);
  const typo = await call('/api/verify-code', { method: 'POST', body: { code: code.display.replace(/-[A-Z]+-/, '-WRONG-'), studentName: 'Z', deviceId: 'dev-zzzzzzzz', clientType: 'desktop' } });
  assert.equal(typo.status, 400);
  a = (await call('/api/verify-code', { method: 'POST', body: { code: code.display, studentName: 'Alice', deviceId: 'dev-alice-1', clientType: 'desktop', platform: 'win32' } })).json;
  b = (await call('/api/verify-code', { method: 'POST', body: { code: code.code, studentName: 'Bob', deviceId: 'dev-bob-1', clientType: 'mobile', platform: 'android' } })).json;
  assert.ok(a.token && b.token && a.token !== b.token && a.examUrl === exam.exam_url);
});

test('exam site: 403 "MySEB Needed" without the header, on every route', async () => {
  for (const p of ['/', '/app.js']) {
    const r = await call(`/exam/${exam.id}${p}`, { headers: { Accept: 'text/html' } });
    assert.equal(r.status, 403); assert.match(r.text, /MySEB Needed/);
  }
  assert.equal((await call(`/exam/${exam.id}/answers`, { method: 'POST', body: {} })).status, 403);
});

test('token used from normal Chrome (right key, no MySEB client/UA) is blocked and logged', async () => {
  const chrome = await call(`/exam/${exam.id}/`, { headers: { 'X-MySEB-Key': a.token, 'User-Agent': 'Mozilla/5.0 Chrome/120' } });
  assert.equal(chrome.status, 403);
  const wrongDev = await call(`/exam/${exam.id}/`, { headers: mk(a, 'other-device') });
  assert.equal(wrongDev.status, 403);
  const { rows } = await q(`SELECT count(*)::int n FROM violations WHERE session_id=$1 AND type='token_misuse'`, [a.sessionId]);
  assert.ok(rows[0].n >= 2);
  const hb = await call('/api/heartbeat', { method: 'POST', headers: { 'X-MySEB-Key': a.token, 'User-Agent': 'Chrome' } });
  assert.equal(hb.status, 403);
});

test('valid desktop header gets the exam; mobile gets a cookie for sub-resources', async () => {
  const ok = await call(`/exam/${exam.id}/`, { headers: mk(a, 'dev-alice-1') });
  assert.equal(ok.status, 200); assert.match(ok.text, /Alice/);
  const m = await fetch(`${base}/exam/${exam.id}/`, { headers: mk(b, 'dev-bob-1', 'mobile', 'MySEB/1.0 (mobile) Mobile') });
  assert.equal(m.status, 200);
  const cookie = m.headers.get('set-cookie'); assert.match(cookie, /myseb_s=.*HttpOnly/);
  const sub = await call(`/exam/${exam.id}/app.js`, { headers: { Cookie: cookie.split(';')[0], 'User-Agent': 'MySEB/1.0 (mobile)' } });
  assert.equal(sub.status, 200);
  const subChrome = await call(`/exam/${exam.id}/app.js`, { headers: { Cookie: cookie.split(';')[0], 'User-Agent': 'Chrome' } });
  assert.equal(subChrome.status, 403);
  const desktopCookie = await call(`/exam/${exam.id}/app.js`, { headers: { Cookie: `myseb_s=${a.token}`, 'User-Agent': DESKTOP_UA } });
  assert.equal(desktopCookie.status, 403, 'cookie fallback is for mobile sessions only');
});

test('heartbeat; leave violation pauses; paused student is locked out of the exam site; teacher resumes', async () => {
  const hb = await call('/api/heartbeat', { method: 'POST', headers: mk(a, 'dev-alice-1') });
  assert.equal(hb.json.status, 'IN_EXAM'); assert.ok(hb.json.remainingSeconds > 1700);
  const v = await call('/api/violation', { method: 'POST', headers: mk(a, 'dev-alice-1'), body: { type: 'leave', detail: { ms: 2100 } } });
  assert.equal(v.json.status, 'PAUSED');
  assert.equal((await call(`/exam/${exam.id}/`, { headers: mk(a, 'dev-alice-1') })).status, 403);
  assert.equal((await call('/api/violation', { method: 'POST', headers: mk(a, 'dev-alice-1'), body: { type: 'nonsense' } })).status, 400);
  await call('/api/violation', { method: 'POST', headers: mk(a, 'dev-alice-1'), body: { type: 'copy' } });   // recorded, does not change state
  const mon = (await call(`/api/exams/${exam.id}/monitor`, { headers: T })).json;
  const alice = mon.students.find((s) => s.student_name === 'Alice');
  assert.equal(alice.status, 'PAUSED'); assert.equal(alice.violation_count, 6); assert.equal(mon.counts.IN_EXAM, 1);
  await call(`/api/sessions/${alice.id}/resume`, { method: 'POST', headers: T });
  assert.equal((await call(`/exam/${exam.id}/`, { headers: mk(a, 'dev-alice-1') })).status, 200);
});

test('re-entering the code cannot escape a pause, and rotates the token', async () => {
  await call('/api/violation', { method: 'POST', headers: mk(a, 'dev-alice-1'), body: { type: 'background' } });
  const again = (await call('/api/verify-code', { method: 'POST', body: { code: code.code, studentName: 'alice', deviceId: 'dev-alice-1', clientType: 'desktop' } })).json;
  assert.equal(again.status, 'PAUSED'); assert.notEqual(again.token, a.token);
  assert.equal((await call('/api/heartbeat', { method: 'POST', headers: mk(a, 'dev-alice-1') })).status, 401, 'old token is dead');
  a = again;
  const other = await call('/api/verify-code', { method: 'POST', body: { code: code.code, studentName: 'Alice', deviceId: 'dev-evil-99', clientType: 'desktop' } });
  assert.equal(other.status, 409);
});

test('missed heartbeats mark the student LEFT; coming back pauses them', async () => {
  const c = (await call('/api/verify-code', { method: 'POST', body: { code: code.code, studentName: 'Carol', deviceId: 'dev-carol-1', clientType: 'desktop' } })).json;
  await q(`UPDATE exam_sessions SET last_heartbeat = now() - interval '60 seconds' WHERE id=$1`, [c.sessionId]);
  await sweep();
  assert.equal((await q('SELECT status FROM exam_sessions WHERE id=$1', [c.sessionId])).rows[0].status, 'LEFT');
  assert.equal((await call('/api/heartbeat', { method: 'POST', headers: mk(c, 'dev-carol-1') })).json.status, 'PAUSED');
});

test('teacher ends one student; ends exam: codes expire; gate API works for external sites', async () => {
  const gate = (key, secret = code.secret, extra = {}) => call('/api/gate', { method: 'POST', headers: { 'X-MySEB-Exam-Secret': secret }, body: { key, client: 'desktop', device: 'dev-bob-1', userAgent: DESKTOP_UA, ...extra } });
  assert.equal((await gate(b.token)).json.allowed, false, 'bob is a mobile session, not desktop');
  assert.equal((await gate(a.token, code.secret, { device: 'dev-alice-1' })).json.reason, 'PAUSED');
  assert.equal((await gate(a.token, 'mseb_wrong', { device: 'dev-alice-1' })).json.allowed, false);

  await call(`/api/sessions/${b.sessionId}/end`, { method: 'POST', headers: T });
  assert.equal((await call('/api/heartbeat', { method: 'POST', headers: mk(b, 'dev-bob-1', 'mobile', 'MySEB/1.0 (mobile)') })).json.status, 'ENDED');
  assert.equal((await call(`/exam/${exam.id}/`, { headers: mk(b, 'dev-bob-1', 'mobile', 'MySEB/1.0 (mobile)') })).status, 403);

  await call(`/api/exams/${exam.id}/end`, { method: 'POST', headers: T });
  const late = await call('/api/verify-code', { method: 'POST', body: { code: code.code, studentName: 'Dan', deviceId: 'dev-dan-123', clientType: 'desktop' } });
  assert.equal(late.status, 404);
  assert.equal((await call('/api/heartbeat', { method: 'POST', headers: mk(a, 'dev-alice-1') })).json.status, 'ENDED');
});

test('Require MySEB off lets a plain browser in; extension needs allow_extension', async () => {
  const e2 = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Open', requireMyseb: false } })).json;
  assert.equal((await call(`/exam/${e2.id}/`)).status, 200);
  await call(`/api/exams/${e2.id}`, { method: 'PATCH', headers: T, body: { requireMyseb: true } });
  assert.equal((await call(`/exam/${e2.id}/`)).status, 403);
  const c2 = (await call(`/api/exams/${e2.id}/generate-code`, { method: 'POST', headers: T })).json;
  const ext = await call('/api/verify-code', { method: 'POST', body: { code: c2.code, studentName: 'Eve', deviceId: 'ext-eve-1234', clientType: 'extension' } });
  assert.equal(ext.status, 403);
  await call(`/api/exams/${e2.id}`, { method: 'PATCH', headers: T, body: { allowExtension: true } });
  const ext2 = (await call('/api/verify-code', { method: 'POST', body: { code: c2.code, studentName: 'Eve', deviceId: 'ext-eve-1234', clientType: 'extension' } })).json;
  const h = { 'X-MySEB-Key': ext2.token, 'X-MySEB-Client': 'extension', 'X-MySEB-Device': 'ext-eve-1234' };
  assert.equal((await call(`/exam/${e2.id}/`, { headers: h })).status, 200);
  assert.equal((await call(`/exam/${e2.id}/`, { headers: { ...h, 'X-MySEB-Device': 'nope' } })).status, 403);
});

test('junk under /exam is a 404 and cannot crash the server', async () => {
  assert.equal((await call('/exam/app.js')).status, 404);
  assert.equal((await call('/exam/not-a-uuid/')).status, 404);
  assert.equal((await call(`/exam/${'a'.repeat(36)}/`)).status, 404);   // right shape, not a UUID
  assert.equal((await call('/api/exams/zzz/monitor', { headers: T })).status, 400);
  const r = await fetch(`${base}/exam/${exam.id}`, { redirect: 'manual' });
  assert.equal(r.status, 301); assert.ok(r.headers.get('location').endsWith(`/exam/${exam.id}/`));
});

test('remoteMySebGuard protects an exam site that lives elsewhere (bwenge-style)', async () => {
  const { remoteMySebGuard } = await import('../src/remoteGuard.js');
  const express = (await import('express')).default;
  const ex = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Remote' } })).json;
  const c = (await call(`/api/exams/${ex.id}/generate-code`, { method: 'POST', headers: T })).json;
  const s = (await call('/api/verify-code', { method: 'POST', body: { code: c.code, studentName: 'Rem', deviceId: 'dev-remote-1', clientType: 'desktop' } })).json;

  const other = express();
  other.use('/f', remoteMySebGuard({ mysebUrl: base, secretFor: (req) => (req.query.open ? null : c.secret), cacheMs: 0 }));
  other.get('/f/test', (req, res) => res.send('hello ' + req.myseb?.studentName));
  const srv = other.listen(0); const ob = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.equal((await fetch(ob + '/f/test')).status, 403);
    assert.equal((await fetch(ob + '/f/test?open=1')).status, 200, 'secretFor -> null means MySEB not required');
    assert.equal((await fetch(ob + '/f/test', { headers: { 'X-MySEB-Key': s.token, 'User-Agent': 'Chrome' } })).status, 403);
    const ok = await fetch(ob + '/f/test', { headers: mk(s, 'dev-remote-1') });
    assert.equal(ok.status, 200); assert.equal(await ok.text(), 'hello Rem');
    await call('/api/violation', { method: 'POST', headers: mk(s, 'dev-remote-1'), body: { type: 'leave' } });
    const paused = await fetch(ob + '/f/test', { headers: mk(s, 'dev-remote-1') });
    assert.equal(paused.status, 403); assert.equal((await paused.json()).code, 'MYSEB_PAUSED');
  } finally { srv.close(); }
});

test('verify-code is rate limited per IP (default 10 a minute) so 6-digit codes cannot be brute-forced', async () => {
  const { rateLimit } = await import('../src/security.js');
  const express = (await import('express')).default;
  const a = express(); a.post('/v', rateLimit({ windowMs: 60_000, max: 10 }), (_q, r) => r.json({ ok: 1 }));
  const srv = a.listen(0); const u = `http://127.0.0.1:${srv.address().port}/v`;
  try {
    const codes = []; for (let i = 0; i < 12; i++) codes.push((await fetch(u, { method: 'POST' })).status);
    assert.deepEqual(codes.slice(0, 10), Array(10).fill(200)); assert.deepEqual(codes.slice(10), [429, 429]);
  } finally { srv.close(); }
});

test('service-key gate + soft cookie issuer (what bwenge uses): mobile gets a cookie once, then API calls work with the cookie alone', async () => {
  const { remoteMySebGuard } = await import('../src/remoteGuard.js');
  const express = (await import('express')).default;
  const ex = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Svc' } })).json;
  const other = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Other' } })).json;
  const c = (await call(`/api/exams/${ex.id}/generate-code`, { method: 'POST', headers: T })).json;
  const phone = (await call('/api/verify-code', { method: 'POST', body: { code: c.code, studentName: 'Pho', deviceId: 'dev-phone-12', clientType: 'mobile' } })).json;
  const desk = (await call('/api/verify-code', { method: 'POST', body: { code: c.code, studentName: 'Des', deviceId: 'dev-desk-123', clientType: 'desktop' } })).json;
  const opts = (id) => ({ mysebUrl: base, serviceKey: 'tkey', examIdFor: () => id, cacheMs: 0 });
  const site = express();
  site.get('/forms/:id', remoteMySebGuard({ ...opts(ex.id), soft: true }), (_q, r) => r.send('shell'));   // page shell: never denies
  site.use('/api', remoteMySebGuard({ ...opts(ex.id), bypass: (req) => req.get('x-owner') === '1' }));
  site.get('/api/data', (req, res) => res.json({ who: req.myseb?.studentName ?? 'owner' }));
  site.use('/other', remoteMySebGuard(opts(other.id)));
  site.get('/other/x', (_q, r) => r.send('x'));
  const srv = site.listen(0); const ob = `http://127.0.0.1:${srv.address().port}`;
  const MUA = 'Mozilla MySEB/1.0 (mobile; android)';
  try {
    // plain browser: the shell loads (it holds no exam content) and the API is locked
    assert.equal((await fetch(ob + '/forms/abc')).status, 200);
    const locked = await fetch(ob + '/api/data'); assert.equal(locked.status, 403); assert.equal((await locked.json()).code, 'MYSEB_REQUIRED');
    assert.equal((await fetch(ob + '/api/data', { headers: { 'x-owner': '1' } })).status, 200, 'owner bypass');
    // phone: header on the shell request -> cookie
    const shell = await fetch(ob + '/forms/abc', { headers: { 'X-MySEB-Key': phone.token, 'X-MySEB-Client': 'mobile', 'X-MySEB-Device': 'dev-phone-12', 'User-Agent': MUA } });
    const cookie = shell.headers.get('set-cookie'); assert.match(cookie, /myseb_s=.*HttpOnly/);
    // the page's own XHR carries only the cookie (and the app's UA)
    const xhr = await fetch(ob + '/api/data', { headers: { Cookie: cookie.split(';')[0], 'User-Agent': MUA } });
    assert.equal(xhr.status, 200); assert.equal((await xhr.json()).who, 'Pho');
    assert.equal((await fetch(ob + '/api/data', { headers: { Cookie: cookie.split(';')[0], 'User-Agent': 'Chrome' } })).status, 403, 'cookie in normal Chrome');
    // desktop: header on every request
    const dh = { 'X-MySEB-Key': desk.token, 'X-MySEB-Client': 'desktop', 'X-MySEB-Device': 'dev-desk-123', 'User-Agent': 'Mozilla MySEB/1.0 (desktop)' };
    assert.equal((await fetch(ob + '/api/data', { headers: dh })).status, 200);
    assert.equal((await fetch(ob + '/other/x', { headers: dh })).status, 403, 'a session of exam A is useless on exam B');
    // wrong service key -> the gate refuses, so the site fails closed
    const bad = express(); bad.use(remoteMySebGuard({ ...opts(ex.id), serviceKey: 'nope' })); bad.get('/', (_q, r) => r.send('x'));
    const bs = bad.listen(0); try { assert.equal((await fetch(`http://127.0.0.1:${bs.address().port}/`, { headers: dh })).status, 403); } finally { bs.close(); }
    // MySEB down -> 503, not a free pass
    const down = express(); down.use(remoteMySebGuard({ ...opts(ex.id), mysebUrl: 'http://127.0.0.1:9' })); down.get('/', (_q, r) => r.send('x'));
    const ds = down.listen(0); try { assert.equal((await fetch(`http://127.0.0.1:${ds.address().port}/`, { headers: dh })).status, 503); } finally { ds.close(); }
  } finally { srv.close(); }
});
