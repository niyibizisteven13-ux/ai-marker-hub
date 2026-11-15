import ExcelJS from 'exceljs';
import { gradeQuiz, type QuizItem } from './quiz.js';
import { identityFields } from '../gradebook.js';

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
