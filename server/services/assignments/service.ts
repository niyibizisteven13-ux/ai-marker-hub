import { randomBytes, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import type { OwnedRecord, OwnedRecordStore } from '../storage/ownedRecordStore.js';
import { imagesToPdf, typedToPdf } from '../exams/inputs.js';

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
}

export interface AssignmentRecord extends OwnedRecord {
  title: string;
  instructions: string;
  taskFiles: StoredFile[];
  dueAt: string | null;
  open: boolean;
  token: string;
  submissions: AssignmentSubmission[];
}

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

export const LIMITS = { files: 10, fileBytes: 25 * 1024 * 1024, text: 20_000, name: 80, title: 160, instructions: 8_000, submissions: 300 };

/** What students may hand in: photos (phone and scanner formats), PDF, Word and other text documents. */
const ACCEPT = /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?|pdf|docx?|odt|rtf|txt|md)$/i;
const IMAGE = /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i;
const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heic', gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text', rtf: 'application/rtf', txt: 'text/plain', md: 'text/markdown',
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
  if (e === 'docx' || e === 'odt') return str.startsWith('PK\u0003\u0004');
  if (e === 'doc') return head[0] === 0xd0 && head[1] === 0xcf;
  return true; // text formats
}

/** A candidate id the marker accepts: the student's own id when usable, otherwise S001, S002, … */
const ID_OK = /^[\w.-]{1,40}$/;

export function createAssignmentService(deps: {
  store: OwnedRecordStore<AssignmentRecord>; files: AssignmentFiles; tokenDir: string; baseUrl?: () => string;
  /** Throws when the owner's plan has no room for this many more bytes (storage is sold with the plans). */
  ensureStorage?: (ownerId: string, bytes: number, forOthers: boolean) => Promise<void>;
}) {
  const drop = async (ownerId: string, files: StoredFile[]) => {
    for (const f of files) await deps.files.remove?.(ownerId, f.id).catch(() => undefined);
  };
  const tokenFile = (token: string) => {
    if (!/^[\w-]{16,40}$/.test(token)) throw new AssignmentError('NOT_FOUND', 'This task link is not valid.', 404);
    return path.join(path.resolve(deps.tokenDir), `${token}.json`);
  };
  const linkOf = (token: string) => `${(deps.baseUrl?.() ?? '').replace(/\/$/, '')}/a/${token}`;

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

  /** Teacher view: everything, with counts the dashboard shows at a glance. */
  const view = (a: AssignmentRecord) => ({
    id: a.id, title: a.title, instructions: a.instructions, taskFiles: a.taskFiles, dueAt: a.dueAt, open: a.open,
    link: linkOf(a.token), createdAt: a.createdAt, updatedAt: a.updatedAt,
    submissions: [...a.submissions].sort((x, y) => y.submittedAt.localeCompare(x.submittedAt)),
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
      out.push(await deps.files.save(ownerId, name, MIME[ext(name)] ?? 'application/octet-stream', u.data));
    }
    return out;
  }

  return {
    linkOf,

    async create(ownerId: string, input: { title?: unknown; instructions?: unknown; dueAt?: unknown; files?: Array<{ name: string; data: Buffer }> }) {
      const title = clean(input.title, LIMITS.title);
      const instructions = clean(input.instructions, LIMITS.instructions);
      if (!title) throw new AssignmentError('TITLE_REQUIRED', 'Give the task a title.');
      if (!instructions && !input.files?.length) throw new AssignmentError('TASK_REQUIRED', 'Write the task or attach the task file.');
      const due = typeof input.dueAt === 'string' && input.dueAt ? new Date(input.dueAt) : null;
      if (due && Number.isNaN(due.getTime())) throw new AssignmentError('BAD_DUE', 'The due date is not valid.');
      const taskFiles = await storeUploads(ownerId, input.files ?? [], 5);
      const token = randomBytes(12).toString('base64url');
      const a = await deps.store.create(ownerId, { title, instructions, taskFiles, dueAt: due ? due.toISOString() : null, open: true, token, submissions: [] });
      await fs.mkdir(path.resolve(deps.tokenDir), { recursive: true, mode: 0o700 });
      await fs.writeFile(tokenFile(token), JSON.stringify({ id: a.id, ownerId }), { mode: 0o600 });
      return view(a);
    },

    /** Ids of the files the owner's tasks still show (task files and current hand-ins). */
    async fileIds(ownerId: string): Promise<Set<string>> {
      const all = await deps.store.list(ownerId, 1000);
      return new Set(all.flatMap((a) => [...a.taskFiles, ...a.submissions.flatMap((s) => s.files)].map((f) => f.id)));
    },

    async list(ownerId: string) {
      return (await deps.store.list(ownerId, 100)).map((a) => ({
        id: a.id, title: a.title, dueAt: a.dueAt, open: a.open, link: linkOf(a.token), createdAt: a.createdAt,
        submitted: a.submissions.length, lastSubmissionAt: a.submissions.reduce<string | null>((m, s) => (!m || s.submittedAt > m ? s.submittedAt : m), null),
      }));
    },

    async get(ownerId: string, id: string) { return view(await load(ownerId, id)); },

    async update(ownerId: string, id: string, patch: { open?: unknown; dueAt?: unknown; title?: unknown; instructions?: unknown }) {
      await load(ownerId, id);
      const a = await deps.store.update(id, ownerId, (r) => {
        if (typeof patch.open === 'boolean') r.open = patch.open;
        if (patch.dueAt === null || patch.dueAt === '') r.dueAt = null;
        else if (typeof patch.dueAt === 'string') { const d = new Date(patch.dueAt); if (!Number.isNaN(d.getTime())) r.dueAt = d.toISOString(); }
        const t = clean(patch.title, LIMITS.title); if (t) r.title = t;
        if (typeof patch.instructions === 'string') r.instructions = clean(patch.instructions, LIMITS.instructions);
      });
      return view(a!);
    },

    async remove(ownerId: string, id: string) {
      const a = await load(ownerId, id);
      await fs.rm(tokenFile(a.token), { force: true });
      await deps.store.delete(id, ownerId);
      await drop(ownerId, [...a.taskFiles, ...a.submissions.flatMap((s) => s.files)]);
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

    // ── Student side (the shared link) ──────────────────────────────────
    async publicView(token: string) {
      const a = await byToken(token);
      const closed = !a.open;
      return { title: a.title, instructions: a.instructions, dueAt: a.dueAt, open: !closed, taskFiles: a.taskFiles.map((f, i) => ({ index: i, name: f.name, mime: f.mime, size: f.size })) };
    },

    async publicTaskFile(token: string, index: number) {
      const a = await byToken(token);
      const f = a.taskFiles[index];
      if (!f) throw new AssignmentError('NOT_FOUND', 'File not found.', 404);
      return deps.files.read(a.ownerId, f.id);
    },

    async submit(token: string, input: { studentName?: unknown; studentId?: unknown; text?: unknown; files?: Array<{ name: string; data: Buffer }> }) {
      const a = await byToken(token);
      if (!a.open) throw new AssignmentError('CLOSED', 'This task is closed. Ask the person who shared it.', 410);
      const studentName = clean(input.studentName, LIMITS.name);
      const studentId = clean(input.studentId, 40) || undefined;
      const text = clean(input.text, LIMITS.text) || undefined;
      if (!studentName) throw new AssignmentError('NAME_REQUIRED', 'Write your name.');
      if (!text && !input.files?.length) throw new AssignmentError('ANSWER_REQUIRED', 'Add your answer: upload a file or photo, or type it.');
      if (a.submissions.length >= LIMITS.submissions) throw new AssignmentError('FULL', 'This task has reached its submission limit.', 409);
      const files = await storeUploads(a.ownerId, input.files ?? [], LIMITS.files, true);
      const late = !!a.dueAt && Date.now() > Date.parse(a.dueAt);
      const same = (s: AssignmentSubmission) => (studentId && s.studentId ? s.studentId.toLowerCase() === studentId.toLowerCase() : s.studentName.toLowerCase() === studentName.toLowerCase());
      let receipt!: AssignmentSubmission;
      let replaced: StoredFile[] = [];
      await deps.store.update(a.id, a.ownerId, (r) => {
        const prev = r.submissions.find(same);
        replaced = prev?.files ?? [];
        receipt = { id: prev?.id ?? randomUUID(), studentName, ...(studentId ? { studentId } : {}), files, ...(text ? { text } : {}), submittedAt: now(), late, resubmissions: prev ? prev.resubmissions + 1 : 0 };
        r.submissions = [...r.submissions.filter((s) => s !== prev), receipt];
      });
      // The earlier hand-in's files are no longer shown or marked: free their storage.
      await drop(a.ownerId, replaced);
      return { receiptId: receipt.id.slice(0, 8).toUpperCase(), submittedAt: receipt.submittedAt, late, replaced: receipt.resubmissions > 0, files: files.length };
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

  /** One student's hand-in as one PDF, in the order the files were sent; typed text goes last. */
  async function studentPdf(ownerId: string, s: AssignmentSubmission): Promise<Buffer> {
    const parts: Buffer[] = [];
    let photos: Buffer[] = [];
    const flushPhotos = async () => { if (photos.length) { parts.push(await imagesToPdf(photos)); photos = []; } };
    for (const f of s.files) {
      const { data } = await deps.files.read(ownerId, f.id);
      if (IMAGE.test(f.name)) { photos.push(data); continue; }
      await flushPhotos();
      parts.push(/\.pdf$/i.test(f.name) ? data : await typedToPdf({ name: f.name, buffer: data, mime: f.mime }));
    }
    await flushPhotos();
    if (s.text) parts.push(await typedToPdf({ name: 'answer.txt', buffer: Buffer.from(s.text, 'utf8'), mime: 'text/plain' }));
    if (parts.length === 1) return parts[0];
    const out = await PDFDocument.create();
    for (const p of parts) {
      const doc = await PDFDocument.load(p, { ignoreEncryption: true });
      for (const page of await out.copyPages(doc, doc.getPageIndices())) out.addPage(page);
    }
    return Buffer.from(await out.save());
  }
}

export type AssignmentService = ReturnType<typeof createAssignmentService>;
