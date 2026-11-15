import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { OwnedRecordStore } from '../server/services/storage/ownedRecordStore.js';
import { AssignmentError, createAssignmentService, type AssignmentFiles, type AssignmentRecord } from '../server/services/assignments/service.js';
import { createTaskMarker } from '../server/services/assignments/autoMark.js';

// "Mark all papers" in one click. A marking scheme that needs the lecturer's OK is shown first and is NEVER confirmed by itself.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marknow-'));
test.after(() => fs.rm(dir, { recursive: true, force: true }));
const mem = new Map<string, { owner: string; name: string; mime: string; data: Buffer }>();
const files: AssignmentFiles = {
  async save(userId, name, mime, data) { const id = randomUUID(); mem.set(id, { owner: userId, name, mime, data }); return { id, name, mime, size: data.length }; },
  async read(userId, id) { const f = mem.get(id); if (!f || f.owner !== userId) throw new AssignmentError('NOT_FOUND', 'File not found.', 404); return f; },
};
const calls: string[] = [];
let scheme: any = { status: 'needs_confirmation', version: 3, warnings: ['Question 2 has no marks written: 4 assumed.'], errors: [], scheme: { title: 'Statistics test', totalMarks: 10, allowHalfMarks: false, questions: [
  { id: 'q1', number: '1', maxMarks: 6, marking: 'criteria', criteria: [{}, {}], alternativePaths: [], levels: [], workingRequired: true, errorCarriedForward: false },
  { id: 'q2', number: '2', maxMarks: 4, marking: 'criteria', criteria: [{}], alternativePaths: [], levels: [], workingRequired: false, errorCarriedForward: false }] } };
let startError: any = null;
const exam = { id: 'exam-1', submissions: [] as any[] };
const fakeExams = {
  async createExam() { return { id: exam.id }; }, async load() { return exam; },
  async addSubmissions(_u: string, _e: string, f: any[], m: any[]) { const id = `sub-${exam.submissions.length + 1}`; exam.submissions.push({ id, candidateId: m[0].candidateId, state: 'queued' }); return { accepted: [{ id }], rejected: [] }; },
  async submitSchemeDocuments() { calls.push('scheme-docs'); }, async startMarking() { calls.push('start'); if (startError) throw startError; },
  async confirmScheme(_u: string, _e: string, version?: number) { calls.push(`confirm:${version}`); scheme = { ...scheme, status: 'confirmed' }; },
  reviewList() { return []; }, async release() { return { released: [], skipped: [] }; }, async candidateView() { return {}; },
  latestScheme() { return scheme; },
};
const svc = createAssignmentService({ store: new OwnedRecordStore<AssignmentRecord>(path.join(dir, 'records')), files, tokenDir: path.join(dir, 'links'), baseUrl: () => 'https://www.bwenge.space', marker: createTaskMarker(() => fakeExams as any, { retryMs: 5, maxRetries: 0 }) });
const pdf = async () => { const d = await PDFDocument.create(); d.addPage([595, 842]); return Buffer.from(await d.save()); };
const until = async (ok: () => boolean) => { const end = Date.now() + 5000; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 10)); };

const owner = 'lect-1';
const task = await svc.create(owner, { title: 'Applied statistics', instructions: 'Solve.', autoMark: 'true', scheme: [{ name: 'scheme.pdf', data: await pdf() }] });
const plain = await svc.create(owner, { title: 'Not automatic', instructions: 'x' });
const token = task.link.split('/a/')[1];

test('before anyone has handed in there is nothing to mark', async () => {
  assert.deepEqual(await svc.markNow(owner, task.id, {}), { kind: 'no_papers' });
});

test('with a paper in, a scheme that needs the lecturer is SHOWN first and nothing is confirmed or started', async () => {
  await svc.submit(token, { studentName: 'Steven Niyibizi', studentId: '225061920', files: [{ name: 'answers.pdf', data: await pdf() }] });
  await until(() => calls.includes('scheme-docs'));
  calls.length = 0;
  const r: any = await svc.markNow(owner, task.id, {});
  assert.equal(r.kind, 'needs_confirmation');
  assert.match(r.scheme.summary, /Statistics test: 2 questions, 10 marks/); assert.match(r.scheme.summary, /- 1: 6 marks/);
  assert.deepEqual(r.scheme.warnings, ['Question 2 has no marks written: 4 assumed.']);
  assert.deepEqual(calls, [], 'no confirm, no marking: the lecturer has not agreed yet');
  // a "yes" that is not exactly true does not count
  for (const sneaky of ['true', 1, 'yes', {}, null]) assert.equal(((await svc.markNow(owner, task.id, { confirm: sneaky as any })) as any).kind, 'needs_confirmation', String(sneaky));
  assert.deepEqual(calls, []);
});

test('confirm: true confirms that exact scheme version, then starts marking', async () => {
  const r = await svc.markNow(owner, task.id, { confirm: true });
  assert.deepEqual(r, { kind: 'started' }); assert.deepEqual(calls, ['confirm:3', 'start']);
});

test('a confirmed scheme starts straight away, with no questions asked', async () => {
  calls.length = 0;
  assert.deepEqual(await svc.markNow(owner, task.id, {}), { kind: 'started' }); assert.deepEqual(calls, ['start']);
});

test('busy and idle are explained, and a real failure is not hidden', async () => {
  startError = Object.assign(new Error('x'), { code: 'RUN_IN_PROGRESS' }); assert.deepEqual(await svc.markNow(owner, task.id, {}), { kind: 'already_running' });
  startError = Object.assign(new Error('x'), { code: 'NOTHING_TO_MARK' }); assert.deepEqual(await svc.markNow(owner, task.id, {}), { kind: 'nothing_to_mark' });
  startError = Object.assign(new Error('provider down'), { code: 'PROVIDER' }); await assert.rejects(svc.markNow(owner, task.id, {}), /provider down/);
  startError = null;
});

test('a scheme that could not be read, or is still being read, is reported and nothing starts', async () => {
  const saved = scheme; calls.length = 0;
  scheme = { status: 'invalid', version: 4, warnings: [], errors: ['No marks could be found for any question.'], scheme: null };
  const bad: any = await svc.markNow(owner, task.id, { confirm: true });
  assert.equal(bad.kind, 'invalid'); assert.deepEqual(bad.scheme.errors, ['No marks could be found for any question.']); assert.equal(bad.scheme.summary, null);
  scheme = null; assert.deepEqual(await svc.markNow(owner, task.id, { confirm: true }), { kind: 'reading' });
  assert.deepEqual(calls, [], 'even with confirm, an unreadable scheme is never confirmed or marked'); scheme = saved;
});

test('only the owner, and only tasks with automatic marking', async () => {
  await assert.rejects(svc.markNow('someone-else', task.id, {}), /not found/i);
  await assert.rejects(svc.markNow(owner, plain.id, {}), (e: any) => e instanceof AssignmentError && e.code === 'NOT_AUTO');
});
