import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { prisma } from '../server/db.js';
import { OwnedRecordStore } from '../server/services/storage/ownedRecordStore.js';
import { AssignmentError, createAssignmentService, type AssignmentFiles, type AssignmentRecord } from '../server/services/assignments/service.js';
import { setAssignmentService } from '../server/services/assignments/runtime.js';
import { setGradebookItems, setGradebookStore } from '../server/services/gradebook.js';
import { createClass } from '../server/services/learning/practice.js';
import { publicTranscript, regenerateLink, setTranscriptStorage, transcriptLinks } from '../server/services/transcripts.js';
import { createTranscriptPublicRouter } from '../server/routes/transcriptRoutes.js';

// Transcripts: one private link per student; only RELEASED marks are ever shown, in rows or in the average.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'transcripts-'));
test.after(async () => { setAssignmentService(null); setGradebookStore(null); setTranscriptStorage(null, null); await fs.rm(dir, { recursive: true, force: true }); });
const mem = new Map<string, { owner: string; name: string; mime: string; data: Buffer }>();
const files: AssignmentFiles = {
  async save(userId, name, mime, data) { const id = randomUUID(); mem.set(id, { owner: userId, name, mime, data }); return { id, name, mime, size: data.length }; },
  async read(userId, id) { const f = mem.get(id); if (!f || f.owner !== userId) throw new AssignmentError('NOT_FOUND', 'File not found.', 404); return f; },
};
const marks: Record<string, { percent: number; total: number; maxTotal: number; released: boolean }> = {};
const marker = {
  async mark() { /* marks are set below */ },
  async statuses(_o: string, a: AssignmentRecord) { return Object.fromEntries(a.submissions.filter((s) => marks[s.studentName]).map((s) => [s.id, { state: 'marked' as const, ...marks[s.studentName] }])); },
  async release() { return { released: 0, skipped: [] }; },
  async result() { return { state: 'not_marked' as const, title: '', studentName: '' }; },
};
const recordsDir = path.join(dir, 'records');
const svc = createAssignmentService({ store: new OwnedRecordStore<AssignmentRecord>(recordsDir), files, tokenDir: path.join(dir, 'links'), baseUrl: () => 'https://www.bwenge.space', marker });
setAssignmentService(svc);
setGradebookStore(new OwnedRecordStore(path.join(dir, 'gradebooks')));
setTranscriptStorage(new OwnedRecordStore(path.join(dir, 'tr-records')), path.join(dir, 'tr-links'));

const owner = `teacher-tr-${randomUUID().slice(0, 8)}`;
const cls = await createClass(owner, 'S3 Biology');
const task = await svc.create(owner, { title: 'Cells homework', instructions: 'Label the cell.' });
await svc.setAutoMark(owner, task.id, { autoMark: 'true', scheme: [{ name: 'scheme.txt', data: Buffer.from('1. Nucleus (2 marks)') }] });
await new OwnedRecordStore<AssignmentRecord>(recordsDir).update(task.id, owner, (r) => { r.examId = 'exam-x'; });
const tok = task.link.split('/a/')[1];
await svc.submit(tok, { studentName: 'Uwase Aline', studentId: 'S3-001', text: 'nucleus' });
await svc.submit(tok, { studentName: 'Mugisha Eric', studentId: 'S3-002', text: 'membrane' });
await svc.submit(tok, { studentName: 'Keza Divine', studentId: 'S3-003', text: 'wall' });
marks['Uwase Aline'] = { percent: 90, total: 9, maxTotal: 10, released: true };     // released
marks['Mugisha Eric'] = { percent: 40, total: 4, maxTotal: 10, released: false };   // marked, NOT released
// Keza: handed in, not marked.
const quiz = (title: string, showScore: boolean) => (prisma as any).applicationForm.create({ data: { id: randomUUID(), userId: owner, title, schema: JSON.stringify({ title, isQuiz: true, showScore, fields: [{ id: 'n', label: 'Full name', type: 'text' }, { id: 'r', label: 'Registration number', type: 'text' }] }) } });
const open = await quiz('Cells quiz', true); const hidden = await quiz('Secret quiz', false);
const take = (formId: string, n: string, r: string, percent: number) => (prisma as any).formSubmission.create({ data: { formId, data: JSON.stringify({ n, r, _quiz: { score: percent / 10, maxScore: 10, percent } }) } });
await take(open.id, 'Uwase Aline', 'S3-001', 100); await take(open.id, 'Mugisha Eric', 'S3-002', 60);
await take(hidden.id, 'Uwase Aline', 'S3-001', 70);
await setGradebookItems(owner, cls.id, [{ kind: 'task', id: task.id }, { kind: 'quiz', id: open.id }, { kind: 'quiz', id: hidden.id }]);

const app = express(); app.use('/api/transcripts/public', createTranscriptPublicRouter());
const srv = app.listen(0); const base = `http://127.0.0.1:${(srv.address() as any).port}/api/transcripts/public`;
test.after(() => srv.close());
const links = await transcriptLinks(owner, cls.id, 'https://www.bwenge.space');
const tokenOf = (name: string) => links.find((l) => l.name === name)!.link.split('/t/')[1];

test('each student gets one private link, made once and kept', async () => {
  assert.equal(links.length, 3); assert.ok(links.every((l) => /^https:\/\/www\.bwenge\.space\/t\/[\w-]{20,}$/.test(l.link)));
  assert.equal(new Set(links.map((l) => l.link)).size, 3, 'every link is different');
  const again = await transcriptLinks(owner, cls.id, 'https://www.bwenge.space');
  assert.deepEqual(again.map((l) => l.link), links.map((l) => l.link), 'asking again does not change the links');
  await assert.rejects(transcriptLinks('someone-else', cls.id, 'https://x'), /not found/i, 'only the class owner');
});

test('a student sees only RELEASED marks, and the average counts only those', async () => {
  const aline = await publicTranscript(tokenOf('Uwase Aline'));
  assert.equal(aline.className, 'S3 Biology'); assert.deepEqual(aline.student, { name: 'Uwase Aline', studentId: 'S3-001' });
  const by = Object.fromEntries(aline.rows.map((r) => [r.title, r]));
  assert.deepEqual([by['Cells homework'].status, by['Cells homework'].percent], ['released', 90]);
  assert.deepEqual([by['Cells quiz'].status, by['Cells quiz'].percent], ['released', 100]);
  assert.deepEqual([by['Secret quiz'].status, by['Secret quiz'].percent, by['Secret quiz'].label], ['pending', null, 'Marks not released yet'], 'a quiz that hides scores stays hidden');
  assert.equal(aline.average, 95, 'average of 90 and 100 only; the hidden 70 is not in it'); assert.equal(aline.releasedCount, 2);

  const eric = await publicTranscript(tokenOf('Mugisha Eric'));
  const e = Object.fromEntries(eric.rows.map((r) => [r.title, r]));
  assert.deepEqual([e['Cells homework'].status, e['Cells homework'].percent], ['pending', null], 'marked but not released: no number at all');
  assert.equal(e['Cells quiz'].percent, 60); assert.equal(eric.average, 60, 'the unreleased 40 is not in the average');
  assert.ok(!JSON.stringify(eric).includes('"percent":40') && !JSON.stringify(eric).includes('4/10'), 'the unreleased mark appears nowhere in what the student receives');

  const keza = await publicTranscript(tokenOf('Keza Divine'));
  assert.deepEqual(keza.rows.map((r) => r.status), ['handed_in', 'none', 'none']); assert.equal(keza.average, null);
});

test('releasing a mark later shows it on the same link', async () => {
  marks['Mugisha Eric'].released = true;
  const t = await publicTranscript(tokenOf('Mugisha Eric'));
  assert.equal(t.rows.find((r) => r.title === 'Cells homework')!.percent, 40); assert.equal(t.average, 50);
});

test('the public page: links work, bad or guessed links give 404, and nothing is cached or indexed', async () => {
  const ok = await fetch(`${base}/${tokenOf('Uwase Aline')}`);
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('cache-control'), 'no-store'); assert.equal(ok.headers.get('x-robots-tag'), 'noindex');
  assert.equal((await ok.json()).student.name, 'Uwase Aline');
  for (const bad of ['short', 'x'.repeat(24), '../../etc/passwd', `${tokenOf('Uwase Aline')}x`]) assert.equal((await fetch(`${base}/${encodeURIComponent(bad)}`)).status, 404, bad);
});

test('a leaked link can be replaced, and the old one stops working at once', async () => {
  const old = tokenOf('Keza Divine');
  const key = links.find((l) => l.name === 'Keza Divine')!.key;
  const fresh = await regenerateLink(owner, cls.id, key, 'https://www.bwenge.space');
  assert.notEqual(fresh.link.split('/t/')[1], old);
  assert.equal((await fetch(`${base}/${old}`)).status, 404); assert.equal((await fetch(`${base}/${fresh.link.split('/t/')[1]}`)).status, 200);
  await assert.rejects(regenerateLink('someone-else', cls.id, key, 'https://x'), /not (in this class|found)/i);
  await assert.rejects(regenerateLink(owner, cls.id, 'id:nobody', 'https://x'), /not in this class/i);
});
