import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';
import { getJwtSecret } from '../auth/secrets.js';
import { normalizeExam } from '../../shared/examRules.js';
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
const formCache = new Map<string, { at: number; examId: string | null }>();

async function examIdFor(req: Request): Promise<string | null> {
  const formId = String(req.params.id ?? req.params.formId ?? '');
  if (!formId) return null;
  const hit = formCache.get(formId);
  let examId: string | null;
  if (hit && Date.now() - hit.at < 5000) examId = hit.examId;
  else {
    const row = await prisma.applicationForm.findUnique({ where: { id: formId }, select: { schema: true } }).catch(() => null);
    let schema: any = {};
    try { schema = JSON.parse(row?.schema || '{}'); } catch { /* unreadable schema: not a MySEB form */ }
    const exam = normalizeExam(schema.exam);
    examId = !row || !exam.requireMyseb ? null : (exam.mysebExamId ?? NO_SUCH_EXAM);   // required but no code made yet: nobody can be in
    formCache.set(formId, { at: Date.now(), examId });
    if (formCache.size > 2000) formCache.clear();
  }
  if (examId && !mySebConfigured()) throw new MySebError('This test needs MySEB, which is not set up on this server.', 503, 'MYSEB_NOT_CONFIGURED');
  return examId;
}
export const forgetFormCache = (formId: string) => formCache.delete(formId);

/** The lecturer who owns the form can open it normally (preview, edit) without MySEB. */
async function isOwner(req: Request): Promise<boolean> {
  const auth = req.get('authorization');
  if (!auth?.startsWith('Bearer ')) return false;
  try {
    const d: any = jwt.verify(auth.slice(7).trim(), getJwtSecret(), { algorithms: ['HS256'], issuer: 'bwenge', audience: 'bwenge-web' });
    const form = await prisma.applicationForm.findUnique({ where: { id: String(req.params.id ?? req.params.formId) }, select: { userId: true } });
    return !!form && !!d?.userId && form.userId === d.userId;
  } catch { return false; }
}

const guardOpts = () => ({ mysebUrl: MYSEB_URL(), serviceKey: SERVICE_KEY(), examIdFor, bypass: isOwner });

/** Put in front of every route a student uses to read or answer a form. */
export const mySebGuard = (): RequestHandler => {
  const handler = remoteMySebGuard(guardOpts());
  return (req, res, next) => handler(req, res, next);
};
/** Never denies: only gives the phone app its cookie on the page request (a phone web view cannot add the header to later requests). */
export const mySebShell = (): RequestHandler => {
  const handler = remoteMySebGuard({ ...guardOpts(), soft: true });
  return (req, res, next) => handler(req, res, next);
};

/* ------------------------------------------------------------------ lecturer actions */
async function ownedExam(userId: string, formId: string) {
  const row = await prisma.applicationForm.findFirst({ where: { id: formId, userId } });
  if (!row) throw new MySebError('Form not found (or it belongs to someone else).', 404, 'NOT_FOUND');
  let schema: any = {};
  try { schema = JSON.parse(row.schema || '{}'); } catch { schema = {}; }
  return { row, schema, exam: normalizeExam(schema.exam) };
}

const LEAVE_MAP = { record: 'record', warn: 'record', pause: 'pause', end: 'end' } as const;

/** Creates the matching MySEB exam the first time a lecturer asks for a code, and remembers it on the form. */
async function ensureMysebExam(userId: string, formId: string): Promise<string> {
  const { row, schema, exam } = await ownedExam(userId, formId);
  if (exam.mysebExamId) return exam.mysebExamId;
  const base = (process.env.APP_URL || '').replace(/\/$/, '');
  if (!base) throw new MySebError('APP_URL is not set, so MySEB does not know where the test lives.', 500, 'APP_URL_MISSING');
  const created = await mysebFetch('/exams', {
    method: 'POST',
    body: {
      title: row.title, examUrl: `${base}/forms/${formId}`, requireMyseb: true, allowExtension: true,
      leaveAction: LEAVE_MAP[exam.leaveAction], durationMinutes: exam.enabled ? exam.minutes : 180,
    },
  });
  schema.exam = { ...normalizeExam(schema.exam), requireMyseb: true, mysebExamId: created.id };
  await prisma.applicationForm.update({ where: { id: formId }, data: { schema: JSON.stringify(schema) } });
  forgetFormCache(formId);
  return created.id as string;
}

export async function generateCode(userId: string, formId: string) {
  const examId = await ensureMysebExam(userId, formId);
  const r = await mysebFetch(`/exams/${examId}/generate-code`, { method: 'POST' });
  // The exam secret is for per-code gating; bwenge uses the service key, so it is not passed on to the browser.
  return { mysebExamId: examId, code: r.code, display: r.display, qrSvg: r.qrSvg, joinUrl: r.joinUrl, expiresAt: r.expiresAt };
}

export async function monitor(userId: string, formId: string) {
  const { exam } = await ownedExam(userId, formId);
  if (!exam.mysebExamId) return { counts: { IN_EXAM: 0, PAUSED: 0, LEFT: 0, ENDED: 0 }, students: [] };
  return mysebFetch(`/exams/${exam.mysebExamId}/monitor`);
}

export async function sessionAction(userId: string, formId: string, sid: string, action: 'resume' | 'end') {
  if (!/^[0-9a-f-]{36}$/i.test(sid)) throw new MySebError('Bad session id.', 400);
  const m = await monitor(userId, formId);
  if (!m.students.some((s: any) => s.id === sid)) throw new MySebError('That student is not in this test.', 404, 'NOT_FOUND');   // a lecturer can only touch their own test's students
  return mysebFetch(`/sessions/${sid}/${action}`, { method: 'POST' });
}

export async function endAll(userId: string, formId: string) {
  const { exam } = await ownedExam(userId, formId);
  if (!exam.mysebExamId) return { ok: true };
  return mysebFetch(`/exams/${exam.mysebExamId}/end`, { method: 'POST' });
}

export async function violations(userId: string, formId: string, sid: string) {
  const m = await monitor(userId, formId);
  if (!/^[0-9a-f-]{36}$/i.test(sid) || !m.students.some((s: any) => s.id === sid)) throw new MySebError('That student is not in this test.', 404, 'NOT_FOUND');
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
