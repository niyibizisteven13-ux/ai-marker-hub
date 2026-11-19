import { randomBytes, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import ExcelJS from 'exceljs';
import type { OwnedRecord, OwnedRecordStore } from '../storage/ownedRecordStore.js';
import type { MarkStatus, TaskMarker } from './autoMark.js';
import { imagesToPdf, typedToPdf } from '../exams/inputs.js';
import { needsScanRecognition, SCANNED_PAPER_MESSAGE } from '../exams/scanPolicy.js';
import { CODE_EXT, SHEET_EXT, SLIDE_EXT, VIDEO_EXT, fileToPdf, looksTextual, mergePdfs } from './handIn.js';
import JSZip from 'jszip';
import { gradeCode, normalizeCodeTests, redactForStudent, type CodeResult, type CodeTestConfig } from '../codeRunner/grade.js';
import { LANGUAGES } from '../codeRunner/languages.js';
import { SKIP_DIRS } from '../../../shared/handInTypes.js';
import type { CodeRunner } from '../codeRunner/types.js';

/**
 * Assignments: a teacher sets a task (instructions and/or files), shares one link, and students hand in their
 * answers there without an account, in any format (photos, PDF, Word, text, or typed in the page). The teacher
 * sees every submission in the class dashboard and, when they want, hands all of them to the marker: each
 * student's work becomes one PDF named by their id, plus a students list so the results carry their names.
 */

export interface StoredFile { id: string; name: string; mime: string; size: number }

export interface AssignmentSubmission {
  id: string;
  studentName: string;
  studentId?: string;
  files: StoredFile[];
  text?: string;
  submittedAt: string;
  late: boolean;
  /** Times this student handed in before (the latest hand-in replaces the earlier one). */
  resubmissions: number;
  /** Private link key for the student's result page (kept across resubmissions). */
  resultToken?: string;
  /** Automatic marking: the script in the task's examination, or why it could not be added. */
  examSubmissionId?: string;
  markError?: string;
  /** The result of running the lecturer's tests on this hand-in (tasks with code tests). */
  codeResult?: CodeResult;
  codeRunning?: boolean;
}

export interface AssignmentRecord extends OwnedRecord {
  title: string;
  instructions: string;
  taskFiles: StoredFile[];
  dueAt: string | null;
  open: boolean;
  token: string;
  submissions: AssignmentSubmission[];
  /** Mark each hand-in as soon as it arrives, with the marking scheme below. */
  autoMark?: boolean;
  schemeFiles?: StoredFile[];
  /** The examination that holds this task's marked scripts (created with the first automatic marking). */
  examId?: string;
  /** Tests that run each handed-in program (language, inputs and expected outputs, points). */
  codeTests?: CodeTestConfig;
  /** The class list (registration number and name). When set, only these students can hand in, under their own name. */
  roster?: RosterEntry[];
  /** Refuse hand-ins after the due date instead of marking them late. */
  hardDeadline?: boolean;
  /** Students must hand in from inside the MySEB app (or its Chrome extension). */
  requireMyseb?: boolean;
  /** The matching exam on the MySEB server, created when the lecturer first asks for a code. */
  mysebExamId?: string;
}

export interface RosterEntry { id: string; name: string }

/** Where files live: the same uploads the chat uses, so prepared files can be marked from the chat as they are. */
export interface AssignmentFiles {
  save(userId: string, name: string, mime: string, data: Buffer): Promise<StoredFile>;
  read(userId: string, id: string): Promise<{ data: Buffer; name: string; mime: string }>;
  /** Deletes a file that is no longer used (a replaced or removed hand-in), so it stops counting as storage. */
  remove?(userId: string, id: string): Promise<void>;
}

export class AssignmentError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export const LIMITS = { files: 10, fileBytes: 25 * 1024 * 1024, text: 20_000, name: 80, title: 160, instructions: 8_000, submissions: 300, roster: 1000 };

/** What students may hand in: photos (phone and scanner formats), PDF, Word and other text documents, voice recordings. */
const ACCEPT = new RegExp(`\\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?|pdf|docx?|odt|rtf|txt|md|webm|ogg|oga|m4a|mp3|wav|aac|zip|${[...SHEET_EXT, ...SLIDE_EXT, ...VIDEO_EXT, ...CODE_EXT].join('|')})$`, 'i');
/** Voice recordings: heard by the teacher in the dashboard; not part of the PDF the AI marks. */
const AUDIO = /\.(webm|ogg|oga|m4a|mp3|wav|aac)$/i;
const IMAGE = /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i;
const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heic', gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text', rtf: 'application/rtf', txt: 'text/plain', md: 'text/markdown',
  zip: 'application/zip', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', ipynb: 'application/json', xml: 'application/xml', html: 'text/html', htm: 'text/html',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime',
  webm: 'audio/webm', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac',
};
const ext = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '');
const now = () => new Date().toISOString();

/** The file's first bytes must match what its name says (a ".pdf" must be a PDF, a ".jpg" a JPEG, and so on). */
export function looksLike(name: string, data: Buffer): boolean {
  const e = ext(name);
  const head = data.subarray(0, 12);
  const str = head.toString('latin1');
  if (e === 'pdf') return str.startsWith('%PDF-');
  if (e === 'jpg' || e === 'jpeg') return head[0] === 0xff && head[1] === 0xd8;
  if (e === 'png') return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (e === 'gif') return str.startsWith('GIF8');
  if (e === 'webp') return str.startsWith('RIFF') && str.slice(8, 12) === 'WEBP';
  if (e === 'heic' || e === 'heif') return str.slice(4, 8) === 'ftyp';
  if (e === 'bmp') return str.startsWith('BM');
  if (e === 'tif' || e === 'tiff') return str.startsWith('II*') || str.startsWith('MM\u0000*');
  if (e === 'docx' || e === 'odt' || e === 'xlsx' || e === 'xlsm' || e === 'pptx' || e === 'zip') return str.startsWith('PK\u0003\u0004');
  if (e === 'mp4' || e === 'm4v' || e === 'mov') return str.slice(4, 8) === 'ftyp' || str.slice(4, 8) === 'moov' || str.slice(4, 8) === 'wide' || str.slice(4, 8) === 'free';
  if (e === 'doc') return head[0] === 0xd0 && head[1] === 0xcf;
  if (e === 'webm') return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  if (e === 'ogg' || e === 'oga') return str.startsWith('OggS');
  if (e === 'wav') return str.startsWith('RIFF') && str.slice(8, 12) === 'WAVE';
  if (e === 'm4a') return str.slice(4, 8) === 'ftyp';
  if (e === 'mp3') return str.startsWith('ID3') || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
  if (e === 'aac') return head[0] === 0xff && (head[1] & 0xf0) === 0xf0;
  return looksTextual(data); // text, code and CSV: no binary bytes
}

/**
 * A class list pasted or exported from a spreadsheet: one student per line, "registration number, name"
 * (comma, semicolon or tab). A first line that looks like a header is skipped. Duplicate ids keep the first.
 */
export function parseRoster(input: unknown): RosterEntry[] {
  if (typeof input !== 'string') return [];
  const out: RosterEntry[] = [];
  const seen = new Set<string>();
  for (const raw of input.split(/\r?\n/)) {
    const parts = raw.split(/[,;\t]/).map((x) => clean(x.replace(/^"|"$/g, ''), LIMITS.name)).filter(Boolean);
    if (parts.length < 2) continue;
    const [id, ...rest] = parts;
    if (!/^[\w.\/-]{1,40}$/.test(id) || /^(reg(istration)?|id|student)\b/i.test(id) && out.length === 0 && /name/i.test(rest.join(' '))) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, name: rest.join(' ') });
    if (out.length >= LIMITS.roster) break;
  }
  return out;
}

/** A candidate id the marker accepts: the student's own id when usable, otherwise S001, S002, … */
const ID_OK = /^[\w.-]{1,40}$/;

export function createAssignmentService(deps: {
  store: OwnedRecordStore<AssignmentRecord>; files: AssignmentFiles; tokenDir: string; baseUrl?: () => string;
  /** Throws when the owner's plan has no room for this many more bytes (storage is sold with the plans). */
  ensureStorage?: (ownerId: string, bytes: number, forOthers: boolean) => Promise<void>;
  /** Marks hand-ins as they arrive (tasks with automatic marking) and serves students their released results. */
  marker?: TaskMarker;
  /** The runner that runs students' programs (Docker); null when this server has none. */
  codeRunner?: () => Promise<{ runner: CodeRunner | null; reason: string }>;
}) {
  // At most two programs run at a time, so a class handing in together cannot overload the server.
  let running = 0;
  const waiting: Array<() => void> = [];
  const drop = async (ownerId: string, files: StoredFile[]) => {
    for (const f of files) await deps.files.remove?.(ownerId, f.id).catch(() => undefined);
  };
  const tokenFile = (token: string) => {
    if (!/^[\w-]{16,40}$/.test(token)) throw new AssignmentError('NOT_FOUND', 'This task link is not valid.', 404);
    return path.join(path.resolve(deps.tokenDir), `${token}.json`);
  };
  const linkOf = (token: string) => `${(deps.baseUrl?.() ?? '').replace(/\/$/, '')}/a/${token}`;
  const resultLinkOf = (token: string, resultToken: string) => `${linkOf(token)}/result/${resultToken}`;

  async function load(ownerId: string, id: string) {
    const a = await deps.store.get(id, ownerId);
    if (!a) throw new AssignmentError('NOT_FOUND', 'Task not found.', 404);
    return a;
  }

  async function byToken(token: string): Promise<AssignmentRecord> {
    let ref: { id: string; ownerId: string };
    try { ref = JSON.parse(await fs.readFile(tokenFile(token), 'utf8')); } catch (e) { if (e instanceof AssignmentError) throw e; throw new AssignmentError('NOT_FOUND', 'This task link is not valid.', 404); }
    const a = await deps.store.get(ref.id, ref.ownerId);
    if (!a || a.token !== token) throw new AssignmentError('NOT_FOUND', 'This task is no longer available.', 404);
    return a;
  }

  /** Students on the class list who have not handed in yet. */
  const notSubmitted = (a: AssignmentRecord): RosterEntry[] => {
    const done = new Set(a.submissions.map((x) => (x.studentId ?? '').toLowerCase()).filter(Boolean));
    return (a.roster ?? []).filter((r) => !done.has(r.id.toLowerCase()));
  };

  /** Teacher view: everything, with counts the dashboard shows at a glance. */
  const view = (a: AssignmentRecord) => ({
    id: a.id, title: a.title, instructions: a.instructions, taskFiles: a.taskFiles, dueAt: a.dueAt, open: a.open,
    link: linkOf(a.token), createdAt: a.createdAt, updatedAt: a.updatedAt,
    autoMark: !!a.autoMark, schemeFiles: a.schemeFiles ?? [], examId: a.examId ?? null, codeTests: a.codeTests ?? null,
    roster: a.roster ?? [], hardDeadline: !!a.hardDeadline, requireMyseb: !!a.requireMyseb, notSubmitted: notSubmitted(a),
    submissions: [...a.submissions].sort((x, y) => y.submittedAt.localeCompare(x.submittedAt)).map(({ resultToken, ...x }) => ({ ...x, receiptCode: x.id.slice(0, 8).toUpperCase(), ...(resultToken ? { resultLink: resultLinkOf(a.token, resultToken) } : {}) })),
    counts: { submitted: a.submissions.length, late: a.submissions.filter((s) => s.late).length },
  });

  async function storeUploads(ownerId: string, uploads: Array<{ name: string; data: Buffer }>, max = LIMITS.files, forOthers = false): Promise<StoredFile[]> {
    if (uploads.length > max) throw new AssignmentError('TOO_MANY_FILES', `At most ${max} files.`);
    const bytes = uploads.reduce((a, u) => a + u.data.length, 0);
    if (bytes) await deps.ensureStorage?.(ownerId, bytes, forOthers);
    const out: StoredFile[] = [];
    for (const u of uploads) {
      const name = clean(u.name, 120).replace(/[\\/]/g, '_') || 'file';
      if (!ACCEPT.test(name)) throw new AssignmentError('UNSUPPORTED', `${name}: send photos, PDF, Word or text files.`);
      if (!u.data.length) throw new AssignmentError('EMPTY', `${name} is empty.`);
      if (u.data.length > LIMITS.fileBytes) throw new AssignmentError('TOO_LARGE', `${name} is larger than ${LIMITS.fileBytes / 1048576} MB.`, 413);
      if (!looksLike(name, u.data)) throw new AssignmentError('MISMATCH', `${name} does not match its file type.`);
      out.push(await deps.files.save(ownerId, name, MIME[ext(name)] ?? (CODE_EXT.includes(ext(name)) ? 'text/plain' : 'application/octet-stream'), u.data));
    }
    return out;
  }

  return {
    linkOf,

    async create(ownerId: string, input: { title?: unknown; instructions?: unknown; dueAt?: unknown; files?: Array<{ name: string; data: Buffer }>; autoMark?: unknown; scheme?: Array<{ name: string; data: Buffer }>; roster?: unknown; hardDeadline?: unknown; codeTests?: unknown }) {
      const title = clean(input.title, LIMITS.title);
      const instructions = clean(input.instructions, LIMITS.instructions);
      if (!title) throw new AssignmentError('TITLE_REQUIRED', 'Give the task a title.');
      if (!instructions && !input.files?.length) throw new AssignmentError('TASK_REQUIRED', 'Write the task or attach the task file.');
      const due = typeof input.dueAt === 'string' && input.dueAt ? new Date(input.dueAt) : null;
      if (due && Number.isNaN(due.getTime())) throw new AssignmentError('BAD_DUE', 'The due date is not valid.');
      const autoMark = input.autoMark === true || input.autoMark === 'true';
      if (autoMark && !input.scheme?.length) throw new AssignmentError('SCHEME_REQUIRED', 'Attach the marking scheme so each hand-in can be marked as it arrives.');
      const roster = parseRoster(input.roster);
      const codeTests = input.codeTests ? normalizeCodeTests(input.codeTests) : null;
      if (input.codeTests && !codeTests) throw new AssignmentError('BAD_TESTS', 'Add at least one test with an expected output.');
      const taskFiles = await storeUploads(ownerId, input.files ?? [], 5);
      const schemeFiles = autoMark ? await storeUploads(ownerId, input.scheme ?? [], 5) : [];
      const token = randomBytes(12).toString('base64url');
      const a = await deps.store.create(ownerId, { title, instructions, taskFiles, dueAt: due ? due.toISOString() : null, open: true, token, submissions: [], ...(autoMark ? { autoMark, schemeFiles } : {}), ...(roster.length ? { roster } : {}), ...(input.hardDeadline === true || input.hardDeadline === 'true' ? { hardDeadline: true } : {}), ...(codeTests ? { codeTests } : {}) });
      await fs.mkdir(path.resolve(deps.tokenDir), { recursive: true, mode: 0o700 });
      await fs.writeFile(tokenFile(token), JSON.stringify({ id: a.id, ownerId }), { mode: 0o600 });
      return view(a);
    },

    /** Ids of the files the owner's tasks still show (task files and current hand-ins). */
    async fileIds(ownerId: string): Promise<Set<string>> {
      const all = await deps.store.list(ownerId, 1000);
      return new Set(all.flatMap((a) => [...a.taskFiles, ...(a.schemeFiles ?? []), ...a.submissions.flatMap((s) => s.files)].map((f) => f.id)));
    },

    async list(ownerId: string) {
      return (await deps.store.list(ownerId, 100)).map((a) => ({
        id: a.id, title: a.title, dueAt: a.dueAt, open: a.open, link: linkOf(a.token), createdAt: a.createdAt,
        submitted: a.submissions.length, late: a.submissions.filter((s) => s.late).length, autoMark: !!a.autoMark, lastSubmissionAt: a.submissions.reduce<string | null>((m, s) => (!m || s.submittedAt > m ? s.submittedAt : m), null),
      }));
    },

    async get(ownerId: string, id: string) {
      const a = await load(ownerId, id);
      const v = view(a);
      const marks = deps.marker && a.examId ? await deps.marker.statuses(ownerId, a).catch(() => ({} as Record<string, MarkStatus>)) : {};
      const codeMark = (x: AssignmentSubmission): { marking: MarkStatus } | Record<string, never> => {
        if (!a.codeTests || a.autoMark) return {};
        const sub = a.submissions.find((y) => y.id === x.id);
        if (sub?.codeRunning) return { marking: { state: 'marking', total: null, maxTotal: null, percent: null, released: false } };
        const c = sub?.codeResult;
        if (!c) return {};
        return { marking: { state: 'marked', total: c.earned, maxTotal: c.max, percent: c.max ? Math.round((c.earned / c.max) * 1000) / 10 : 0, released: false } };
      };
      return { ...v, submissions: v.submissions.map((x): typeof x & { marking?: MarkStatus } => ({ ...x, ...(a.codeTests && !a.autoMark ? codeMark(x) : {}), ...(marks[x.id] ? { marking: marks[x.id] } : x.markError ? { marking: { state: 'failed', total: null, maxTotal: null, percent: null, released: false, error: x.markError } } : {}) })) };
    },

    /** Turns automatic marking on or off, with a new marking scheme when one is sent. */
    async setAutoMark(ownerId: string, id: string, input: { autoMark?: unknown; scheme?: Array<{ name: string; data: Buffer }> }) {
      const before = await load(ownerId, id);
      const on = input.autoMark === true || input.autoMark === 'true';
      const scheme = input.scheme?.length ? await storeUploads(ownerId, input.scheme, 5) : null;
      if (on && !scheme && !before.schemeFiles?.length) throw new AssignmentError('SCHEME_REQUIRED', 'Attach the marking scheme first.');
      const a = await deps.store.update(id, ownerId, (r) => {
        r.autoMark = on;
        // A new scheme starts a new examination, so later hand-ins are marked with it.
        if (scheme) { r.schemeFiles = scheme; delete r.examId; }
      });
      if (scheme) await drop(ownerId, before.schemeFiles ?? []);
      return this.get(ownerId, a!.id);
    },

    /** Shows marked results to students (all, or the given hand-ins). Marks are confirmed when released. */
    async release(ownerId: string, id: string, submissionIds?: string[]) {
      const a = await load(ownerId, id);
      if (!deps.marker || !a.examId) throw new AssignmentError('NOT_MARKED', 'Nothing has been marked automatically for this task yet.', 409);
      return deps.marker.release(ownerId, a, submissionIds?.length ? submissionIds : 'all');
    },

    async update(ownerId: string, id: string, patch: { open?: unknown; dueAt?: unknown; title?: unknown; instructions?: unknown; roster?: unknown; hardDeadline?: unknown; codeTests?: unknown; requireMyseb?: unknown }) {
      await load(ownerId, id);
      const tests = patch.codeTests === null ? null : patch.codeTests !== undefined ? normalizeCodeTests(patch.codeTests) : undefined;
      if (patch.codeTests !== undefined && patch.codeTests !== null && !tests) throw new AssignmentError('BAD_TESTS', 'Add at least one test with an expected output.');
      const a = await deps.store.update(id, ownerId, (r) => {
        if (typeof patch.open === 'boolean') r.open = patch.open;
        if (patch.dueAt === null || patch.dueAt === '') r.dueAt = null;
        else if (typeof patch.dueAt === 'string') { const d = new Date(patch.dueAt); if (!Number.isNaN(d.getTime())) r.dueAt = d.toISOString(); }
        const t = clean(patch.title, LIMITS.title); if (t) r.title = t;
        if (typeof patch.instructions === 'string') r.instructions = clean(patch.instructions, LIMITS.instructions);
        if (typeof patch.roster === 'string') { const list = parseRoster(patch.roster); if (list.length) r.roster = list; else delete r.roster; }
        if (typeof patch.hardDeadline === 'boolean') { if (patch.hardDeadline) r.hardDeadline = true; else delete r.hardDeadline; }
        if (typeof patch.requireMyseb === 'boolean') { if (patch.requireMyseb) r.requireMyseb = true; else delete r.requireMyseb; }
        if (tests === null) delete r.codeTests; else if (tests) r.codeTests = tests;
      });
      return view(a!);
    },

    async remove(ownerId: string, id: string) {
      const a = await load(ownerId, id);
      await fs.rm(tokenFile(a.token), { force: true });
      await deps.store.delete(id, ownerId);
      await drop(ownerId, [...a.taskFiles, ...(a.schemeFiles ?? []), ...a.submissions.flatMap((s) => s.files)]);
    },

    /**
     * The task as an Excel sheet for the lecturer: every student on the class list (or who handed in), when they
     * handed in, whether late, and the marks once marked. Students who have not handed in are listed too.
     */
    async exportWorkbook(ownerId: string, id: string): Promise<{ name: string; data: Buffer }> {
      const a = await load(ownerId, id);
      const marks = deps.marker && a.examId ? await deps.marker.statuses(ownerId, a).catch(() => ({} as Record<string, MarkStatus>)) : {};
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Bwenge';
      const ws = wb.addWorksheet('Marks', { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = [
        { header: 'Registration no.', key: 'sid', width: 18 }, { header: 'Name', key: 'name', width: 30 }, { header: 'Status', key: 'status', width: 16 },
        { header: 'Handed in', key: 'at', width: 20 }, { header: 'Late', key: 'late', width: 8 }, { header: 'Mark', key: 'total', width: 10 },
        { header: 'Out of', key: 'max', width: 10 }, { header: 'Percent', key: 'pct', width: 10 }, { header: 'Released', key: 'rel', width: 10 },
      ];
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A68' } };
      const byId = new Map(a.submissions.filter((x) => x.studentId).map((x) => [x.studentId!.toLowerCase(), x]));
      const rows: Array<{ sid: string; name: string; sub?: AssignmentSubmission }> = [];
      for (const r of a.roster ?? []) rows.push({ sid: r.id, name: r.name, sub: byId.get(r.id.toLowerCase()) });
      const listed = new Set((a.roster ?? []).map((r) => r.id.toLowerCase()));
      for (const x of a.submissions) if (!x.studentId || !listed.has(x.studentId.toLowerCase())) rows.push({ sid: x.studentId ?? '', name: x.studentName, sub: x });
      rows.sort((x, y) => x.name.localeCompare(y.name));
      for (const { sid, name, sub } of rows) {
        const m = sub ? marks[sub.id] : undefined;
        const marked = m && (m.state === 'marked' || m.state === 'needs_review');
        const row = ws.addRow({
          sid, name, status: !sub ? 'Not handed in' : m ? (m.state === 'needs_review' ? 'Check marks' : m.state === 'marked' ? 'Marked' : 'Marking') : 'Handed in',
          at: sub ? new Date(sub.submittedAt) : '', late: sub ? (sub.late ? 'Yes' : 'No') : '',
          total: marked ? m!.total ?? '' : '', max: marked ? m!.maxTotal ?? '' : '', pct: marked && m!.percent !== null ? Math.round(m!.percent) : '', rel: m?.released ? 'Yes' : '',
        });
        if (!sub) row.getCell('status').font = { color: { argb: 'FFB91C1C' } };
        if (sub) row.getCell('at').numFmt = 'dd mmm yyyy hh:mm';
      }
      const safe = a.title.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'task';
      return { name: `${safe} marks.xlsx`, data: Buffer.from(await wb.xlsx.writeBuffer()) };
    },

    /**
     * Runs the code tests again (all hand-ins, or the given ones). They run in the background, a few at a time;
     * the dashboard shows "marking" until each result arrives.
     */
    async runTests(ownerId: string, id: string, submissionIds?: string[]) {
      const a = await load(ownerId, id);
      if (!a.codeTests) throw new AssignmentError('NO_TESTS', 'This task has no code tests.', 409);
      const status = await deps.codeRunner?.();
      if (!status?.runner) throw new AssignmentError('NO_RUNNER', status?.reason ?? 'Code testing is not available on this server.', 503);
      const ids = a.submissions.filter((s) => !submissionIds?.length || submissionIds.includes(s.id)).map((s) => s.id);
      void runCodeTests(ownerId, id, ids);
      return { started: ids.length };
    },

    /** Whether this server can run students' programs, and why not. */
    async codeStatus() {
      const s = await deps.codeRunner?.();
      return { available: !!s?.runner, runner: s?.runner?.name ?? null, reason: s?.reason ?? 'Code testing is not set up on this server.' };
    },

    /** Removes one student's hand-in (for example a test or a duplicate). */
    async removeSubmission(ownerId: string, id: string, submissionId: string) {
      const before = await load(ownerId, id);
      const a = await deps.store.update(id, ownerId, (r) => { r.submissions = r.submissions.filter((s) => s.id !== submissionId); });
      await drop(ownerId, before.submissions.find((s) => s.id === submissionId)?.files ?? []);
      return view(a!);
    },

    /** One of the assignment's files (task or submission), for the teacher's preview. */
    async file(ownerId: string, id: string, fileId: string) {
      const a = await load(ownerId, id);
      const known = [...a.taskFiles, ...a.submissions.flatMap((s) => s.files)].some((f) => f.id === fileId);
      if (!known) throw new AssignmentError('NOT_FOUND', 'File not found.', 404);
      return deps.files.read(ownerId, fileId);
    },

    /** One click: mark every paper handed in. See TaskMarker.markNow for the rules about the marking scheme. */
    async markNow(ownerId: string, id: string, input: { confirm?: unknown }) {
      const a = await load(ownerId, id);
      if (!deps.marker?.markNow || !a.autoMark) throw new AssignmentError('NOT_AUTO', 'Automatic marking is not turned on for this task. Use "Mark all with AI" instead.', 409);
      return deps.marker.markNow(ownerId, a, { confirm: input?.confirm === true });
    },

    // ── MySEB (device lock) ─────────────────────────────────────────────
    /** What the MySEB wiring needs about one of the lecturer's tasks. */
    async mysebInfo(ownerId: string, id: string) {
      const a = await load(ownerId, id);
      return { title: a.title, link: linkOf(a.token), requireMyseb: !!a.requireMyseb, mysebExamId: a.mysebExamId ?? null, dueAt: a.dueAt };
    },
    async setMysebExamId(ownerId: string, id: string, examId: string) {
      await load(ownerId, id);
      await deps.store.update(id, ownerId, (r) => { r.mysebExamId = examId; r.requireMyseb = true; });
    },
    /** For the guard in front of the student routes: does this link need MySEB, and who owns it (the owner may preview). Never throws. */
    async mysebForToken(token: string): Promise<{ requireMyseb: boolean; mysebExamId: string | null; ownerId: string } | null> {
      try { const a = await byToken(token); return { requireMyseb: !!a.requireMyseb, mysebExamId: a.mysebExamId ?? null, ownerId: a.ownerId }; } catch { return null; }
    },

    // ── Student side (the shared link) ──────────────────────────────────
    async publicView(token: string) {
      const a = await byToken(token);
      const closed = !a.open || !!(a.hardDeadline && a.dueAt && Date.now() > Date.parse(a.dueAt));
      return { title: a.title, instructions: a.instructions, dueAt: a.dueAt, open: !closed, autoMark: !!a.autoMark, rosterRequired: !!a.roster?.length, hardDeadline: !!a.hardDeadline, codeLanguage: a.codeTests ? LANGUAGES[a.codeTests.language].label : null, codeMain: a.codeTests ? LANGUAGES[a.codeTests.language].mains[0] : null, taskFiles: a.taskFiles.map((f, i) => ({ index: i, name: f.name, mime: f.mime, size: f.size })) };
    },

    /** A student's own result, through the private link they got when they handed in. */
    async publicResult(token: string, resultToken: string) {
      const a = await byToken(token);
      const sub = /^[\w-]{8,24}$/.test(resultToken) ? a.submissions.find((x) => x.resultToken === resultToken) : undefined;
      if (!sub) throw new AssignmentError('NOT_FOUND', 'This result link is not valid.', 404);
      if (a.codeTests && !a.autoMark) {
        const shown = sub.codeResult ? redactForStudent(sub.codeResult, a.codeTests.showStudents) : null;
        return { title: a.title, studentName: sub.studentName, state: 'code' as const, submittedAt: sub.submittedAt, code: sub.codeRunning || (!sub.codeResult && !sub.markError) ? { running: true } : a.codeTests.showStudents === 'none' ? { hidden: true } : shown };
      }
      if (!a.autoMark || !deps.marker) return { title: a.title, studentName: sub.studentName, state: 'not_marked' as const, submittedAt: sub.submittedAt };
      return { ...(await deps.marker.result(a.ownerId, a, sub)), submittedAt: sub.submittedAt };
    },

    async publicTaskFile(token: string, index: number) {
      const a = await byToken(token);
      const f = a.taskFiles[index];
      if (!f) throw new AssignmentError('NOT_FOUND', 'File not found.', 404);
      return deps.files.read(a.ownerId, f.id);
    },

    async submit(token: string, input: { studentName?: unknown; studentId?: unknown; receiptCode?: unknown; text?: unknown; files?: Array<{ name: string; data: Buffer }> }) {
      const a = await byToken(token);
      if (!a.open) throw new AssignmentError('CLOSED', 'This task is closed. Ask the person who shared it.', 410);
      if (a.hardDeadline && a.dueAt && Date.now() > Date.parse(a.dueAt)) throw new AssignmentError('DEADLINE_PASSED', 'The deadline has passed, so this task no longer takes hand-ins. Contact your lecturer.', 403);
      let studentName = clean(input.studentName, LIMITS.name);
      let studentId = clean(input.studentId, 40) || undefined;
      // With a class list, a student hands in under their own registration number and the name on the list.
      if (a.roster?.length) {
        if (!studentId) throw new AssignmentError('ID_REQUIRED', 'Enter your registration number.');
        const onList = a.roster.find((r) => r.id.toLowerCase() === studentId!.toLowerCase());
        if (!onList) throw new AssignmentError('NOT_ON_LIST', 'This registration number is not on the class list. Check it, or ask your lecturer.', 403);
        studentId = onList.id;
        studentName = onList.name;
      }
      const text = clean(input.text, LIMITS.text) || undefined;
      if (!studentName) throw new AssignmentError('NAME_REQUIRED', 'Write your name.');
      if (!text && !input.files?.length) throw new AssignmentError('ANSWER_REQUIRED', 'Add your answer: upload a file or photo, or type it.');
      if (a.submissions.length >= LIMITS.submissions) throw new AssignmentError('FULL', 'This task has reached its submission limit.', 409);
      // Refuse a replacement without the receipt code before any file is stored.
      const sameStudent = (x: AssignmentSubmission) => (studentId && x.studentId ? x.studentId.toLowerCase() === studentId.toLowerCase() : x.studentName.toLowerCase() === studentName.toLowerCase());
      const earlier = a.submissions.find(sameStudent);
      if (earlier && clean(input.receiptCode, 20).toUpperCase() !== earlier.id.slice(0, 8).toUpperCase()) {
        throw new AssignmentError('ALREADY_SUBMITTED', 'You have already handed in. To replace your work, enter the receipt code from your first hand-in.', 409);
      }
      const uploads = input.files ?? [];
      const autoMark = !!(a.autoMark && deps.marker && a.schemeFiles?.length);
      let scanNeedsTeacher = false;
      if (autoMark) {
        for (const file of uploads) {
          if (await needsScanRecognition({ name: file.name, buffer: file.data, mime: MIME[ext(file.name)] })) {
            scanNeedsTeacher = true;
            break;
          }
        }
      }
      const files = await storeUploads(a.ownerId, uploads, LIMITS.files, true);
      const late = !!a.dueAt && Date.now() > Date.parse(a.dueAt);
      const same = (s: AssignmentSubmission) => (studentId && s.studentId ? s.studentId.toLowerCase() === studentId.toLowerCase() : s.studentName.toLowerCase() === studentName.toLowerCase());
      let receipt!: AssignmentSubmission;
      let replaced: StoredFile[] = [];
      try { await deps.store.update(a.id, a.ownerId, (r) => {
        const prev = r.submissions.find(same);
        // Someone who knows only a name or number cannot overwrite another student's work: replacing needs the receipt code.
        if (prev && clean(input.receiptCode, 20).toUpperCase() !== prev.id.slice(0, 8).toUpperCase()) {
          throw new AssignmentError('ALREADY_SUBMITTED', 'You have already handed in. To replace your work, enter the receipt code from your first hand-in.', 409);
        }
        replaced = prev?.files ?? [];
        receipt = { id: prev?.id ?? randomUUID(), studentName, ...(studentId ? { studentId } : {}), files, ...(text ? { text } : {}), submittedAt: now(), late, resubmissions: prev ? prev.resubmissions + 1 : 0, resultToken: prev?.resultToken ?? randomBytes(9).toString('base64url'), ...(scanNeedsTeacher ? { markError: SCANNED_PAPER_MESSAGE } : {}) };
        r.submissions = [...r.submissions.filter((s) => s !== prev), receipt];
      }); } catch (e) { await drop(a.ownerId, files); throw e; }
      // The earlier hand-in's files are no longer shown or marked: free their storage.
      await drop(a.ownerId, replaced);
      // Automatic marking runs in the background; the student does not wait for it.
      if (autoMark && deps.marker && !scanNeedsTeacher) {
        const sub = receipt;
        const save = (patch: { examId?: string; examSubmissionId?: string; markError?: string | null }) => deps.store.update(a.id, a.ownerId, (r) => {
          if (patch.examId) r.examId = patch.examId;
          const x = r.submissions.find((y) => y.id === sub.id);
          if (x && patch.examSubmissionId) x.examSubmissionId = patch.examSubmissionId;
          if (x && patch.markError !== undefined) { if (patch.markError) x.markError = patch.markError; else delete x.markError; }
        }).then(() => undefined);
        void deps.marker.mark({
          ownerId: a.ownerId, assignment: (await deps.store.get(a.id, a.ownerId)) ?? a, submission: sub,
          pdf: () => studentPdf(a.ownerId, sub),
          scheme: async () => Promise.all((a.schemeFiles ?? []).map(async (f) => { const d = await deps.files.read(a.ownerId, f.id); return { name: d.name, buffer: d.data, mime: d.mime }; })),
          save,
          reload: () => deps.store.get(a.id, a.ownerId),
        }).catch((e) => save({ markError: e instanceof Error ? e.message.slice(0, 200) : 'Could not be marked.' }).catch(() => undefined));
      }
      if (a.codeTests) void runCodeTests(a.ownerId, a.id, [receipt.id]);
      return { receiptId: receipt.id.slice(0, 8).toUpperCase(), submittedAt: receipt.submittedAt, late, replaced: receipt.resubmissions > 0, files: files.length, resultLink: resultLinkOf(a.token, receipt.resultToken!), autoMark: autoMark && !scanNeedsTeacher, codeTests: !!a.codeTests && a.codeTests.showStudents !== 'none' };
    },

    /**
     * Everything the marker needs, as files the chat can attach: one PDF per student (photos, PDFs, documents
     * and typed answers joined in the order handed in) named by a candidate id, plus students.csv with the names.
     */
    async prepareMarking(ownerId: string, id: string, submissionIds?: string[]) {
      const a = await load(ownerId, id);
      const subs = a.submissions.filter((s) => !submissionIds?.length || submissionIds.includes(s.id)).sort((x, y) => x.submittedAt.localeCompare(y.submittedAt));
      if (!subs.length) throw new AssignmentError('NO_SUBMISSIONS', 'Nobody has submitted yet.');
      const used = new Set<string>();
      let seq = 0;
      const scripts: Array<StoredFile & { studentName: string; candidateId: string }> = [];
      const skipped: Array<{ studentName: string; reason: string }> = [];
      for (const s of subs) {
        let cid = s.studentId && ID_OK.test(s.studentId) && !used.has(s.studentId.toLowerCase()) ? s.studentId : '';
        while (!cid || used.has(cid.toLowerCase())) cid = `S${String(++seq).padStart(3, '0')}`;
        try {
          const pdf = await studentPdf(ownerId, s);
          used.add(cid.toLowerCase());
          scripts.push({ ...(await deps.files.save(ownerId, `${cid}.pdf`, 'application/pdf', pdf)), studentName: s.studentName, candidateId: cid });
        } catch (e) {
          skipped.push({ studentName: s.studentName, reason: e instanceof Error ? e.message.slice(0, 160) : 'could not be read' });
        }
      }
      if (!scripts.length) throw new AssignmentError('UNREADABLE', 'None of the submissions could be read.');
      const csv = ['candidate,file,name', ...scripts.map((x) => `${x.candidateId},${x.candidateId}.pdf,"${x.studentName.replace(/"/g, "'")}"`)].join('\n');
      const roster = await deps.files.save(ownerId, 'students.csv', 'text/csv', Buffer.from(csv, 'utf8'));
      const task = a.taskFiles.length ? a.taskFiles : [];
      return { title: a.title, scripts, roster, task, skipped };
    },
  };

  /** The files of a hand-in as a program's source tree: folders (ZIP) are unpacked, typed text becomes a main file. */
  async function sourceFiles(ownerId: string, s: AssignmentSubmission, a: AssignmentRecord): Promise<Array<{ path: string; data: Buffer }>> {
    const out: Array<{ path: string; data: Buffer }> = [];
    let total = 0;
    const add = (p: string, data: Buffer) => { if (out.length < 200 && total + data.length < 20 * 1024 * 1024 && data.length <= 2 * 1024 * 1024) { total += data.length; out.push({ path: p, data }); } };
    for (const f of s.files) {
      if (/\.(zip)$/i.test(f.name)) {
        const { data } = await deps.files.read(ownerId, f.id);
        const zip: JSZip | null = await JSZip.loadAsync(data).catch(() => null);
        if (!zip) continue;
        const entries = (Object.values(zip.files) as JSZip.JSZipObject[]).filter((e) => !e.dir && !SKIP_DIRS.test(e.name) && !/(^|\/)\./.test(e.name)).slice(0, 400);
        // A single wrapping folder ("project/main.py") is stripped so the main file is found at the top.
        const roots = new Set(entries.map((e) => e.name.split('/')[0]));
        const strip = roots.size === 1 && entries.every((e) => e.name.includes('/')) ? `${[...roots][0]}/` : '';
        for (const e of entries) {
          const claimed = Number((e as any)._data?.uncompressedSize) || 0;
          if (claimed > 2 * 1024 * 1024) continue;
          add(e.name.slice(strip.length), await e.async('nodebuffer'));
        }
      } else if (!IMAGE.test(f.name) && !AUDIO.test(f.name) && !/\.(mp4|mov|m4v|pdf)$/i.test(f.name)) {
        add(f.name, (await deps.files.read(ownerId, f.id)).data);
      }
    }
    // Code typed into the page counts as the main file when no source file was sent.
    const spec = a.codeTests ? LANGUAGES[a.codeTests.language] : null;
    if (spec && s.text && !out.some((o) => spec.ext.includes((o.path.split('.').pop() ?? '').toLowerCase()))) add(spec.mains[0], Buffer.from(s.text, 'utf8'));
    return out;
  }

  async function slot() { if (running >= 2) await new Promise<void>((r) => waiting.push(r)); running++; }
  function release() { running--; waiting.shift()?.(); }

  async function runCodeTests(ownerId: string, id: string, submissionIds: string[]) {
    const mark = (sid: string, patch: (x: AssignmentSubmission) => void) => deps.store.update(id, ownerId, (r) => { const x = r.submissions.find((y) => y.id === sid); if (x) patch(x); }).catch(() => undefined);
    for (const sid of submissionIds) await mark(sid, (x) => { x.codeRunning = true; });
    for (const sid of submissionIds) {
      await slot();
      try {
        const a = await deps.store.get(id, ownerId);
        const sub = a?.submissions.find((x) => x.id === sid);
        if (!a?.codeTests || !sub) { await mark(sid, (x) => { delete x.codeRunning; }); continue; }
        const status = await deps.codeRunner?.();
        if (!status?.runner) { await mark(sid, (x) => { delete x.codeRunning; x.markError = status?.reason ?? 'Code testing is not available on this server.'; }); continue; }
        const result = await gradeCode(status.runner, a.codeTests, await sourceFiles(ownerId, sub, a));
        await mark(sid, (x) => { x.codeResult = result; delete x.codeRunning; delete x.markError; });
      } catch (e) {
        await mark(sid, (x) => { delete x.codeRunning; x.markError = e instanceof Error ? e.message.slice(0, 200) : 'The tests could not be run.'; });
      } finally { release(); }
    }
  }

  /** One student's hand-in as one PDF, in the order the files were sent; typed text goes last. */
  async function studentPdf(ownerId: string, s: AssignmentSubmission): Promise<Buffer> {
    const parts: Buffer[] = [];
    let photos: Buffer[] = [];
    const flushPhotos = async () => { if (photos.length) { parts.push(await imagesToPdf(photos)); photos = []; } };
    for (const f of s.files) {
      if (AUDIO.test(f.name)) continue;
      const { data } = await deps.files.read(ownerId, f.id);
      if (IMAGE.test(f.name)) { photos.push(data); continue; }
      await flushPhotos();
      // Code, spreadsheets, slides, documents and folders (ZIP) all become pages; recordings and videos do not.
      const pdf = await fileToPdf(f.name, f.mime, data);
      if (pdf) parts.push(pdf);
    }
    await flushPhotos();
    if (s.text) parts.push(await typedToPdf({ name: 'answer.txt', buffer: Buffer.from(s.text, 'utf8'), mime: 'text/plain' }));
    if (!parts.length) throw new Error('only a voice recording or video was handed in; open it in the dashboard');
    return mergePdfs(parts);
  }
}

export type AssignmentService = ReturnType<typeof createAssignmentService>;
