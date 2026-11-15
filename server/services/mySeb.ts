import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';
import { getJwtSecret } from '../auth/secrets.js';
import { normalizeExam } from '../../shared/examRules.js';
import { assignmentService } from './assignments/runtime.js';
// The same guard MySEB ships for external exam sites (myseb/backend/src/remoteGuard.js).
import { remoteMySebGuard } from '../../myseb/backend/src/remoteGuard.js';

/**
 * MySEB: the device lock around tests and assignments.
 *  - A form with exam.requireMyseb only answers students who come through the MySEB app (desktop, phone) or its
 *    Chrome extension. Everything else gets 403 { code: 'MYSEB_REQUIRED' } and the page shows how to get MySEB.
 *  - The lecturer never visits the MySEB dashboard: code, live monitor, resume and end are done from bwenge, which
 *    talks to the MySEB server with MYSEB_SERVICE_KEY (server to server; the key never reaches a browser).
 */
const MYSEB_URL = () => (process.env.MYSEB_URL || '').replace(/\/$/, '');
const SERVICE_KEY = () => process.env.MYSEB_SERVICE_KEY || '';
export const mySebConfigured = () => Boolean(MYSEB_URL() && SERVICE_KEY());
const NO_SUCH_EXAM = '00000000-0000-0000-0000-000000000000';

export class MySebError extends Error {
  constructor(message: string, public status = 400, public code = 'MYSEB_ERROR') { super(message); }
}

async function mysebFetch(path: string, init: { method?: string; body?: unknown } = {}) {
  if (!mySebConfigured()) throw new MySebError('MySEB is not set up on this server (MYSEB_URL and MYSEB_SERVICE_KEY).', 503, 'MYSEB_NOT_CONFIGURED');
  let res: Response;
  try {
    res = await fetch(`${MYSEB_URL()}/api${path}`, {
      method: init.method ?? 'GET', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY()}` },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new MySebError('The MySEB server cannot be reached.', 502, 'MYSEB_UNREACHABLE');
  }
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new MySebError(json.error || 'MySEB refused the request.', res.status === 401 ? 502 : res.status);
  return json;
}

/* ------------------------------------------------------------------ guard for the students' routes */
/** What a student route belongs to: a form (`/api/forms/:id`) or an assignment link (`/a/:token`). */
export type MySebKind = 'form' | 'assignment';
interface Resolved { examId: string | null; ownerId?: string }
const cache = new Map<string, { at: number; r: Resolved }>();

async function resolve(kind: MySebKind, req: Request): Promise<Resolved> {
  const ref = String(kind === 'form' ? (req.params.id ?? req.params.formId ?? '') : (req.params.token ?? ''));
  if (!ref) return { examId: null };
  const ck = `${kind}:${ref}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < 5000) return hit.r;
  let r: Resolved = { examId: null };
  if (kind === 'form') {
    const row = await prisma.applicationForm.findUnique({ where: { id: ref }, select: { schema: true, userId: true } }).catch(() => null);
    let schema: any = {};
    try { schema = JSON.parse(row?.schema || '{}'); } catch { /* unreadable schema: not a MySEB form */ }
    const exam = normalizeExam(schema.exam);
    // Required but no code made yet: nobody can be inside, so the test stays closed until the lecturer makes a code.
    r = !row || !exam.requireMyseb ? { examId: null } : { examId: exam.mysebExamId ?? NO_SUCH_EXAM, ownerId: row.userId };
  } else {
    const a = await assignmentService().mysebForToken(ref);
    r = !a || !a.requireMyseb ? { examId: null } : { examId: a.mysebExamId ?? NO_SUCH_EXAM, ownerId: a.ownerId };
  }
  cache.set(ck, { at: Date.now(), r });
  if (cache.size > 2000) cache.clear();
  return r;
}
export const forgetCache = (kind: MySebKind, ref: string) => cache.delete(`${kind}:${ref}`);

/** The lecturer who owns it can open it normally (preview, edit) without MySEB. */
async function isOwner(req: Request, ownerId?: string): Promise<boolean> {
  const auth = req.get('authorization');
  if (!ownerId || !auth?.startsWith('Bearer ')) return false;
  try {
    const d: any = jwt.verify(auth.slice(7).trim(), getJwtSecret(), { algorithms: ['HS256'], issuer: 'bwenge', audience: 'bwenge-web' });
    return !!d?.userId && d.userId === ownerId;
  } catch { return false; }
}

const guardFor = (kind: MySebKind, soft: boolean): RequestHandler => {
  const handler = remoteMySebGuard({
    mysebUrl: MYSEB_URL(), serviceKey: SERVICE_KEY(), soft,
    examIdFor: async (req: Request) => {
      const r = await resolve(kind, req);
      (req as any)._mysebOwner = r.ownerId;
      if (r.examId && !mySebConfigured()) throw new MySebError('This needs MySEB, which is not set up on this server.', 503, 'MYSEB_NOT_CONFIGURED');
      return r.examId;
    },
    bypass: (req: Request) => isOwner(req, (req as any)._mysebOwner),
  });
  return (req, res, next) => handler(req, res, next);
};

/** Put in front of every route a student uses to read or answer a form (`kind: 'form'`) or a hand-in link (`'assignment'`). */
export const mySebGuard = (kind: MySebKind = 'form'): RequestHandler => guardFor(kind, false);
/** Never denies: only gives the phone app its cookie on the page request (a phone web view cannot add the header to later requests). */
export const mySebShell = (kind: MySebKind = 'form'): RequestHandler => guardFor(kind, true);

/* ------------------------------------------------------------------ lecturer actions */
/** The thing being protected: a form or a hand-in task, as far as MySEB cares. */
export interface MySebTarget {
  kind: MySebKind; ref: string; title: string; url: string; mysebExamId: string | null;
  leaveAction: 'record' | 'pause' | 'end'; minutes: number;
  saveExamId(id: string): Promise<void>;
}
export type TargetLoader = () => Promise<MySebTarget>;

const LEAVE_MAP = { record: 'record', warn: 'record', pause: 'pause', end: 'end' } as const;
const appUrl = () => (process.env.APP_URL || '').replace(/\/$/, '');

export const formTarget = (userId: string, formId: string): TargetLoader => async () => {
  const row = await prisma.applicationForm.findFirst({ where: { id: formId, userId } });
  if (!row) throw new MySebError('Form not found (or it belongs to someone else).', 404, 'NOT_FOUND');
  let schema: any = {};
  try { schema = JSON.parse(row.schema || '{}'); } catch { schema = {}; }
  const exam = normalizeExam(schema.exam);
  return {
    kind: 'form', ref: formId, title: row.title, url: `${appUrl()}/forms/${formId}`, mysebExamId: exam.mysebExamId ?? null,
    leaveAction: LEAVE_MAP[exam.leaveAction], minutes: exam.enabled ? exam.minutes : 180,
    async saveExamId(id) {
      schema.exam = { ...normalizeExam(schema.exam), requireMyseb: true, mysebExamId: id };
      await prisma.applicationForm.update({ where: { id: formId }, data: { schema: JSON.stringify(schema) } });
    },
  };
};

export const assignmentTarget = (userId: string, id: string): TargetLoader => async () => {
  const svc = assignmentService();
  let info;
  try { info = await svc.mysebInfo(userId, id); } catch { throw new MySebError('Task not found.', 404, 'NOT_FOUND'); }
  // A hand-in is a sitting: from the first hand-in screen to the due time (3 hours when there is no due time).
  const left = info.dueAt ? Math.round((Date.parse(info.dueAt) - Date.now()) / 60000) : 180;
  return {
    kind: 'assignment', ref: id, title: info.title, url: info.link, mysebExamId: info.mysebExamId,
    leaveAction: 'pause', minutes: Math.max(30, Math.min(600, left)),
    async saveExamId(examId) { await svc.setMysebExamId(userId, id, examId); },
  };
};

/** Creates the matching MySEB exam the first time a lecturer asks for a code, and remembers it. */
async function ensureMysebExam(t: MySebTarget): Promise<string> {
  if (t.mysebExamId) return t.mysebExamId;
  if (!appUrl()) throw new MySebError('APP_URL is not set, so MySEB does not know where this lives.', 500, 'APP_URL_MISSING');
  const created = await mysebFetch('/exams', {
    method: 'POST',
    body: { title: t.title, examUrl: t.url, requireMyseb: true, allowExtension: true, leaveAction: t.leaveAction, durationMinutes: t.minutes },
  });
  await t.saveExamId(created.id);
  forgetCache(t.kind, t.ref);
  return created.id as string;
}

export async function generateCode(load: TargetLoader) {
  const examId = await ensureMysebExam(await load());
  const r = await mysebFetch(`/exams/${examId}/generate-code`, { method: 'POST' });
  // The exam secret is for per-code gating; bwenge uses the service key, so it is not passed on to the browser.
  return { mysebExamId: examId, code: r.code, display: r.display, qrSvg: r.qrSvg, joinUrl: r.joinUrl, expiresAt: r.expiresAt };
}

export async function monitor(load: TargetLoader) {
  const t = await load();
  if (!t.mysebExamId) return { counts: { IN_EXAM: 0, PAUSED: 0, LEFT: 0, ENDED: 0 }, students: [] };
  return mysebFetch(`/exams/${t.mysebExamId}/monitor`);
}

const SID = /^[0-9a-f-]{36}$/i;
async function ownStudent(load: TargetLoader, sid: string) {
  if (!SID.test(sid)) throw new MySebError('Bad session id.', 400);
  const m = await monitor(load);
  if (!m.students.some((s: any) => s.id === sid)) throw new MySebError('That student is not in this test.', 404, 'NOT_FOUND');   // a lecturer can only touch their own students
}

export async function sessionAction(load: TargetLoader, sid: string, action: 'resume' | 'end') {
  await ownStudent(load, sid);
  return mysebFetch(`/sessions/${sid}/${action}`, { method: 'POST' });
}

export async function endAll(load: TargetLoader) {
  const t = await load();
  if (!t.mysebExamId) return { ok: true };
  return mysebFetch(`/exams/${t.mysebExamId}/end`, { method: 'POST' });
}

export async function violations(load: TargetLoader, sid: string) {
  await ownStudent(load, sid);
  return mysebFetch(`/sessions/${sid}/violations`);
}

/** Where students get the apps. Set these to your real download pages (see .env.example). */
export function downloadLinks() {
  const e = process.env;
  return {
    windows: e.MYSEB_DL_WINDOWS || '', mac: e.MYSEB_DL_MAC || '', linux: e.MYSEB_DL_LINUX || '',
    android: e.MYSEB_DL_ANDROID || '', ios: e.MYSEB_DL_IOS || '', extension: e.MYSEB_DL_EXTENSION || '',
  };
}
