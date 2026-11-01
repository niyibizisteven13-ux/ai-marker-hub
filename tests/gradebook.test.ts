import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { prisma } from '../server/db.js';
import { OwnedRecordStore } from '../server/services/storage/ownedRecordStore.js';
import { AssignmentError, createAssignmentService, type AssignmentFiles, type AssignmentRecord } from '../server/services/assignments/service.js';
import { setAssignmentService } from '../server/services/assignments/runtime.js';
import { buildGradebook, gradebookWorkbook, setGradebookItems, setGradebookStore } from '../server/services/gradebook.js';
import { createClass } from '../server/services/learning/practice.js';

// A class gradebook from a task (marked automatically) and a quiz form: the same student is one row across both,
// with averages per student and per column, and an Excel copy.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gradebook-'));
test.after(async () => { setAssignmentService(null); setGradebookStore(null); await fs.rm(dir, { recursive: true, force: true }); });
const mem = new Map<string, { owner: string; name: string; mime: string; data: Buffer }>();
const files: AssignmentFiles = {
  async save(userId, name, mime, data) { const id = randomUUID(); mem.set(id, { owner: userId, name, mime, data }); return { id, name, mime, size: data.length }; },
  async read(userId, id) { const f = mem.get(id); if (!f || f.owner !== userId) throw new AssignmentError('NOT_FOUND', 'File not found.', 404); return f; },
};
const marks: Record<string, { percent: number; total: number; maxTotal: number }> = {};
const marker = {
  async mark() { /* marked below */ },
  async statuses(_o: string, a: AssignmentRecord) { return Object.fromEntries(a.submissions.filter((s) => marks[s.studentName]).map((s) => [s.id, { state: 'marked' as const, released: false, ...marks[s.studentName] }])); },
  async release() { return { released: 0, skipped: [] }; },
  async result() { return { state: 'not_marked' as const, title: '', studentName: '' }; },
};
const svc = createAssignmentService({ store: new OwnedRecordStore<AssignmentRecord>(path.join(dir, 'records')), files, tokenDir: path.join(dir, 'links'), marker });
setAssignmentService(svc);
setGradebookStore(new OwnedRecordStore(path.join(dir, 'gradebooks')));

test('gradebook: tasks and quizzes side by side, one row per student, averages and an Excel copy', async () => {
  const owner = `teacher-gb-${randomUUID().slice(0, 8)}`;
  const cls = await createClass(owner, 'S3 Biology');
  const task = await svc.create(owner, { title: 'Cells homework', instructions: 'Label the cell.' });
  await svc.setAutoMark(owner, task.id, { autoMark: 'true', scheme: [{ name: 'scheme.txt', data: Buffer.from('1. Nucleus (2 marks)') }] });
  const token = task.link.split('/a/')[1];
  await svc.submit(token, { studentName: 'Uwase Aline', studentId: 'S3-001', text: 'nucleus' });
  await svc.submit(token, { studentName: 'Mugisha Eric', text: 'membrane' });
  marks['Uwase Aline'] = { percent: 90, total: 9, maxTotal: 10 };
  // Marks are read from the task's examination (the stand-in marker above answers for it).
  const rec = await new OwnedRecordStore<AssignmentRecord>(path.join(dir, 'records')).update(task.id, owner, (r) => { r.examId = 'exam-x'; });
  assert.ok(rec);

  const form = await (prisma as any).applicationForm.create({ data: { userId: owner, title: 'Cells quiz', schema: JSON.stringify({ title: 'Cells quiz', isQuiz: true, fields: [{ id: 'n', label: 'Your name', type: 'text' }, { id: 'q1', label: 'Powerhouse?', type: 'radio', points: 1, correctAnswer: 'Mitochondria' }] }) } });
  await (prisma as any).formSubmission.create({ data: { formId: form.id, data: JSON.stringify({ n: 'uwase  aline', q1: 'Mitochondria', _quiz: { score: 1, maxScore: 1, percent: 100, correct: ['q1'] } }) } });
  await (prisma as any).formSubmission.create({ data: { formId: form.id, data: JSON.stringify({ n: 'Keza Divine', q1: 'Nucleus', _quiz: { score: 0, maxScore: 1, percent: 0, correct: [] } }) } });

  const empty = await buildGradebook(owner, cls.id);
  assert.equal(empty.columns.length, 0);
  assert.ok(empty.available.tasks.some((t) => t.id === task.id));
  assert.ok(empty.available.quizzes.some((q) => q.id === form.id));

  const g = await setGradebookItems(owner, cls.id, [{ kind: 'task', id: task.id }, { kind: 'quiz', id: form.id }]);
  assert.deepEqual(g.columns.map((c) => c.title), ['Cells homework', 'Cells quiz']);
  const byName = Object.fromEntries(g.students.map((s) => [s.name, s]));
  assert.deepEqual(Object.keys(byName).sort(), ['Keza Divine', 'Mugisha Eric', 'Uwase Aline'], 'the quiz name "uwase  aline" joins the task row');
  assert.equal(byName['Uwase Aline'].cells[`task:${task.id}`].percent, 90);
  assert.equal(byName['Uwase Aline'].cells[`quiz:${form.id}`].percent, 100);
  assert.equal(byName['Uwase Aline'].average, 95);
  assert.equal(byName['Mugisha Eric'].cells[`task:${task.id}`].state, 'submitted', 'handed in, not marked');
  assert.equal(byName['Keza Divine'].cells[`task:${task.id}`].state, 'missing');
  assert.equal(g.columns[1].average, 50);

  await assert.rejects(buildGradebook('someone-else', cls.id), /not found/i, 'only the class owner');

  const { name, data } = await gradebookWorkbook(owner, cls.id);
  assert.equal(name, 'S3 Biology gradebook.xlsx');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const ws = wb.getWorksheet('Gradebook')!;
  assert.equal(ws.getRow(1).getCell(3).value, 'Cells homework (%)');
  assert.equal(ws.rowCount, 5, 'header, three students, class average');
});
