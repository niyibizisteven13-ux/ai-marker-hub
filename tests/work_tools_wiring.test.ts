import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { OwnedRecordStore } from '../server/services/storage/ownedRecordStore.js';
import { AssignmentError, createAssignmentService, type AssignmentFiles, type AssignmentRecord } from '../server/services/assignments/service.js';
import { setAssignmentService } from '../server/services/assignments/runtime.js';
import { createCourseService, type CourseRecord } from '../server/services/courses/service.js';
import { setCourseService } from '../server/services/courses/runtime.js';
import type { TaskMarker } from '../server/services/assignments/autoMark.js';

// The chat's work tools against the REAL assignment and class services (only the AI marker and the files are stand-ins):
// the wiring in AiService turns each tool into the right service call.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'worktools-'));
test.after(() => fs.rm(dir, { recursive: true, force: true }));
const mem = new Map<string, { owner: string; name: string; mime: string; data: Buffer }>();
const files: AssignmentFiles = {
  async save(userId, name, mime, data) { const id = randomUUID(); mem.set(id, { owner: userId, name, mime, data }); return { id, name, mime, size: data.length }; },
  async read(userId, id) { const f = mem.get(id); if (!f || f.owner !== userId) throw new AssignmentError('NOT_FOUND', 'File not found.', 404); return f; },
};
const calls: string[] = [];
const marked = new Map<string, { total: number; released: boolean }>();
const marker: TaskMarker = {
  async mark() { /* not used here */ },
  async statuses(_o, a) { return Object.fromEntries(a.submissions.filter((s) => marked.has(s.id)).map((s) => [s.id, { state: 'marked' as const, total: marked.get(s.id)!.total, maxTotal: 20, percent: marked.get(s.id)!.total * 5, released: marked.get(s.id)!.released }])); },
  async release(_o, a, ids) { calls.push(`release ${ids === 'all' ? 'all' : ids.length}`); for (const s of a.submissions) if (marked.has(s.id) && (ids === 'all' || ids.includes(s.id))) marked.get(s.id)!.released = true; return { released: [...marked.values()].filter((m) => m.released).length, skipped: [] }; },
  async result() { return { state: 'not_marked', title: '', studentName: '' }; },
  async markNow(_o, a, opts) { calls.push(`markNow confirm=${opts.confirm}`); if (!opts.confirm) return { kind: 'needs_confirmation', scheme: { state: 'needs_confirmation', summary: '2 questions, 20 marks', warnings: [], errors: [] } }; a.submissions.forEach((s, i) => marked.set(s.id, { total: 17 - i * 4, released: false })); await store.update(a.id, a.ownerId, (r) => { r.examId = 'exam1'; }); return { kind: 'started' }; },   // like the real marker: the task now has its examination
};
const store = new OwnedRecordStore<AssignmentRecord>(path.join(dir, 'a'));
const svc = createAssignmentService({ store, files, tokenDir: path.join(dir, 'links'), baseUrl: () => 'https://www.bwenge.space', marker });
setAssignmentService(svc);
const courses = createCourseService({
  store: new OwnedRecordStore<CourseRecord>(path.join(dir, 'c')),
  sources: { available: async () => ({ tasks: [], quizzes: [] }), task: async (o: string, id: string) => { const a = await svc.get(o, id); return { title: a.title, dueAt: a.dueAt, submissions: a.submissions.map((s: any) => ({ studentId: s.studentId, late: s.late, marking: s.marking ? { state: s.marking.state, total: s.marking.total, maxTotal: s.marking.maxTotal, percent: s.marking.percent } : undefined })) } as any; }, quiz: async () => null } as any,
});
setCourseService(courses);
const { bwengeAgent } = await import('../server/services/AiService.js');
const tool = (n: string) => bwengeAgent.tools.get(n)!;
const saved: string[] = [];
const ctx = { userId: 'teacher', files: { put: async (f: any) => { saved.push(`${f.name}:${f.data.length}`); return { id: 'f1', name: f.name, mime: f.mime, kind: f.kind, size: f.data.length }; }, toRef: (m: any) => ({ id: m.id, name: m.name, mime: m.mime, size: m.size, kind: m.kind, url: '/f', expiresAt: '' }) } } as any;

test('the chat marks a task, shows the marks, releases them after a yes, and attaches the Excel sheet', async () => {
  const a = await svc.create('teacher', { title: 'Cells homework', instructions: 'Draw and label a cell.' });
  const token = a.link.split('/a/')[1];
  for (const [n, id] of [['Aline Uwase', '2201'], ['Eric Mugisha', '2202']]) await svc.submit(token, { studentName: n, studentId: id, text: `${n}'s answer` });
  assert.ok(tool('mark_task'), 'the tool is part of the real toolkit');

  // no scheme anywhere: the chat is told to ask for one
  const noScheme = await tool('mark_task').execute({ assignmentId: a.id }, ctx);
  assert.ok(noScheme.isError); assert.match(noScheme.text, /marking scheme/i);
  // a scheme written in the chat: stored on the task, read back to the user for a yes
  const ask = await tool('mark_task').execute({ assignmentId: a.id, scheme: 'Q1 (10 marks): organelles named\nQ2 (10 marks): functions' }, ctx);
  assert.match(ask.text, /2 questions, 20 marks/); assert.match(ask.text, /confirm true/);
  assert.equal((await svc.get('teacher', a.id) as any).autoMark, true, 'automatic marking was turned on for the task');
  const started = await tool('mark_task').execute({ assignmentId: a.id, confirm: true }, ctx);
  assert.match(started.text, /Marking started for 2 hand-in/);
  assert.deepEqual(calls.filter((c) => c.startsWith('markNow')), ['markNow confirm=false', 'markNow confirm=true']);

  const res = (await tool('task_results').execute({ assignmentId: a.id }, ctx)).text;
  assert.match(res, /2 handed in, 2 marked, average 75%/); assert.match(res, /Aline Uwase \(2201\): marked, 17\/20 \(85%\), not released yet/);
  // releasing: nothing without the yes; with it, students see their marks
  assert.ok((await tool('release_task_results').execute({ assignmentId: a.id }, ctx)).isError);
  assert.match((await tool('release_task_results').execute({ assignmentId: a.id, confirmed: true, studentIds: ['2201'] }, ctx)).text, /Released/);
  assert.match((await tool('task_results').execute({ assignmentId: a.id }, ctx)).text, /Aline Uwase \(2201\): marked, 17\/20 \(85%\), released to the student/);
  // the Excel sheet comes attached
  const x = await tool('export_task_results').execute({ assignmentId: a.id }, ctx);
  assert.equal(x.attachments?.length, 1); assert.match(saved.at(-1)!, /^Cells homework marks\.xlsx:\d{3,}/);
  // closing the task and moving the date
  assert.match((await tool('task_settings').execute({ assignmentId: a.id, open: false, dueAt: '2026-12-01T17:00:00+02:00' }, ctx)).text, /closed for hand-ins, due 2026-12-01 15:00 UTC/);
  // another teacher gets nothing
  assert.ok((await tool('task_results').execute({ assignmentId: a.id }, { ...ctx, userId: 'other' })).isError);
});

test('the chat builds a class from a pasted list, links the task and reads the class back', async () => {
  const tasks = await svc.list('teacher');
  const c = await tool('create_class').execute({ name: 'S4 Biology', code: 'BIO4', students: '2201, Aline Uwase\n2202, Eric Mugisha\n2203, Chantal Mutesi' }, ctx);
  const courseId = /courseId ([0-9a-f-]{36})/.exec(c.text)?.[1] as string; assert.ok(courseId, c.text);
  assert.match(c.text, /made with 3 student/);
  assert.match((await tool('add_class_students').execute({ courseId, students: '2204, Didier Habimana' }, ctx)).text, /Added 1 student\(s\), updated 0/);
  assert.match((await tool('link_class_work').execute({ courseId, items: [{ kind: 'task', id: tasks[0].id }] }, ctx)).text, /counts 1 task/);
  const o = (await tool('course_overview').execute({ courseId }, ctx)).text;
  assert.match(o, /S4 Biology \(BIO4\): 4 students/); assert.match(o, /Cells homework \(task, average 75%, 2\/4 handed in/);
  assert.match((await tool('list_courses').execute({}, ctx)).text, /S4 Biology \(BIO4\): 4 students, 1 tasks or quizzes/);
  assert.equal((await tool('export_class_gradebook').execute({ courseId }, ctx)).attachments?.length, 1);
  assert.ok((await tool('add_class_students').execute({ courseId, students: 'x' }, { ...ctx, userId: 'other' })).isError, "another teacher's class is not reachable");
});
