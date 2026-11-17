import ExcelJS from 'exceljs';
import { gradeQuiz, type QuizItem } from './quiz.js';
import { identityFields } from '../gradebook.js';
import { normalizeFields } from './model.js';

/**
 * A quiz's results as an Excel file for the lecturer:
 *  - Results: one row per attempt (name, registration number, total, percent, and the marks for every question)
 *  - Questions: how the class did on each question, the correct answer and the most common wrong answer
 *  - Summary: class average, median, highest, lowest and pass rate
 * Marks are worked out again from the CURRENT answer key, so fixing a key and exporting again corrects every student.
 */
const fold = (v: unknown) => String(v ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const round1 = (n: number) => Math.round(n * 10) / 10;
const text = (v: unknown) => (Array.isArray(v) ? v.map(String).join('; ') : v === null || v === undefined ? '' : String(v));
const FILL = { good: 'FFD1FAE5', ok: 'FFFEF3C7', bad: 'FFFEE2E2' };
const band = (p: number) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: p >= 70 ? FILL.good : p >= 50 ? FILL.ok : FILL.bad } });

export interface Submission { id: string; createdAt: Date; data: string }
interface Row { name: string; studentId: string; attempt: number; at: Date; score: number; max: number; percent: number; items: QuizItem[]; key: string }

export class NotAQuizError extends Error {}

export function gradeSubmissions(schema: any, submissions: Submission[]): { rows: Row[]; latest: Row[]; questions: Array<{ id: string; label: string; points: number }> } {
  const fields: any[] = Array.isArray(schema.fields) ? schema.fields : Array.isArray(schema.questions) ? schema.questions : [];
  const { nameField, idField } = identityFields(fields);
  const attempts = new Map<string, number>();
  const rows: Row[] = [];
  let questions: Array<{ id: string; label: string; points: number }> = [];
  for (const sub of [...submissions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    let values: Record<string, unknown> = {};
    try { values = JSON.parse(sub.data || '{}'); } catch { continue; }
    const graded = gradeQuiz(schema, values);
    if (!graded) continue;
    if (!questions.length) questions = graded.items.map((i) => ({ id: i.id, label: i.title, points: i.points }));
    const name = String((nameField && values[String(nameField.id)]) || values._respondentEmail || '').trim().slice(0, 80);
    const studentId = idField ? String(values[String(idField.id)] ?? '').trim().slice(0, 40) : '';
    const key = studentId ? `id:${fold(studentId)}` : `name:${fold(name) || sub.id}`;
    const attempt = (attempts.get(key) ?? 0) + 1; attempts.set(key, attempt);
    rows.push({ name: name || 'Unnamed', studentId, attempt, at: sub.createdAt, score: graded.score, max: graded.maxScore, percent: graded.percent, items: graded.items, key });
  }
  const last = new Map<string, Row>(); for (const r of rows) last.set(r.key, r);   // the latest attempt of each student is the one that counts
  return { rows, latest: [...last.values()], questions };
}

export async function quizWorkbook(input: { title: string; schema: any; submissions: Submission[] }): Promise<{ name: string; data: Buffer; students: number }> {
  if (!input.schema?.isQuiz) throw new NotAQuizError('This form is not a quiz.');
  const { rows, latest, questions } = gradeSubmissions(input.schema, input.submissions);
  const wb = new ExcelJS.Workbook(); wb.creator = 'Bwenge'; wb.created = new Date();

  // ---- Results
  const ws = wb.addWorksheet('Results', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  ws.columns = [
    { header: 'Registration no.', key: 'sid', width: 18 }, { header: 'Name', key: 'name', width: 28 }, { header: 'Attempt', key: 'attempt', width: 9 },
    { header: 'Submitted', key: 'at', width: 19 }, { header: 'Mark', key: 'score', width: 9 }, { header: 'Out of', key: 'max', width: 9 }, { header: 'Percent', key: 'pct', width: 10 },
    ...questions.map((q, i) => ({ header: `Q${i + 1} (${q.points}): ${q.label.slice(0, 40)}`, key: `q_${q.id}`, width: 14 })),
  ];
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name) || a.attempt - b.attempt);
  for (const r of sorted) {
    const row = ws.addRow({ sid: r.studentId, name: r.name, attempt: r.attempt, at: r.at, score: r.score, max: r.max, pct: r.percent, ...Object.fromEntries(r.items.map((i) => [`q_${i.id}`, i.earned])) });
    row.getCell('pct').fill = band(r.percent); row.getCell('pct').numFmt = '0.0'; row.getCell('at').numFmt = 'yyyy-mm-dd hh:mm';
    r.items.forEach((i) => { row.getCell(`q_${i.id}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i.correct ? FILL.good : FILL.bad } }; });
  }
  ws.getRow(1).font = { bold: true }; ws.getRow(1).alignment = { wrapText: true, vertical: 'top' };
  if (ws.rowCount > 1) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };

  // ---- Questions (the latest attempt of each student)
  const wq = wb.addWorksheet('Questions', { views: [{ state: 'frozen', ySplit: 1 }] });
  wq.columns = [{ header: '#', key: 'n', width: 5 }, { header: 'Question', key: 'q', width: 60 }, { header: 'Points', key: 'p', width: 8 }, { header: 'Answered', key: 'a', width: 10 },
    { header: 'Correct', key: 'c', width: 9 }, { header: '% correct', key: 'pc', width: 11 }, { header: 'Correct answer', key: 'ans', width: 28 }, { header: 'Most common wrong answer', key: 'wrong', width: 34 }];
  questions.forEach((q, i) => {
    const items = latest.map((r) => r.items.find((x) => x.id === q.id)).filter((x): x is QuizItem => !!x);
    const correct = items.filter((x) => x.correct).length;
    const wrong = new Map<string, number>();
    for (const x of items) if (!x.correct && text(x.given).trim()) wrong.set(text(x.given), (wrong.get(text(x.given)) ?? 0) + 1);
    const top = [...wrong.entries()].sort((a, b) => b[1] - a[1])[0];
    const pc = items.length ? round1((correct / items.length) * 100) : null;
    const row = wq.addRow({ n: i + 1, q: q.label, p: q.points, a: items.length, c: correct, pc, ans: text(items[0]?.correctAnswer), wrong: top ? `${top[0]} (${top[1]})` : '' });
    if (pc !== null) { row.getCell('pc').fill = band(pc); row.getCell('pc').numFmt = '0.0'; }
    row.getCell('q').alignment = { wrapText: true, vertical: 'top' };
  });
  wq.getRow(1).font = { bold: true };

  // ---- Summary
  const percents = latest.map((r) => r.percent).sort((a, b) => a - b);
  const median = percents.length ? (percents.length % 2 ? percents[(percents.length - 1) / 2] : (percents[percents.length / 2 - 1] + percents[percents.length / 2]) / 2) : null;
  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 34 }, { width: 28 }];
  const line = (k: string, v: string | number | null) => sum.addRow([k, v ?? '—']);
  sum.addRow([String(input.title)]).font = { bold: true, size: 14 };
  line('Students', latest.length); line('Attempts', rows.length);
  line('Class average (%)', percents.length ? round1(percents.reduce((a, b) => a + b, 0) / percents.length) : null);
  line('Median (%)', median === null ? null : round1(median));
  line('Highest (%)', percents.length ? percents[percents.length - 1] : null); line('Lowest (%)', percents.length ? percents[0] : null);
  line('Pass rate (50% or more)', percents.length ? `${round1((percents.filter((p) => p >= 50).length / percents.length) * 100)}%` : null);
  sum.addRow([]);
  sum.addRow(['Each student counts once (their latest attempt). Marks are recalculated from the current answer key. Long answers are not included: you mark those yourself.']).alignment = { wrapText: true };
  sum.mergeCells(`A${sum.rowCount}:B${sum.rowCount}`); sum.getRow(sum.rowCount).height = 48;
  sum.addRow([`Made by Bwenge on ${new Date().toISOString().slice(0, 10)}`]);

  const name = `${String(input.title).replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 80) || 'Quiz'} marks.xlsx`;
  return { name, data: Buffer.from(await wb.xlsx.writeBuffer()), students: latest.length };
}

/* ------------------------------------------------------------------ every response, for any form */
const shown = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '';
  if (Array.isArray(v)) return v.map(shown).filter(Boolean).join('; ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.name === 'string' && typeof o.url === 'string') return o.name;                 // an attached file: its name (the file itself is in the form's results)
    return Object.entries(o).map(([k, x]) => `${k}: ${shown(x)}`).join('; ');
  }
  return String(v);
};
const EXAM_COLUMNS: Array<[string, string]> = [['faceLost', 'Face left the camera (times)'], ['multipleFaces', 'More than one face (times)'], ['cameraProblems', 'Camera problems (times)'], ['tabHidden', 'Left the page (times)'], ['pauses', 'Pauses']];

/**
 * Every response to any form (a survey, a registration, a test that is not marked as a quiz) as an Excel file: one row per response with
 * the time, the name and registration number when the form asks for them, and every answer in its own column. A test taken with the
 * camera and screen rules adds how often each rule was triggered. Nothing is marked and nothing is hidden: it is the data as collected.
 */
export async function responsesWorkbook(input: { title: string; schema: any; submissions: Submission[] }): Promise<{ name: string; data: Buffer; responses: number }> {
  const fields = normalizeFields(input.schema);
  const raw: any[] = Array.isArray(input.schema?.fields) ? input.schema.fields : Array.isArray(input.schema?.questions) ? input.schema.questions : [];
  const { nameField, idField } = identityFields(raw);
  const subs = [...input.submissions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const parsed = subs.map((s) => { let v: any = {}; try { v = JSON.parse(s.data || '{}'); } catch { v = {}; } return { s, v }; });
  const examCols = EXAM_COLUMNS.filter(([k]) => parsed.some((p) => typeof p.v?._exam?.[k] === 'number'));
  const wb = new ExcelJS.Workbook(); wb.creator = 'Bwenge'; wb.created = new Date();

  const ws = wb.addWorksheet('Responses', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  const idOf = (f: { id: string }) => String(f.id);
  const identity = new Set([nameField && String(nameField.id), idField && String(idField.id)].filter(Boolean) as string[]);
  ws.columns = [
    { header: '#', key: 'n', width: 5 }, { header: 'Submitted', key: 'at', width: 19 },
    ...(nameField ? [{ header: 'Name', key: 'name', width: 26 }] : []), ...(idField ? [{ header: 'Registration no.', key: 'sid', width: 18 }] : []),
    ...fields.filter((f) => !identity.has(idOf(f))).map((f) => ({ header: f.label.slice(0, 60), key: `f_${idOf(f)}`, width: 24 })),
    ...examCols.map(([k, h]) => ({ header: h, key: `x_${k}`, width: 16 })),
  ];
  parsed.forEach(({ s, v }, i) => {
    const row = ws.addRow({
      n: i + 1, at: s.createdAt, name: nameField ? shown(v[String(nameField.id)]) : undefined, sid: idField ? shown(v[String(idField.id)]) : undefined,
      ...Object.fromEntries(fields.filter((f) => !identity.has(idOf(f))).map((f) => [`f_${idOf(f)}`, shown(v[idOf(f)])])),
      ...Object.fromEntries(examCols.map(([k]) => [`x_${k}`, typeof v?._exam?.[k] === 'number' ? v._exam[k] : ''])),
    });
    row.getCell('at').numFmt = 'yyyy-mm-dd hh:mm';
  });
  ws.getRow(1).font = { bold: true }; ws.getRow(1).alignment = { wrapText: true, vertical: 'top' };
  if (ws.rowCount > 1) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };

  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 30 }, { width: 40 }];
  sum.addRow([String(input.title)]).font = { bold: true, size: 14 };
  sum.addRow(['Responses', parsed.length]);
  if (parsed.length) { sum.addRow(['First response', subs[0].createdAt]); sum.addRow(['Last response', subs[subs.length - 1].createdAt]); }
  sum.addRow(['Questions', fields.length]);
  sum.addRow([]);
  sum.addRow(['This is every response as collected. This form is not marked as a quiz, so there are no marks; turn on "Make this a quiz" and give the questions points and answers to get marks.']);
  sum.mergeCells(`A${sum.rowCount}:B${sum.rowCount}`); sum.getCell(`A${sum.rowCount}`).alignment = { wrapText: true, vertical: 'top' }; sum.getRow(sum.rowCount).height = 48;
  sum.addRow([`Made by Bwenge on ${new Date().toISOString().slice(0, 10)}`]);

  const name = `${String(input.title).replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 80) || 'Form'} responses.xlsx`;
  return { name, data: Buffer.from(await wb.xlsx.writeBuffer()), responses: parsed.length };
}
