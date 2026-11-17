// More time and short messages to students, from the lecturer or the room assistant.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TEACHER_KEY = 'tkey'; process.env.PEPPER = 'testpepper'; process.env.PUBLIC_URL = 'http://127.0.0.1:0'; process.env.VERIFY_RATE_PER_MIN = '1000';
const { app } = await import('../src/server.js');
const { migrate, pool, q } = await import('../src/db.js');
const { noticeFor, setNotice, cleanText, _resetNotices } = await import('../src/notices.js');
await migrate();
const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); pool.end(); });
const T = { Authorization: 'Bearer tkey', 'Content-Type': 'application/json' };
const call = async (path, { method = 'GET', headers = {}, body } = {}) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const mk = (s, dev) => ({ 'X-MySEB-Key': s.token, 'X-MySEB-Client': 'desktop', 'X-MySEB-Device': dev, 'User-Agent': 'Mozilla/5.0 MySEB/1.0 (desktop)' });
const join = async (code, name, dev) => (await call('/api/verify-code', { method: 'POST', body: { code, studentName: name, deviceId: dev, clientType: 'desktop', platform: 'win32' } })).json;

test('notices: kept ten minutes, one for the whole test and one per student, cleaned', () => {
  _resetNotices();
  assert.equal(noticeFor('e', 's'), null);
  const all = setNotice('e', 'Ten minutes left\u0000\n', undefined);
  assert.equal(noticeFor('e', 's').text, 'Ten minutes left'); assert.equal(noticeFor('e', 's').id, all.id);
  const one = setNotice('e', 'Check your camera', 's');
  assert.equal(noticeFor('e', 's').text, 'Check your camera', 'the personal one is newer'); assert.equal(noticeFor('e', 'other').text, 'Ten minutes left');
  assert.equal(noticeFor('e', 's', Date.now() + 11 * 60_000), null, 'gone after ten minutes');
  assert.equal(setNotice('e', '   '), null); assert.equal(cleanText('x'.repeat(500)).length, 300);
  assert.ok(one.id);
});

test('more time for everyone or one student, within 1 to 60 minutes, and the heartbeat carries notices', async () => {
  const exam = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Bio', durationMinutes: 30, leaveAction: 'pause' } })).json;
  const code = (await call(`/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).json;
  const a = await join(code.code, 'Alice', 'dev-alice-ra'); const b = await join(code.code, 'Bob', 'dev-bob-ra');
  const dl = async (sid) => new Date((await q('SELECT deadline_at FROM exam_sessions WHERE id=$1', [sid])).rows[0].deadline_at).getTime();
  const [a0, b0] = [await dl(a.sessionId), await dl(b.sessionId)];
  assert.equal((await call(`/api/exams/${exam.id}/extend`, { method: 'POST', body: { minutes: 5 } })).status, 401);
  for (const bad of [0, 61, 'x', null]) assert.equal((await call(`/api/exams/${exam.id}/extend`, { method: 'POST', headers: T, body: { minutes: bad } })).status, 400);
  assert.equal((await call(`/api/exams/${exam.id}/extend`, { method: 'POST', headers: T, body: { minutes: 5, sessionId: 'nope' } })).status, 400);
  const one = await call(`/api/exams/${exam.id}/extend`, { method: 'POST', headers: T, body: { minutes: 5, sessionId: a.sessionId } });
  assert.equal(one.json.changed, 1); assert.equal(await dl(a.sessionId) - a0, 5 * 60_000); assert.equal(await dl(b.sessionId), b0);
  const all = await call(`/api/exams/${exam.id}/extend`, { method: 'POST', headers: T, body: { minutes: 10 } });
  assert.equal(all.json.changed, 2); assert.equal(await dl(a.sessionId) - a0, 15 * 60_000); assert.equal(await dl(b.sessionId) - b0, 10 * 60_000);

  assert.equal((await call(`/api/exams/${exam.id}/notice`, { method: 'POST', headers: T, body: { text: '  ' } })).status, 400);
  assert.equal((await call(`/api/exams/${exam.id}/notice`, { method: 'POST', headers: T, body: { text: 'Hi', sessionId: 'nope' } })).status, 400);
  assert.equal((await call('/api/heartbeat', { method: 'POST', headers: mk(a, 'dev-alice-ra') })).json.notice, null);
  await call(`/api/exams/${exam.id}/notice`, { method: 'POST', headers: T, body: { text: 'Ten more minutes were added.' } });
  await call(`/api/exams/${exam.id}/notice`, { method: 'POST', headers: T, body: { text: 'Alice, please check your camera.', sessionId: a.sessionId } });
  assert.equal((await call('/api/heartbeat', { method: 'POST', headers: mk(a, 'dev-alice-ra') })).json.notice.text, 'Alice, please check your camera.');
  assert.equal((await call('/api/heartbeat', { method: 'POST', headers: mk(b, 'dev-bob-ra') })).json.notice.text, 'Ten more minutes were added.');
});
