// Browser mode ("MySEB Web"): for iPhones and anyone without the app. Allowed per test; signed in by a secure cookie tied to the browser.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TEACHER_KEY = 'tkey'; process.env.PEPPER = 'testpepper'; process.env.PUBLIC_URL = 'https://example.test/myseb'; process.env.VERIFY_RATE_PER_MIN = '1000';
const { app } = await import('../src/server.js');
const { migrate, pool } = await import('../src/db.js');
await migrate();
const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); pool.end(); });
const T = { Authorization: 'Bearer tkey', 'Content-Type': 'application/json' };
const call = async (path, { method = 'GET', headers = {}, body } = {}) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})), cookie: r.headers.get('set-cookie') || '' };
};
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36';

test('a browser can join only when the lecturer allows it, and its key is a secure cookie', async () => {
  const exam = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Web', leaveAction: 'record' } })).json;
  const code = (await call(`/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).json;
  const join = (ua = SAFARI) => call('/api/verify-code', { method: 'POST', headers: { 'User-Agent': ua }, body: { code: code.code, studentName: 'Ife', deviceId: 'web-ife-123456', clientType: 'web', platform: 'iPhone' } });
  assert.equal((await join()).status, 403, 'off by default');
  await call(`/api/exams/${exam.id}`, { method: 'PATCH', headers: T, body: { allowWeb: true } });
  const ok = await join(); assert.equal(ok.status, 200);
  assert.match(ok.cookie, /myseb_s=[\w-]{20,}/); assert.match(ok.cookie, /HttpOnly/); assert.match(ok.cookie, /Secure/); assert.match(ok.cookie, /SameSite=Lax/);
  const ck = ok.cookie.split(';')[0];

  // the same browser: signed in
  const me = await call('/api/web/me', { headers: { Cookie: ck, 'User-Agent': SAFARI } });
  assert.equal(me.json.active, true); assert.equal(me.json.status, 'IN_EXAM');
  // heartbeat and violation work with the cookie alone
  assert.equal((await call('/api/heartbeat', { method: 'POST', headers: { Cookie: ck, 'User-Agent': SAFARI } })).json.status, 'IN_EXAM');
  assert.equal((await call('/api/violation', { method: 'POST', headers: { Cookie: ck, 'User-Agent': SAFARI }, body: { type: 'visibility_hidden', detail: {} } })).status, 200);
  // the cookie taken to a different browser is refused, and the lecturer is told
  assert.equal((await call('/api/web/me', { headers: { Cookie: ck, 'User-Agent': CHROME } })).status, 401);
  assert.equal((await call('/api/heartbeat', { method: 'POST', headers: { Cookie: ck, 'User-Agent': CHROME } })).status, 403);
  // no cookie, no entry; and a phone-app style request can't pretend to be a browser session
  assert.equal((await call('/api/web/me', { headers: { 'User-Agent': SAFARI } })).status, 401);
  assert.equal((await call('/api/heartbeat', { method: 'POST', headers: { 'X-MySEB-Key': ck.split('=')[1], 'X-MySEB-Client': 'web', 'X-MySEB-Device': 'web-ife-123456', 'User-Agent': SAFARI } })).status, 403, 'a browser session works only through its cookie');

  // the exam site's question "is this request from a live session?": the same browser yes, another no
  const gate = (ua, cookieKey = ck.split('=')[1]) => call('/api/gate', { method: 'POST', headers: { 'X-MySEB-Service-Key': 'tkey' }, body: { key: cookieKey, client: 'cookie', device: '', userAgent: ua, examId: exam.id } });
  assert.equal((await gate(SAFARI)).json.allowed, true); assert.equal((await gate(SAFARI)).json.clientType, 'web');
  const other = await gate(CHROME); assert.equal(other.json.allowed, false); assert.equal(other.json.webAllowed, true, 'the "use your browser" offer is shown');
  // turned off again: the browser is out at once
  await call(`/api/exams/${exam.id}`, { method: 'PATCH', headers: T, body: { allowWeb: false } });
  assert.equal((await call('/api/web/me', { headers: { Cookie: ck, 'User-Agent': SAFARI } })).status, 401);
  assert.equal((await gate(SAFARI)).json.allowed, false);
});

test('the lecturer sees a browser student, and can end them', async () => {
  const exam = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Web 2' } })).json;
  await call(`/api/exams/${exam.id}`, { method: 'PATCH', headers: T, body: { allowWeb: true } });
  const code = (await call(`/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).json;
  const j = await call('/api/verify-code', { method: 'POST', headers: { 'User-Agent': SAFARI }, body: { code: code.code, studentName: 'Kay', deviceId: 'web-kay-123456', clientType: 'web' } });
  const mon = (await call(`/api/exams/${exam.id}/monitor`, { headers: T })).json;
  assert.equal(mon.exam.allow_web, true); assert.equal(mon.students[0].client_type, 'web');
  await call(`/api/sessions/${j.json.sessionId}/end`, { method: 'POST', headers: T });
  assert.equal((await call('/api/heartbeat', { method: 'POST', headers: { Cookie: j.cookie.split(';')[0], 'User-Agent': SAFARI } })).json.status, 'ENDED');
});

test('the link a lecturer shares: one page for every device, with the code and nothing secret', async () => {
  const get = async (path, ua) => { const r = await fetch(base + path, { headers: { 'User-Agent': ua } }); return { status: r.status, csp: r.headers.get('content-security-policy') || '', text: await r.text() }; };
  const ok = await get('/join/482910', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120');
  assert.equal(ok.status, 200);
  assert.match(ok.text, /482 910/, 'the code is shown');
  assert.match(ok.text, /myseb:\/\/join\?code='\+CODE/, 'it can open the app with the code');
  assert.match(ok.text, /\/download/, 'and download the app when it is missing');
  assert.match(ok.text, /clientType:'web'/, 'and start in the browser (iPhones)');
  assert.match(ok.csp, /connect-src 'self'/); assert.match(ok.csp, /frame-ancestors 'none'/); assert.doesNotMatch(ok.csp, /unsafe-eval/);
  assert.doesNotMatch(ok.text, /tkey|testpepper|myseb_s=/, 'no secret on the page');
  // anything that is not a six-digit code is not rendered into the page (no injection through the address)
  for (const bad of ['abc', '12345', '1234567', encodeURIComponent('</script><script>alert(1)</script>')]) {
    const r = await get(`/join/${bad}`, 'Mozilla/5.0 (iPhone)');
    assert.match(r.text, /This link is not valid/); assert.doesNotMatch(r.text, /<script>alert|var CODE/);
  }
});
