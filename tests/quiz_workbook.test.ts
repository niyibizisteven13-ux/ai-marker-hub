import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { NotAQuizError, quizWorkbook } from '../server/services/forms/resultsWorkbook.js';
import { prisma } from '../server/db.js';
import { getJwtSecret } from '../server/auth/secrets.js';
import formRoutes from '../server/routes/formRoutes.js';

const schema = (over: any = {}) => ({
  title: 'Cells quiz', isQuiz: true,
  fields: [
    { id: 'n', type: 'text', label: 'Full name' }, { id: 'r', type: 'text', label: 'Registration number' },
    { id: 'q1', type: 'radio', label: 'Powerhouse of the cell?', options: ['Nucleus', 'Mitochondria', 'Ribosome'], points: 2, correctAnswer: 'Mitochondria' },
    { id: 'q2', type: 'checkbox', label: 'Which are organelles?', options: ['Nucleus', 'Vacuole', 'Atom'], points: 3, correctAnswer: ['Nucleus', 'Vacuole'] },
    { id: 'q3', type: 'text', label: 'Pigment in leaves?', points: 1, correctAnswer: 'chlorophyll' },
    { id: 'q4', type: 'long_text', label: 'Explain osmosis.', points: 5 },
  ], ...over,
});
const at = (m: number) => new Date(Date.UTC(2026, 10, 15, 9, m));
const sub = (n: string, r: string, a: Record<string, unknown>, m: number) => ({ id: randomUUID(), createdAt: at(m), data: JSON.stringify({ n, r, ...a }) });
const SUBS = [
  sub('Uwase Aline', 'S3-001', { q1: 'Mitochondria', q2: ['Nucleus', 'Vacuole'], q3: 'Chlorophyll', q4: 'x' }, 1),              // 6/6
  sub('Mugisha Eric', 'S3-002', { q1: 'Nucleus', q2: ['Nucleus'], q3: 'melanin' }, 2),                                  // 0/6
  sub('Keza Divine', 'S3-003', { q1: 'Nucleus', q2: ['Nucleus', 'Vacuole'], q3: 'chlorophyll' }, 3),                    // 4/6 first try
  sub('Keza Divine', 'S3-003', { q1: 'Mitochondria', q2: ['Nucleus', 'Vacuole'], q3: 'chlorophyll' }, 9),               // 6/6 second try counts
  sub('=HYPERLINK("http://evil")', 'S3-004', { q1: 'Nucleus', q2: ['Atom'], q3: 'melanin' }, 4),                        // 0/6, a name that looks like a formula
];
const load = async (buf: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any); return wb; };
const cell = (ws: ExcelJS.Worksheet, row: number, header: string) => { const col = (ws.getRow(1).values as any[]).findIndex((h) => String(h ?? '').startsWith(header)); return ws.getRow(row).getCell(col).value; };

test('the workbook has Results, Questions and Summary, with every student and every attempt', async () => {
  const f = await quizWorkbook({ title: 'Cells quiz', schema: schema(), submissions: SUBS });
  assert.equal(f.name, 'Cells quiz marks.xlsx'); assert.equal(f.students, 4);
  const wb = await load(f.data);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Results', 'Questions', 'Summary']);
  const ws = wb.getWorksheet('Results')!;
  assert.equal(ws.rowCount, 6, 'header + 5 attempts');
  const names = Array.from({ length: 5 }, (_, i) => cell(ws, i + 2, 'Name'));
  assert.deepEqual(names.slice(0, 4), ['=HYPERLINK("http://evil")', 'Keza Divine', 'Keza Divine', 'Mugisha Eric'].slice(0, 4).sort((a, b) => String(a).localeCompare(String(b))).slice(0, 4), 'sorted by name');
  const keza2 = [2, 3, 4, 5, 6].find((r) => cell(ws, r, 'Name') === 'Keza Divine' && cell(ws, r, 'Attempt') === 2)!;
  assert.deepEqual([cell(ws, keza2, 'Mark'), cell(ws, keza2, 'Out of'), cell(ws, keza2, 'Percent')], [6, 6, 100]);
  const keza1 = [2, 3, 4, 5, 6].find((r) => cell(ws, r, 'Name') === 'Keza Divine' && cell(ws, r, 'Attempt') === 1)!;
  assert.deepEqual([cell(ws, keza1, 'Mark'), cell(ws, keza1, 'Percent')], [4, 66.7]); assert.equal(cell(ws, keza1, 'Q1'), 0); assert.equal(cell(ws, keza1, 'Q2'), 3);
  // the long answer is not auto-marked, so it has no column
  assert.ok(!(ws.getRow(1).values as any[]).some((h) => String(h ?? '').includes('Explain osmosis')));
  assert.equal(ws.getRow(1).getCell(1).value, 'Registration no.');
});

test('a student name that looks like a formula stays plain text (no Excel formula injection)', async () => {
  const wb = await load((await quizWorkbook({ title: 't', schema: schema(), submissions: SUBS })).data);
  const ws = wb.getWorksheet('Results')!;
  const r = [2, 3, 4, 5, 6].find((i) => String(cell(ws, i, 'Name')).startsWith('=HYPERLINK'))!;
  const c = ws.getRow(r).getCell(2);
  assert.equal(typeof c.value, 'string'); assert.ok(!('formula' in (c as any).model && (c as any).model.formula), 'not stored as a formula');
});

test('Questions: how many got each right, the right answer, and the most common wrong answer (latest attempts only)', async () => {
  const wb = await load((await quizWorkbook({ title: 'Cells quiz', schema: schema(), submissions: SUBS })).data);
  const wq = wb.getWorksheet('Questions')!;
  assert.equal(wq.rowCount, 4, 'header + the three auto-marked questions');
  const q1 = wq.getRow(2);   // latest attempts: Aline right, Eric wrong, Keza right (2nd try), Evil wrong -> 2 of 4
  assert.deepEqual([q1.getCell(4).value, q1.getCell(5).value, q1.getCell(6).value], [4, 2, 50]);
  assert.equal(q1.getCell(7).value, 'Mitochondria'); assert.equal(q1.getCell(8).value, 'Nucleus (2)');
  const q3 = wq.getRow(4); assert.equal(q3.getCell(8).value, 'melanin (2)');
});

test('Summary counts each student once, by their latest attempt', async () => {
  const wb = await load((await quizWorkbook({ title: 'Cells quiz', schema: schema(), submissions: SUBS })).data);
  const sum = wb.getWorksheet('Summary')!; const v = (label: string) => { let out: any; sum.eachRow((r) => { if (r.getCell(1).value === label) out = r.getCell(2).value; }); return out; };
  assert.equal(v('Students'), 4); assert.equal(v('Attempts'), 5);
  assert.equal(v('Class average (%)'), 50);        // 100, 0, 100, 0
  assert.equal(v('Highest (%)'), 100); assert.equal(v('Lowest (%)'), 0); assert.equal(v('Pass rate (50% or more)'), '50%'); assert.equal(v('Median (%)'), 50);
});

test('fixing an answer key and exporting again corrects every student', async () => {
  const marksOf = async (sch: any) => {
    const ws = (await load((await quizWorkbook({ title: 't', schema: sch, submissions: SUBS })).data)).getWorksheet('Results')!;
    const out: Record<string, number> = {};
    for (let r = 2; r <= ws.rowCount; r++) if (cell(ws, r, 'Attempt') === 1) out[String(cell(ws, r, 'Name'))] = Number(cell(ws, r, 'Q1'));
    return out;
  };
  const before = await marksOf(schema());
  assert.deepEqual([before['Uwase Aline'], before['Mugisha Eric']], [2, 0]);
  const fixed = schema(); fixed.fields[2].correctAnswer = 'Nucleus';   // the lecturer had the key wrong
  const after = await marksOf(fixed);
  assert.deepEqual([after['Uwase Aline'], after['Mugisha Eric'], after['Keza Divine']], [0, 2, 2], 'the marks follow the corrected key');
});

test('an empty quiz still gives a valid file, and a form that is not a quiz is refused', async () => {
  const empty = await quizWorkbook({ title: 'None yet', schema: schema(), submissions: [] });
  const wb = await load(empty.data); assert.equal(wb.getWorksheet('Summary')!.getRow(2).getCell(2).value, 0);
  await assert.rejects(quizWorkbook({ title: 'x', schema: { title: 'x', fields: [] }, submissions: [] }), NotAQuizError);
  assert.equal((await quizWorkbook({ title: 'a/b:c*"?.', schema: schema(), submissions: [] })).name, 'a b c . marks.xlsx', 'characters Windows files cannot have are removed');
});

test('the route: the owner gets the file; another signed-in user and a visitor do not', async () => {
  const owner = `lect-${randomUUID().slice(0, 8)}`; const other = `lect-${randomUUID().slice(0, 8)}`;
  for (const id of [owner, other]) await (prisma as any).user.create({ data: { id, email: `${id}@example.org`, passwordHash: 'x' } }).catch(() => undefined);
  const form = await (prisma as any).applicationForm.create({ data: { id: randomUUID(), userId: owner, title: 'Cells quiz', schema: JSON.stringify(schema()) } });
  for (const s of SUBS) await (prisma as any).formSubmission.create({ data: { formId: form.id, data: s.data } });
  const plain = await (prisma as any).applicationForm.create({ data: { id: randomUUID(), userId: owner, title: 'Survey', schema: JSON.stringify({ title: 'Survey', fields: [] }) } });
  const app = express(); app.use('/api/forms', formRoutes); const srv = app.listen(0); const base = `http://127.0.0.1:${(srv.address() as any).port}/api/forms`;
  try {
    const bearer = (uid: string) => ({ Authorization: `Bearer ${jwt.sign({ userId: uid }, getJwtSecret(), { algorithm: 'HS256', issuer: 'bwenge', audience: 'bwenge-web', expiresIn: 60 })}` });
    const ok = await fetch(`${base}/${form.id}/results/export.xlsx`, { headers: bearer(owner) });
    assert.equal(ok.status, 200, await ok.clone().text().catch(() => ''));
    assert.match(ok.headers.get('content-type') ?? '', /spreadsheetml/); assert.match(ok.headers.get('content-disposition') ?? '', /Cells quiz marks\.xlsx/);
    assert.equal((await load(Buffer.from(await ok.arrayBuffer()))).getWorksheet('Results')!.rowCount, 6);
    assert.equal((await fetch(`${base}/${form.id}/results/export.xlsx`, { headers: bearer(other) })).status, 403, 'another lecturer');
    assert.equal((await fetch(`${base}/${form.id}/results/export.xlsx`)).status, 401, 'no sign-in');
    assert.equal((await fetch(`${base}/${plain.id}/results/export.xlsx`, { headers: bearer(owner) })).status, 409, 'not a quiz');
  } finally { srv.close(); }
});
