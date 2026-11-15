// Runs in its own process with the DEFAULT limits: a whole lab behind one address can join at once; guessing is stopped.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TEACHER_KEY = 'tkey'; process.env.PEPPER = 'testpepper'; process.env.PUBLIC_URL = 'http://127.0.0.1:0';
delete process.env.VERIFY_RATE_PER_MIN; delete process.env.VERIFY_FAILS_PER_IP_PER_MIN;
const { app } = await import('../src/server.js');
const { migrate, pool } = await import('../src/db.js');
await migrate();
const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); pool.end(); });
const T = { Authorization: 'Bearer tkey', 'Content-Type': 'application/json' };
const post = (p, body, headers = { 'Content-Type': 'application/json' }) => fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body) });

test('a class of 120 students behind one address all get in with the right code, and wrong codes are then slowed down', async () => {
  const exam = await (await post('/api/exams', { title: 'Big lab' }, T)).json();
  const code = (await (await post(`/api/exams/${exam.id}/generate-code`, {}, T)).json()).code;
  const join = (i) => post('/api/verify-code', { code, studentName: 'Student ' + i, deviceId: 'lab-device-' + String(i).padStart(4, '0'), clientType: 'desktop' });
  const results = await Promise.all(Array.from({ length: 120 }, (_, i) => join(i)));
  assert.deepEqual([...new Set(results.map((r) => r.status))], [200], 'right codes are never counted, however many students share an address');

  // now someone guesses: 20 wrong tries are answered, then the address is blocked
  const wrong = []; for (let i = 0; i < 21; i++) wrong.push((await post('/api/verify-code', { code: String(100000 + i), studentName: 'Guesser', deviceId: 'guess-device-1', clientType: 'desktop' })).status);
  assert.deepEqual(wrong.slice(0, 20), Array(20).fill(404)); assert.equal(wrong[20], 429, 'the 21st wrong try in a minute is refused');
  const blocked = await join(999);
  assert.equal(blocked.status, 429, 'while blocked even the right code is refused, so a refusal never hints at a close guess');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.match((await blocked.json()).error, /Too many wrong codes/);
});
