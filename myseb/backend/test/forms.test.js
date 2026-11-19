// Exams from any form link (Google Forms and others): recognised, locked to the form's own sites, a key for every student, a teacher list to match responses.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TEACHER_KEY = 'tkey'; process.env.PEPPER = 'testpepper'; process.env.PUBLIC_URL = 'https://myseb.example.org'; process.env.VERIFY_RATE_PER_MIN = '1000';
const { analyzeFormUrl, cleanOrigins, cleanDone, cleanKeyParam, examKey, withKey, isDone, lockFor } = await import('../src/forms.js');
const { app } = await import('../src/server.js');
const { migrate, pool } = await import('../src/db.js');
await migrate();
const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); pool.end(); });
const T = { Authorization: 'Bearer tkey', 'Content-Type': 'application/json' };
const call = async (path, { method = 'GET', headers = {}, body } = {}) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }); const text = await r.text(); let json; try { json = JSON.parse(text); } catch {} return { status: r.status, json, text }; };

test('known form tools are recognised with the sites they need; unknown sites get only their own origin; bad addresses are refused', () => {
  const g = analyzeFormUrl('https://docs.google.com/forms/d/e/1FAIpQLSdXYZ/viewform');
  assert.equal(g.provider.id, 'google'); assert.equal(g.kind, 'form'); assert.equal(g.sendKey, false);
  assert.ok(g.origins.includes('https://docs.google.com') && g.origins.includes('https://accounts.google.com') && g.origins.includes('https://forms.gle')); assert.deepEqual(g.done, ['/formResponse']); assert.ok(g.tips.length >= 2 && /entry\./.test(g.keyHint));
  assert.equal(analyzeFormUrl('https://forms.gle/abc123').provider.id, 'google'); assert.equal(analyzeFormUrl('https://forms.office.com/r/abcd').provider.id, 'microsoft'); assert.ok(analyzeFormUrl('https://forms.office.com/r/abcd').origins.includes('https://login.microsoftonline.com'));
  assert.equal(analyzeFormUrl('https://acme.typeform.com/to/xyz').provider.id, 'typeform'); assert.deepEqual(analyzeFormUrl('https://acme.typeform.com/to/xyz').origins, ['https://acme.typeform.com', 'https://typeform.com']);
  assert.equal(analyzeFormUrl('https://docs.google.com/document/d/abc/edit').provider.id, 'custom', 'a Google Doc is not a form');
  const c = analyzeFormUrl('https://school.example.org/exam/1'); assert.equal(c.kind, 'form'); assert.equal(c.sendKey, false, 'an unknown site never receives the MySEB key'); assert.deepEqual(c.origins, ['https://school.example.org']);
  const own = analyzeFormUrl('https://myseb.example.org/exam/abc/'); assert.equal(own.kind, 'site'); assert.equal(own.sendKey, true); assert.equal(analyzeFormUrl('https://bwenge.space/exam/1').sendKey, true);
  for (const bad of ['not a url', 'http://docs.google.com/forms/x', 'ftp://x.org/a', 'https://user:pw@docs.google.com/forms/x', 'javascript:alert(1)']) assert.equal(analyzeFormUrl(bad).ok, false, bad);
});

test('extra sites, submitted markers and the key field are cleaned; the key is stable, readable and different per session; it is pre-filled into the form address', () => {
  assert.deepEqual(cleanOrigins('https://a.example.org/x, http://evil.org javascript:1 https://u:p@x.org https://a.example.org'), ['https://a.example.org']); assert.equal(cleanOrigins(Array.from({ length: 30 }, (_, i) => `https://s${i}.example.org`)).length, 12);
  assert.deepEqual(cleanDone('/formResponse\n\n  thanks \n'), ['/formResponse', 'thanks']); assert.equal(cleanKeyParam('entry.12345'), 'entry.12345'); assert.equal(cleanKeyParam('a b'), null); assert.equal(cleanKeyParam('x&y=1'), null);
  const k1 = examKey('11111111-1111-1111-1111-111111111111', 's'), k2 = examKey('22222222-2222-2222-2222-222222222222', 's'); assert.match(k1, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/); assert.equal(k1, examKey('11111111-1111-1111-1111-111111111111', 's')); assert.notEqual(k1, k2); assert.notEqual(k1, examKey('11111111-1111-1111-1111-111111111111', 'other secret'));
  assert.equal(withKey('https://docs.google.com/forms/d/e/X/viewform?usp=pp_url', 'entry.1', 'AB-CD'), 'https://docs.google.com/forms/d/e/X/viewform?usp=pp_url&entry.1=AB-CD'); assert.equal(withKey('https://x.org/f', null, 'K'), 'https://x.org/f'); assert.equal(withKey('https://x.org/f', 'bad name', 'K'), 'https://x.org/f');
  assert.equal(isDone('https://docs.google.com/forms/d/e/X/formResponse', ['/formResponse']), true); assert.equal(isDone('https://docs.google.com/forms/d/e/X/viewform', ['/formResponse']), false); assert.equal(isDone('https://x.org', []), false);
  assert.deepEqual(lockFor({ exam_url: 'https://docs.google.com/forms/d/e/X/viewform', allowed_origins: ['https://accounts.google.com'], send_key: false, done_patterns: ['/formResponse'], form_provider: 'google' }), { origins: ['https://docs.google.com', 'https://accounts.google.com'], sendKey: false, done: ['/formResponse'], kind: 'form', provider: 'google' });
  assert.equal(lockFor({ exam_url: 'https://myseb.example.org/exam/1/' }).sendKey, true, 'exams made before this feature behave as before');
});

let exam, code, alice;
test('teacher pastes a Google Form: the exam stores the sites, the marker and the key field; the dashboard can preview the same analysis', async () => {
  assert.equal((await call('/api/forms/analyze?url=' + encodeURIComponent('https://forms.gle/x'))).status, 401);
  const pre = await call('/api/forms/analyze?url=' + encodeURIComponent('https://docs.google.com/forms/d/e/X/viewform'), { headers: T }); assert.equal(pre.json.provider.name, 'Google Forms'); assert.equal((await call('/api/forms/analyze?url=nope', { headers: T })).status, 400);
  assert.equal((await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Bad', examUrl: 'http://docs.google.com/forms/x' } })).status, 400);
  const r = await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Maths quiz', examUrl: 'https://docs.google.com/forms/d/e/X/viewform', durationMinutes: 30, extraOrigins: 'https://school.example.org', keyParam: 'entry.9876', doneContains: ['thank-you'] } });
  assert.equal(r.status, 201); exam = r.json; assert.equal(exam.form.provider.id, 'google'); assert.ok(exam.form.tips.length); assert.equal(exam.send_key, false); assert.equal(exam.key_param, 'entry.9876');
  assert.deepEqual(exam.allowed_origins.filter((o) => o.includes('school') || o.includes('accounts')).sort(), ['https://accounts.google.com', 'https://school.example.org']); assert.deepEqual(exam.done_patterns, ['/formResponse', 'thank-you']);
  code = (await call(`/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).json;
});

test('verify-code gives the app everything it needs to lock to the form: the sites, no secret header for Google, the submitted marker, and the student\'s key in the address', async () => {
  alice = (await call('/api/verify-code', { method: 'POST', body: { code: code.code, studentName: 'Alice', deviceId: 'dev-alice-form', clientType: 'desktop', platform: 'win32' } })).json;
  assert.equal(alice.lock.kind, 'form'); assert.equal(alice.lock.sendKey, false); assert.ok(alice.lock.origins.includes('https://docs.google.com') && alice.lock.origins.includes('https://accounts.google.com')); assert.deepEqual(alice.lock.done, ['/formResponse', 'thank-you']);
  assert.match(alice.examKey, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/); assert.ok(alice.examUrl.includes(`entry.9876=${alice.examKey}`)); assert.ok(alice.examUrl.startsWith('https://docs.google.com/forms/d/e/X/viewform'));
  const again = (await call('/api/verify-code', { method: 'POST', body: { code: code.code, studentName: 'Alice', deviceId: 'dev-alice-form', clientType: 'desktop', platform: 'win32' } })).json; assert.equal(again.examKey, alice.examKey, 'coming back keeps the same key'); alice.token = again.token;   // re-entering the code rotated the token
  const bob = (await call('/api/verify-code', { method: 'POST', body: { code: code.code, studentName: 'Bob', deviceId: 'dev-bob-form', clientType: 'desktop', platform: 'win32' } })).json; assert.notEqual(bob.examKey, alice.examKey);
});

test('violations: leaving pauses as before; trying a blocked site is recorded without pausing; a submission ends the exam as "submitted"; the teacher gets keys and who submitted', async () => {
  const H = { 'X-MySEB-Key': alice.token, 'X-MySEB-Client': 'desktop', 'X-MySEB-Device': 'dev-alice-form', 'User-Agent': 'Mozilla/5.0 MySEB/1.0 (desktop)' };
  const v = await call('/api/violation', { method: 'POST', headers: H, body: { type: 'blocked_navigation', detail: { host: 'chat.openai.com' } } }); assert.equal(v.status, 200); assert.equal(v.json.status, 'IN_EXAM', 'a blocked page does not pause the exam');
  const fin = await call('/api/finish', { method: 'POST', headers: H, body: { reason: 'submitted' } }); assert.equal(fin.status, 200);
  const keys = (await call(`/api/exams/${exam.id}/form-keys`, { headers: T })).json; assert.equal(keys.exam.keyField, 'entry.9876'); assert.equal(keys.keys.length, 2);
  const a = keys.keys.find((k) => k.student === 'Alice'), b = keys.keys.find((k) => k.student === 'Bob'); assert.equal(a.key, alice.examKey); assert.equal(a.submittedInMyseb, true); assert.equal(a.violations, 1); assert.equal(b.submittedInMyseb, false);
  const csv = await call(`/api/exams/${exam.id}/form-keys?format=csv`, { headers: T }); assert.match(csv.text, /^Student,Exam key,Status,Submitted in MySEB/); assert.match(csv.text, new RegExp(`"Alice","${alice.examKey}"`)); assert.equal((await call(`/api/exams/${exam.id}/form-keys`)).status, 401);
});

test('exams made the old way (no form link) keep sending the secret header and their one origin', async () => {
  const e = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Own exam' } })).json; assert.equal(e.send_key, true); assert.deepEqual(e.allowed_origins, []);
  const c = (await call(`/api/exams/${e.id}/generate-code`, { method: 'POST', headers: T })).json; const s = (await call('/api/verify-code', { method: 'POST', body: { code: c.code, studentName: 'Cy', deviceId: 'dev-cy-oldway', clientType: 'desktop' } })).json;
  assert.equal(s.lock.sendKey, true); assert.equal(s.lock.kind, 'site'); assert.equal(s.examKey, null); assert.equal(s.examUrl, e.exam_url);
});

// The app's page lock (pure code from the desktop app).
import { createRequire } from 'node:module';
const lockLib = createRequire(import.meta.url)('../../desktop/src/formLock.js');
test('desktop lock: the student stays on the form\'s sites; anything else is refused, and only a submitted address ends the exam', () => {
  const lock = lockLib.lockOf({ examUrl: 'https://docs.google.com/forms/d/e/X/viewform?entry.1=K', lock: { origins: ['https://docs.google.com', 'https://accounts.google.com'], sendKey: false, kind: 'form', done: ['/formResponse'] } });
  assert.equal(lock.sendKey, false); assert.equal(lock.kind, 'form'); assert.equal(lock.examOrigin, 'https://docs.google.com');
  for (const ok of ['https://docs.google.com/forms/d/e/X/viewform', 'https://accounts.google.com/signin', 'about:blank', 'blob:https://docs.google.com/abc']) assert.equal(lockLib.allowed(ok, lock), true, ok);
  for (const no of ['https://www.google.com/search?q=answers', 'https://chat.openai.com/', 'http://docs.google.com/forms', 'https://docs.google.com.evil.org/forms', 'https://evil.org/https://docs.google.com', 'javascript:alert(1)', 'file:///etc/passwd', 'not a url']) assert.equal(lockLib.allowed(no, lock), false, no);
  assert.equal(lockLib.isDone('https://docs.google.com/forms/d/e/X/formResponse', lock), true); assert.equal(lockLib.isDone('https://docs.google.com/forms/d/e/X/viewform', lock), false);
  assert.equal(lockLib.hostOf('https://chat.openai.com/c/secret-id?x=1'), 'chat.openai.com', 'only the site is logged');
  const old = lockLib.lockOf({ examUrl: 'https://myseb.example.org/exam/1/' }); assert.equal(old.sendKey, true); assert.equal(old.kind, 'site'); assert.deepEqual([...old.origins], ['https://myseb.example.org']); assert.equal(lockLib.allowed('https://myseb.example.org/exam/1/x', old), true);
  assert.equal(lockLib.allowed('https://x.org', null), false);
});
