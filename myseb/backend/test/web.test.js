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
  assert.equal((await call('/api/violation', { method: 'POST', headers: { Cookie: ck, 'User-Agent': SAFARI }, body: { type: 'paste', detail: {} } })).status, 200);
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

test('strict browser rules: leaving, a lost face or a closed camera ends the test, once, and a weak connection does not', async () => {
  const exam = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Strict', leaveAction: 'record' } })).json;
  await call(`/api/exams/${exam.id}`, { method: 'PATCH', headers: T, body: { allowWeb: true } });
  const code = (await call(`/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).json;
  const join = (name, device) => call('/api/verify-code', { method: 'POST', headers: { 'User-Agent': SAFARI }, body: { code: code.code, studentName: name, deviceId: device, clientType: 'web' } });
  const H = (j) => ({ Cookie: j.cookie.split(';')[0], 'User-Agent': SAFARI });
  const viol = (j, type) => call('/api/violation', { method: 'POST', headers: H(j), body: { type, detail: {} } });

  assert.equal((await call(`/api/exams/${exam.id}/monitor`, { headers: T })).json.exam.web_strict, true, 'strict is the default');
  for (const [i, type] of ['background', 'visibility_hidden', 'face_missing', 'camera_off'].entries()) {
    const j = await join(`Strict ${i}`, `strict-dev-${i}-123456`);
    assert.equal((await call('/api/web/me', { headers: H(j) })).json.strict, true);
    const r = await viol(j, type);
    assert.equal(r.json.status, 'ENDED', `${type} ends the test`); assert.equal(r.json.reason, type);
    assert.equal((await call('/api/heartbeat', { method: 'POST', headers: H(j) })).json.status, 'ENDED');
    assert.equal((await call('/api/web/me', { headers: H(j) })).json.reason, type, 'the page can show why after a reload');
  }
  // one attempt: the same browser cannot come back under another name, nor under the same name
  assert.equal((await join('Someone Else', 'strict-dev-0-123456')).status, 409);
  assert.equal((await join('Strict 0', 'strict-dev-0-123456')).status, 409);
  // not rejected: copy / paste are only recorded, a face check that could not load is only recorded, a lost heartbeat follows the lecturer's rule
  const ok = await join('Calm', 'strict-dev-calm-123456');
  assert.equal((await viol(ok, 'paste')).json.status, 'IN_EXAM');
  assert.equal((await viol(ok, 'face_check_unavailable')).json.status, 'IN_EXAM');
  assert.equal((await viol(ok, 'multiple_faces')).json.status, 'IN_EXAM');
  // gentler rules: the lecturer's own "If a student leaves" rule applies instead
  await call(`/api/exams/${exam.id}`, { method: 'PATCH', headers: T, body: { webStrict: false } });
  const soft = await join('Soft', 'strict-dev-soft-123456');
  assert.equal((await call('/api/web/me', { headers: H(soft) })).json.strict, false);
  assert.equal((await viol(soft, 'visibility_hidden')).json.status, 'IN_EXAM', 'record only');
  assert.equal((await viol(soft, 'face_missing')).json.status, 'IN_EXAM');
});

test('more than one face, the card check, looking aside and letting a student back in', async () => {
  const exam = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Phase 2', leaveAction: 'record' } })).json;
  await call(`/api/exams/${exam.id}`, { method: 'PATCH', headers: T, body: { allowWeb: true } });
  const code = (await call(`/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).json;
  const join = (name) => call('/api/verify-code', { method: 'POST', headers: { 'User-Agent': SAFARI }, body: { code: code.code, studentName: name, deviceId: `p2-${name}-1234567`, clientType: 'web' } });
  const H = (j) => ({ Cookie: j.cookie.split(';')[0], 'User-Agent': SAFARI });
  const viol = (j, type) => call('/api/violation', { method: 'POST', headers: H(j), body: { type, detail: {} } });
  const mon = async () => (await call(`/api/exams/${exam.id}/monitor`, { headers: T })).json;
  const patch = (body) => call(`/api/exams/${exam.id}`, { method: 'PATCH', headers: T, body });

  // several faces: warn is the default (recorded, not ended); end disqualifies; off records nothing special
  const a = await join('Amy');
  assert.equal((await call('/api/web/me', { headers: H(a) })).json.multi, 'warn');
  assert.equal((await viol(a, 'multiple_faces')).json.status, 'IN_EXAM');
  await patch({ multiFace: 'end' });
  const b = await join('Ben');
  assert.equal((await call('/api/web/me', { headers: H(b) })).json.multi, 'end');
  assert.equal((await viol(b, 'multiple_faces')).json.status, 'ENDED');
  assert.equal((await patch({ multiFace: 'nonsense' })).status, 400, 'an unknown value changes nothing');
  assert.equal((await mon()).exam.multi_face, 'end');

  // looking aside: a number for the lecturer, written by the heartbeat
  await call('/api/heartbeat', { method: 'POST', headers: H(a), body: { aside: 42 } });
  await new Promise((r) => setTimeout(r, 1700));   // the room's shared list is rebuilt at least every 1.5 s
  assert.equal((await mon()).students.find((s) => s.student_name === 'Amy').aside_seconds, 42);

  // letting a disqualified student back in: only for rule breaks, recorded, and the student's page sees it on its next heartbeat
  const benId = (await mon()).students.find((s) => s.student_name === 'Ben').id;
  assert.equal((await call('/api/heartbeat', { method: 'POST', headers: H(b) })).json.status, 'ENDED');
  assert.equal((await call(`/api/sessions/${benId}/reinstate`, { method: 'POST', headers: T })).status, 200);
  assert.equal((await call('/api/heartbeat', { method: 'POST', headers: H(b) })).json.status, 'IN_EXAM');
  const ben = (await mon()).students.find((s) => s.student_name === 'Ben'); assert.equal(ben.reinstated_count, 1);
  assert.ok((await call(`/api/sessions/${benId}/violations`, { headers: T })).json.some((v) => v.type === 'reinstated'), 'it is in the log');
  assert.equal((await call(`/api/sessions/${benId}/reinstate`, { method: 'POST', headers: T })).status, 409, 'not ended: nothing to undo');
  await call(`/api/sessions/${benId}/end`, { method: 'POST', headers: T });
  assert.equal((await call(`/api/sessions/${benId}/reinstate`, { method: 'POST', headers: T })).status, 409, 'a lecturer who ended a student is not undone');

  // the card check: off by default; on, the picture waits for the lecturer and is deleted at the decision
  const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBD';
  assert.equal((await call('/api/id-check', { method: 'POST', headers: H(a), body: { image: JPG } })).status, 400, 'no card check on this test');
  await patch({ idCheck: true });
  const c = await join('Cora');
  const me = (await call('/api/web/me', { headers: H(c) })).json; assert.equal(me.idCheck, true); assert.equal(me.idStatus, 'none');
  assert.equal((await call('/api/id-check', { method: 'POST', headers: H(c), body: { image: 'not a picture' } })).status, 400);
  assert.equal((await call('/api/id-check', { method: 'POST', headers: H(c), body: { image: 'data:image/png;base64,AAAA' } })).status, 400, 'JPEG only');
  assert.equal((await call('/api/id-check', { method: 'POST', headers: H(c), body: { image: JPG } })).json.idStatus, 'pending');
  assert.equal((await call('/api/heartbeat', { method: 'POST', headers: H(c) })).json.idStatus, 'pending');
  assert.equal((await call(`/api/exams/${exam.id}/id-checks`)).status, 401, 'only the lecturer sees the card');
  const waiting = (await call(`/api/exams/${exam.id}/id-checks`, { headers: T })).json.pending; assert.equal(waiting.length, 1); assert.equal(waiting[0].image, JPG);
  const coraId = waiting[0].id;
  assert.equal((await call(`/api/sessions/${coraId}/id-decision`, { method: 'POST', headers: T, body: { allow: true } })).json.ok, true);
  assert.equal((await call('/api/heartbeat', { method: 'POST', headers: H(c) })).json.idStatus, 'approved');
  assert.equal((await call(`/api/exams/${exam.id}/id-checks`, { headers: T })).json.pending.length, 0);
  assert.equal((await call(`/api/exams/${exam.id}/id-checks`, { headers: T })).json.pending.some((x) => x.id === coraId), false, 'the picture is gone once decided');
  // refused: the student is out
  const d = await join('Dan');
  await call('/api/id-check', { method: 'POST', headers: H(d), body: { image: JPG } });
  const danId = (await call(`/api/exams/${exam.id}/id-checks`, { headers: T })).json.pending[0].id;
  await call(`/api/sessions/${danId}/id-decision`, { method: 'POST', headers: T, body: { allow: false } });
  assert.equal((await call('/api/heartbeat', { method: 'POST', headers: H(d) })).json.status, 'ENDED');
  assert.equal((await mon()).students.find((s) => s.student_name === 'Dan').end_reason, 'id_refused');
});

test('browsers for iPhones and iPads only, and answers saved so leaving does not lose them', async () => {
  const exam = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Phase 3', leaveAction: 'record' } })).json;
  await call(`/api/exams/${exam.id}`, { method: 'PATCH', headers: T, body: { allowWeb: true } });
  const code = (await call(`/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).json;
  const join = (name, ua, extra = {}) => call('/api/verify-code', { method: 'POST', headers: { 'User-Agent': ua }, body: { code: code.code, studentName: name, deviceId: `p3-${name}-1234567`, clientType: 'web', ...extra } });
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
  const H = (j, ua = SAFARI) => ({ Cookie: j.cookie.split(';')[0], 'User-Agent': ua });
  const patch = (body) => call(`/api/exams/${exam.id}`, { method: 'PATCH', headers: T, body });
  const mon = async () => (await call(`/api/exams/${exam.id}/monitor`, { headers: T })).json;

  // any device by default; ios only: a laptop browser is refused with a clear reason, an iPhone and a (claimed) iPad in desktop mode are fine
  assert.equal((await mon()).exam.web_devices, 'any');
  assert.equal((await join('Lap0', CHROME)).status, 200);
  assert.equal((await patch({ webDevices: 'nonsense' })).status, 400);
  await patch({ webDevices: 'ios' });
  assert.equal((await mon()).exam.web_devices, 'ios');
  const laptop = await join('Lap1', CHROME); assert.equal(laptop.status, 403); assert.match(laptop.json.error, /only for iPhones and iPads/);
  assert.equal((await join('Mac1', MAC)).status, 403, 'a Mac without a touch screen');
  assert.equal((await join('Pad1', MAC, { touch: true })).status, 200, 'an iPad in desktop mode says it has a touch screen');
  const phone = await join('Phone1', SAFARI); assert.equal(phone.status, 200);
  // the gate's offer of the browser is only made to devices that could use it
  const gate = (ua) => call('/api/gate', { method: 'POST', headers: { 'X-MySEB-Service-Key': 'tkey' }, body: { key: 'x'.repeat(30), client: 'cookie', device: '', userAgent: ua, examId: exam.id } });
  assert.equal((await gate(CHROME)).json.webAllowed, false); assert.equal((await gate(SAFARI)).json.webAllowed, true);

  // saved answers: any time while in the test, bounded in size, only the owner reads them
  const sid = (await mon()).students.find((s) => s.student_name === 'Phone1').id;
  assert.equal((await call('/api/partial', { method: 'POST', headers: H(phone), body: { nonsense: 1 } })).status, 400);
  assert.equal((await call('/api/partial', { method: 'POST', headers: H(phone), body: { answers: { huge: 'x'.repeat(250_000) } } })).status, 413);
  const first = { key: 'dynamicform:f1', answers: { q1: 'Mitochondria', q2: ['a', 'c'] }, labels: { q1: 'What makes energy?', q2: 'Pick two' } };
  assert.equal((await call('/api/partial', { method: 'POST', headers: H(phone), body: first })).status, 200);
  assert.equal((await call('/api/partial', { method: 'POST', headers: { 'User-Agent': SAFARI }, body: first })).status, 401, 'needs the browser session');
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal((await mon()).students.find((s) => s.id === sid).has_partial, true);
  assert.equal((await call(`/api/sessions/${sid}/partial`)).status, 401, 'only the lecturer reads them');
  const got = (await call(`/api/sessions/${sid}/partial`, { headers: T })).json;
  assert.deepEqual(got.answers, first.answers); assert.deepEqual(got.labels, first.labels); assert.equal(got.student, 'Phone1');

  // disqualified: the last words still arrive; they are in the report and the lecturer can see them
  const last = { ...first, answers: { ...first.answers, q1: 'Mitochondria and chloroplasts' } };
  assert.equal((await call('/api/violation', { method: 'POST', headers: H(phone), body: { type: 'visibility_hidden', detail: {} } })).json.status, 'ENDED');
  assert.equal((await call('/api/partial', { method: 'POST', headers: H(phone), body: last })).status, 200, 'a final save right after leaving');
  assert.equal((await call(`/api/sessions/${sid}/partial`, { headers: T })).json.answers.q1, 'Mitochondria and chloroplasts');
  const rep = (await call(`/api/exams/${exam.id}/report`, { headers: T })).json;
  assert.equal(rep.partial.length, 1); assert.equal(rep.partial[0].student_name, 'Phone1'); assert.equal(rep.partial[0].answers.q1, 'Mitochondria and chloroplasts');
  // a long time after the end it is refused
  await pool.query(`UPDATE exam_sessions SET ended_at = now() - interval '11 minutes' WHERE id=$1`, [sid]);
  assert.equal((await call('/api/partial', { method: 'POST', headers: H(phone), body: first })).status, 409);
  assert.equal((await call(`/api/sessions/${sid}/partial`, { headers: T })).json.answers.q1, 'Mitochondria and chloroplasts', 'nothing was overwritten');

  // let back in: the page is told what to put back, and only then
  assert.equal((await call('/api/web/me', { headers: H(phone) })).json.restore, null, 'not reinstated: nothing to restore');
  await pool.query(`UPDATE exam_sessions SET ended_at = now() WHERE id=$1`, [sid]);
  assert.equal((await call(`/api/sessions/${sid}/reinstate`, { method: 'POST', headers: T })).status, 200);
  const me = (await call('/api/web/me', { headers: H(phone) })).json;
  assert.equal(me.status, 'IN_EXAM'); assert.equal(me.restore.key, 'dynamicform:f1'); assert.equal(me.restore.answers.q1, 'Mitochondria and chloroplasts');
});
