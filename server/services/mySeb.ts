import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { createHmac } from 'node:crypto';
import { prisma } from '../db.js';
import { getJwtSecret } from '../auth/secrets.js';
import { normalizeExam } from '../../shared/examRules.js';
import { assignmentService } from './assignments/runtime.js';
import { flagOn } from './platform/settings.js';
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
  constructor(message: string, public status = 400, public code = 'MYSEB_ERROR', public data?: unknown) { super(message); }
}

async function mysebFetch(path: string, init: { method?: string; body?: unknown; timeoutMs?: number; signal?: AbortSignal } = {}) {
  if (!mySebConfigured()) throw new MySebError('MySEB is not set up on this server (MYSEB_URL and MYSEB_SERVICE_KEY).', 503, 'MYSEB_NOT_CONFIGURED');
  let res: Response;
  try {
    res = await fetch(`${MYSEB_URL()}/api${path}`, {
      method: init.method ?? 'GET', signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(init.timeoutMs ?? 8000)]) : AbortSignal.timeout(init.timeoutMs ?? 8000),
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
  /** Who owns the test: they are the one who pays for MySEB. */
  ownerId: string;
  kind: MySebKind; ref: string; title: string; url: string; mysebExamId: string | null;
  leaveAction: 'record' | 'pause' | 'end'; minutes: number;
  saveExamId(id: string): Promise<void>;
}
export type TargetLoader = () => Promise<MySebTarget>;

const LEAVE_MAP = { record: 'record', warn: 'record', pause: 'pause', end: 'end' } as const;
/** Public address of this site. APP_URL wins; otherwise the same fallbacks the rest of the app uses, then the live site. */
const appUrl = () => {
  const e = process.env;
  const vercel = e.VERCEL_PROJECT_PRODUCTION_URL ? `https://${e.VERCEL_PROJECT_PRODUCTION_URL}` : '';
  return (e.APP_URL || e.APP_BASE_URL || e.RENDER_EXTERNAL_URL || vercel || 'https://www.bwenge.space').replace(/\/$/, '');
};

export const formTarget = (userId: string, formId: string): TargetLoader => async () => {
  const row = await prisma.applicationForm.findFirst({ where: { id: formId, userId } });
  if (!row) throw new MySebError('Form not found (or it belongs to someone else).', 404, 'NOT_FOUND');
  let schema: any = {};
  try { schema = JSON.parse(row.schema || '{}'); } catch { schema = {}; }
  const exam = normalizeExam(schema.exam);
  return {
    ownerId: userId, kind: 'form', ref: formId, title: row.title, url: `${appUrl()}/forms/${formId}`, mysebExamId: exam.mysebExamId ?? null,
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
    ownerId: userId, kind: 'assignment', ref: id, title: info.title, url: info.link, mysebExamId: info.mysebExamId,
    leaveAction: 'pause', minutes: Math.max(30, Math.min(600, left)),
    async saveExamId(examId) { await svc.setMysebExamId(userId, id, examId); },
  };
};

/** Creates the matching MySEB exam the first time a lecturer asks for a code, and remembers it. */
async function ensureMysebExam(t: MySebTarget): Promise<string> {
  if (t.mysebExamId) return t.mysebExamId;
  const created = await mysebFetch('/exams', {
    method: 'POST',
    body: { title: t.title, examUrl: t.url, requireMyseb: true, allowExtension: true, leaveAction: t.leaveAction, durationMinutes: t.minutes },
  });
  await t.saveExamId(created.id);
  forgetCache(t.kind, t.ref);
  return created.id as string;
}

export async function generateCode(load: TargetLoader) {
  if (!flagOn('myseb.enabled')) throw new MySebError('MySEB is paused by the platform administrator. Try again later.', 503, 'MYSEB_PAUSED');
  const target = await load();
  // MySEB is sold: a code needs a monthly plan or a test credit (administrators and a switched-off paywall are exempt).
  await (await import('./mySebAccess.js')).requireMySebAccess(target.ownerId, `${target.kind}:${target.ref}`);
  const examId = await ensureMysebExam(target);
  const r = await mysebFetch(`/exams/${examId}/generate-code`, { method: 'POST' });
  // The exam secret is for per-code gating; bwenge uses the service key, so it is not passed on to the browser.
  return { mysebExamId: examId, code: r.code, display: r.display, qrSvg: r.qrSvg, joinUrl: r.joinUrl, expiresAt: r.expiresAt };
}

export async function monitor(load: TargetLoader, opts: { frames?: boolean } = {}) {
  const t = await load();
  if (!t.mysebExamId) return { exam: { title: (t as { title?: string }).title ?? 'Live room', status: 'active', live_faces: false, live_mode: 'off', live_sound: false }, counts: { IN_EXAM: 0, PAUSED: 0, LEFT: 0, ENDED: 0 }, students: [] };
  return mysebFetch(`/exams/${t.mysebExamId}/monitor${opts.frames === false ? '?frames=0' : ''}`);
}
/** Camera pictures for the students whose tiles are on screen. */
export async function frames(load: TargetLoader, ids: string[]) {
  const t = await load();
  if (!t.mysebExamId || !ids.length) return { frames: {} };
  return mysebFetch(`/exams/${t.mysebExamId}/frames?ids=${ids.filter((x) => SID.test(x)).slice(0, 60).join(',')}`);
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

/** Disqualified for breaking a rule (not ended by the lecturer): let the student back in. Recorded in their log. */
export async function reinstate(load: TargetLoader, sid: string, minutes?: number) {
  await ownStudent(load, sid);
  return mysebFetch(`/sessions/${sid}/reinstate`, { method: 'POST', ...(minutes ? { body: { minutes } } : {}) });
}
/** Keep the pictures the server holds for this student right now as evidence (memory only on the MySEB server). */
export async function captureEvidenceFor(load: TargetLoader, sid: string, type: string): Promise<boolean> {
  await ownStudent(load, sid);
  return Boolean(((await mysebFetch(`/sessions/${sid}/capture`, { method: 'POST', body: { type } })) as { kept?: boolean }).kept);
}
/** How many evidence pictures the server holds per student (memory only on the MySEB server), and the pictures of one student. */
export async function evidenceCounts(load: TargetLoader): Promise<Record<string, number>> {
  const t = await load();
  if (!t.mysebExamId) return {};
  return ((await mysebFetch(`/exams/${t.mysebExamId}/evidence`)) as { counts?: Record<string, number> }).counts ?? {};
}
export async function evidenceOf(load: TargetLoader, sid: string): Promise<Array<{ at: string; type: string; frame: string | null; screen: string | null }>> {
  const t = await load();
  if (!t.mysebExamId) return [];
  await ownStudent(load, sid);
  return ((await mysebFetch(`/exams/${t.mysebExamId}/evidence?sessionId=${encodeURIComponent(sid)}`, { timeoutMs: 20000 })) as { items?: any[] }).items ?? [];
}
/** What a student had typed when they left (saved every few seconds by their browser). */
export async function savedAnswers(load: TargetLoader, sid: string) {
  await ownStudent(load, sid);
  return mysebFetch(`/sessions/${sid}/partial`);
}
/** Student cards waiting for a look (browsers, when the card check is on), and the lecturer's decision. */
export async function idChecks(load: TargetLoader) {
  const t = await load();
  if (!t.mysebExamId) return { pending: [] };
  return mysebFetch(`/exams/${t.mysebExamId}/id-checks`);
}
export async function idDecision(load: TargetLoader, sid: string, allow: boolean) {
  await ownStudent(load, sid);
  return mysebFetch(`/sessions/${sid}/id-decision`, { method: 'POST', body: { allow } });
}

export async function endAll(load: TargetLoader) {
  const t = await load();
  if (!t.mysebExamId) return { ok: true };
  return mysebFetch(`/exams/${t.mysebExamId}/end`, { method: 'POST' });
}

export async function pauseAll(load: TargetLoader) {
  const t = await load();
  return t.mysebExamId ? mysebFetch(`/exams/${t.mysebExamId}/pause-all`, { method: 'POST' }) : { ok: true, changed: 0 };
}
export async function resumeAll(load: TargetLoader) {
  const t = await load();
  return t.mysebExamId ? mysebFetch(`/exams/${t.mysebExamId}/resume-all`, { method: 'POST' }) : { ok: true, changed: 0 };
}
/** More time for everyone still in the test, or for one student (1-60 minutes). */
export async function extendTime(load: TargetLoader, minutes: number, sid?: string) {
  const t = await load();
  if (!t.mysebExamId) throw new MySebError('This test has no live room yet.', 404, 'NOT_FOUND');
  if (sid) await ownStudent(load, sid);
  return mysebFetch(`/exams/${t.mysebExamId}/extend`, { method: 'POST', body: { minutes, ...(sid ? { sessionId: sid } : {}) } });
}
/** A short message on the students' screens (all of them, or one). */
export async function sendNotice(load: TargetLoader, text: string, sid?: string) {
  const t = await load();
  if (!t.mysebExamId) throw new MySebError('This test has no live room yet.', 404, 'NOT_FOUND');
  if (sid) await ownStudent(load, sid);
  return mysebFetch(`/exams/${t.mysebExamId}/notice`, { method: 'POST', body: { text, ...(sid ? { sessionId: sid } : {}) } });
}
/** The lecturer asks for (or stops) small camera pictures in the live room. Made on the MySEB exam, created first if needed. */
export async function setLiveFaces(load: TargetLoader, on: boolean) {
  const examId = await ensureMysebExam(await load());
  return mysebFetch(`/exams/${examId}`, { method: 'PATCH', body: { liveFaces: !!on } });
}

/** What the exam page tells the live room: the question the student is on and, if asked for, a small picture. Never stored here. */
const lastLive = new Map<string, number>();
const lastAnswer = new Map<string, LiveAnswer>();
export type LiveSource = 'camera' | 'screen' | 'both';
export interface LiveAnswer { faces: boolean; live: boolean; sound: boolean; source?: LiveSource; pictures?: boolean; every?: number }
export async function relayLive(sessionId: string, body: any): Promise<LiveAnswer> {
  const now = Date.now();
  if (now - (lastLive.get(sessionId) ?? 0) < 3000) return lastAnswer.get(sessionId) ?? { faces: false, live: false, sound: false };   // at most one report every 3 s per student
  lastLive.set(sessionId, now);
  if (lastLive.size > 5000) lastLive.clear();
  const q = body?.question && typeof body.question === 'object' ? { index: body.question.index, total: body.question.total, label: String(body.question.label ?? '').slice(0, 200) } : undefined;
  const frame = typeof body?.frame === 'string' && body.frame.length <= 16000 ? body.frame : undefined;
  const screen = typeof body?.screen === 'string' && body.screen.length <= 30000 ? body.screen : undefined;
  const r = await mysebFetch(`/sessions/${sessionId}/live`, { method: 'POST', body: { question: q, camera: body?.camera, frame, screen, screenState: body?.screenState } });
  const answer: LiveAnswer = { faces: !!r.faces, live: !!r.live, sound: !!r.sound, source: (['camera', 'screen', 'both'] as const).includes(r.source) ? r.source : 'camera', pictures: r.pictures === true, every: Math.max(3, Math.min(30, Number(r.every) || 5)) };
  lastAnswer.set(sessionId, answer);
  if (lastAnswer.size > 5000) lastAnswer.clear();
  return answer;
}

/** Camera in the live room: off, small pictures, or live video; and whether the lecturer may listen. */
export const LEAVE_ACTIONS = ['record', 'pause', 'end', 'pause_then_end'] as const;
export async function setLiveMode(load: TargetLoader, mode: 'off' | 'pictures' | 'live', sound: boolean, extra: { source?: unknown; leaveAction?: unknown; allowWeb?: unknown; webStrict?: unknown; multiFace?: unknown; idCheck?: unknown; webDevices?: unknown } = {}) {
  const examId = await ensureMysebExam(await load());
  const source = (['camera', 'screen', 'both'] as const).find((x) => x === extra.source);
  const leaveAction = LEAVE_ACTIONS.find((x) => x === extra.leaveAction);
  return mysebFetch(`/exams/${examId}`, { method: 'PATCH', body: { liveMode: mode, liveSound: mode === 'live' && sound && source !== 'screen', ...(source ? { liveSource: source } : {}), ...(leaveAction ? { leaveAction } : {}), ...(typeof extra.allowWeb === 'boolean' ? { allowWeb: extra.allowWeb } : {}), ...(typeof extra.webStrict === 'boolean' ? { webStrict: extra.webStrict } : {}), ...(extra.multiFace === 'off' || extra.multiFace === 'warn' || extra.multiFace === 'end' ? { multiFace: extra.multiFace } : {}), ...(typeof extra.idCheck === 'boolean' ? { idCheck: extra.idCheck } : {}), ...(extra.webDevices === 'any' || extra.webDevices === 'ios' ? { webDevices: extra.webDevices } : {}) } });
}

/* ---- live video: only the short set-up messages pass through here; the video goes student -> lecturer directly ---- */
/** The network helper servers WebRTC needs. TURN passwords are short-lived (coturn `use-auth-secret`), never fixed. */
export function iceServers() {
  const stun = (process.env.MYSEB_STUN_URLS || 'stun:stun.l.google.com:19302').split(',').map((x) => x.trim()).filter(Boolean);
  const list: Array<{ urls: string[]; username?: string; credential?: string }> = [{ urls: stun }];
  const turn = (process.env.MYSEB_TURN_URLS || '').split(',').map((x) => x.trim()).filter(Boolean);
  const secret = process.env.MYSEB_TURN_SECRET;
  if (turn.length && secret) {
    const username = `${Math.floor(Date.now() / 1000) + 6 * 3600}:myseb`;
    list.push({ urls: turn, username, credential: createHmac('sha1', secret).update(username).digest('base64') });
  }
  return { iceServers: list, turn: turn.length > 0 && !!secret };
}

/** Students waiting for a lecturer message hold one connection each. Past this many, new ones are told to come back later instead of piling up. */
export const MAX_HELD_PULLS = Number(process.env.MYSEB_MAX_HELD || 6000);
let heldPulls = 0;
export const heldPullCount = () => heldPulls;
export async function heldStudentSignalPull(sid: string, after: number, signal: AbortSignal) {
  if (heldPulls >= MAX_HELD_PULLS) throw new MySebError('Busy. Try again in a moment.', 503, 'BUSY');
  heldPulls++;
  try { return await studentSignalPull(sid, after, signal); } finally { heldPulls--; }
}
export const studentSignalPull = (sid: string, after: number, signal: AbortSignal) =>
  mysebFetch(`/sessions/${sid}/from-lecturer?after=${Math.max(0, after | 0)}&wait=20000`, { timeoutMs: 26000, signal });
export const studentSignalPush = (sid: string, msg: unknown) => mysebFetch(`/sessions/${sid}/to-lecturer`, { method: 'POST', body: { msg } });

/* ---- instant updates: the lecturer's room keeps one stream open and is told the moment something changes ---- */
const roomStreams = new Map<string, number>();
export async function streamRoomEvents(load: TargetLoader, res: import('express').Response) {
  const t = await load();
  if (!t.mysebExamId) { res.status(204).end(); return; }          // nobody has joined yet: the room checks on a timer until then
  if (!mySebConfigured()) throw new MySebError('MySEB is not set up on this server (MYSEB_URL and MYSEB_SERVICE_KEY).', 503, 'MYSEB_NOT_CONFIGURED');
  const examId = t.mysebExamId;
  const open = roomStreams.get(examId) ?? 0;
  if (open >= 6) throw new MySebError('Too many live rooms are open for this test.', 429, 'TOO_MANY_STREAMS');
  const ac = new AbortController(); res.on('close', () => ac.abort());
  let up: Response;
  try {
    up = await fetch(`${MYSEB_URL()}/api/exams/${examId}/events`, { headers: { Authorization: `Bearer ${SERVICE_KEY()}`, Accept: 'text/event-stream' }, signal: ac.signal });
  } catch { throw new MySebError('The MySEB server cannot be reached.', 502, 'MYSEB_UNREACHABLE'); }
  if (!up.ok || !up.body) throw new MySebError('Instant updates are not available.', up.status === 503 ? 503 : 502);
  roomStreams.set(examId, open + 1);
  res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const { Readable } = await import('node:stream');
  const body = Readable.fromWeb(up.body as any);
  body.on('error', () => res.end()); body.on('end', () => res.end());
  res.on('close', () => { roomStreams.set(examId, Math.max(0, (roomStreams.get(examId) ?? 1) - 1)); body.destroy(); });
  body.pipe(res);
}

/** Who is in the lecturer's room, remembered for a few seconds so ICE traffic does not ask the database every time. */
const roomCache = new Map<string, { at: number; sids: Set<string>; examId: string }>();
async function roomOf(load: TargetLoader) {
  const t = await load();
  if (!t.mysebExamId) throw new MySebError('Nobody has joined yet.', 404, 'NOT_FOUND');
  const hit = roomCache.get(t.mysebExamId);
  if (hit && Date.now() - hit.at < 8000) return hit;
  const m = await mysebFetch(`/exams/${t.mysebExamId}/monitor`);
  const r = { at: Date.now(), sids: new Set<string>(m.students.map((x: any) => x.id)), examId: t.mysebExamId };
  roomCache.set(t.mysebExamId, r);
  if (roomCache.size > 500) roomCache.clear();
  return r;
}
export async function lecturerSignalPull(load: TargetLoader, after: number, signal: AbortSignal) {
  const room = await roomOf(load);
  return mysebFetch(`/exams/${room.examId}/from-students?after=${Math.max(0, after | 0)}&wait=20000`, { timeoutMs: 26000, signal });
}
export async function lecturerSignalPush(load: TargetLoader, sid: string, msg: unknown) {
  if (!SID.test(sid)) throw new MySebError('Bad session id.', 400);
  let room = await roomOf(load);
  if (!room.sids.has(sid)) { roomCache.delete(room.examId); room = await roomOf(load); }   // a student who just joined
  if (!room.sids.has(sid)) throw new MySebError('That student is not in this test.', 404, 'NOT_FOUND');
  return mysebFetch(`/sessions/${sid}/to-student`, { method: 'POST', body: { msg } });
}

/** The full record of the test (summary per student and a timeline), for the lecturer and for appeals. */
export async function report(load: TargetLoader) {
  const t = await load();
  if (!t.mysebExamId) throw new MySebError('Nobody has joined yet, so there is nothing to report.', 404, 'NOT_FOUND');
  return mysebFetch(`/exams/${t.mysebExamId}/report`, { timeoutMs: 20000 });
}

export async function violations(load: TargetLoader, sid: string) {
  await ownStudent(load, sid);
  return mysebFetch(`/sessions/${sid}/violations`);
}

/** Where students get the apps. Set these to your real download pages (see .env.example). */
export function downloadLinks() {
  const e = process.env;
  const r = '/myseb/download';
  return {
    windows: e.MYSEB_DL_WINDOWS || `${r}?platform=windows`, mac: e.MYSEB_DL_MAC || `${r}?platform=mac`, linux: e.MYSEB_DL_LINUX || `${r}?platform=linux`,
    android: e.MYSEB_DL_ANDROID || `${r}?platform=android`, ios: e.MYSEB_DL_IOS || '', extension: e.MYSEB_DL_EXTENSION || '',
  };
}
