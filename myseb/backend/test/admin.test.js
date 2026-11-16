// The platform administrator's controls over MySEB: a view of every exam, stopping new sign-ins, turning browser mode off, and retention.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TEACHER_KEY = 'tkey'; process.env.PEPPER = 'testpepper'; process.env.PUBLIC_URL = 'https://example.test/myseb'; process.env.VERIFY_RATE_PER_MIN = '1000';
const { app } = await import('../src/server.js');
const { migrate, pool, q } = await import('../src/db.js');
const { saveControls } = await import('../src/admin.js');
await migrate();
const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(async () => { await saveControls({ enabled: true, browserMode: true, retentionDays: null }); server.close(); pool.end(); });
const T = { Authorization: 'Bearer tkey', 'Content-Type': 'application/json' };
const call = async (path, { method = 'GET', headers = {}, body } = {}) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';

test('only the service key sees the administrator view, and it shows every exam with where the students are', async () => {
  assert.equal((await call('/api/admin/overview')).status, 401);
  assert.equal((await call('/api/admin/controls', { method: 'PUT', body: { enabled: false } })).status, 401);
  const exam = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Admin view', leaveAction: 'record' } })).json;
  await call(`/api/exams/${exam.id}`, { method: 'PATCH', headers: T, body: { allowWeb: true } });
  const code = (await call(`/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).json;
  const join = (name) => call('/api/verify-code', { method: 'POST', headers: { 'User-Agent': SAFARI }, body: { code: code.code, studentName: name, deviceId: `adm-${name}-1234567`, clientType: 'web' } });
  assert.equal((await join('Ann')).status, 200); assert.equal((await join('Bo')).status, 200);
  const o = (await call('/api/admin/overview', { headers: T })).json;
  assert.equal(o.controls.enabled, true); assert.equal(o.retentionDays, 90);
  assert.ok(o.totals.inExam >= 2 && o.totals.exams >= 1); assert.ok(o.server.uptimeSeconds >= 0); assert.ok('reports' in o.live);
  const row = o.exams.find((e) => e.id === exam.id);
  assert.equal(row.title, 'Admin view'); assert.equal(row.students, 2); assert.equal(row.in_exam, 2); assert.equal(row.allow_web, true);
  assert.equal(o.exams[0].in_exam > 0, true, 'exams with students inside come first');
});

test('stopping sign-ins, turning browser mode off and the 503 / 403 students see; students already inside carry on', async () => {
  const exam = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Switches', leaveAction: 'record' } })).json;
  await call(`/api/exams/${exam.id}`, { method: 'PATCH', headers: T, body: { allowWeb: true } });
  const code = (await call(`/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).json;
  const join = (name, ua = SAFARI) => call('/api/verify-code', { method: 'POST', headers: { 'User-Agent': ua }, body: { code: code.code, studentName: name, deviceId: `sw-${name}-1234567`, clientType: 'web' } });
  const inside = await fetch(base + '/api/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': SAFARI }, body: JSON.stringify({ code: code.code, studentName: 'Inside', deviceId: 'sw-inside-1234567', clientType: 'web' }) });
  const cookie = inside.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/admin/controls', { method: 'PUT', headers: T, body: {} })).status, 400, 'nothing to change');

  assert.equal((await call('/api/admin/controls', { method: 'PUT', headers: T, body: { browserMode: false } })).json.browserMode, false);
  const noWeb = await join('Late1'); assert.equal(noWeb.status, 403); assert.match(noWeb.json.error, /Browser mode is turned off/);
  assert.equal((await call('/api/heartbeat', { method: 'POST', headers: { Cookie: cookie, 'User-Agent': SAFARI } })).json.status, 'IN_EXAM', 'a student already inside is not cut off');

  await call('/api/admin/controls', { method: 'PUT', headers: T, body: { browserMode: true, enabled: false } });
  const paused = await join('Late2'); assert.equal(paused.status, 503); assert.match(paused.json.error, /paused by the platform administrator/);
  assert.equal((await call('/api/heartbeat', { method: 'POST', headers: { Cookie: cookie, 'User-Agent': SAFARI } })).json.status, 'IN_EXAM');

  await call('/api/admin/controls', { method: 'PUT', headers: T, body: { enabled: true } });
  assert.equal((await join('Late3')).status, 200, 'switched back on: students can join again');
  // the choice is kept in the database, so a restart does not lose it
  const stored = JSON.parse((await q("SELECT v FROM myseb_meta WHERE k = 'controls'")).rows[0].v); assert.equal(stored.enabled, true);
});

test('retention: change how long finished exams are kept, and purge now', async () => {
  const r = await call('/api/admin/controls', { method: 'PUT', headers: T, body: { retentionDays: 30 } }); assert.equal(r.json.retentionDays, 30);
  assert.equal((await call('/api/admin/overview', { headers: T })).json.retentionDays, 30);
  assert.equal((await call('/api/admin/controls', { method: 'PUT', headers: T, body: { retentionDays: 3 } })).status, 400, 'too short is refused');
  // an exam that ended 40 days ago goes; one that ended 10 days ago stays
  const old = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Old' } })).json; const recent = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Recent' } })).json;
  await q(`UPDATE exams SET status='ended', ends_at = now() - interval '40 days' WHERE id=$1`, [old.id]);
  await q(`UPDATE exams SET status='ended', ends_at = now() - interval '10 days' WHERE id=$1`, [recent.id]);
  const purged = (await call('/api/admin/purge', { method: 'POST', headers: T })).json;
  assert.equal(purged.days, 30); assert.ok(purged.exams >= 1);
  assert.equal((await q('SELECT 1 FROM exams WHERE id=$1', [old.id])).rowCount, 0); assert.equal((await q('SELECT 1 FROM exams WHERE id=$1', [recent.id])).rowCount, 1);
  assert.equal((await call('/api/admin/controls', { method: 'PUT', headers: T, body: { retentionDays: null } })).json.retentionDays, null, 'back to the server default');
  assert.equal((await call('/api/admin/overview', { headers: T })).json.retentionDays, 90);
});
