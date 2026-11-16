/**
 * Timed-exam rules shared by the exam page (which watches the camera) and the server (which keeps the clock and
 * decides what a camera event means). Nothing here sees a picture: the browser reports only where faces were.
 */

export type CameraRule = 'off' | 'warn' | 'pause';

export interface ExamSettings {
  enabled: boolean;
  /** Length of the test in minutes (before any extra time). */
  minutes: number;
  /** off: no camera. warn: record only. pause: the test pauses and the lecturer decides. */
  camera: CameraRule;
  /** Seconds a face may be out of frame before it counts (people look down to think and lean to write). */
  graceSeconds: number;
  /** The class the students belong to (their accommodations come from it). */
  courseId?: string;
  /** Only students on that class's roster may start. */
  requireRoster: boolean;
  /** What leaving the page (or full screen) does: record it, warn the student, pause the test, or end it. */
  leaveAction: LeaveAction;
  /** How many times a student may leave before `leaveAction` applies (for pause and end). */
  maxLeaves: number;
  /** Ask for full screen at the start, and count leaving it like leaving the page. */
  requireFullscreen: boolean;
  /** The test can only be taken in Safe Exam Browser (a free lockdown browser). */
  requireSeb: boolean;
  /** The Browser Exam Keys of your Safe Exam Browser configuration (64 hex characters each). Never sent to students. */
  sebKeys: string[];
  /** Students must open this test or assignment inside the MySEB app (or its Chrome extension): the device is locked and leaving is reported. */
  requireMyseb: boolean;
  /** The matching exam on the MySEB server. Created the first time the lecturer asks for a code. Never shown to students. */
  mysebExamId?: string;
}
export type LeaveAction = 'record' | 'warn' | 'pause' | 'end';

export const DEFAULT_EXAM: ExamSettings = { enabled: false, minutes: 60, camera: 'off', graceSeconds: 8, requireRoster: false, leaveAction: 'record', maxLeaves: 3, requireFullscreen: false, requireSeb: false, sebKeys: [], requireMyseb: false };

export function normalizeExam(input: unknown): ExamSettings {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
  const camera: CameraRule = o.camera === 'warn' || o.camera === 'pause' ? o.camera : 'off';
  const courseId = typeof o.courseId === 'string' && /^[0-9a-f-]{36}$/i.test(o.courseId) ? o.courseId : undefined;
  return {
    enabled: o.enabled === true,
    minutes: num(o.minutes, 5, 600, DEFAULT_EXAM.minutes),
    camera,
    graceSeconds: num(o.graceSeconds, 3, 60, DEFAULT_EXAM.graceSeconds),
    ...(courseId ? { courseId } : {}),
    requireRoster: o.requireRoster === true && !!courseId,
    leaveAction: o.leaveAction === 'warn' || o.leaveAction === 'pause' || o.leaveAction === 'end' ? o.leaveAction : 'record',
    maxLeaves: num(o.maxLeaves, 1, 20, DEFAULT_EXAM.maxLeaves),
    requireFullscreen: o.requireFullscreen === true,
    ...(() => {
      const keys = (Array.isArray(o.sebKeys) ? o.sebKeys : typeof o.sebKeys === 'string' ? o.sebKeys.split(/[\s,;]+/) : []).map((k) => String(k).trim().toLowerCase()).filter((k) => /^[0-9a-f]{64}$/.test(k));
      const unique = [...new Set(keys)].slice(0, 10);
      // Required without a key means nobody can start (it fails closed); the form builder warns about it.
      return { sebKeys: unique, requireSeb: o.requireSeb === true };
    })(),
    // MySEB and Safe Exam Browser are alternatives: if both were set, Safe Exam Browser wins (a student cannot be inside both).
    requireMyseb: o.requireMyseb === true && o.requireSeb !== true,
    ...(typeof o.mysebExamId === 'string' && /^[0-9a-f-]{36}$/i.test(o.mysebExamId) ? { mysebExamId: o.mysebExamId } : {}),
  };
}

/**
 * A save from the form builder replaces the test settings. The MySEB link (`mysebExamId`) is made elsewhere (the live room
 * creates it when the lecturer first asks for a code), so a builder that was open at the time must not erase it.
 */
export function keepMysebLink(next: unknown, prev: unknown): ExamSettings {
  const n = (next && typeof next === 'object' ? next : {}) as Record<string, unknown>;
  const p = (prev && typeof prev === 'object' ? prev : {}) as Record<string, unknown>;
  return normalizeExam({ ...n, mysebExamId: n.mysebExamId ?? p.mysebExamId });
}

/** A detected face as the detector reports it: a box in 0..1 of the picture. */
export interface FaceBox { x: number; y: number; w: number; h: number; /** How far the face is turned from the camera: 0 straight on, about ±0.5 and beyond when it looks well to one side. Absent when the detector gave no landmarks. */ yaw?: number }
export type FrameStatus = 'ok' | 'no_face' | 'partial' | 'multiple';

/**
 * The frame rule. A face counts when it is big enough to be a person at a desk (at least 2% of the picture) and
 * mostly inside the picture (its centre inside the middle 80%, and at most a quarter of the box outside).
 * `ok`: exactly one such face. `partial`: a face is there but cut off or at the edge. `multiple`: more than one.
 */
export function frameStatus(faces: FaceBox[]): FrameStatus {
  const inside = (f: FaceBox) => {
    const w = Math.max(0, Math.min(1, f.x + f.w) - Math.max(0, f.x));
    const h = Math.max(0, Math.min(1, f.y + f.h) - Math.max(0, f.y));
    return f.w * f.h > 0 ? (w * h) / (f.w * f.h) : 0;
  };
  const big = faces.filter((f) => f.w * f.h >= 0.02);
  if (!big.length) return faces.length ? 'partial' : 'no_face';
  const good = big.filter((f) => {
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    return inside(f) >= 0.75 && cx >= 0.1 && cx <= 0.9 && cy >= 0.1 && cy <= 0.9;
  });
  if (good.length > 1) return 'multiple';
  return good.length === 1 ? 'ok' : 'partial';
}

export type WatchState = { state: 'ok' | 'warning' | 'lost'; secondsLeft: number; status: FrameStatus };
export type WatchEvent = { type: 'face_lost' | 'face_back' | 'multiple_faces'; seconds?: number };

/**
 * Turns a stream of frame results into calm events. Looking down or leaning out for less than the grace period
 * is ignored (the person only sees a countdown); after it, one `face_lost` event; when they return, one
 * `face_back` with how long they were away. Several people in the picture are reported once per episode.
 */
export class FaceWatch {
  private since: number | null = null;
  private lost = false;
  private multi = false;
  constructor(private graceMs: number) {}

  feed(status: FrameStatus, now: number): { state: WatchState; events: WatchEvent[] } {
    const events: WatchEvent[] = [];
    if (status === 'multiple') {
      if (!this.multi) { this.multi = true; events.push({ type: 'multiple_faces' }); }
    } else this.multi = false;
    const present = status === 'ok' || status === 'multiple';
    if (present) {
      if (this.lost && this.since !== null) events.push({ type: 'face_back', seconds: Math.round((now - this.since) / 1000) });
      this.since = null; this.lost = false;
      return { state: { state: 'ok', secondsLeft: Math.ceil(this.graceMs / 1000), status }, events };
    }
    if (this.since === null) this.since = now;
    const away = now - this.since;
    if (away >= this.graceMs) {
      if (!this.lost) { this.lost = true; events.push({ type: 'face_lost', seconds: Math.round(away / 1000) }); }
      return { state: { state: 'lost', secondsLeft: 0, status }, events };
    }
    return { state: { state: 'warning', secondsLeft: Math.ceil((this.graceMs - away) / 1000), status }, events };
  }
  reset() { this.since = null; this.lost = false; this.multi = false; }
}
