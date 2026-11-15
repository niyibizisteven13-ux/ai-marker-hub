// What an operator relies on: health checks, metrics, switching off the standalone dashboard, and deleting old data.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TEACHER_KEY = 'tkey'; process.env.PEPPER = 'testpepper'; process.env.PUBLIC_URL = 'http://127.0.0.1:0'; process.env.DISABLE_DASHBOARD = '1'; process.env.RETENTION_DAYS = '30';
const { app } = await import('../src/server.js');
const { migrate, pool, q } = await import('../src/db.js');
const { purgeOld } = await import('../src/sessions.js');
await migrate();
const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); pool.end(); });
const get = (p, headers = {}) => fetch(base + p, { headers });

test('health: alive, and ready only when the database answers', async () => {
  assert.deepEqual(await (await get('/healthz')).json(), { ok: true });
  assert.deepEqual(await (await get('/readyz')).json(), { ok: true });
});

test('the standalone dashboard can be switched off (bwenge is the lecturer screen in production)', async () => {
  assert.equal((await get('/dashboard/')).status, 404);
  assert.deepEqual(await (await get('/')).json(), { name: 'MySEB', ok: true });
  assert.equal((await get('/api/exams')).status, 401, 'the API still needs the key');
});

test('metrics need the key and report the room in Prometheus text', async () => {
  assert.equal((await get('/metrics')).status, 401);
  assert.equal((await get('/metrics', { Authorization: 'Bearer wrong' })).status, 401);
  const ex = (await q(`INSERT INTO exams (title, exam_url) VALUES ('m', 'http://x/') RETURNING id`)).rows[0].id;
  const code = (await q(`INSERT INTO exam_codes (exam_id, code_hash, secret_hash, expires_at) VALUES ($1::uuid, 'h' || $1::text, 's', now() + interval '1 hour') RETURNING id`, [ex])).rows[0].id;
  await q(`INSERT INTO exam_sessions (exam_id, code_id, student_name, token_hash, client_type, device_id, deadline_at) VALUES ($1,$2,'A','t1-' || $3::text,'desktop','d-aaaaaaaa', now() + interval '1 hour'), ($1,$2,'B','t2-' || $3::text,'desktop','d-bbbbbbbb', now() + interval '1 hour')`, [ex, code, String(Date.now())]);
  const r = await get('/metrics', { Authorization: 'Bearer tkey' });
  assert.match(r.headers.get('content-type'), /text\/plain/);
  const text = await r.text();
  assert.match(text, /myseb_students\{status="IN_EXAM"\} ([2-9]|\d{2,})/); assert.match(text, /myseb_exams_active [1-9]/);
  for (const m of ['myseb_live_entries', 'myseb_signal_mailboxes', 'myseb_process_resident_bytes', 'myseb_process_uptime_seconds']) assert.ok(text.includes(m), m);
  assert.ok(!/tkey|testpepper/.test(text), 'no secrets in the metrics');
  await q('DELETE FROM exams WHERE id=$1', [ex]);
});

test('retention: finished students and exams older than the limit are deleted with their violation logs; recent and running ones stay', async () => {
  const mkExam = async (title, status, endsAgoDays) => (await q(`INSERT INTO exams (title, exam_url, status, ends_at) VALUES ($1, 'http://x/', $2, ${endsAgoDays === null ? 'NULL' : `now() - interval '${endsAgoDays} days'`}) RETURNING id`, [title, status])).rows[0].id;
  const old = await mkExam('old exam', 'ended', 45), recent = await mkExam('recent exam', 'ended', 3), running = await mkExam('running exam', 'active', null);
  const code = async (ex) => (await q(`INSERT INTO exam_codes (exam_id, code_hash, secret_hash, expires_at) VALUES ($1::uuid, 'c' || gen_random_uuid()::text, 's', now()) RETURNING id`, [ex])).rows[0].id;
  const stu = async (ex, name, endedDaysAgo) => {
    const id = (await q(`INSERT INTO exam_sessions (exam_id, code_id, student_name, token_hash, client_type, device_id, deadline_at, status, ended_at) VALUES ($1,$2,$3,'t' || gen_random_uuid(),'desktop','d-' || gen_random_uuid(), now(), $4, ${endedDaysAgo === null ? 'NULL' : `now() - interval '${endedDaysAgo} days'`}) RETURNING id`, [ex, await code(ex), name, endedDaysAgo === null ? 'IN_EXAM' : 'ENDED'])).rows[0].id;
    await q(`INSERT INTO violations (session_id, exam_id, type) VALUES ($1,$2,'leave')`, [id, ex]); return id;
  };
  const oldStudent = await stu(running, 'finished long ago', 40);        // finished 40 days ago in a still-running exam
  const recentStudent = await stu(running, 'finished yesterday', 1);
  const inExam = await stu(running, 'still sitting', null);
  const inOld = await stu(old, 'in an old exam', 45); const inRecent = await stu(recent, 'in a recent exam', 3);
  const r = await purgeOld();
  assert.ok(r.sessions >= 2 && r.exams >= 1);
  const left = async (id) => (await q('SELECT 1 FROM exam_sessions WHERE id=$1', [id])).rowCount;
  assert.deepEqual([await left(oldStudent), await left(inOld)], [0, 0], 'older than 30 days: gone');
  assert.deepEqual([await left(recentStudent), await left(inExam), await left(inRecent)], [1, 1, 1], 'recent and running: kept');
  assert.equal((await q('SELECT 1 FROM violations WHERE session_id=$1', [oldStudent])).rowCount, 0, 'their violation logs go with them');
  assert.equal((await q('SELECT 1 FROM exams WHERE id=$1', [old])).rowCount, 0); assert.equal((await q('SELECT 1 FROM exams WHERE id = ANY($1)', [[recent, running]])).rowCount, 2);
  assert.deepEqual(await purgeOld(0), { sessions: 0, exams: 0 }, 'a retention of 0 days switches the purge off');
  await q('DELETE FROM exams WHERE id = ANY($1)', [[recent, running]]);
});
