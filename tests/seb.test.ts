import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { sebAllowed, sebRequestHash, SEB_HEADER } from '../server/services/formExam/seb.js';
import { createFormExamService, ExamError } from '../server/services/formExam/service.js';
import { normalizeExam } from '../shared/examRules.js';

const KEY = 'a'.repeat(32) + 'B'.repeat(32).toLowerCase();
const KEY2 = '0123456789abcdef'.repeat(4);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const req = (url: string, hash?: string) => ({ protocol: 'https', originalUrl: new URL(url).pathname + new URL(url).search, get: (n: string) => (n === 'host' ? new URL(url).host : n.toLowerCase() === SEB_HEADER ? hash : undefined) });

test('the Safe Exam Browser hash is SHA-256 of the full URL (no fragment) followed by the key', () => {
  assert.equal(sebRequestHash('https://exams.ur.ac.rw/api/x?a=1#frag', KEY), sha('https://exams.ur.ac.rw/api/x?a=1' + KEY));
});

test('a request is allowed only with the right hash for exactly this URL; a normal browser, a wrong key and a copied header for another URL are refused', () => {
  const url = 'https://exams.ur.ac.rw/api/form-exams/public/abc/start';
  const good = sha(url + KEY);
  assert.equal(sebAllowed(req(url, good), [KEY]), true);
  assert.equal(sebAllowed(req(url, good), [KEY2, KEY]), true, 'either of several configurations');
  assert.equal(sebAllowed(req(url, good.toUpperCase()), [KEY]), true, 'case does not matter');
  assert.equal(sebAllowed(req(url), [KEY]), false, 'no header: an ordinary browser');
  assert.equal(sebAllowed(req(url, sha(url + KEY2)), [KEY]), false, 'another configuration');
  assert.equal(sebAllowed(req('https://exams.ur.ac.rw/api/form-exams/public/abc/start?x=1', good), [KEY]), false, 'a header copied for another address');
  assert.equal(sebAllowed(req(url, 'not-a-hash'), [KEY]), false);
  assert.equal(sebAllowed(req(url, good), []), false, 'required but no key set: nobody gets in');
});

test('exam settings keep valid keys only; requiring it without a key is allowed but nobody can start', () => {
  const e = normalizeExam({ enabled: true, requireSeb: true, sebKeys: `${KEY}\n${KEY.toUpperCase()}\nnot-a-key\n${KEY2}` });
  assert.deepEqual(e.sebKeys, [KEY, KEY2]);
  assert.equal(e.requireSeb, true);
  assert.equal(normalizeExam({ enabled: true, requireSeb: true }).requireSeb, true);
  assert.equal(normalizeExam({ enabled: true }).requireSeb, false);
});

test('a test that needs Safe Exam Browser: start and every later call are refused without it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'seb-'));
  const formId = randomUUID();
  const svc = createFormExamService({ dir, forms: async (id) => (id === formId ? { ownerId: 'lec', title: 'T', exam: normalizeExam({ enabled: true, minutes: 30, requireSeb: true, sebKeys: [KEY] }) } : null) });
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof ExamError ? e.code : 'other'));
  assert.equal(await code(svc.start(formId, { studentId: 'S1', name: 'S' })), 'SEB_REQUIRED');
  assert.equal(await code(svc.start(formId, { studentId: 'S1', name: 'S' }, { seb: () => false })), 'SEB_REQUIRED');
  let seen: string[] = [];
  const s = await svc.start(formId, { studentId: 'S1', name: 'S' }, { seb: (keys) => { seen = keys; return true; } });
  assert.deepEqual(seen, [KEY]);
  assert.ok(!JSON.stringify(s).includes(KEY), 'the key is never sent to the student');
  assert.equal(await code(svc.sebGuard(s.id, () => false)), 'SEB_REQUIRED');
  assert.equal(await code(svc.sebGuard(s.id, (keys) => keys.includes(KEY))), 'ok');
  await fs.rm(dir, { recursive: true, force: true });
});
