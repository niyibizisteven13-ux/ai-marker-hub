// Strict Windows lock: the lecturer's setting reaches the desktop app for every kind of exam, and the registry changes are undone.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const win = req('../../desktop/src/winLock.js');
const lockLib = req('../../desktop/src/formLock.js');

/** A fake `reg` command over an in-memory registry. */
const fakeReg = (init = {}) => {
  const reg = { ...init };
  const run = async (a) => {
    const [cmd, key] = a; const name = a[a.indexOf('/v') + 1]; const id = `${key}|${name}`;
    if (cmd === 'query') return reg[id] === undefined ? { code: 1, out: '' } : { code: 0, out: `    ${name}    REG_DWORD    0x${reg[id].toString(16)}` };
    if (cmd === 'add') { reg[id] = parseInt(a[a.indexOf('/d') + 1], 10); return { code: 0, out: '' }; }
    if (cmd === 'delete') { delete reg[id]; return { code: 0, out: '' }; }
    return { code: 1, out: '' };
  };
  return { reg, run };
};
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wl-')), 'b.json');

test('only a strict lock changes anything, and only the chosen policies', () => {
  assert.deepEqual(win.plan('standard', ['taskmgr']), []);
  assert.deepEqual(win.plan('strict', ['taskmgr', 'bogus', 'snip']).map((p) => p.id), ['taskmgr']);
  assert.equal(win.plan('strict', ['taskmgr', 'winkey', 'lock', 'snip']).length, 3);
  assert.ok(win.extraBlockedPrograms('strict', ['snip']).includes('snippingtool'));
  assert.deepEqual(win.extraBlockedPrograms('strict', ['taskmgr']), []);
  assert.deepEqual(win.extraBlockedPrograms('standard', ['snip']), []);
});

test('apply sets the policies; restore puts back what was there, deleting what was not', async () => {
  const file = tmp();
  const T = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System|DisableTaskMgr';
  const W = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer|NoWinKeys';
  const { reg, run } = fakeReg({ [T]: 0 });                       // Task Manager policy existed (0); the Windows-key one did not
  const r = await win.apply(win.plan('strict', ['taskmgr', 'winkey']), run, file);
  assert.equal(r.ok, true); assert.equal(reg[T], 1); assert.equal(reg[W], 1);
  assert.ok(fs.existsSync(file), 'a backup is written first, so a crash can be undone');
  const back = await win.restore(run, file);
  assert.equal(back.restored, 2); assert.equal(reg[T], 0); assert.equal(reg[W], undefined);
  assert.ok(!fs.existsSync(file));
  assert.deepEqual(await win.restore(run, file), { restored: 0 }, 'restoring twice is harmless');
});

test('a policy that cannot be set is reported, not hidden', async () => {
  const run = async (a) => (a[0] === 'add' && a.includes('NoWinKeys') ? { code: 1, out: '' } : { code: 1, out: '' });
  const r = await win.apply(win.plan('strict', ['winkey']), run, tmp());
  assert.equal(r.ok, false); assert.deepEqual(r.failed, ['winkey']);
});

process.env.TEACHER_KEY = 'tkey'; process.env.PEPPER = 'testpepper'; process.env.PUBLIC_URL = 'http://127.0.0.1:0'; process.env.VERIFY_RATE_PER_MIN = '1000';
const { app } = await import('../src/server.js');
const { migrate, pool } = await import('../src/db.js');
await migrate();
const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); pool.end(); });
const T = { Authorization: 'Bearer tkey' };
const call = async (p, { method = 'GET', headers = {}, body } = {}) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const join = async (exam, name) => {
  const code = (await call(`/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).json;
  return (await call('/api/verify-code', { method: 'POST', body: { code: code.code, studentName: name, deviceId: 'dev-' + name + '-12345', clientType: 'desktop' } })).json;
};

test('the setting reaches the desktop app for a Google Form, another form tool and an own site', async () => {
  for (const [title, examUrl] of [['G', 'https://docs.google.com/forms/d/e/abc/viewform'], ['T', 'https://acme.typeform.com/to/xyz'], ['Own', undefined]]) {
    const exam = (await call('/api/exams', { method: 'POST', headers: T, body: { title, examUrl, windowsLock: 'strict', winBlock: ['taskmgr', 'bogus', 'winkey'] } })).json;
    assert.equal(exam.windows_lock, 'strict');
    const s = await join(exam, title);
    assert.deepEqual(s.lock.windows, { level: 'strict', block: ['taskmgr', 'winkey'] }, title);
    assert.equal(lockLib.lockOf(s).windows.level, 'strict');
  }
});

test('standard is the default, the lecturer can change it later, and nonsense is ignored', async () => {
  const exam = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Plain' } })).json;
  assert.equal(exam.windows_lock, 'standard');
  assert.equal((await join(exam, 'A')).lock.windows.level, 'standard');
  assert.equal((await call(`/api/exams/${exam.id}`, { method: 'PATCH', headers: T, body: { windowsLock: 'maximum' } })).status, 400, 'unknown value changes nothing');
  assert.equal((await call(`/api/exams/${exam.id}`, { method: 'PATCH', headers: T, body: { windowsLock: 'strict', winBlock: ['lock'] } })).json.windows_lock, 'strict');
  assert.deepEqual((await join(exam, 'B')).lock.windows, { level: 'strict', block: ['lock'] });
  assert.equal(lockLib.lockOf({}).windows.level, 'standard', 'an older server that sends nothing means standard');
});
