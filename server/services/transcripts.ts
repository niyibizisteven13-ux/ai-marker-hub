import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { OwnedRecordStore, type OwnedRecord } from './storage/ownedRecordStore.js';
import { buildGradebook, type Gradebook } from './gradebook.js';
import { LearnError } from './learning/practice.js';

/**
 * Student transcripts. Students have no accounts, so each student of a class gets one private, unguessable link
 * (the lecturer shares it). The page lists every test, quiz and task of the class gradebook with the student's mark,
 * but ONLY marks the lecturer has released: an unreleased mark shows "not released yet" and is left out of the average.
 */
interface Entry { token: string; name: string; studentId: string | null }
interface TranscriptRecord extends OwnedRecord { classId: string; students: Record<string, Entry> }

const FIVE_YEARS = 5 * 365 * 24 * 60 * 60 * 1000;
let store: OwnedRecordStore<TranscriptRecord> | null = null;
let indexDir: string | null = null;
const records = () => (store ??= new OwnedRecordStore<TranscriptRecord>(path.join(process.env.TRANSCRIPTS_DIR ?? './data/transcripts', 'records'), FIVE_YEARS));
const dir = () => (indexDir ??= path.resolve(process.env.TRANSCRIPTS_DIR ?? './data/transcripts', 'links'));
/** Tests use a temporary folder. */
export function setTranscriptStorage(s: OwnedRecordStore<TranscriptRecord> | null, d: string | null) { store = s; indexDir = d; }

const TOKEN = /^[\w-]{20,40}$/;
const fold = (v: string) => v.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const round1 = (n: number) => Math.round(n * 10) / 10;
const newToken = () => randomBytes(18).toString('base64url');
const fileOf = (token: string) => path.join(dir(), `${token}.json`);

async function issue(ownerId: string, classId: string, key: string, name: string, studentId: string | null): Promise<string> {
  const token = newToken();
  await fs.mkdir(dir(), { recursive: true, mode: 0o700 });
  await fs.writeFile(fileOf(token), JSON.stringify({ classId, ownerId, key }), { mode: 0o600 });
  await records().update(classId, ownerId, (r) => { r.students[key] = { token, name, studentId }; });
  return token;
}

/** One link per student of the class, made on first use and kept. */
export async function transcriptLinks(ownerId: string, classId: string, baseUrl: string) {
  const g = await buildGradebook(ownerId, classId);
  if (!(await records().get(classId, ownerId))) await records().put(classId, ownerId, { classId, students: {} });
  const out: Array<{ key: string; name: string; studentId: string | null; link: string; released: number; total: number }> = [];
  for (const s of g.students) {
    const rec = await records().get(classId, ownerId);
    let token = rec?.students[s.key]?.token;
    if (!token) token = await issue(ownerId, classId, s.key, s.name, s.studentId);
    const cells = g.columns.map((c) => s.cells[c.key]);
    out.push({ key: s.key, name: s.name, studentId: s.studentId, link: `${baseUrl.replace(/\/$/, '')}/t/${token}`, released: cells.filter((c) => c?.released && c.percent !== null).length, total: g.columns.length });
  }
  return out;
}

/** A leaked link is replaced: the old one stops working at once. */
export async function regenerateLink(ownerId: string, classId: string, key: string, baseUrl: string) {
  const rec = await records().get(classId, ownerId);
  const e = rec?.students[key];
  if (!e) throw new LearnError('NOT_FOUND', 'That student is not in this class.');
  await fs.rm(fileOf(e.token), { force: true });
  const token = await issue(ownerId, classId, key, e.name, e.studentId);
  return { link: `${baseUrl.replace(/\/$/, '')}/t/${token}` };
}

export interface TranscriptRow { kind: 'task' | 'quiz'; title: string; status: 'released' | 'pending' | 'handed_in' | 'none'; percent: number | null; label: string; link: string | null }
export interface Transcript { className: string; student: { name: string; studentId: string | null }; rows: TranscriptRow[]; average: number | null; releasedCount: number; generatedAt: string }

/** What the student sees. Never includes an unreleased mark, in a row or in the average. */
export function transcriptView(g: Gradebook, row: Gradebook['students'][number]): Transcript {
  const rows: TranscriptRow[] = g.columns.map((c) => {
    const cell = row.cells[c.key];
    if (cell?.state === 'marked' && cell.released && cell.percent !== null) return { kind: c.kind, title: c.title, status: 'released', percent: cell.percent, label: cell.label, link: cell.link ?? null };
    if (cell?.state === 'marked') return { kind: c.kind, title: c.title, status: 'pending', percent: null, label: 'Marks not released yet', link: null };
    if (cell?.state === 'submitted') return { kind: c.kind, title: c.title, status: 'handed_in', percent: null, label: 'Handed in, not marked yet', link: null };
    return { kind: c.kind, title: c.title, status: 'none', percent: null, label: 'Not taken', link: null };
  });
  const shown = rows.filter((r) => r.status === 'released').map((r) => r.percent as number);
  return { className: g.class.name, student: { name: row.name, studentId: row.studentId }, rows, average: shown.length ? round1(shown.reduce((a, b) => a + b, 0) / shown.length) : null, releasedCount: shown.length, generatedAt: new Date().toISOString() };
}

export async function publicTranscript(token: string): Promise<Transcript> {
  if (!TOKEN.test(token)) throw new LearnError('NOT_FOUND', 'This transcript link is not valid.');
  let ref: { classId: string; ownerId: string; key: string };
  try { ref = JSON.parse(await fs.readFile(fileOf(token), 'utf8')); } catch { throw new LearnError('NOT_FOUND', 'This transcript link is not valid.'); }
  const rec = await records().get(ref.classId, ref.ownerId);
  const entry = rec?.students[ref.key];
  if (!entry || entry.token !== token) throw new LearnError('NOT_FOUND', 'This transcript link is not valid.');
  const g = await buildGradebook(ref.ownerId, ref.classId);
  // The row's key changes if the student later gave a registration number: find them by key, then number, then name.
  const row = g.students.find((s) => s.key === ref.key) ?? (entry.studentId ? g.students.find((s) => s.studentId && fold(s.studentId) === fold(entry.studentId!)) : undefined) ?? g.students.find((s) => fold(s.name) === fold(entry.name));
  if (!row) throw new LearnError('NOT_FOUND', 'This transcript is no longer available.');
  return transcriptView(g, row);
}
