import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { CameraRule, ExamSettings } from '../../../shared/examRules.js';
import type { Accommodation } from '../courses/service.js';

/**
 * Timed tests. The SERVER keeps the clock: the browser only shows it. A student starts a session (identity, then
 * accommodations from the class roster), the clock runs while the session runs, and it stops while the session
 * is paused (a break, or the camera rule, or the lecturer). Submitting needs the session's secret, so a response
 * cannot be sent by someone who did not sit the test, and a response after the end is refused.
 *
 * The camera never reaches the server: the page reports events ("face out of frame for 9 s") and this service
 * decides what they mean for the form's camera rule: warn (record only) or pause (the lecturer decides).
 */

export type ExamStatus = 'running' | 'paused' | 'submitted' | 'ended';
export interface ExamEvent { t: number; type: string; detail?: string; by?: 'student' | 'system' | 'lecturer' }
interface PauseInfo { by: 'student' | 'system' | 'lecturer'; reason: string; since: number }

export interface ExamSession {
  id: string; formId: string; ownerId: string; token: string;
  studentId: string; studentName: string;
  startedAt: number; baseMs: number; extraMs: number;
  usedMs: number; runningSince: number | null;
  status: ExamStatus; pause: PauseInfo | null; endedAt?: number; submittedAt?: number;
  camera: CameraRule; graceSeconds: number;
  accommodations: Accommodation | null;
  events: ExamEvent[];
  /** The lecturer let this student back in: the next start returns this session with a new secret. */
  reentry?: boolean;
}

export class ExamError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

const EVENT_TYPES = new Set(['face_lost', 'face_back', 'multiple_faces', 'camera_denied', 'camera_stopped', 'camera_ok', 'tab_hidden', 'tab_back', 'offline', 'online']);
const MAX_EVENTS = 600;
const SUBMIT_GRACE_MS = 90_000;
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '');
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ExamFormInfo { ownerId: string; title: string; exam: ExamSettings }

export function createFormExamService(deps: {
  dir: string;
  forms: (formId: string) => Promise<ExamFormInfo | null>;
  accommodations?: (ownerId: string, courseId: string, studentId: string) => Promise<{ name: string; accommodations: Accommodation } | null>;
  now?: () => number;
}) {
  const now = () => (deps.now ?? Date.now)();
  const root = path.resolve(deps.dir);
  const file = (sid: string) => { if (!ID_RE.test(sid)) throw new ExamError('NOT_FOUND', 'Test session not found.', 404); return path.join(root, `${sid}.json`); };
  const indexDir = (formId: string) => { if (!ID_RE.test(formId)) throw new ExamError('NOT_FOUND', 'Test not found.', 404); return path.join(root, 'by-form', formId); };

  // One change at a time per session (heartbeats and events can arrive together).
  const locks = new Map<string, Promise<unknown>>();
  const locked = <T,>(sid: string, fn: () => Promise<T>): Promise<T> => {
    const run = (locks.get(sid) ?? Promise.resolve()).catch(() => undefined).then(fn);
    locks.set(sid, run);
    run.finally(() => { if (locks.get(sid) === run) locks.delete(sid); }).catch(() => undefined);
    return run;
  };
  async function read(sid: string): Promise<ExamSession> {
    try { return JSON.parse(await fs.readFile(file(sid), 'utf8')); } catch (e) { if (e instanceof ExamError) throw e; throw new ExamError('NOT_FOUND', 'Test session not found.', 404); }
  }
  async function write(r: ExamSession) {
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const f = file(r.id), tmp = `${f}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(r), { mode: 0o600 });
    await fs.rename(tmp, f);
  }
  const sameToken = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
  /** Reads a session for the student and checks the secret. */
  async function mine(sid: string, token: unknown): Promise<ExamSession> {
    const r = await read(sid);
    if (typeof token !== 'string' || !sameToken(r.token, token)) throw new ExamError('NOT_FOUND', 'Test session not found.', 404);
    return r;
  }
  async function owned(ownerId: string, sid: string): Promise<ExamSession> {
    const r = await read(sid);
    if (r.ownerId !== ownerId) throw new ExamError('NOT_FOUND', 'Test session not found.', 404);
    return r;
  }

  const total = (r: ExamSession) => r.baseMs + r.extraMs;
  const used = (r: ExamSession, t: number) => r.usedMs + (r.runningSince !== null ? t - r.runningSince : 0);
  const remaining = (r: ExamSession, t: number) => Math.max(0, total(r) - used(r, t));
  const log = (r: ExamSession, type: string, by?: ExamEvent['by'], detail?: string) => { if (r.events.length < MAX_EVENTS) r.events.push({ t: now(), type, ...(detail ? { detail } : {}), ...(by ? { by } : {}) }); };

  function pauseNow(r: ExamSession, by: PauseInfo['by'], reason: string) {
    if (r.status !== 'running') return;
    const t = now();
    r.usedMs = used(r, t); r.runningSince = null; r.status = 'paused'; r.pause = { by, reason, since: t };
    log(r, 'paused', by, reason);
  }
  function resumeNow(r: ExamSession, by: PauseInfo['by']) {
    if (r.status !== 'paused') return;
    const t = now();
    r.runningSince = t; r.status = 'running'; log(r, 'resumed', by, r.pause?.reason); r.pause = null;
  }
  /** Moves a running session to "ended" when its time is up. */
  function settle(r: ExamSession): boolean {
    if (r.status === 'running' && remaining(r, now()) <= 0) {
      // The moment the time really ran out (this is noticed later, when the page next asks).
      const ranOutAt = (r.runningSince ?? now()) + (total(r) - r.usedMs);
      r.usedMs = total(r); r.runningSince = null; r.status = 'ended'; r.endedAt = ranOutAt; log(r, 'time_up', 'system');
      return true;
    }
    return false;
  }

  const publicView = (r: ExamSession) => {
    const t = now();
    return {
      id: r.id, status: r.status, serverNow: t, remainingMs: remaining(r, t), totalMs: total(r),
      endsAt: r.status === 'running' ? t + remaining(r, t) : null,
      pause: r.pause ? { by: r.pause.by, reason: r.pause.reason } : null,
      camera: r.camera, graceSeconds: r.graceSeconds, studentName: r.studentName,
      accommodations: r.accommodations ? { largeText: r.accommodations.largeText, voiceAnswers: r.accommodations.voiceAnswers, breaks: r.accommodations.breaks, cameraExempt: r.accommodations.cameraExempt, extraTimePercent: r.accommodations.extraTimePercent } : null,
    };
  };

  function summary(r: ExamSession) {
    const count = (type: string) => r.events.filter((e) => e.type === type).length;
    const awaySeconds = r.events.filter((e) => e.type === 'face_back').reduce((n, e) => n + (Number(e.detail) || 0), 0);
    return { faceLost: count('face_lost'), multipleFaces: count('multiple_faces'), cameraProblems: count('camera_denied') + count('camera_stopped'), tabHidden: count('tab_hidden'), pauses: count('paused'), awaySeconds };
  }

  async function listForm(formId: string): Promise<ExamSession[]> {
    let names: string[] = [];
    try { names = await fs.readdir(indexDir(formId)); } catch (e) { if (e instanceof ExamError) throw e; }
    const out: ExamSession[] = [];
    for (const n of names) { try { out.push(await read(n)); } catch { /* removed */ } }
    return out;
  }

  return {
    async start(formId: string, input: { studentId?: unknown; name?: unknown }) {
      const form = await deps.forms(formId);
      if (!form || !form.exam.enabled) throw new ExamError('NOT_AN_EXAM', 'This form is not a timed test.', 404);
      const studentId = clean(input.studentId, 40);
      if (!studentId) throw new ExamError('ID_REQUIRED', 'Enter your registration number.');
      let name = clean(input.name, 80);
      let acc: Accommodation | null = null;
      if (form.exam.courseId && deps.accommodations) {
        const hit = await deps.accommodations(form.ownerId, form.exam.courseId, studentId).catch(() => null);
        if (hit) { name = hit.name; acc = hit.accommodations; }
        else if (form.exam.requireRoster) throw new ExamError('NOT_ON_LIST', 'This registration number is not on the class list. Check it, or ask your lecturer.', 403);
      }
      if (!name) throw new ExamError('NAME_REQUIRED', 'Write your name.');

      const before = (await listForm(formId)).find((s) => s.studentId.toLowerCase() === studentId.toLowerCase());
      if (before) {
        if (before.status === 'submitted') throw new ExamError('ALREADY_SUBMITTED', 'You have already handed in this test.', 409);
        if (!before.reentry) throw new ExamError('SESSION_EXISTS', 'You already started this test on another device or page. Ask your lecturer to let you back in.', 409);
        // Let back in: a new secret (the old page stops working); the clock kept running, and the lecturer can add time.
        return locked(before.id, async () => {
          const r = await read(before.id);
          r.token = randomBytes(24).toString('base64url'); delete r.reentry; log(r, 'reentry', 'lecturer');
          await write(r);
          return { ...publicView(r), secret: r.token };
        });
      }

      const baseMs = form.exam.minutes * 60_000;
      const extraMs = acc ? Math.round(baseMs * acc.extraTimePercent / 100) : 0;
      const exempt = !!acc?.cameraExempt;
      const t = now();
      const r: ExamSession = {
        id: randomUUID(), formId, ownerId: form.ownerId, token: randomBytes(24).toString('base64url'),
        studentId, studentName: name, startedAt: t, baseMs, extraMs, usedMs: 0, runningSince: t,
        status: 'running', pause: null, camera: exempt ? 'off' : form.exam.camera, graceSeconds: form.exam.graceSeconds,
        accommodations: acc, events: [{ t, type: 'started', by: 'student' }],
      };
      if (exempt && form.exam.camera !== 'off') r.events.push({ t, type: 'camera_exempt', by: 'system' });
      // With a camera check the clock waits until the camera is working (setting it up is not the student's time).
      if (r.camera !== 'off') { r.usedMs = 0; r.runningSince = null; r.status = 'paused'; r.pause = { by: 'system', reason: 'setup', since: t }; }
      await write(r);
      await fs.mkdir(indexDir(formId), { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(indexDir(formId), r.id), '', { mode: 0o600 });
      return { ...publicView(r), secret: r.token };
    },

    /** The student's page asks for the state (and so keeps the session alive). */
    async state(sid: string, token: unknown) {
      return locked(sid, async () => {
        const r = await mine(sid, token);
        if (settle(r)) await write(r);
        return publicView(r);
      });
    },

    /** A camera or page event from the student's browser. */
    async event(sid: string, token: unknown, input: { type?: unknown; seconds?: unknown }) {
      return locked(sid, async () => {
        const r = await mine(sid, token);
        if (r.status === 'submitted') return publicView(r);
        settle(r);
        const type = String(input.type ?? '');
        if (!EVENT_TYPES.has(type)) throw new ExamError('BAD_EVENT', 'Unknown event.');
        const seconds = typeof input.seconds === 'number' && Number.isFinite(input.seconds) ? Math.max(0, Math.min(86400, Math.round(input.seconds))) : undefined;
        // A camera event on a student without a camera check is ignored (they may be exempt).
        const cameraType = type.startsWith('face_') || type.startsWith('camera_') || type === 'multiple_faces';
        if (!(cameraType && r.camera === 'off')) {
          log(r, type, 'student', seconds !== undefined ? String(seconds) : undefined);
          // The camera works: the clock starts (first time) and the student is in the frame.
          if (type === 'camera_ok' && r.status === 'paused' && r.pause?.by === 'system' && r.pause.reason === 'setup') resumeNow(r, 'system');
          else if (r.camera === 'pause' && (type === 'face_lost' || type === 'camera_denied' || type === 'camera_stopped')) pauseNow(r, 'system', type);
        }
        await write(r);
        return publicView(r);
      });
    },

    /** A break (students with that accommodation): the clock stops until they come back. */
    async setBreak(sid: string, token: unknown, on: unknown) {
      return locked(sid, async () => {
        const r = await mine(sid, token);
        settle(r);
        if (!r.accommodations?.breaks) throw new ExamError('NO_BREAKS', 'Breaks are not set up for you. Ask your lecturer.', 403);
        if (on === true) pauseNow(r, 'student', 'break');
        else if (r.status === 'paused' && r.pause?.by === 'student') resumeNow(r, 'student');
        await write(r);
        return publicView(r);
      });
    },

    /** The form's submit route asks before accepting a response. */
    async checkSubmit(sid: unknown, token: unknown, formId: string) {
      if (typeof sid !== 'string') throw new ExamError('EXAM_SESSION_REQUIRED', 'This test must be started first, with your registration number.', 403);
      return locked(sid, async () => {
        const r = await mine(sid, token).catch(() => { throw new ExamError('EXAM_SESSION_REQUIRED', 'This test must be started first, with your registration number.', 403); });
        if (r.formId !== formId) throw new ExamError('EXAM_SESSION_REQUIRED', 'This session belongs to another test.', 403);
        if (settle(r)) await write(r);
        if (r.status === 'submitted') throw new ExamError('ALREADY_SUBMITTED', 'You have already handed in this test.', 409);
        if (r.status === 'paused') throw new ExamError('EXAM_PAUSED', 'The test is paused. Wait for your lecturer or end your break first.', 423);
        if (r.status === 'ended' && now() - (r.endedAt ?? 0) > SUBMIT_GRACE_MS) throw new ExamError('TIME_UP', 'The time for this test is over.', 403);
        return { studentId: r.studentId, studentName: r.studentName, timeUp: r.status === 'ended', ownerId: r.ownerId };
      });
    },

    async markSubmitted(sid: string) {
      return locked(sid, async () => {
        const r = await read(sid);
        const t = now();
        r.usedMs = Math.min(total(r), used(r, t)); r.runningSince = null; r.status = 'submitted'; r.submittedAt = t; r.pause = null; log(r, 'submitted', 'student');
        await write(r);
        return { sessionId: r.id, studentId: r.studentId, studentName: r.studentName, usedSeconds: Math.round(r.usedMs / 1000), allowedSeconds: Math.round(total(r) / 1000), camera: r.camera, ...summary(r) };
      });
    },

    // ── Lecturer side ───────────────────────────────────────────────
    async list(ownerId: string, formId: string) {
      const t = now();
      const out = [];
      for (const r of await listForm(formId)) {
        if (r.ownerId !== ownerId) continue;
        out.push({
          id: r.id, studentId: r.studentId, studentName: r.studentName, status: r.status, camera: r.camera,
          remainingSeconds: Math.round(remaining(r, t) / 1000), usedSeconds: Math.round(used(r, t) / 1000),
          pause: r.pause ? { by: r.pause.by, reason: r.pause.reason, sinceSeconds: Math.round((t - r.pause.since) / 1000) } : null,
          hasAccommodation: !!r.accommodations && (r.accommodations.extraTimePercent > 0 || r.accommodations.cameraExempt || r.accommodations.breaks || r.accommodations.largeText || r.accommodations.voiceAnswers),
          reentry: !!r.reentry, summary: summary(r), last: r.events.slice(-5).map((e) => ({ seconds: Math.round((t - e.t) / 1000), type: e.type, by: e.by, detail: e.detail })),
        });
      }
      return out.sort((a, b) => a.studentName.localeCompare(b.studentName));
    },
    async resume(ownerId: string, sid: string) {
      return locked(sid, async () => { const r = await owned(ownerId, sid); if (r.status !== 'paused') throw new ExamError('NOT_PAUSED', 'This test is not paused.', 409); resumeNow(r, 'lecturer'); await write(r); return publicView(r); });
    },
    /** Resumes every student whose camera pause is over (their face is back): one click for a whole lab. */
    async resumeAll(ownerId: string, formId: string) {
      let resumed = 0;
      for (const s of await listForm(formId)) {
        if (s.ownerId !== ownerId || s.status !== 'paused' || s.pause?.by !== 'system' || !['face_lost', 'camera_denied', 'camera_stopped'].includes(s.pause.reason)) continue;
        const last = [...s.events].reverse().find((e) => ['face_back', 'camera_ok', 'face_lost', 'camera_denied', 'camera_stopped'].includes(e.type));
        if (!last || (last.type !== 'face_back' && last.type !== 'camera_ok')) continue;
        await locked(s.id, async () => { const r = await read(s.id); if (r.status === 'paused') { resumeNow(r, 'lecturer'); await write(r); resumed++; } });
      }
      return { resumed };
    },
    async pause(ownerId: string, sid: string) {
      return locked(sid, async () => { const r = await owned(ownerId, sid); settle(r); pauseNow(r, 'lecturer', 'lecturer'); await write(r); return publicView(r); });
    },
    /** Ends the test for one student: their page submits what they have. */
    async end(ownerId: string, sid: string) {
      return locked(sid, async () => {
        const r = await owned(ownerId, sid);
        if (r.status === 'submitted' || r.status === 'ended') return publicView(r);
        r.usedMs = used(r, now()); r.runningSince = null; r.usedMs = Math.max(r.usedMs, total(r)); r.status = 'ended'; r.endedAt = now(); r.pause = null; log(r, 'ended', 'lecturer');
        await write(r);
        return publicView(r);
      });
    },
    async extend(ownerId: string, sid: string, minutes: unknown) {
      const m = typeof minutes === 'number' && Number.isFinite(minutes) ? Math.round(minutes) : 0;
      if (m < 1 || m > 180) throw new ExamError('BAD_MINUTES', 'Add between 1 and 180 minutes.');
      return locked(sid, async () => {
        const r = await owned(ownerId, sid);
        if (r.status === 'submitted') throw new ExamError('ALREADY_SUBMITTED', 'This student has already handed in.', 409);
        if (r.status === 'ended') { r.status = 'running'; r.runningSince = now(); r.usedMs = Math.min(r.usedMs, total(r)); delete r.endedAt; }
        r.extraMs += m * 60_000; log(r, 'extended', 'lecturer', String(m));
        await write(r);
        return publicView(r);
      });
    },
    /** Lets a student who lost their page or device back in (they enter their number again). */
    async allowReentry(ownerId: string, sid: string) {
      return locked(sid, async () => { const r = await owned(ownerId, sid); if (r.status === 'submitted') throw new ExamError('ALREADY_SUBMITTED', 'This student has already handed in.', 409); r.reentry = true; log(r, 'reentry_allowed', 'lecturer'); await write(r); });
    },
    async session(ownerId: string, sid: string) { const r = await owned(ownerId, sid); return { id: r.id, studentId: r.studentId, studentName: r.studentName, status: r.status, events: r.events }; },
  };
}
export type FormExamService = ReturnType<typeof createFormExamService>;
