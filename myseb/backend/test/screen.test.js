// Screen sharing and the "pause, then end" leave policy, against a real Postgres.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TEACHER_KEY = 'tkey'; process.env.PEPPER = 'testpepper'; process.env.PUBLIC_URL = 'http://127.0.0.1:0'; process.env.VERIFY_RATE_PER_MIN = '1000';
const { app } = await import('../src/server.js');
const { migrate, pool, q } = await import('../src/db.js');
await migrate();
const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); pool.end(); });
const T = { Authorization: 'Bearer tkey' };
const call = async (path, { method = 'GET', headers = {}, body } = {}) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const UA = 'Mozilla/5.0 MySEB/1.0 (desktop)';
const mk = (s, dev) => ({ 'X-MySEB-Key': s.token, 'X-MySEB-Client': 'desktop', 'X-MySEB-Device': dev, 'User-Agent': UA });
const { cleanSignal } = await import('../src/live.js');
const dot = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/';

test('the lecturer chooses what students show: camera, screen or both; a bad value is ignored', async () => {
  const exam = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Screens', leaveAction: 'pause_then_end' } })).json;
  const get = async () => (await call(`/api/exams/${exam.id}/monitor`, { headers: T })).json.exam;
  assert.equal((await get()).live_source, 'camera');
  assert.equal((await get()).leave_action, 'pause_then_end');
  await call(`/api/exams/${exam.id}`, { method: 'PATCH', headers: T, body: { liveMode: 'live', liveSource: 'both' } });
  assert.equal((await get()).live_source, 'both');
  await call(`/api/exams/${exam.id}`, { method: 'PATCH', headers: T, body: { liveSource: 'everything' } });
  assert.equal((await get()).live_source, 'both', 'unknown value changes nothing');
});

test('screen pictures are kept in memory for the live room, only when the lecturer asked for pictures', async () => {
  const exam = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Screens 2' } })).json;
  const code = (await call(`/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).json;
  const a = (await call('/api/verify-code', { method: 'POST', body: { code: code.code, studentName: 'Ann', deviceId: 'dev-ann-12345', clientType: 'desktop' } })).json;
  const live = (body) => call(`/api/sessions/${a.sessionId}/live`, { method: 'POST', headers: T, body });
  assert.equal((await live({ screen: dot, screenState: 'on' })).json.faces, false);
  let mon = (await call(`/api/exams/${exam.id}/monitor`, { headers: T })).json;
  assert.equal(mon.students[0].live.screen, null, 'dropped while the lecturer has pictures off');
  await call(`/api/exams/${exam.id}`, { method: 'PATCH', headers: T, body: { liveMode: 'pictures', liveSource: 'screen' } });
  const r = (await live({ screen: dot, screenState: 'on' })).json;
  assert.equal(r.source, 'screen'); assert.equal(r.faces, true);
  mon = (await call(`/api/exams/${exam.id}/monitor`, { headers: T })).json;
  assert.equal(mon.students[0].live.screen, dot); assert.equal(mon.students[0].live.screen_state, 'on');
  assert.equal((await live({ screen: 'data:text/html;base64,AAAA', screenState: 'on' })).status, 200);
  const frames = (await call(`/api/exams/${exam.id}/frames?ids=${a.sessionId}`, { headers: T })).json.frames[a.sessionId];
  assert.equal(frames.screen, dot, 'a non-image is refused, the last good picture stays');
  const row = await q('SELECT count(*)::int n FROM information_schema.columns WHERE column_name ILIKE \'%screen%\' AND table_name IN (\'exam_sessions\',\'violations\')');
  assert.equal(row.rows[0].n, 0, 'nothing about the screen is written to the database');
});

test('pause, then end: the first time away pauses; the second time ends the quiz at once', async () => {
  const exam = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Strikes', leaveAction: 'pause_then_end' } })).json;
  const code = (await call(`/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).json;
  const a = (await call('/api/verify-code', { method: 'POST', body: { code: code.code, studentName: 'Bea', deviceId: 'dev-bea-12345', clientType: 'desktop' } })).json;
  const status = async () => (await q('SELECT status, end_reason FROM exam_sessions WHERE id=$1', [a.sessionId])).rows[0];
  await call('/api/violation', { method: 'POST', headers: mk(a, 'dev-bea-12345'), body: { type: 'blur', detail: {} } });
  assert.equal((await status()).status, 'PAUSED');
  await call(`/api/sessions/${a.sessionId}/resume`, { method: 'POST', headers: T });
  assert.equal((await status()).status, 'IN_EXAM');
  await call('/api/violation', { method: 'POST', headers: mk(a, 'dev-bea-12345'), body: { type: 'visibility_hidden', detail: {} } });
  const end = await status();
  assert.equal(end.status, 'ENDED'); assert.equal(end.end_reason, 'visibility_hidden');
});

test('stopping the screen share counts as leaving, once per stop, and the leave policy applies', async () => {
  const exam = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Stop share', leaveAction: 'pause' } })).json;
  await call(`/api/exams/${exam.id}`, { method: 'PATCH', headers: T, body: { liveMode: 'pictures', liveSource: 'screen' } });
  const code = (await call(`/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).json;
  const a = (await call('/api/verify-code', { method: 'POST', body: { code: code.code, studentName: 'Cy', deviceId: 'dev-cy-123456', clientType: 'desktop' } })).json;
  const live = (screenState) => call(`/api/sessions/${a.sessionId}/live`, { method: 'POST', headers: T, body: { screenState } });
  const row = async () => (await q('SELECT status, violation_count FROM exam_sessions WHERE id=$1', [a.sessionId])).rows[0];
  await live('ask'); await live('on');
  assert.equal((await row()).status, 'IN_EXAM');
  await live('denied'); await live('denied');
  const r = await row(); assert.equal(r.status, 'PAUSED'); assert.equal(r.violation_count, 1, 'counted once, not every report');
  assert.equal((await q("SELECT count(*)::int n FROM violations WHERE session_id=$1 AND type='screen_share_stopped'", [a.sessionId])).rows[0].n, 1);
});

test('a camera that another app is holding is shown to the lecturer as "busy", is not a rule break, and an unknown value is ignored', async () => {
  const exam = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Busy camera' } })).json;
  await call(`/api/exams/${exam.id}`, { method: 'PATCH', headers: T, body: { liveMode: 'pictures', liveSource: 'camera' } });
  const code = (await call(`/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).json;
  const a = (await call('/api/verify-code', { method: 'POST', body: { code: code.code, studentName: 'Dee', deviceId: 'dev-dee-123456', clientType: 'mobile' } })).json;
  const live = (camera) => call(`/api/sessions/${a.sessionId}/live`, { method: 'POST', headers: T, body: { camera } });
  const seen = async () => (await call(`/api/exams/${exam.id}/monitor?frames=0`, { headers: T })).json.students[0];
  await live('busy');
  let s = await seen();
  assert.equal(s.live.camera, 'busy'); assert.equal(s.status, 'IN_EXAM', 'a busy camera on its own does not pause or end the test');
  await live('on'); assert.equal((await seen()).live.camera, 'on', 'it goes back to on by itself once the other app lets go');
  await live('something-else'); assert.equal((await seen()).live.camera, 'off', 'unknown values are ignored');
});

test('the lecturer can ask a student for full quality (zoom) or the light picture; nothing else sneaks through', () => {
  assert.deepEqual(cleanSignal({ type: 'quality', level: 'high', viewer: 'v1' }), { type: 'quality', viewer: 'v1', level: 'high' });
  assert.equal(cleanSignal({ type: 'quality', level: 'ultra', viewer: 'v1' }).level, 'low', 'an unknown level means the light picture');
  assert.equal(cleanSignal({ type: 'quality', level: 'high', viewer: 'v1', sdp: 'x'.repeat(20000) }), null, 'oversize messages are refused');
  assert.equal(cleanSignal({ type: 'format-disk' }), null);
});

test('pictures are asked for only from the students the lecturer is looking at', async () => {
  const exam = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Wanted' } })).json;
  await call(`/api/exams/${exam.id}`, { method: 'PATCH', headers: T, body: { liveMode: 'live', liveSource: 'both' } });
  const code = (await call(`/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).json;
  const mkStudent = async (name, n) => (await call('/api/verify-code', { method: 'POST', body: { code: code.code, studentName: name, deviceId: `dev-${n}-12345678`, clientType: 'desktop' } })).json;
  const watched = await mkStudent('Watched', 'w'), other = await mkStudent('Other', 'o');
  const report = (s) => call(`/api/sessions/${s.sessionId}/live`, { method: 'POST', headers: T, body: { question: { index: 1, total: 3, label: 'Q' }, camera: 'on', screenState: 'on' } });
  assert.equal((await report(watched)).json.pictures, false, 'nobody is looking yet: no pictures');
  assert.ok((await report(watched)).json.every >= 5, 'the server sets the rhythm');
  await call(`/api/exams/${exam.id}/frames?ids=${watched.sessionId}`, { headers: T });   // the lecturer's room shows this student's tile
  assert.equal((await report(watched)).json.pictures, true, 'now this student is asked for pictures');
  assert.equal((await report(other)).json.pictures, false, 'the others still send only status');
});
