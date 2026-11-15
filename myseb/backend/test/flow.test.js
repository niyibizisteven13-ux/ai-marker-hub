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

test('live room: question + camera picture only when the lecturer asked, memory only, pause-all / resume-all', async () => {
  const ex = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Live' } })).json;
  const c = (await call(`/api/exams/${ex.id}/generate-code`, { method: 'POST', headers: T })).json;
  const s1 = (await call('/api/verify-code', { method: 'POST', body: { code: c.code, studentName: 'Una', deviceId: 'dev-una-1234', clientType: 'desktop' } })).json;
  const s2 = (await call('/api/verify-code', { method: 'POST', body: { code: c.code, studentName: 'Vic', deviceId: 'dev-vic-1234', clientType: 'desktop' } })).json;
  const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
  const live = (sid, body, headers = T) => call(`/api/sessions/${sid}/live`, { method: 'POST', headers, body });

  assert.equal((await live(s1.sessionId, {}, { 'content-type': 'application/json' })).status, 401, 'only bwenge (service key) may report');
  // pictures are refused while the lecturer has not asked for them
  let r = await live(s1.sessionId, { question: { index: 4, total: 12, label: 'What is 12 x 12?' }, camera: 'on', frame: JPEG });
  assert.equal(r.json.faces, false);
  let mon = (await call(`/api/exams/${ex.id}/monitor`, { headers: T })).json;
  let una = mon.students.find((x) => x.student_name === 'Una');
  assert.deepEqual(una.live.question, { index: 4, total: 12, label: 'What is 12 x 12?' }); assert.equal(una.live.frame, null);
  assert.equal(mon.exam.title, 'Live'); assert.equal(mon.exam.live_faces, false);

  await call(`/api/exams/${ex.id}`, { method: 'PATCH', headers: T, body: { liveFaces: true } });
  r = await live(s1.sessionId, { question: { index: 5, total: 12, label: 'Q5' }, camera: 'on', frame: JPEG });
  assert.equal(r.json.faces, true);
  una = (await call(`/api/exams/${ex.id}/monitor`, { headers: T })).json.students.find((x) => x.student_name === 'Una');
  assert.equal(una.live.frame, JPEG); assert.equal(una.live.question.index, 5);
  // junk is cleaned: not a JPEG data URL, oversize, script in the label
  await live(s1.sessionId, { question: { index: 'x', total: 1e9, label: '<b>hi</b>' + 'a'.repeat(500) }, camera: 'weird', frame: 'data:text/html;base64,AAAA' });
  una = (await call(`/api/exams/${ex.id}/monitor`, { headers: T })).json.students.find((x) => x.student_name === 'Una');
  assert.equal(una.live.camera, 'off'); assert.equal(una.live.frame, JPEG, 'a junk frame does not replace the last good one');
  assert.ok(una.live.question.label.length <= 120); assert.equal(una.live.question.total, 10000);
  // nothing about pictures reaches the database
  const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name IN ('exam_sessions','violations')`)).rows.map((x) => x.column_name);
  assert.ok(!cols.some((n) => /frame|image|photo|picture/i.test(n)));

  // pause everyone, then let everyone back
  const pa = (await call(`/api/exams/${ex.id}/pause-all`, { method: 'POST', headers: T })).json; assert.equal(pa.changed, 2);
  mon = (await call(`/api/exams/${ex.id}/monitor`, { headers: T })).json; assert.equal(mon.counts.PAUSED, 2);
  assert.equal((await call(`/exam/${ex.id}/`, { headers: mk(s2, 'dev-vic-1234') })).status, 403, 'paused students are locked out of the exam site');
  assert.equal((await call('/api/heartbeat', { method: 'POST', headers: mk(s2, 'dev-vic-1234') })).json.status, 'PAUSED');
  const ra = (await call(`/api/exams/${ex.id}/resume-all`, { method: 'POST', headers: T })).json; assert.equal(ra.changed, 2);
  assert.equal((await call('/api/heartbeat', { method: 'POST', headers: mk(s2, 'dev-vic-1234') })).json.status, 'IN_EXAM');

  // when a student ends, their picture is forgotten
  await call(`/api/sessions/${s1.sessionId}/end`, { method: 'POST', headers: T });
  una = (await call(`/api/exams/${ex.id}/monitor`, { headers: T })).json.students.find((x) => x.student_name === 'Una');
  assert.equal(una.live, null);
  assert.equal((await live(s1.sessionId, { camera: 'on', frame: JPEG })).json.status, 'ENDED');
});

test('live video set-up messages: long poll, order, validation, wrong exam, and cleanup (the video itself never passes here)', async () => {
  const ex = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'RTC' } })).json;
  const c = (await call(`/api/exams/${ex.id}/generate-code`, { method: 'POST', headers: T })).json;
  const s = (await call('/api/verify-code', { method: 'POST', body: { code: c.code, studentName: 'Rita', deviceId: 'dev-rita-123', clientType: 'desktop' } })).json;
  const post = (p, msg, headers = T) => call(p, { method: 'POST', headers, body: { msg } });
  assert.equal((await call('/api/exams/' + ex.id + '/from-students', {})).status, 401, 'service key required');

  // lecturer -> student: a waiting student is woken the moment a message arrives
  const waiting = call(`/api/sessions/${s.sessionId}/from-lecturer?after=0&wait=5000`, { headers: T });
  await new Promise((r) => setTimeout(r, 150));
  await post(`/api/sessions/${s.sessionId}/to-student`, { type: 'watch', viewer: 'v-1', audio: false });
  const got = (await waiting).json;
  assert.equal(got.msgs.length, 1); assert.deepEqual([got.msgs[0].type, got.msgs[0].viewer], ['watch', 'v-1']); assert.equal(got.next, got.msgs[0].n);
  // nothing new -> an empty long poll returns after its wait, with the cursor kept
  const t0 = Date.now(); const empty = (await call(`/api/sessions/${s.sessionId}/from-lecturer?after=${got.next}&wait=400`, { headers: T })).json;
  assert.equal(empty.msgs.length, 0); assert.ok(Date.now() - t0 >= 350); assert.equal(empty.next, got.next);

  // student -> lecturer: the lecturer's one mailbox for the exam carries which student sent it
  await post(`/api/sessions/${s.sessionId}/to-lecturer`, { type: 'offer', viewer: 'v-1', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1' });
  await post(`/api/sessions/${s.sessionId}/to-lecturer`, { type: 'ice', viewer: 'v-1', candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0 } });
  const inbox = (await call(`/api/exams/${ex.id}/from-students?after=0&wait=0`, { headers: T })).json;
  assert.deepEqual(inbox.msgs.map((m) => [m.type, m.sid]), [['offer', s.sessionId], ['ice', s.sessionId]]);
  assert.equal((await call(`/api/exams/${ex.id}/from-students?after=${inbox.next}&wait=0`, { headers: T })).json.msgs.length, 0, 'the cursor means each message is read once');

  // validation: unknown type, wrong direction, oversize sdp, script in ids
  assert.equal((await post(`/api/sessions/${s.sessionId}/to-student`, { type: 'rm -rf' })).status, 400);
  assert.equal((await post(`/api/sessions/${s.sessionId}/to-student`, { type: 'offer' })).status, 400, 'a lecturer cannot send an offer');
  assert.equal((await post(`/api/sessions/${s.sessionId}/to-lecturer`, { type: 'watch' })).status, 400, 'a student cannot start a watch');
  assert.equal((await post(`/api/sessions/${s.sessionId}/to-lecturer`, { type: 'offer', sdp: 'x'.repeat(20000) })).status, 400);
  await post(`/api/sessions/${s.sessionId}/to-student`, { type: 'watch', viewer: '<img onerror=1>' });
  assert.equal((await call(`/api/sessions/${s.sessionId}/from-lecturer?after=${got.next}&wait=0`, { headers: T })).json.msgs[0].viewer, 'imgonerror1');
  assert.equal((await post(`/api/sessions/${randomUUIDish()}/to-student`, { type: 'watch' })).status, 404);

  // the room settings: live mode + sound, and the report tells the page what to do
  await call(`/api/exams/${ex.id}`, { method: 'PATCH', headers: T, body: { liveMode: 'live', liveSound: true } });
  const rep = await call(`/api/sessions/${s.sessionId}/live`, { method: 'POST', headers: T, body: { camera: 'on' } });
  assert.deepEqual([rep.json.faces, rep.json.live, rep.json.sound], [true, true, true]);
  await call(`/api/exams/${ex.id}`, { method: 'PATCH', headers: T, body: { liveMode: 'pictures' } });
  const rep2 = await call(`/api/sessions/${s.sessionId}/live`, { method: 'POST', headers: T, body: { camera: 'on' } });
  assert.deepEqual([rep2.json.faces, rep2.json.live, rep2.json.sound], [true, false, false], 'sound only exists in live mode');
  const m = (await call(`/api/exams/${ex.id}/monitor`, { headers: T })).json.exam; assert.deepEqual([m.live_mode, m.live_sound], ['pictures', true]);

  // ending the exam clears every mailbox
  await call(`/api/exams/${ex.id}/end`, { method: 'POST', headers: T });
  assert.equal((await call(`/api/sessions/${s.sessionId}/from-lecturer?after=0&wait=0`, { headers: T })).json.msgs.length, 0);
});
function randomUUIDish() { return '00000000-0000-4000-8000-000000000000'; }

test('a big room asks for camera pictures only for the tiles on screen', async () => {
  const ex = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Frames' } })).json;
  const other = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Other room' } })).json;
  const mkStudent = async (examId, name, dev) => { const c = (await call(`/api/exams/${examId}/generate-code`, { method: 'POST', headers: T })).json; return (await call('/api/verify-code', { method: 'POST', body: { code: c.code, studentName: name, deviceId: dev, clientType: 'desktop' } })).json; };
  const a = await mkStudent(ex.id, 'Fay', 'dev-fay-12345'); const b = await mkStudent(ex.id, 'Gus', 'dev-gus-12345'); const z = await mkStudent(other.id, 'Zed', 'dev-zed-12345');
  await call(`/api/exams/${ex.id}`, { method: 'PATCH', headers: T, body: { liveMode: 'pictures' } });
  await call(`/api/exams/${other.id}`, { method: 'PATCH', headers: T, body: { liveMode: 'pictures' } });
  const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
  for (const s of [a, b, z]) await call(`/api/sessions/${s.sessionId}/live`, { method: 'POST', headers: T, body: { camera: 'on', frame: JPEG } });
  const slim = (await call(`/api/exams/${ex.id}/monitor?frames=0`, { headers: T })).json;
  assert.ok(slim.students.every((s) => s.live.frame === null), 'the room poll carries no pictures');
  assert.equal(slim.students.length, 2);
  const one = (await call(`/api/exams/${ex.id}/frames?ids=${a.sessionId}`, { headers: T })).json.frames;
  assert.deepEqual(Object.keys(one), [a.sessionId]); assert.equal(one[a.sessionId].frame, JPEG);
  const foreign = (await call(`/api/exams/${ex.id}/frames?ids=${z.sessionId},not-a-uuid`, { headers: T })).json.frames;
  assert.deepEqual(foreign, {}, 'a student of another exam is never returned');
  await call(`/api/exams/${ex.id}`, { method: 'PATCH', headers: T, body: { liveMode: 'off' } });
  assert.deepEqual((await call(`/api/exams/${ex.id}/frames?ids=${a.sessionId}`, { headers: T })).json.frames, {}, 'nothing when the camera is off');
});

test('limits: the service key is not rate limited (one school, thousands of students), a guessed exam secret is', async () => {
  const ex = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Limits' } })).json;
  const svc = { 'X-MySEB-Service-Key': 'tkey', 'Content-Type': 'application/json' };
  const body = { key: 'nope', client: 'desktop', device: 'd', userAgent: 'MySEB/1', examId: ex.id };
  const codes = []; for (let i = 0; i < 700; i++) codes.push((await fetch(`${base}/api/gate`, { method: 'POST', headers: svc, body: JSON.stringify(body) })).status);
  assert.ok(codes.every((c) => c === 200), 'service key: never limited, got ' + JSON.stringify([...new Set(codes)]));
  const guess = []; for (let i = 0; i < 620; i++) guess.push((await fetch(`${base}/api/gate`, { method: 'POST', headers: { 'X-MySEB-Exam-Secret': 'mseb_guess' + i, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'x' }) })).status);
  const allowed = guess.filter((c) => c !== 429).length;   // earlier tests already used a few of the 600
  assert.ok(allowed >= 570 && allowed <= 600, `allowed ${allowed}`); assert.ok(guess.slice(-10).every((c) => c === 429), 'secret guessing is stopped after 600 a minute');
});

test('the report lists every student and a time-ordered timeline, and never carries pictures', async () => {
  const ex = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Report me', leaveAction: 'pause' } })).json;
  const c = (await call(`/api/exams/${ex.id}/generate-code`, { method: 'POST', headers: T })).json;
  const a = (await call('/api/verify-code', { method: 'POST', body: { code: c.code, studentName: 'Zed', deviceId: 'dev-zed-report', clientType: 'desktop', platform: 'win32' } })).json;
  const b = (await call('/api/verify-code', { method: 'POST', body: { code: c.code, studentName: 'Amy', deviceId: 'dev-amy-report', clientType: 'mobile', platform: 'android' } })).json;
  await call(`/api/exams/${ex.id}`, { method: 'PATCH', headers: T, body: { liveMode: 'pictures' } });
  await call(`/api/sessions/${a.sessionId}/live`, { method: 'POST', headers: T, body: { camera: 'on', frame: 'data:image/jpeg;base64,/9j/4AAQ' } });
  await call('/api/violation', { method: 'POST', headers: mk(a, 'dev-zed-report'), body: { type: 'leave', detail: { thresholdMs: 1500 } } });
  await new Promise((r) => setTimeout(r, 20));
  await call('/api/violation', { method: 'POST', headers: mk(a, 'dev-zed-report'), body: { type: 'copy' } });
  await call(`/api/sessions/${b.sessionId}/end`, { method: 'POST', headers: T });
  const rep = await call(`/api/exams/${ex.id}/report`, { headers: T });
  assert.equal(rep.status, 200);
  const r = rep.json;
  assert.deepEqual(r.students.map((s) => s.student_name), ['Amy', 'Zed'], 'sorted by name');
  assert.deepEqual(r.students.map((s) => [s.status, s.end_reason, s.violation_count]), [['ENDED', 'teacher', 0], ['PAUSED', null, 2]]);
  assert.deepEqual(r.events.map((e) => e.type), ['leave', 'copy']); assert.deepEqual(r.events[0].detail, { thresholdMs: 1500 });
  assert.ok(new Date(r.events[0].created_at) <= new Date(r.events[1].created_at));
  assert.ok(!JSON.stringify(r).includes('base64') && !JSON.stringify(r).includes('frame'), 'no pictures in the record');
  assert.equal((await call(`/api/exams/${ex.id}/report`)).status, 401);
  assert.equal((await call(`/api/exams/00000000-0000-4000-8000-000000000009/report`, { headers: T })).status, 404);
});
