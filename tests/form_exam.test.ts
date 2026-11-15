import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createFormExamService, ExamError } from '../server/services/formExam/service.js';
import { normalizeExam } from '../shared/examRules.js';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formexam-'));
test.after(() => fs.rm(dir, { recursive: true, force: true }));

let clock = 1_000_000;
const MIN = 60_000;
const course = randomUUID();
const forms: Record<string, any> = {};
const mk = (exam: any) => { const id = randomUUID(); forms[id] = { ownerId: 'lec1', title: 'CAT', exam: normalizeExam({ enabled: true, ...exam }) }; return id; };
const roster: Record<string, any> = {
  '222001': { name: 'Uwase Aline', accommodations: { extraTimePercent: 50, cameraExempt: true, breaks: true, largeText: true, voiceAnswers: false, note: 'screen reader' } },
  '222002': { name: 'Mugisha Eric', accommodations: { extraTimePercent: 0, cameraExempt: false, breaks: false, largeText: false, voiceAnswers: false } },
};
const svc = createFormExamService({ dir, now: () => clock, forms: async (id) => forms[id] ?? null, accommodations: async (_o, c, sid) => (c === course ? roster[sid] ?? null : null) });
const rejects = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: any) => e instanceof ExamError && e.code === code, code);

test('the server keeps the clock; extra time from the roster is added; camera exemption turns the camera off', async () => {
  const f = mk({ minutes: 60, camera: 'pause', courseId: course, requireRoster: true });
  await rejects(svc.start(f, { studentId: '' }), 'ID_REQUIRED');
  await rejects(svc.start(f, { studentId: '999' }), 'NOT_ON_LIST');
  await rejects(svc.start(randomUUID(), { studentId: '1', name: 'x' }), 'NOT_AN_EXAM');
  const a = await svc.start(f, { studentId: '222001' });
  assert.equal(a.studentName, 'Uwase Aline', 'the name comes from the roster');
  assert.equal(a.totalMs, 90 * MIN, '60 minutes + 50%');
  assert.equal(a.camera, 'off', 'camera exempt: no camera check');
  assert.equal(a.accommodations?.largeText, true);
  const b = await svc.start(f, { studentId: '222002' });
  assert.equal(b.totalMs, 60 * MIN);
  assert.equal(b.camera, 'pause');
  assert.equal(b.status, 'paused', 'with a camera check the clock waits for the camera');
  clock += 4 * MIN;
  assert.equal((await svc.state(b.id, b.secret)).remainingMs, 60 * MIN, 'camera set-up time is not the student\'s time');
  assert.equal((await svc.event(b.id, b.secret, { type: 'camera_ok' })).status, 'running');
  clock += 10 * MIN;
  const s = await svc.state(b.id, b.secret);
  assert.equal(s.remainingMs, 50 * MIN);
  assert.equal(s.status, 'running');
  await rejects(svc.state(b.id, 'wrong-secret'), 'NOT_FOUND');
  await rejects(svc.state(a.id, b.secret), 'NOT_FOUND');
  // Nobody can sit it twice, or take over the session from another page.
  await rejects(svc.start(f, { studentId: '222002' }), 'SESSION_EXISTS');
});

test('camera rule "pause": a lost face stops the clock until the lecturer resumes; the student cannot resume themselves', async () => {
  const f = mk({ minutes: 30, camera: 'pause', graceSeconds: 8 });
  const s = await svc.start(f, { studentId: 'A1', name: 'Test Student' });
  await svc.event(s.id, s.secret, { type: 'camera_ok' });
  clock += 5 * MIN;
  const p = await svc.event(s.id, s.secret, { type: 'face_lost', seconds: 9 });
  assert.equal(p.status, 'paused');
  assert.deepEqual(p.pause, { by: 'system', reason: 'face_lost' });
  assert.equal(p.remainingMs, 25 * MIN);
  clock += 7 * MIN;
  const still = await svc.state(s.id, s.secret);
  assert.equal(still.remainingMs, 25 * MIN, 'the clock does not run while paused');
  await rejects(svc.setBreak(s.id, s.secret, false), 'NO_BREAKS');
  await rejects(svc.checkSubmit(s.id, s.secret, f), 'EXAM_PAUSED');
  // The lecturer sees who and why, and resumes.
  const rows = await svc.list('lec1', f);
  assert.equal(rows[0].status, 'paused');
  assert.equal(rows[0].pause?.reason, 'face_lost');
  assert.equal(rows[0].pause?.sinceSeconds, 7 * 60);
  assert.equal(rows[0].summary.faceLost, 1);
  await assert.rejects(svc.resume('someone-else', s.id), /not found/i);
  const r = await svc.resume('lec1', s.id);
  assert.equal(r.status, 'running');
  clock += 2 * MIN;
  assert.equal((await svc.state(s.id, s.secret)).remainingMs, 23 * MIN);
  await rejects(svc.resume('lec1', s.id), 'NOT_PAUSED');
});

test('resume all: only students whose face is back are resumed', async () => {
  const f = mk({ minutes: 30, camera: 'pause' });
  const go = async (id: string) => { const s = await svc.start(f, { studentId: id, name: id }); await svc.event(s.id, s.secret, { type: 'camera_ok' }); return s; };
  const back = await go('B1'), gone = await go('G1'), fine = await go('F1');
  await svc.event(back.id, back.secret, { type: 'face_lost', seconds: 9 });
  await svc.event(gone.id, gone.secret, { type: 'face_lost', seconds: 9 });
  await svc.event(back.id, back.secret, { type: 'face_back', seconds: 20 });
  assert.deepEqual(await svc.resumeAll('lec1', f), { resumed: 1 });
  const status = Object.fromEntries((await svc.list('lec1', f)).map((x) => [x.studentId, x.status]));
  assert.deepEqual(status, { B1: 'running', G1: 'paused', F1: 'running' });
  assert.deepEqual(await svc.resumeAll('someone-else', f), { resumed: 0 });
  void fine;
});

test('camera rule "warn" only records; "off" ignores camera events; page events are always recorded', async () => {
  const w = await svc.start(mk({ minutes: 30, camera: 'warn' }), { studentId: 'W1', name: 'W' });
  await svc.event(w.id, w.secret, { type: 'camera_ok' });
  const r1 = await svc.event(w.id, w.secret, { type: 'face_lost', seconds: 20 });
  assert.equal(r1.status, 'running');
  await svc.event(w.id, w.secret, { type: 'face_back', seconds: 20 });
  await svc.event(w.id, w.secret, { type: 'tab_hidden' });
  await svc.event(w.id, w.secret, { type: 'multiple_faces' });
  await rejects(svc.event(w.id, w.secret, { type: 'launch_missiles' }), 'BAD_EVENT');
  const f2 = mk({ minutes: 30, camera: 'off' });
  const o = await svc.start(f2, { studentId: 'O1', name: 'O' });
  await svc.event(o.id, o.secret, { type: 'face_lost', seconds: 30 });
  await svc.event(o.id, o.secret, { type: 'tab_hidden' });
  const sum = (await svc.list('lec1', f2))[0].summary;
  assert.equal(sum.faceLost, 0, 'no camera check: camera events are not counted');
  assert.equal(sum.tabHidden, 1);
});

test('breaks: only for students with that accommodation, the clock stops, only the student ends it', async () => {
  const f = mk({ minutes: 60, camera: 'pause', courseId: course });
  const a = await svc.start(f, { studentId: '222001' });
  clock += 10 * MIN;
  const p = await svc.setBreak(a.id, a.secret, true);
  assert.equal(p.status, 'paused'); assert.equal(p.pause?.by, 'student');
  const rem = p.remainingMs;
  clock += 15 * MIN;
  assert.equal((await svc.state(a.id, a.secret)).remainingMs, rem);
  assert.equal((await svc.setBreak(a.id, a.secret, false)).status, 'running');
  // A lecturer pause cannot be ended by the student's break button.
  await svc.pause('lec1', a.id);
  assert.equal((await svc.setBreak(a.id, a.secret, false)).status, 'paused');
});

test('submitting: needs the secret, refuses after time up (with a short grace), once only', async () => {
  const f = mk({ minutes: 10, camera: 'off' });
  const s = await svc.start(f, { studentId: 'S1', name: 'S' });
  await rejects(svc.checkSubmit(undefined, s.secret, f), 'EXAM_SESSION_REQUIRED');
  await rejects(svc.checkSubmit(s.id, 'nope', f), 'EXAM_SESSION_REQUIRED');
  await rejects(svc.checkSubmit(s.id, s.secret, mk({ minutes: 5 })), 'EXAM_SESSION_REQUIRED');
  clock += 10 * MIN + 1000;
  const late = await svc.checkSubmit(s.id, s.secret, f);
  assert.equal(late.timeUp, true, 'the page sends what it has when time is up');
  const done = await svc.markSubmitted(s.id);
  assert.equal(done.allowedSeconds, 600);
  await rejects(svc.checkSubmit(s.id, s.secret, f), 'ALREADY_SUBMITTED');
  await rejects(svc.start(f, { studentId: 'S1', name: 'S' }), 'ALREADY_SUBMITTED');
  const f2 = mk({ minutes: 5, camera: 'off' });
  const t = await svc.start(f2, { studentId: 'T1', name: 'T' });
  clock += 8 * MIN;
  await rejects(svc.checkSubmit(t.id, t.secret, f2), 'TIME_UP');
});

test('lecturer: add time (even after the end), end one student, let a student back in with a new secret', async () => {
  const f = mk({ minutes: 10, camera: 'off' });
  const s = await svc.start(f, { studentId: 'L1', name: 'L' });
  clock += 12 * MIN;
  assert.equal((await svc.state(s.id, s.secret)).status, 'ended');
  await assert.rejects(svc.extend('lec1', s.id, 0), /between 1 and 180/);
  const ext = await svc.extend('lec1', s.id, 5);
  assert.equal(ext.status, 'running');
  assert.equal(ext.remainingMs, 5 * MIN, 'an extension gives time from now, not from the lost minutes');
  const e = await svc.end('lec1', s.id);
  assert.equal(e.status, 'ended');
  // The student lost the page: not allowed until the lecturer says so.
  await rejects(svc.start(f, { studentId: 'L1', name: 'L' }), 'SESSION_EXISTS');
  await svc.allowReentry('lec1', s.id);
  const back = await svc.start(f, { studentId: 'L1', name: 'L' });
  assert.equal(back.id, s.id);
  assert.notEqual(back.secret, s.secret);
  await rejects(svc.state(s.id, s.secret), 'NOT_FOUND');
  assert.equal((await svc.state(back.id, back.secret)).status, 'ended');
  await assert.rejects(svc.session('other', s.id), /not found/i);
  assert.ok((await svc.session('lec1', s.id)).events.some((x) => x.type === 'reentry'));
});
