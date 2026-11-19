// Integrity score: what it counts, and that it is shown in the live monitor, against a real Postgres.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assess } from '../src/integrity.js';

test('a clean student is low; repeats count less; reasons are spelled out', () => {
  assert.deepEqual(assess({}), { score: 0, level: 'low', reasons: [] });
  const five = assess({ blur: 5 });
  assert.ok(five.score < 25 && five.level === 'low', 'window switching alone is not suspicious');
  const rec = assess({ screen_recording: 1, forbidden_app: 1 });
  assert.equal(rec.level, 'high');
  assert.match(rec.reasons[0], /screen recording/);
  assert.ok(assess({ heartbeat_lost: 20 }).level === 'low', 'a bad connection alone never makes anyone high');
});

test('a shared device is high on its own; the score is capped at 100', () => {
  const a = assess({}, { sharedDevice: true });
  assert.ok(a.level === 'high' && a.reasons[0].includes('same device'));
  assert.equal(assess({ token_misuse: 3, screen_recording: 3, virtual_machine: 1, remote_session: 1 }, { sharedDevice: true }).score, 100);
});

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

test('the monitor shows each student\'s risk and flags a device used by two students', async () => {
  const exam = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Integrity' } })).json;
  const join = async (name, dev) => {
    const code = (await call(`/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).json;
    return (await call('/api/verify-code', { method: 'POST', body: { code: code.code, studentName: name, deviceId: dev, clientType: 'desktop' } })).json;
  };
  const a = await join('Alice', 'dev-shared-12345');
  const b = await join('Bob', 'dev-shared-12345');   // same device, different student
  const c = await join('Cara', 'dev-cara-123456');
  const hdr = (s, dev) => ({ 'X-MySEB-Key': s.token, 'X-MySEB-Client': 'desktop', 'X-MySEB-Device': dev, 'User-Agent': UA });
  assert.ok(a.sessionId && b.sessionId && c.sessionId, JSON.stringify([a, b, c]));
  const r = await call('/api/violation', { method: 'POST', headers: hdr(c, 'dev-cara-123456'), body: { type: 'virtual_machine', detail: {} } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const m = (await call(`/api/exams/${exam.id}/monitor?frames=0`, { headers: T })).json;
  const by = Object.fromEntries(m.students.map((s) => [s.student_name, s.risk]));
  assert.equal(by.Alice.level, 'high'); assert.match(by.Bob.reasons.join(), /same device/);
  assert.ok(by.Cara.score > 0 && by.Cara.reasons[0].includes('virtual machine'));
});
