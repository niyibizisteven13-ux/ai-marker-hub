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

// Automatic marking of a task's hand-ins, with a stand-in examination service: the first hand-in creates the
// examination and sends the scheme, later ones join it, the teacher releases, and students read their own result.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'automark-'));
test.after(() => fs.rm(dir, { recursive: true, force: true }));
const mem = new Map<string, { owner: string; name: string; mime: string; data: Buffer }>();
const files: AssignmentFiles = {
  async save(userId, name, mime, data) { const id = randomUUID(); mem.set(id, { owner: userId, name, mime, data }); return { id, name, mime, size: data.length }; },
  async read(userId, id) { const f = mem.get(id); if (!f || f.owner !== userId) throw new AssignmentError('NOT_FOUND', 'File not found.', 404); return f; },
};

const calls: string[] = [];
const exam = { id: 'exam-1', submissions: [] as any[], released: new Set<string>(), marked: new Set<string>(), scheme: false };
const fakeExams = {
  async createExam() { calls.push('create'); return { id: exam.id }; },
  async load() { return exam; },
  async addSubmissions(_u: string, _e: string, f: any[], mapping: any[]) { const id = `sub-${exam.submissions.length + 1}`; exam.submissions.push({ id, candidateId: mapping[0].candidateId, candidateName: mapping[0].candidateName, state: 'queued', bytes: f[0].buffer.length }); calls.push(`add:${mapping[0].candidateName}`); return { accepted: [{ id }], rejected: [] }; },
  async submitSchemeDocuments(_u: string, _e: string, input: any) { calls.push(`scheme:${input.scheme.map((x: any) => x.name).join(',')}:${input.autoMark}`); exam.scheme = true; },
  async startMarking() { calls.push('start'); },
  reviewList() { return exam.submissions.filter((s) => exam.marked.has(s.id)).map((s) => ({ submissionId: s.id, total: 7, maxTotal: 10, percent: 70, released: exam.released.has(s.id), releasedAt: exam.released.has(s.id) ? '2026-11-01T10:00:00.000Z' : null, openFlags: 0 })); },
  async release(_u: string, _e: string, refs: any) { const ids = refs === 'all' ? [...exam.marked] : refs; for (const id of ids) exam.released.add(id); return { released: ids.map((id: string) => exam.submissions.find((s) => s.id === id).candidateId), skipped: [] }; },
  async candidateView() { return { result: { questions: [{ number: 1, awardedMarks: 3, maxMarks: 5, feedback: 'Good method.', lostMarks: 'Arithmetic slip.', correction: 'x = 4' }] }, markedPdf: { url: '/signed/marked.pdf' } }; },
  latestScheme() { return exam.scheme ? { status: 'confirmed' } : null; },
};
const svc = createAssignmentService({ store: new OwnedRecordStore<AssignmentRecord>(path.join(dir, 'records')), files, tokenDir: path.join(dir, 'links'), baseUrl: () => 'https://www.bwenge.space', marker: createTaskMarker(() => fakeExams as any, { retryMs: 5, maxRetries: 2 }) });

const pdf = async () => { const d = await PDFDocument.create(); d.addPage([595, 842]); return Buffer.from(await d.save()); };
// Background marking runs after each hand-in returns; wait for it (not a fixed delay, so slow machines pass too).
const until = async (ok: () => boolean, ms = 5000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 10)); };

test('tasks: hand-ins are marked as they arrive, released by the teacher, and read by each student privately', async () => {
  await assert.rejects(svc.create('t1', { title: 'Quiz 1', instructions: 'Answer all.', autoMark: 'true' }), /marking scheme/);
  const a = await svc.create('t1', { title: 'Quiz 1', instructions: 'Answer all.', autoMark: 'true', scheme: [{ name: 'scheme.pdf', data: await pdf() }] });
  assert.equal(a.autoMark, true);
  const token = a.link.split('/a/')[1];
  assert.equal((await svc.publicView(token)).autoMark, true);

  const r1 = await svc.submit(token, { studentName: 'Uwase Aline', text: 'x = 4' });
  const r2 = await svc.submit(token, { studentName: 'Mugisha Eric', studentId: 'S3-014', files: [{ name: 'answers.pdf', data: await pdf() }] });
  assert.match(r1.resultLink, /^https:\/\/www\.bwenge\.space\/a\/[\w-]+\/result\/[\w-]+$/);
  await until(() => calls.includes('start'));
  // One examination for the task; the scheme goes with the first hand-in, the second joins and starts marking.
  assert.deepEqual(calls, ['create', 'add:Uwase Aline', 'scheme:scheme.pdf:true', 'add:Mugisha Eric', 'start']);

  const rt1 = r1.resultLink.split('/result/')[1];
  assert.equal((await svc.publicResult(token, rt1)).state, 'marking', 'handed in, not marked yet');
  exam.marked.add('sub-1');
  const view = await svc.get('t1', a.id);
  const aline = view.submissions.find((s: any) => s.studentName === 'Uwase Aline') as any;
  assert.equal(aline.marking.state, 'marked');
  assert.equal(aline.marking.percent, 70);
  assert.ok(aline.resultLink, 'the teacher sees the link to share again');
  assert.equal((view.submissions as any[]).some((s) => 'resultToken' in s), false, 'the raw key is not exposed');
  assert.equal((await svc.publicResult(token, rt1)).state, 'waiting', 'marked, waiting for release');

  const rel = await svc.release('t1', a.id);
  assert.equal(rel.released, 1);
  const res = await svc.publicResult(token, rt1);
  assert.equal(res.state, 'released');
  assert.equal(res.percent, 70);
  assert.equal(res.questions![0].feedback, 'Good method.');
  assert.equal(res.markedPdfUrl, '/signed/marked.pdf');

  // A wrong key or another task's token shows nothing.
  await assert.rejects(svc.publicResult(token, 'not-a-real-key'), /not valid/);
  // Resubmitting keeps the same private link.
  const again = await svc.submit(token, { studentName: 'Uwase Aline', text: 'x = 4, checked' });
  assert.equal(again.resultLink, r1.resultLink);
  await until(() => calls.filter((c) => c === 'add:Uwase Aline').length === 2); // let that hand-in's background marking finish before the folder is removed
  await new Promise((r) => setTimeout(r, 30));
});
