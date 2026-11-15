import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { OwnedRecordStore } from '../server/services/storage/ownedRecordStore.js';
import { createCourseService, parseStudents, normalizeAccommodations, CourseError, type CourseRecord, type CourseSources } from '../server/services/courses/service.js';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'courses-'));
test.after(() => fs.rm(dir, { recursive: true, force: true }));

const sources: CourseSources = {
  async task(_o, id) {
    if (id !== 'task1') return null;
    return { title: 'Calculus CAT 1', dueAt: null, submissions: [
      { studentId: '222001', submittedAt: '2026-11-01T10:00:00Z', late: false, marking: { state: 'marked', total: 18, maxTotal: 20, percent: 90 } },
      { studentId: '222002', submittedAt: '2026-11-01T11:00:00Z', late: true },
      { studentId: '999999', submittedAt: '2026-11-01T11:00:00Z', late: false },
    ] };
  },
  async quiz(_o, id) {
    if (id !== 'quiz1') return null;
    return { title: 'Algebra quiz', attempts: [
      { studentId: '222001', submittedAt: 'a', percent: 30, score: 3, maxScore: 10, flags: 0 },
      { studentId: '222001', submittedAt: 'b', percent: 80, score: 8, maxScore: 10, flags: 2 },
      { studentId: '222003', submittedAt: 'c', percent: 20, score: 2, maxScore: 10, flags: 0 },
    ] };
  },
  async available() { return { tasks: [{ id: 'task1', title: 'Calculus CAT 1' }], quizzes: [{ id: 'quiz1', title: 'Algebra quiz' }] }; },
};
const svc = createCourseService({ store: new OwnedRecordStore<CourseRecord>(path.join(dir, 'c')), sources });

test('parseStudents reads pasted spreadsheet lines: id, name, optional email; skips header, duplicates and bad lines', () => {
  const list = parseStudents('Registration,Name,Email\n222001, Uwase Aline ,aline@ur.ac.rw\n222002;Mugisha Eric\n222002,Dup Row\nnonsense\n222003\tKeza Divine\t\n');
  assert.deepEqual(list.map((s) => [s.id, s.name, s.email]), [['222001', 'Uwase Aline', 'aline@ur.ac.rw'], ['222002', 'Mugisha Eric', undefined], ['222003', 'Keza Divine', undefined]]);
  assert.deepEqual(parseStudents(42), []);
});

test('accommodations are bounded and merged, not replaced', () => {
  const a = normalizeAccommodations({ extraTimePercent: 9999, cameraExempt: true, junk: 1 });
  assert.equal(a.extraTimePercent, 200);
  assert.equal(a.cameraExempt, true);
  const b = normalizeAccommodations({ breaks: true }, a);
  assert.deepEqual([b.extraTimePercent, b.cameraExempt, b.breaks], [200, true, true]);
  assert.equal(normalizeAccommodations({ extraTimePercent: -5 }).extraTimePercent, 0);
});

test('a lecturer creates a course, imports the roster, links work, and sees who needs attention', async () => {
  await assert.rejects(svc.create('t1', { name: '' }), /name/i);
  const c = await svc.create('t1', { name: 'Calculus I', code: 'MATH101', term: '2026 S1', roster: '222001,Uwase Aline\n222002,Mugisha Eric\n222003,Keza Divine\n222004,Habimana Jean' });
  assert.equal(c.students, 4);
  assert.deepEqual(await svc.addStudents('t1', c.id, '222004,Habimana Jean Paul\n222005,Ineza Grace,ineza@ur.ac.rw'), { added: 1, updated: 1 });
  await assert.rejects(svc.addStudents('t1', c.id, 'garbage'), /No students found/);
  await svc.setItems('t1', c.id, [{ kind: 'task', id: 'task1' }, { kind: 'quiz', id: 'quiz1' }, { kind: 'quiz', id: 'quiz1' }, { kind: 'quiz', id: 'gone' }, { kind: 'x', id: 'y' }]);

  const d = await svc.dashboard('t1', c.id);
  assert.deepEqual(d.columns.map((x) => x.title), ['Calculus CAT 1', 'Algebra quiz'], 'duplicate and unknown items are dropped');
  const by = Object.fromEntries(d.students.map((s) => [s.id, s]));
  assert.equal(by['222001'].cells['task:task1'].percent, 90);
  assert.equal(by['222001'].cells['quiz:quiz1'].percent, 80, 'the latest attempt counts');
  assert.equal(by['222001'].average, 85);
  assert.equal(by['222001'].flagged, 1);
  assert.equal(by['222001'].risk, 'watch', 'a flagged response is worth watching');
  assert.equal(by['222002'].cells['task:task1'].state, 'submitted');
  assert.equal(by['222002'].risk, 'attention', 'half the work is missing');
  assert.equal(by['222003'].risk, 'attention');
  assert.equal(by['222004'].missing, 2);
  assert.deepEqual(d.unmatched, ['999999'], 'a hand-in from an id that is not on the roster is reported');
  assert.equal(d.totals.students, 5);
  assert.equal(d.totals.flaggedResponses, 1);
  assert.equal(d.columns[1].average, 50, 'quiz average over the roster: (80 + 20) / 2');
  assert.equal(d.columns[0].submitted, 2);
  assert.equal(d.available.tasks.length, 1);
});

test('accommodations are kept per student, readable for exams, and never leave the owner', async () => {
  const c = await svc.create('t1', { name: 'Physics', roster: '300001,Ishimwe Grace\n300002,Niyonzima Paul' });
  await svc.updateStudent('t1', c.id, '300001', { accommodations: { extraTimePercent: 50, cameraExempt: true, breaks: true, note: 'Low vision; uses a screen reader' } });
  const got = await svc.accommodationsFor('t1', c.id, '300001');
  assert.equal(got?.accommodations.extraTimePercent, 50);
  assert.equal(got?.accommodations.cameraExempt, true);
  assert.match(got?.accommodations.note ?? '', /screen reader/);
  assert.equal((await svc.accommodationsFor('t1', c.id, '300002'))?.accommodations.extraTimePercent, 0);
  // Re-importing the roster keeps accommodations.
  await svc.addStudents('t1', c.id, '300001,Ishimwe Grace M');
  assert.equal((await svc.accommodationsFor('t1', c.id, '300001'))?.accommodations.cameraExempt, true);
  const d = await svc.dashboard('t1', c.id);
  assert.equal(d.totals.withAccommodations, 1);
  await assert.rejects(svc.dashboard('t2', c.id), (e: any) => e instanceof CourseError && e.status === 404);
  await assert.rejects(svc.accommodationsFor('t2', c.id, '300001'), /not found/i);
  await assert.rejects(svc.updateStudent('t1', c.id, 'nobody', { name: 'x' }), /not on this course/);
  // A withdrawn student is not counted as missing work and has no exam accommodations.
  await svc.updateStudent('t1', c.id, '300002', { status: 'withdrawn' });
  assert.equal(await svc.accommodationsFor('t1', c.id, '300002'), null);
  await svc.removeStudent('t1', c.id, '300002');
  assert.equal((await svc.dashboard('t1', c.id)).students.length, 1);
});

test('the Excel sheet has marks and status but not accommodations', async () => {
  const c = (await svc.list('t1')).find((x) => x.name === 'Calculus I')!;
  const f = await svc.exportWorkbook('t1', c.id);
  assert.match(f.name, /Calculus I marks\.xlsx/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(f.data as any);
  const ws = wb.getWorksheet('Course')!;
  const header = (ws.getRow(1).values as any[]).slice(1);
  assert.deepEqual(header.slice(0, 4), ['Registration no.', 'Name', 'Calculus CAT 1 (%)', 'Algebra quiz (%)']);
  const text = JSON.stringify(ws.getSheetValues());
  assert.ok(!/accommodat|extraTime|camera/i.test(text));
  assert.match(text, /Needs attention/);
});
