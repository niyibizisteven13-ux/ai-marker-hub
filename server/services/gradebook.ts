import ExcelJS from 'exceljs';
import { prisma } from '../db.js';
import { OwnedRecordStore, type OwnedRecord } from './storage/ownedRecordStore.js';
import { assignmentService } from './assignments/runtime.js';
import { LearnError } from './learning/practice.js';

/**
 * A class gradebook: one row per student, one column per task or quiz the teacher adds to it, each cell the
 * student's percentage (automatically marked tasks and quiz forms), with averages, and an Excel copy. Students are
 * matched across columns by their ID when they gave one, otherwise by name (ignoring case, spaces and accents).
 * Practice stays anonymous by design (class dashboard), so it is not broken down per student here.
 */

export interface GradebookItem { kind: 'task' | 'quiz'; id: string }
interface GradebookRecord extends OwnedRecord { classId: string; items: GradebookItem[] }

export interface Cell { percent: number | null; label: string; state: 'marked' | 'submitted' | 'missing' }
export interface Gradebook {
  class: { id: string; name: string };
  columns: Array<{ key: string; kind: 'task' | 'quiz'; id: string; title: string; average: number | null; count: number }>;
  students: Array<{ key: string; name: string; studentId: string | null; cells: Record<string, Cell>; average: number | null }>;
  available: { tasks: Array<{ id: string; title: string; autoMark: boolean }>; quizzes: Array<{ id: string; title: string }> };
}

const db = prisma as any;
let store: OwnedRecordStore<GradebookRecord> | null = null;
const records = () => (store ??= new OwnedRecordStore<GradebookRecord>(process.env.GRADEBOOKS_DIR ?? './data/gradebooks', 5 * 365 * 24 * 60 * 60 * 1000));
/** Tests use a temporary folder. */
export function setGradebookStore(s: OwnedRecordStore<GradebookRecord> | null) { store = s; }

const fold = (v: string) => v.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const NAME_FIELD = /\b(full\s*name|name|names|student|izina|amazina|nom|pr[ée]nom)\b/i;
const ID_FIELD = /\b(student\s*id|reg(istration)?\s*(no|number)?|index\s*(no|number)|matricule|id)\b/i;

async function ownedClass(ownerId: string, classId: string) {
  const cls = await db.classroom.findFirst({ where: { id: classId, ownerId } });
  if (!cls) throw new LearnError('NOT_FOUND', 'Class not found.');
  return cls;
}

function quizForms(rows: any[]) {
  return rows.map((f) => { let s: any = {}; try { s = JSON.parse(f.schema || '{}'); } catch { s = {}; } return { f, s }; }).filter(({ s }) => s.isQuiz);
}

export async function setGradebookItems(ownerId: string, classId: string, items: GradebookItem[]) {
  await ownedClass(ownerId, classId);
  const clean = items.filter((i) => (i.kind === 'task' || i.kind === 'quiz') && typeof i.id === 'string' && /^[\w-]{1,64}$/.test(i.id)).slice(0, 60);
  const unique = clean.filter((i, n) => clean.findIndex((j) => j.kind === i.kind && j.id === i.id) === n);
  await records().put(classId, ownerId, { classId, items: unique });
  return buildGradebook(ownerId, classId);
}

export async function buildGradebook(ownerId: string, classId: string): Promise<Gradebook> {
  const cls = await ownedClass(ownerId, classId);
  const rec = await records().get(classId, ownerId);
  const items = rec?.items ?? [];
  const tasks = await assignmentService().list(ownerId).catch(() => [] as any[]);
  const forms = quizForms(await db.applicationForm.findMany({ where: { userId: ownerId }, orderBy: { updatedAt: 'desc' }, take: 200 }).catch(() => []));
  const students = new Map<string, { key: string; name: string; studentId: string | null; cells: Record<string, Cell> }>();
  const row = (name: string, studentId?: string | null) => {
    const key = studentId ? `id:${fold(studentId)}` : `name:${fold(name)}`;
    // A student who gave an ID once is matched by name too, so other columns without the ID join the same row.
    const byName = !studentId ? [...students.values()].find((r) => fold(r.name) === fold(name)) : undefined;
    const hit = students.get(key) ?? byName;
    if (hit) { if (studentId && !hit.studentId) hit.studentId = studentId; return hit; }
    const r = { key, name: name.trim() || 'Unnamed', studentId: studentId ?? null, cells: {} };
    students.set(key, r);
    return r;
  };
  const columns: Gradebook['columns'] = [];

  for (const item of items) {
    const key = `${item.kind}:${item.id}`;
    if (item.kind === 'task') {
      const a = await assignmentService().get(ownerId, item.id).catch(() => null);
      if (!a) continue;
      for (const s of a.submissions as any[]) {
        const m = s.marking;
        const marked = m && (m.state === 'marked' || m.state === 'needs_review') && typeof m.percent === 'number';
        row(s.studentName, s.studentId).cells[key] = marked ? { percent: round1(m.percent), label: `${m.total}/${m.maxTotal}`, state: 'marked' } : { percent: null, label: 'Handed in', state: 'submitted' };
      }
      columns.push({ key, kind: 'task', id: item.id, title: a.title, average: null, count: 0 });
    } else {
      const hit = forms.find(({ f }) => f.id === item.id);
      if (!hit) continue;
      const fields: any[] = Array.isArray(hit.s.fields) ? hit.s.fields : Array.isArray(hit.s.questions) ? hit.s.questions : [];
      const nameField = fields.find((q) => NAME_FIELD.test(String(q.label ?? q.title ?? '')) && !ID_FIELD.test(String(q.label ?? q.title ?? '')));
      const idField = fields.find((q) => ID_FIELD.test(String(q.label ?? q.title ?? '')) && !NAME_FIELD.test(String(q.label ?? q.title ?? '').replace(/student/i, '')));
      const subs = await db.formSubmission.findMany({ where: { formId: item.id }, orderBy: { createdAt: 'asc' } }).catch(() => []);
      for (const sub of subs) {
        let data: any = {};
        try { data = JSON.parse(sub.data || '{}'); } catch { continue; }
        const q = data._quiz;
        if (!q) continue;
        const name = String((nameField && data[String(nameField.id)]) || data._respondentEmail || '').slice(0, 80);
        if (!name) continue;
        const sid = idField ? String(data[String(idField.id)] ?? '').trim().slice(0, 40) || null : null;
        // The latest attempt counts (responses are in time order).
        row(name, sid).cells[key] = { percent: round1(q.percent), label: `${q.score}/${q.maxScore}`, state: 'marked' };
      }
      columns.push({ key, kind: 'quiz', id: item.id, title: String(hit.s.title || hit.f.title || 'Quiz'), average: null, count: 0 });
    }
  }

  const list = [...students.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const c of columns) {
    const vals = list.map((s) => s.cells[c.key]?.percent).filter((v): v is number => typeof v === 'number');
    c.average = mean(vals); c.count = vals.length;
  }
  return {
    class: { id: cls.id, name: cls.name },
    columns,
    students: list.map((s) => {
      for (const c of columns) s.cells[c.key] ??= { percent: null, label: '', state: 'missing' };
      return { ...s, average: mean(columns.map((c) => s.cells[c.key].percent).filter((v): v is number => typeof v === 'number')) };
    }),
    available: {
      tasks: tasks.map((t: any) => ({ id: t.id, title: t.title, autoMark: !!t.autoMark })),
      quizzes: forms.map(({ f, s }) => ({ id: f.id, title: String(s.title || f.title || 'Quiz') })),
    },
  };
}

/** The gradebook as an Excel workbook: marks, averages, colour bands and a frozen header. */
export async function gradebookWorkbook(ownerId: string, classId: string): Promise<{ name: string; data: Buffer }> {
  const g = await buildGradebook(ownerId, classId);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Bwenge';
  const ws = wb.addWorksheet('Gradebook', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  ws.columns = [{ header: 'Student', key: 'name', width: 28 }, { header: 'ID', key: 'sid', width: 14 }, ...g.columns.map((c) => ({ header: `${c.title} (%)`, key: c.key, width: Math.min(36, Math.max(14, c.title.length + 6)) })), { header: 'Average (%)', key: 'avg', width: 14 }];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A68' } };
  for (const s of g.students) {
    const r = ws.addRow({ name: s.name, sid: s.studentId ?? '', ...Object.fromEntries(g.columns.map((c) => [c.key, s.cells[c.key].percent ?? (s.cells[c.key].state === 'submitted' ? 'handed in' : '')])), avg: s.average ?? '' });
    r.eachCell((cell, col) => {
      if (col <= 2 || typeof cell.value !== 'number') return;
      const v = cell.value;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: v >= 80 ? 'FFD1FAE5' : v >= 50 ? 'FFFEF3C7' : 'FFFEE2E2' } };
    });
  }
  const avg = ws.addRow({ name: 'Class average', sid: '', ...Object.fromEntries(g.columns.map((c) => [c.key, c.average ?? ''])), avg: mean(g.students.map((s) => s.average).filter((v): v is number => typeof v === 'number')) ?? '' });
  avg.font = { bold: true };
  avg.border = { top: { style: 'thin' } };
  const safe = g.class.name.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'class';
  return { name: `${safe} gradebook.xlsx`, data: Buffer.from(await wb.xlsx.writeBuffer()) };
}
