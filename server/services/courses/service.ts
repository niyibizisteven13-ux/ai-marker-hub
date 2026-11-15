import ExcelJS from 'exceljs';
import type { OwnedRecord, OwnedRecordStore } from '../storage/ownedRecordStore.js';

/**
 * Courses: a lecturer's named class for a term (for example "MATH 101, 2026 semester 1"). It holds the roster
 * (registration number, name, email), each student's accommodations, and the tasks and quizzes that belong to it.
 * The dashboard puts them together: who handed in what, marks, who is missing work, flagged responses, who needs
 * attention. Students are matched by registration number only (names are typed in different ways).
 *
 * Accommodations are stored here and read by exams: extra time, no camera (another way of invigilating), breaks,
 * large text, voice answers. They are personal data about a student: only the owner of the course can see them.
 */

export interface Accommodation {
  /** Extra time in tests, in percent of the test's time (0, 25, 50, 100…). */
  extraTimePercent: number;
  /** The student sits the test without the camera check; the lecturer or an invigilator watches another way. */
  cameraExempt: boolean;
  /** May pause the test for a break (the clock stops). */
  breaks: boolean;
  largeText: boolean;
  /** May answer typed questions by voice (a recording) or with a scribe. */
  voiceAnswers: boolean;
  note?: string;
}
export const NO_ACCOMMODATION: Accommodation = { extraTimePercent: 0, cameraExempt: false, breaks: false, largeText: false, voiceAnswers: false };

export interface CourseStudent { id: string; name: string; email?: string; status: 'active' | 'withdrawn'; accommodations: Accommodation }
export interface CourseItem { kind: 'task' | 'quiz'; id: string }
export interface CourseRecord extends OwnedRecord { name: string; code?: string; term?: string; roster: CourseStudent[]; items: CourseItem[] }

export class CourseError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export const COURSE_LIMITS = { students: 1000, items: 60, name: 120, note: 300 };
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '');
const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const ID_RE = /^[\w.\/-]{1,40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEADER_RE = /^(reg(istration)?|student|id|no|number)\b/i;

/** One student per line: "registration number, name[, email]" (comma, semicolon or tab). Header and bad lines are skipped. */
export function parseStudents(input: unknown): CourseStudent[] {
  if (typeof input !== 'string') return [];
  const out: CourseStudent[] = [];
  const seen = new Set<string>();
  for (const raw of input.split(/\r?\n/)) {
    const parts = raw.split(/[,;\t]/).map((x) => clean(x.replace(/^"|"$/g, ''), 120)).filter(Boolean);
    if (parts.length < 2) continue;
    const [id, ...rest] = parts;
    if (!ID_RE.test(id)) continue;
    const email = rest.find((x) => EMAIL_RE.test(x));
    const name = rest.filter((x) => x !== email).join(' ').slice(0, 80);
    if (!name || (out.length === 0 && HEADER_RE.test(id) && /name/i.test(name))) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, name, ...(email ? { email: email.toLowerCase() } : {}), status: 'active', accommodations: { ...NO_ACCOMMODATION } });
    if (out.length >= COURSE_LIMITS.students) break;
  }
  return out;
}

export function normalizeAccommodations(input: unknown, base: Accommodation = NO_ACCOMMODATION): Accommodation {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const extra = typeof o.extraTimePercent === 'number' && Number.isFinite(o.extraTimePercent) ? Math.max(0, Math.min(200, Math.round(o.extraTimePercent))) : base.extraTimePercent;
  const note = 'note' in o ? clean(o.note, COURSE_LIMITS.note) : base.note;
  return {
    extraTimePercent: extra,
    cameraExempt: typeof o.cameraExempt === 'boolean' ? o.cameraExempt : base.cameraExempt,
    breaks: typeof o.breaks === 'boolean' ? o.breaks : base.breaks,
    largeText: typeof o.largeText === 'boolean' ? o.largeText : base.largeText,
    voiceAnswers: typeof o.voiceAnswers === 'boolean' ? o.voiceAnswers : base.voiceAnswers,
    ...(note ? { note } : {}),
  };
}
export const hasAccommodation = (a: Accommodation) => a.extraTimePercent > 0 || a.cameraExempt || a.breaks || a.largeText || a.voiceAnswers;

/** What the dashboard reads from tasks and quizzes (the real ones come from the task and form services; tests pass fakes). */
export interface CourseSources {
  task(ownerId: string, id: string): Promise<null | { title: string; dueAt: string | null; submissions: Array<{ studentId?: string; submittedAt: string; late: boolean; marking?: { state: string; total: number | null; maxTotal: number | null; percent: number | null } }> }>;
  quiz(ownerId: string, id: string): Promise<null | { title: string; attempts: Array<{ studentId: string | null; submittedAt: string; percent: number | null; score: number | null; maxScore: number | null; flags: number }> }>;
  available(ownerId: string): Promise<{ tasks: Array<{ id: string; title: string }>; quizzes: Array<{ id: string; title: string }> }>;
}

export type CellState = 'marked' | 'submitted' | 'missing';
export interface Cell { state: CellState; percent: number | null; label: string; late?: boolean; flags?: number }
export type Risk = 'ok' | 'watch' | 'attention';

export function createCourseService(deps: { store: OwnedRecordStore<CourseRecord>; sources: CourseSources }) {
  async function load(ownerId: string, id: string) {
    const c = await deps.store.get(id, ownerId);
    if (!c) throw new CourseError('NOT_FOUND', 'Course not found.', 404);
    return c;
  }
  const row = (c: CourseRecord) => ({ id: c.id, name: c.name, code: c.code ?? '', term: c.term ?? '', students: c.roster.filter((s) => s.status === 'active').length, items: c.items.length, updatedAt: c.updatedAt });

  return {
    async create(ownerId: string, input: { name?: unknown; code?: unknown; term?: unknown; roster?: unknown }) {
      const name = clean(input.name, COURSE_LIMITS.name);
      if (!name) throw new CourseError('NAME_REQUIRED', 'Give the course a name.');
      const c = await deps.store.create(ownerId, { name, code: clean(input.code, 30) || undefined, term: clean(input.term, 40) || undefined, roster: parseStudents(input.roster), items: [] });
      return row(c);
    },

    async list(ownerId: string) { return (await deps.store.list(ownerId, 200)).map(row); },

    async update(ownerId: string, id: string, patch: { name?: unknown; code?: unknown; term?: unknown }) {
      await load(ownerId, id);
      const c = await deps.store.update(id, ownerId, (r) => {
        const n = clean(patch.name, COURSE_LIMITS.name); if (n) r.name = n;
        if (typeof patch.code === 'string') r.code = clean(patch.code, 30) || undefined;
        if (typeof patch.term === 'string') r.term = clean(patch.term, 40) || undefined;
      });
      return row(c!);
    },

    async remove(ownerId: string, id: string) { await load(ownerId, id); await deps.store.delete(id, ownerId); },

    /** Adds students from pasted text. A listed id that already exists gets its name and email updated; accommodations are kept. */
    async addStudents(ownerId: string, id: string, text: unknown) {
      await load(ownerId, id);
      const incoming = parseStudents(text);
      if (!incoming.length) throw new CourseError('NO_STUDENTS', 'No students found. Use one line per student: registration number, name.');
      let added = 0, updated = 0;
      await deps.store.update(id, ownerId, (r) => {
        for (const s of incoming) {
          const have = r.roster.find((x) => x.id.toLowerCase() === s.id.toLowerCase());
          if (have) { have.name = s.name; if (s.email) have.email = s.email; have.status = 'active'; updated++; }
          else if (r.roster.length < COURSE_LIMITS.students) { r.roster.push(s); added++; }
        }
      });
      return { added, updated };
    },

    async updateStudent(ownerId: string, id: string, studentId: string, patch: { name?: unknown; email?: unknown; status?: unknown; accommodations?: unknown }) {
      await load(ownerId, id);
      let found = false;
      await deps.store.update(id, ownerId, (r) => {
        const s = r.roster.find((x) => x.id.toLowerCase() === studentId.toLowerCase());
        if (!s) return;
        found = true;
        const n = clean(patch.name, 80); if (n) s.name = n;
        if (patch.email === '') delete s.email; else if (typeof patch.email === 'string' && EMAIL_RE.test(patch.email.trim())) s.email = patch.email.trim().toLowerCase();
        if (patch.status === 'active' || patch.status === 'withdrawn') s.status = patch.status;
        if (patch.accommodations !== undefined) s.accommodations = normalizeAccommodations(patch.accommodations, s.accommodations);
      });
      if (!found) throw new CourseError('NOT_FOUND', 'That student is not on this course.', 404);
    },

    async removeStudent(ownerId: string, id: string, studentId: string) {
      await load(ownerId, id);
      await deps.store.update(id, ownerId, (r) => { r.roster = r.roster.filter((x) => x.id.toLowerCase() !== studentId.toLowerCase()); });
    },

    async setItems(ownerId: string, id: string, items: unknown) {
      await load(ownerId, id);
      const list = (Array.isArray(items) ? items : []).filter((i): i is CourseItem => !!i && (i.kind === 'task' || i.kind === 'quiz') && typeof i.id === 'string' && /^[\w-]{1,64}$/.test(i.id));
      const unique = list.filter((i, n) => list.findIndex((j) => j.kind === i.kind && j.id === i.id) === n).slice(0, COURSE_LIMITS.items);
      await deps.store.update(id, ownerId, (r) => { r.items = unique; });
    },

    /** The accommodations of one student, for exams (the owner of the course only). */
    async accommodationsFor(ownerId: string, id: string, studentId: string): Promise<{ name: string; accommodations: Accommodation } | null> {
      const c = await load(ownerId, id);
      const s = c.roster.find((x) => x.id.toLowerCase() === studentId.toLowerCase() && x.status === 'active');
      return s ? { name: s.name, accommodations: s.accommodations } : null;
    },

    async dashboard(ownerId: string, id: string) {
      const c = await load(ownerId, id);
      const available = await deps.sources.available(ownerId).catch(() => ({ tasks: [], quizzes: [] }));
      const byId = new Map(c.roster.map((s) => [s.id.toLowerCase(), s]));
      const cells = new Map<string, Record<string, Cell>>(c.roster.map((s) => [s.id.toLowerCase(), {}]));
      const columns: Array<{ key: string; kind: 'task' | 'quiz'; id: string; title: string; dueAt: string | null; average: number | null; submitted: number; flagged: number }> = [];
      const unmatched = new Set<string>();

      for (const item of c.items) {
        const key = `${item.kind}:${item.id}`;
        let col: (typeof columns)[number] | null = null;
        if (item.kind === 'task') {
          const t = await deps.sources.task(ownerId, item.id).catch(() => null);
          if (!t) continue;
          col = { key, kind: 'task', id: item.id, title: t.title, dueAt: t.dueAt, average: null, submitted: 0, flagged: 0 };
          for (const s of t.submissions) {
            const sid = (s.studentId ?? '').toLowerCase();
            const mine = cells.get(sid);
            if (!mine) { if (sid) unmatched.add(sid); continue; }
            const m = s.marking;
            const marked = m && (m.state === 'marked' || m.state === 'needs_review') && typeof m.percent === 'number';
            mine[key] = marked ? { state: 'marked', percent: round1(m!.percent!), label: `${m!.total}/${m!.maxTotal}`, late: s.late } : { state: 'submitted', percent: null, label: 'Handed in', late: s.late };
          }
        } else {
          const q = await deps.sources.quiz(ownerId, item.id).catch(() => null);
          if (!q) continue;
          col = { key, kind: 'quiz', id: item.id, title: q.title, dueAt: null, average: null, submitted: 0, flagged: 0 };
          // Responses come oldest first: the latest attempt counts.
          for (const a of q.attempts) {
            const sid = (a.studentId ?? '').toLowerCase();
            const mine = cells.get(sid);
            if (!mine) { if (sid) unmatched.add(sid); continue; }
            mine[key] = a.percent !== null ? { state: 'marked', percent: round1(a.percent), label: `${a.score}/${a.maxScore}`, flags: a.flags || undefined } : { state: 'submitted', percent: null, label: 'Handed in', flags: a.flags || undefined };
          }
        }
        columns.push(col);
      }

      const students = c.roster.map((s) => {
        const mine = cells.get(s.id.toLowerCase())!;
        for (const col of columns) mine[col.key] ??= { state: 'missing', percent: null, label: '' };
        const percents = columns.map((col) => mine[col.key].percent).filter((v): v is number => typeof v === 'number');
        const average = mean(percents);
        const missing = s.status === 'active' ? columns.filter((col) => mine[col.key].state === 'missing').length : 0;
        const flagged = columns.reduce((n, col) => n + (mine[col.key].flags ? 1 : 0), 0);
        const late = columns.reduce((n, col) => n + (mine[col.key].late ? 1 : 0), 0);
        // Needs attention: marks are low, or half or more of the work is missing. Worth watching: some work missing, flagged or late.
        const risk: Risk = s.status !== 'active' ? 'ok'
          : (average !== null && percents.length >= 2 && average < 40) || (columns.length >= 2 && missing * 2 >= columns.length) ? 'attention'
            : missing > 0 || flagged > 0 || late > 0 ? 'watch' : 'ok';
        return { id: s.id, name: s.name, email: s.email ?? '', status: s.status, accommodations: s.accommodations, hasAccommodation: hasAccommodation(s.accommodations), cells: mine, average, missing, flagged, late, risk };
      }).sort((a, b) => a.name.localeCompare(b.name));

      const active = students.filter((s) => s.status === 'active');
      for (const col of columns) {
        const here = active.map((s) => s.cells[col.key]);
        col.average = mean(here.map((x) => x.percent).filter((v): v is number => typeof v === 'number'));
        col.submitted = here.filter((x) => x.state !== 'missing').length;
        col.flagged = here.filter((x) => x.flags).length;
      }
      return {
        course: { id: c.id, name: c.name, code: c.code ?? '', term: c.term ?? '' },
        columns, students,
        totals: {
          students: active.length, withAccommodations: active.filter((s) => s.hasAccommodation).length,
          needAttention: active.filter((s) => s.risk === 'attention').length, flaggedResponses: columns.reduce((n, col) => n + col.flagged, 0),
          average: mean(active.map((s) => s.average).filter((v): v is number => typeof v === 'number')),
        },
        /** Hand-ins whose registration number is not on the roster (a typo, or a student who is not in this course). */
        unmatched: [...unmatched],
        available,
      };
    },

    async exportWorkbook(ownerId: string, id: string): Promise<{ name: string; data: Buffer }> {
      const d = await this.dashboard(ownerId, id);
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Bwenge';
      const ws = wb.addWorksheet('Course', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
      ws.columns = [
        { header: 'Registration no.', key: 'id', width: 18 }, { header: 'Name', key: 'name', width: 30 },
        ...d.columns.map((c) => ({ header: `${c.title} (%)`, key: c.key, width: Math.min(36, Math.max(14, c.title.length + 6)) })),
        { header: 'Average (%)', key: 'avg', width: 14 }, { header: 'Missing', key: 'missing', width: 10 }, { header: 'Status', key: 'status', width: 16 },
      ];
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A68' } };
      for (const s of d.students) {
        const r = ws.addRow({
          id: s.id, name: s.name,
          ...Object.fromEntries(d.columns.map((c) => [c.key, s.cells[c.key].percent ?? (s.cells[c.key].state === 'submitted' ? 'handed in' : s.status === 'active' ? 'missing' : '')])),
          avg: s.average ?? '', missing: s.missing, status: s.status === 'withdrawn' ? 'Withdrawn' : s.risk === 'attention' ? 'Needs attention' : s.risk === 'watch' ? 'Watch' : 'OK',
        });
        r.eachCell((cell, col) => {
          if (col <= 2 || typeof cell.value !== 'number') return;
          const v = cell.value;
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: v >= 80 ? 'FFD1FAE5' : v >= 50 ? 'FFFEF3C7' : 'FFFEE2E2' } };
        });
      }
      // The sheet leaves out accommodations on purpose: it is shared with other staff and students.
      const safe = d.course.name.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'course';
      return { name: `${safe} marks.xlsx`, data: Buffer.from(await wb.xlsx.writeBuffer()) };
    },
  };
}
export type CourseService = ReturnType<typeof createCourseService>;
