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

test('evidence: pictures at the moment of a violation are kept in memory only, capped, and only the owner exam can read them; a review can give time back', async () => {
  const { saveLive } = await import('../src/live.js');
  const { evidenceOf, evidenceCounts, _resetEvidence, evidenceBytes } = await import('../src/evidence.js');
  _resetEvidence();
  const exam = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Ev', durationMinutes: 30, leaveAction: 'record' } })).json;
  const other = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Other', durationMinutes: 30 } })).json;
  const code = (await call(`/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).json;
  const a = await join(code.code, 'Eve', 'dev-eve-ev');
  const pic = (n) => `data:image/jpeg;base64,${Buffer.from(`picture-${n}`).toString('base64')}`;
  // no picture on the server: nothing to keep
  await call('/api/violation', { method: 'POST', headers: mk(a, 'dev-eve-ev'), body: { type: 'blur' } });
  assert.deepEqual(evidenceCounts(exam.id), {});
  for (let i = 0; i < 8; i++) {
    saveLive(a.sessionId, { camera: 'on', frame: pic(i), screen: pic(`s${i}`) }, true);
    await call('/api/violation', { method: 'POST', headers: mk(a, 'dev-eve-ev'), body: { type: 'screenshot' } });
  }
  assert.equal(evidenceCounts(exam.id)[a.sessionId], 6, 'six at most: the first and the newest');
  const items = evidenceOf(a.sessionId);
  assert.equal(Buffer.from(items[0].frame.split(',')[1], 'base64').toString(), 'picture-0'); assert.equal(Buffer.from(items.at(-1).frame.split(',')[1], 'base64').toString(), 'picture-7');
  assert.ok(evidenceBytes() > 0);
  assert.equal((await call(`/api/exams/${exam.id}/evidence`, { headers: { Authorization: 'Bearer tkey' } })).json.counts[a.sessionId], 6);
  assert.equal((await call(`/api/exams/${exam.id}/evidence`)).status, 401);
  assert.equal((await call(`/api/exams/${exam.id}/evidence?sessionId=${a.sessionId}`, { headers: { Authorization: 'Bearer tkey' } })).json.items.length, 6);
  assert.equal((await call(`/api/exams/${other.id}/evidence?sessionId=${a.sessionId}`, { headers: { Authorization: 'Bearer tkey' } })).status, 404, 'another test cannot read it');
  assert.equal((await call(`/api/exams/${exam.id}/evidence?sessionId=nope`, { headers: { Authorization: 'Bearer tkey' } })).status, 400);

  // reinstating after the time ran out: only with minutes, only while the test is open, and only for students ended by a rule
  await q(`UPDATE exam_sessions SET status='ENDED', ended_at=now(), end_reason='screenshot', deadline_at = now() - interval '5 minutes' WHERE id=$1`, [a.sessionId]);
  assert.equal((await call(`/api/sessions/${a.sessionId}/reinstate`, { method: 'POST', headers: T, body: {} })).status, 409, 'without minutes the old rule holds');
  assert.equal((await call(`/api/sessions/${a.sessionId}/reinstate`, { method: 'POST', headers: T, body: { minutes: 90 } })).status, 400);
  assert.equal((await call(`/api/sessions/${a.sessionId}/reinstate`, { method: 'POST', headers: T, body: { minutes: 10 } })).status, 200);
  const row = (await q('SELECT status, deadline_at, reinstated_count FROM exam_sessions WHERE id=$1', [a.sessionId])).rows[0];
  assert.equal(row.status, 'IN_EXAM'); assert.equal(row.reinstated_count, 1); assert.ok(new Date(row.deadline_at).getTime() - Date.now() > 9 * 60_000);
  await q(`UPDATE exam_sessions SET status='ENDED', ended_at=now(), end_reason='teacher' WHERE id=$1`, [a.sessionId]);
  assert.equal((await call(`/api/sessions/${a.sessionId}/reinstate`, { method: 'POST', headers: T, body: { minutes: 10 } })).status, 409, 'what the lecturer ended stays ended');
  await q(`UPDATE exam_sessions SET end_reason='screenshot', deadline_at = now() - interval '1 minute' WHERE id=$1`, [a.sessionId]);
  await call(`/api/exams/${exam.id}/end`, { method: 'POST', headers: T });
  assert.equal((await call(`/api/sessions/${a.sessionId}/reinstate`, { method: 'POST', headers: T, body: { minutes: 10 } })).status, 409, 'not after the test is closed');
});
