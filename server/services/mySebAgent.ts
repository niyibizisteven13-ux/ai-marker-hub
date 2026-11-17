import { prisma } from '../db.js';
import logger from '../utils/logger.js';
import { auditAction } from './platform/audit.js';
import { flagOn } from './platform/settings.js';
import { MySebError, assignmentTarget, endAll, extendTime, formTarget, monitor, pauseAll, resumeAll, sendNotice, sessionAction, violations as roomViolations, type TargetLoader } from './mySeb.js';
import { reasonWords } from '../../src/utils/studentHelp.js';

/**
 * The room assistant. The lecturer tells it, in the live room or in the chat, how routine moments should be handled while a test runs;
 * it then does that by itself and keeps a short log, so the lecturer only deals with what really needs a person.
 *
 *  - A student paused for a small reason (face left the camera for a moment, lost connection, switched window) is let back in after a
 *    few seconds, if they are connected again, up to a limit per student.
 *  - Anything the lecturer did (paused by the lecturer) or anything that looks like cheating (screenshot, recording app, more than one
 *    face, student card refused, ...) is NEVER touched: it goes to the "needs you" list.
 *  - It ends a student's test only when the lecturer switched on "end after the limit" in advance. It never lets a student back in
 *    after being disqualified (that stays a decision for the lecturer) and never changes the test itself.
 * Rules and the log are stored with the room in appSetting ("myseb-agent:<kind>:<ref>"); no database change. Every action is also written
 * to the audit log (MYSEB_AGENT_...).
 */
const db = prisma as any;

/** The only reasons the assistant may clear by itself. Everything else (including "teacher") is left for the lecturer. */
export const AUTO_REASONS = ['face_missing', 'camera_off', 'heartbeat_lost', 'leave', 'blur', 'background', 'fullscreen_exit', 'screen_share_stopped'] as const;
/**
 * watch: only looks and tells the lecturer. assist: also lets students back in after small problems.
 * run (autopilot): runs the test without the lecturer by the policy set beforehand: warns, lets back in once, ends a test at the strike limit
 * (if the lecturer chose that), adds time for a mass connection loss, announces the time left, closes the test and sends the report.
 */
export const LEVELS = ['watch', 'assist', 'run'] as const;
export interface AgentRules {
  on: boolean; autoResume: boolean; afterSeconds: number; maxResumes: number; reasons: string[]; endAfterMax: boolean;
  level: (typeof LEVELS)[number];
  /** Write what it WOULD have done, and do nothing: for trying it on a small test first. */
  dryRun: boolean;
  /** Hard limits for what it may do in the room by itself (the lecturer is never limited). */
  maxAddMinutes: number; maxRoomPauses: number;
  /** Autopilot policy, chosen by the lecturer beforehand. flag: record and warn only. end: end the test at the strike limit. */
  serious: 'flag' | 'end';
  /** How many serious signals (screenshot, recording app, second person, pasting ...) a student may have before the policy applies. The first ones get a warning. */
  seriousStrikes: number;
  /** Autopilot closes the test when everyone has finished. */
  autoClose: boolean;
}
export const DEFAULT_RULES: AgentRules = { on: false, autoResume: true, afterSeconds: 30, maxResumes: 2, reasons: [...AUTO_REASONS], endAfterMax: false, level: 'assist', dryRun: false, maxAddMinutes: 15, maxRoomPauses: 2, serious: 'flag', seriousStrikes: 2, autoClose: true };
/** What the assistant has already done in the room (counted against the limits above). */
export interface AgentUsage { roomPauses: number; addedMinutes: number; notices: number }
export const EMPTY_USAGE: AgentUsage = { roomPauses: 0, addedMinutes: 0, notices: 0 };
export const MAX_AGENT_NOTICES = 20;
export interface AgentLogEntry { at: string; kind: 'started' | 'stopped' | 'resumed' | 'needs_you' | 'ended' | 'card' | 'finished' | 'would' | 'room' | 'refused' | 'warned' | 'report'; student?: string; text: string }
interface Row { ownerId: string; kind: 'form' | 'task'; ref: string; rules: AgentRules; counts: Record<string, number>; log: AgentLogEntry[]; usage?: AgentUsage;
  /** Serious signals counted per student, and how many of each student's violations were already looked at. */
  serious?: Record<string, number>; vseen?: Record<string, number>; reported?: boolean; report?: { at: string; text: string } }

const cleanUsage = (u: any): AgentUsage => ({ roomPauses: clamp(u?.roomPauses, 0, 1e6, 0), addedMinutes: clamp(u?.addedMinutes, 0, 1e6, 0), notices: clamp(u?.notices, 0, 1e6, 0) });
const numMap = (m: any): Record<string, number> => (m && typeof m === 'object' ? Object.fromEntries(Object.entries(m).filter(([, n]) => typeof n === 'number')) as Record<string, number> : {});
const keyOf = (kind: string, ref: string) => `myseb-agent:${kind}:${ref}`;
const LOG_MAX = 60;
const clamp = (n: unknown, lo: number, hi: number, d: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d);

export function cleanRules(input: Partial<AgentRules> | undefined, base: AgentRules = DEFAULT_RULES): AgentRules {
  const v = input ?? {};
  const reasons = Array.isArray(v.reasons) ? v.reasons.filter((r): r is string => (AUTO_REASONS as readonly string[]).includes(String(r))) : base.reasons;
  return {
    on: typeof v.on === 'boolean' ? v.on : base.on,
    autoResume: typeof v.autoResume === 'boolean' ? v.autoResume : base.autoResume,
    afterSeconds: clamp(v.afterSeconds, 5, 300, base.afterSeconds),
    maxResumes: clamp(v.maxResumes, 1, 5, base.maxResumes),
    reasons: reasons.length ? [...new Set(reasons)] : base.reasons,
    endAfterMax: typeof v.endAfterMax === 'boolean' ? v.endAfterMax : base.endAfterMax,
    level: (LEVELS as readonly string[]).includes(String(v.level)) ? (v.level as AgentRules['level']) : base.level,
    dryRun: typeof v.dryRun === 'boolean' ? v.dryRun : base.dryRun,
    maxAddMinutes: clamp(v.maxAddMinutes, 1, 60, base.maxAddMinutes),
    maxRoomPauses: clamp(v.maxRoomPauses, 0, 5, base.maxRoomPauses),
    serious: v.serious === 'end' || v.serious === 'flag' ? v.serious : base.serious,
    seriousStrikes: clamp(v.seriousStrikes, 1, 3, base.seriousStrikes),
    autoClose: typeof v.autoClose === 'boolean' ? v.autoClose : base.autoClose,
  };
}

/* ------------------------------------------------------------------ the decision (pure, so it can be tested without a database) */
export interface StudentView { id: string; student_name: string; status: string; pause_reason: string | null; seen_ago: number }
export type Decision = { action: 'none' | 'wait' } | { action: 'resume'; why: string } | { action: 'needs_you'; why: string } | { action: 'end'; why: string };
const NICE: Record<string, string> = {
  face_missing: 'face left the camera', camera_off: 'turned the camera off', heartbeat_lost: 'lost connection', leave: 'left the test screen', blur: 'switched window',
  background: 'left the app', fullscreen_exit: 'left full screen', screen_share_stopped: 'stopped sharing the screen', teacher: 'paused by you', screenshot: 'tried a screenshot',
  screen_recording: 'screen recording', forbidden_app: 'remote or recording app', multiple_faces: 'more than one face', id_refused: 'student card refused', devtools: 'opened developer tools',
};
export const niceReason = (r: string | null | undefined) => (r ? NICE[r] ?? r : 'paused');

/**
 * What to do about one student right now. `waited` is how many seconds the assistant has seen them paused; `resumed` is how many times it
 * already let them back in.
 */
export function decide(s: StudentView, rules: AgentRules, waited: number, resumed: number): Decision {
  const d = decideInner(s, rules, waited, resumed);
  // Watch mode only looks: what it would have done becomes something for the lecturer.
  return rules.level === 'watch' && (d.action === 'resume' || d.action === 'end') ? { action: 'needs_you', why: `${d.why} (watch mode: you decide)` } : d;
}
function decideInner(s: StudentView, rules: AgentRules, waited: number, resumed: number): Decision {
  if (!rules.on || !rules.autoResume) return { action: 'none' };
  if (s.status !== 'PAUSED' && s.status !== 'LEFT') return { action: 'none' };
  const reason = s.pause_reason ?? (s.status === 'LEFT' ? 'heartbeat_lost' : '');
  if (!reason || !rules.reasons.includes(reason) || !(AUTO_REASONS as readonly string[]).includes(reason))
    return { action: 'needs_you', why: `${niceReason(reason)}: only you can decide this` };
  if (s.seen_ago > 12) return { action: 'wait' };            // not connected yet: nothing to let back in
  if (waited < rules.afterSeconds) return { action: 'wait' };
  if (resumed >= rules.maxResumes) {
    return rules.endAfterMax
      ? { action: 'end', why: `${niceReason(reason)} again (${resumed} times already let back in)` }
      : { action: 'needs_you', why: `${niceReason(reason)} again: already let back in ${resumed} time${resumed === 1 ? '' : 's'}` };
  }
  return { action: 'resume', why: niceReason(reason) };
}

/* ------------------------------------------------------------------ storage */
async function read(kind: string, ref: string): Promise<Row | null> {
  const r = await db.appSetting.findUnique({ where: { key: keyOf(kind, ref) } }).catch(() => null);
  const v = r?.value;
  if (!v || typeof v !== 'object') return null;
  return { ownerId: String(v.ownerId), kind: v.kind, ref: String(v.ref), rules: cleanRules(v.rules), counts: v.counts && typeof v.counts === 'object' ? v.counts : {}, log: Array.isArray(v.log) ? v.log.slice(-LOG_MAX) : [], usage: cleanUsage(v.usage), serious: numMap(v.serious), vseen: numMap(v.vseen), reported: v.reported === true, report: v.report && typeof v.report.text === 'string' ? { at: String(v.report.at), text: v.report.text } : undefined };
}
async function write(row: Row, by: string) {
  const key = keyOf(row.kind, row.ref);
  const value = { ...row, log: row.log.slice(-LOG_MAX) };
  const existing = await db.appSetting.findUnique({ where: { key } });
  if (existing) await db.appSetting.update({ where: { key }, data: { value, updatedBy: by, updatedAt: new Date() } });
  else await db.appSetting.create({ data: { key, value, updatedBy: by, updatedAt: new Date() } });
}
/** Read the newest copy, change it, write it back: the lecturer changing rules and the assistant working at the same moment do not overwrite each other. */
async function mutate(kind: 'form' | 'task', ref: string, ownerId: string, fn: (row: Row) => void, by: string): Promise<Row> {
  const row = (await read(kind, ref)) ?? { ownerId, kind, ref, rules: DEFAULT_RULES, counts: {}, log: [] };
  fn(row); await write(row, by); return row;
}
const entry = (kind: AgentLogEntry['kind'], text: string, student?: string): AgentLogEntry => ({ at: new Date().toISOString(), kind, text, ...(student ? { student } : {}) });

/* ------------------------------------------------------------------ what the lecturer (and the chat) use */
export interface AgentView { rules: AgentRules; log: AgentLogEntry[]; resumed: number; usage: AgentUsage; report?: { at: string; text: string } }
const view = (row: Row | null): AgentView => ({ rules: row?.rules ?? DEFAULT_RULES, log: (row?.log ?? []).slice(-30).reverse(), resumed: Object.values(row?.counts ?? {}).reduce((a, b) => a + b, 0), usage: row?.usage ?? EMPTY_USAGE, report: row?.report });

export async function getAgent(load: TargetLoader): Promise<AgentView> {
  const t = await load();
  return view(await read(t.kind === 'form' ? 'form' : 'task', t.ref));
}
export async function setAgent(load: TargetLoader, patch: Partial<AgentRules>, by: string, opts: { confirmedAutopilot?: boolean } = {}): Promise<AgentView> {
  const t = await load();
  const kind = t.kind === 'form' ? 'form' : 'task';
  const prev = await read(kind, t.ref);
  const next = cleanRules(patch, prev?.rules ?? DEFAULT_RULES);
  // Autopilot acts on students without the lecturer, so it needs a clear yes each time it is switched on.
  if (next.level === 'run' && next.on && !(prev?.rules.on && prev.rules.level === 'run') && !opts.confirmedAutopilot) throw new MySebError('Autopilot needs your confirmation: it will run the test without you and act on students by the policy you set. Confirm to switch it on.', 400, 'CONFIRM_AUTOPILOT');
  const row = await mutate(kind, t.ref, t.ownerId, (r) => {
    r.ownerId = t.ownerId; r.rules = next;
    if ((!prev?.rules.on && next.on) || (next.on && next.level === 'run' && prev?.rules.level !== 'run')) r.log.push(entry('started', `Room assistant is on${next.level === 'watch' ? ' in watch mode (it only looks and tells you)' : next.level === 'run' ? ` on AUTOPILOT (${next.serious === 'end' ? `a student's test ends after ${next.seriousStrikes} serious signal${next.seriousStrikes === 1 ? '' : 's'}, with a warning before` : 'it warns and records, nobody is ended by it'}; it closes the test and sends you the report)` : ''}${next.dryRun ? ', in practice mode (it writes what it would do and does nothing)' : ''}: it lets students back in after ${next.afterSeconds} s (up to ${next.maxResumes} times each) when the reason is small${next.endAfterMax ? ', and ends a test after that' : ''}. Anything else is left for you.`));
    if (prev?.rules.on && !next.on) r.log.push(entry('stopped', 'Room assistant is off.'));
  }, by);
  await auditAction(by, 'MYSEB_AGENT_RULES', 'live_room', t.ref, { kind, ...next }).catch(() => undefined);
  return view(row);
}

/* ------------------------------------------------------------------ autopilot (pure parts) */
/** Signals that count as serious: each is one strike. */
export const SERIOUS = new Set(['screenshot', 'screen_recording', 'forbidden_app', 'multiple_faces', 'devtools', 'token_misuse', 'extra_display', 'split_screen', 'id_refused']);
/** Attempts that are usually blocked and often accidents: three of them make one strike. */
export const ATTEMPTS = new Set(['copy', 'paste', 'cut', 'shortcut', 'close_attempt']);
export const strikeScore = (types: string[]) => types.filter((t) => SERIOUS.has(t)).length + Math.floor(types.filter((t) => ATTEMPTS.has(t)).length / 3);
/** What to do about a student's strikes under the lecturer's policy: nothing yet, a warning, only record it, or end the test. */
export function decideStrikes(rules: AgentRules, score: number): 'none' | 'warn' | 'flag' | 'end' {
  if (score <= 0) return 'none';
  if (score < rules.seriousStrikes) return 'warn';
  return rules.serious === 'end' ? 'end' : 'flag';
}
/** A lot of students lost their connection at once (a power cut, a network fault): that is not cheating, so give time instead of punishing. */
export function massDisconnect(students: StudentView[]): boolean {
  const inTest = students.filter((s) => s.status !== 'ENDED');
  if (inTest.length < 4) return false;
  const gone = inTest.filter((s) => s.status === 'LEFT' || (s.status === 'PAUSED' && s.pause_reason === 'heartbeat_lost') || s.seen_ago > 20);
  return gone.length / inTest.length >= 0.4;
}
/** Minutes left for the longest student, or null. */
export function minutesLeft(deadlines: Array<string | null | undefined>, now: number): number | null {
  const ms = deadlines.map((d) => (d ? Date.parse(d) : NaN)).filter((n) => Number.isFinite(n));
  return ms.length ? Math.max(0, (Math.max(...ms) - now) / 60_000) : null;
}

export interface ReportStudent { student_name: string; status: string; end_reason: string | null; violation_count: number; last_violation: string | null; reinstated_count?: number; aside_seconds?: number }
const NOT_RULE_ENDS = new Set(['teacher', 'time_up', 'exam_ended', 'student', 'student_exit']);
/** The report the lecturer reads after the test: plain, ranked, honest about what the signals mean. */
export function buildReport(title: string, students: ReportStudent[], row: Pick<Row, 'serious' | 'usage' | 'log' | 'counts' | 'rules'>): string {
  const n = students.length;
  const byRule = students.filter((s) => s.status === 'ENDED' && s.end_reason && !NOT_RULE_ENDS.has(s.end_reason));
  const timeUp = students.filter((s) => s.end_reason === 'time_up').length;
  const finished = students.filter((s) => s.status === 'ENDED' && (!s.end_reason || s.end_reason === 'student' || s.end_reason === 'student_exit')).length;
  const strikes = (s: ReportStudent) => row.serious?.[(s as any).id] ?? 0;
  const score = (s: ReportStudent) => (byRule.includes(s) ? 3 : 0) + Math.min(s.violation_count, 6) + strikes(s) * 2 + ((s.aside_seconds ?? 0) >= 60 ? 1 : 0) + (s.reinstated_count ? 1 : 0);
  const ranked = students.map((s) => ({ s, n: score(s) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  const did = row.log.filter((e) => e.kind === 'resumed').length;
  const warned = row.log.filter((e) => e.kind === 'warned').length;
  const ended = row.log.filter((e) => e.kind === 'ended').length;
  const lines = [
    `${title}: final report`,
    n === 0 ? 'Nobody took part.' : `${n} student${n === 1 ? '' : 's'} took part: ${finished} finished, ${timeUp} ran out of time, ${byRule.length} had their test ended by a rule.`,
    ranked.length ? `Worth a look (most first):\n${ranked.slice(0, 12).map(({ s }) => `- ${s.student_name}: ${s.violation_count} signal${s.violation_count === 1 ? '' : 's'}${s.last_violation ? `, last: ${reasonWords(s.last_violation)}` : ''}${strikes(s) ? `, ${strikes(s)} serious` : ''}${byRule.includes(s) ? `, test ended (${reasonWords(s.end_reason)})` : ''}${s.reinstated_count ? `, let back in ${s.reinstated_count}x` : ''}`).join('\n')}${ranked.length > 12 ? `\n(and ${ranked.length - 12} more with fewer signals)` : ''}` : 'Nobody was flagged.',
    `What the assistant did: let ${did} back in, warned ${warned}, ended ${ended} test${ended === 1 ? '' : 's'}, added ${row.usage?.addedMinutes ?? 0} minute${row.usage?.addedMinutes === 1 ? '' : 's'}, sent ${row.usage?.notices ?? 0} message${row.usage?.notices === 1 ? '' : 's'}.`,
    'These are signals, not proof. A phone propped up, a second person out of view, or answers passed by voice cannot be seen by MySEB. Please look at the flagged students before you decide anything, and talk to them. The full timeline is in the live room.',
  ];
  return lines.join('\n');
}

/* ------------------------------------------------------------------ acting in the room (pause everyone, more time, a message) */
export type RoomAction =
  | { action: 'pause_room'; reason?: string }
  | { action: 'resume_room' }
  | { action: 'add_time'; minutes: number; studentId?: string }
  | { action: 'notice'; text: string; studentId?: string };
export type Actor = 'lecturer' | 'agent';
export const ROOM_ACTIONS = ['pause_room', 'resume_room', 'add_time', 'notice'] as const;

/** A room action from untrusted input (a request body or the model), or null. */
export function roomActionFrom(b: any): RoomAction | null {
  const studentId = typeof b?.studentId === 'string' && b.studentId ? b.studentId : undefined;
  switch (b?.action) {
    case 'pause_room': return { action: 'pause_room', ...(typeof b.reason === 'string' && b.reason ? { reason: b.reason.slice(0, 80) } : {}) };
    case 'resume_room': return { action: 'resume_room' };
    case 'add_time': { const minutes = Number(b.minutes); return Number.isInteger(minutes) ? { action: 'add_time', minutes, studentId } : null; }
    case 'notice': { const text = typeof b.text === 'string' ? b.text.trim().slice(0, 300) : ''; return text ? { action: 'notice', text, studentId } : null; }
    default: return null;
  }
}
export function describeRoomAction(a: RoomAction): string {
  if (a.action === 'pause_room') return `pause the whole room${a.reason ? ` (${a.reason})` : ''}`;
  if (a.action === 'resume_room') return 'let everyone back in';
  if (a.action === 'add_time') return `add ${a.minutes} minute${a.minutes === 1 ? '' : 's'} for ${a.studentId ? 'one student' : 'everyone still in the test'}`;
  return `tell ${a.studentId ? 'one student' : 'all students'}: "${a.text.slice(0, 80)}"`;
}
/**
 * Is this allowed? The lecturer may always (within what MySEB accepts: 1-60 minutes, a short message). The assistant may only act
 * when it is on and not in watch mode, and only within the limits the lecturer set: these are checked here in code, not by the model.
 */
export function checkRoomAction(rules: AgentRules, usage: AgentUsage, a: RoomAction, actor: Actor): { ok: true } | { ok: false; reason: string } {
  if (a.action === 'add_time' && !(Number.isInteger(a.minutes) && a.minutes >= 1 && a.minutes <= 60)) return { ok: false, reason: 'Time can be added in whole minutes, 1 to 60 at a time.' };
  if (a.action === 'notice' && !String(a.text ?? '').trim()) return { ok: false, reason: 'A message needs some text.' };
  if (actor === 'lecturer') return { ok: true };
  if (!rules.on) return { ok: false, reason: 'The room assistant is off.' };
  if (rules.level === 'watch') return { ok: false, reason: 'The room assistant is in watch mode: it only looks and tells you.' };
  if (a.action === 'pause_room' && usage.roomPauses >= rules.maxRoomPauses) return { ok: false, reason: `It already paused the room ${usage.roomPauses} time${usage.roomPauses === 1 ? '' : 's'} (your limit is ${rules.maxRoomPauses}).` };
  if (a.action === 'add_time' && usage.addedMinutes + a.minutes > rules.maxAddMinutes) return { ok: false, reason: `Adding ${a.minutes} minutes would pass your limit of ${rules.maxAddMinutes} minutes in total (${usage.addedMinutes} already added).` };
  if (a.action === 'notice' && usage.notices >= MAX_AGENT_NOTICES) return { ok: false, reason: `It already sent ${MAX_AGENT_NOTICES} messages.` };
  return { ok: true };
}

/** Does one action in the room, for the lecturer (chat or button) or for the assistant. Everything is logged and audited. */
export async function roomAction(load: TargetLoader, a: RoomAction, actor: Actor, by: string): Promise<{ ok: boolean; dry?: boolean; text: string }> {
  const t = await load();
  const kind = t.kind === 'form' ? 'form' : 'task';
  const prev = await read(kind, t.ref);
  const rules = prev?.rules ?? DEFAULT_RULES; const usage = prev?.usage ?? EMPTY_USAGE;
  const what = describeRoomAction(a);
  const who = actor === 'agent' ? 'Assistant' : 'You';
  const chk = checkRoomAction(rules, usage, a, actor);
  if (chk.ok === false) {
    if (actor === 'agent') await mutate(kind, t.ref, t.ownerId, (r) => { r.log.push(entry('refused', `Could not ${what}: ${chk.reason}`)); }, by);
    return { ok: false, text: chk.reason };
  }
  if (actor === 'agent' && rules.dryRun) {
    await mutate(kind, t.ref, t.ownerId, (r) => { r.log.push(entry('would', `Would have chosen to ${what}.`)); }, by);
    return { ok: true, dry: true, text: `Practice mode: would have chosen to ${what}. Nothing was done.` };
  }
  let result = '';
  if (a.action === 'pause_room') { const r: any = await pauseAll(load); result = `${r?.changed ?? 0} student${r?.changed === 1 ? '' : 's'} paused`; }
  else if (a.action === 'resume_room') { const r: any = await resumeAll(load); result = `${r?.changed ?? 0} student${r?.changed === 1 ? '' : 's'} let back in`; }
  else if (a.action === 'add_time') { const r: any = await extendTime(load, a.minutes, a.studentId); result = `${r?.changed ?? 0} student${r?.changed === 1 ? '' : 's'} got ${a.minutes} more minute${a.minutes === 1 ? '' : 's'}`; }
  else { await sendNotice(load, a.text, a.studentId); result = 'message sent'; }
  await mutate(kind, t.ref, t.ownerId, (r) => {
    r.ownerId = r.ownerId || t.ownerId;
    if (actor === 'agent') {
      const u = r.usage ?? { ...EMPTY_USAGE };
      r.usage = { roomPauses: u.roomPauses + (a.action === 'pause_room' ? 1 : 0), addedMinutes: u.addedMinutes + (a.action === 'add_time' ? a.minutes : 0), notices: u.notices + (a.action === 'notice' ? 1 : 0) };
    }
    r.log.push(entry('room', `${who}: ${what} (${result}).`));
  }, by);
  await auditAction(by, 'MYSEB_ROOM_ACTION', 'live_room', t.ref, { kind, actor, ...a }).catch(() => undefined);
  return { ok: true, text: `Done: ${what} (${result}).` };
}

/* ------------------------------------------------------------------ the loop */
// Per student, in memory: when the assistant first saw them paused (so "after 30 seconds" means 30 seconds of watching), and what it already told the lecturer.
const pausedSince = new Map<string, number>();
const told = new Set<string>();
const loaderOf = (r: Row): TargetLoader => (r.kind === 'form' ? formTarget(r.ownerId, r.ref) : assignmentTarget(r.ownerId, r.ref));

/** One look at one room. Returns what it did (for tests and the log). */
/** Replaceable in tests. */
export let alertOwner = async (row: Row, entries: AgentLogEntry[]): Promise<void> => {
  const [{ notifyUser, liveNotifyDeps }, { notifyPrefs }] = await Promise.all([import('./agenda/notify.js'), import('./agenda/store.js')]);
  if (!(await notifyPrefs().get(row.ownerId)).liveAlerts) return;
  const base = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
  const lines = entries.slice(0, 8).map((e) => `• ${e.student ? `${e.student}: ` : ''}${e.text}`);
  await notifyUser(row.ownerId, { title: 'Live room: needs you', text: `${lines.join('\n')}${entries.length > 8 ? `\n…and ${entries.length - 8} more` : ''}`, buttons: base ? [[{ text: 'Open the live room', url: `${base}/live/${row.kind}/${encodeURIComponent(row.ref)}` }]] : undefined }, await liveNotifyDeps());
};
export const __setAlertOwnerForTests = (fn: typeof alertOwner) => { alertOwner = fn; };
/** Replaceable in tests: the final report goes to the owner (Telegram, else email, else the chat). */
export let reportOwner = async (row: Row, title: string, text: string): Promise<void> => {
  const { notifyUser, liveNotifyDeps } = await import('./agenda/notify.js');
  const base = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
  await notifyUser(row.ownerId, { title: `${title}: report`, text, buttons: base ? [[{ text: 'Open the live room', url: `${base}/live/${row.kind}/${encodeURIComponent(row.ref)}` }]] : undefined }, await liveNotifyDeps());
};
export const __setReportOwnerForTests = (fn: typeof reportOwner) => { reportOwner = fn; };

const quietSince = new Map<string, number>();
const incidentAt = new Map<string, number>();
const ADVICE_NOTE = 'This was recorded for your lecturer.';

/** Builds, stores and sends the final report, once. */
async function finishWithReport(row: Row, m: any): Promise<void> {
  const fresh = (await read(row.kind, row.ref)) ?? row;
  if (fresh.reported) return;
  const title = String(m?.exam?.title || 'The test');
  const text = buildReport(title, (m?.students ?? []) as ReportStudent[], { serious: fresh.serious, usage: fresh.usage, log: fresh.log, counts: fresh.counts, rules: fresh.rules });
  await mutate(row.kind, row.ref, row.ownerId, (r) => { r.reported = true; r.report = { at: new Date().toISOString(), text }; r.log.push(entry('report', 'The test is over: the report was sent to you.')); }, 'agent');
  await auditAction(row.ownerId, 'MYSEB_AGENT_REPORT', 'live_room', row.ref, { students: (m?.students ?? []).length }).catch(() => undefined);
  void reportOwner(row, title, text).catch(() => undefined);
}

/** One look at one room. Returns what it did (for tests and the log). */
export async function runRoom(row: Row, now = Date.now()): Promise<AgentLogEntry[]> {
  const load = loaderOf(row);
  const run = row.rules.level === 'run';
  let m: any;
  try { m = await monitor(load, { frames: false }); }
  catch (e) {
    if (e instanceof MySebError && e.status === 404) await mutate(row.kind, row.ref, row.ownerId, (r) => { r.rules = { ...r.rules, on: false }; r.log.push(entry('stopped', 'The test no longer exists, so the assistant stopped.')); }, 'agent').catch(() => undefined);
    return [];
  }
  const made: AgentLogEntry[] = [];
  const actions: Array<() => Promise<void>> = [];
  const counts = { ...row.counts };
  const serious = { ...(row.serious ?? {}) }; const vseen = { ...(row.vseen ?? {}) };
  if (m?.exam?.status === 'ended') {
    if (run) await finishWithReport(row, m).catch((e) => logger.debug?.('[myseb-agent] report failed', { error: (e as Error)?.message }));
    await mutate(row.kind, row.ref, row.ownerId, (r) => { r.rules = { ...r.rules, on: false }; r.log.push(entry('finished', 'The test has ended, so the assistant stopped.')); }, 'agent');
    quietSince.delete(row.ref);
    return [entry('finished', 'ended')];
  }
  const students = (m?.students ?? []) as Array<StudentView & { id_status?: string; violation_count?: number; last_violation?: string | null; deadline_at?: string }>;
  let fetched = 0;
  for (const s of students) {
    const k = `${row.ref}:${s.id}`;
    if (s.id_status === 'pending' && s.status !== 'ENDED' && !told.has(`${k}:card`)) { told.add(`${k}:card`); made.push(entry('card', 'Showed a student card: check it in the live room.', s.student_name)); }
    // Autopilot: count serious signals (a screenshot, a recording app, a second person, pasting ...) and apply the lecturer's policy.
    if (run && s.status !== 'ENDED' && (s.violation_count ?? 0) > (vseen[s.id] ?? 0) && fetched < 20) {
      fetched++;
      const list = await roomViolations(load, s.id).catch(() => null) as Array<{ type: string }> | null;
      if (list) {
        vseen[s.id] = s.violation_count ?? list.length;
        const score = strikeScore(list.map((v) => v.type));
        if (score > (serious[s.id] ?? 0)) {
          serious[s.id] = score;
          const verdict = decideStrikes(row.rules, score);
          const what = reasonWords(s.last_violation) || 'a serious signal';
          if (row.rules.dryRun) made.push(entry('would', `Would have ${verdict === 'end' ? 'ended the test' : 'warned the student'}: ${what} (strike ${score} of ${row.rules.seriousStrikes}).`, s.student_name));
          else if (verdict === 'end') {
            made.push(entry('ended', `Test ended by your autopilot policy: ${what} (strike ${score} of ${row.rules.seriousStrikes}). You can let them back in from the live room while the time is not over.`, s.student_name));
            actions.push(async () => { await sessionAction(load, s.id, 'end'); await auditAction(row.ownerId, 'MYSEB_AGENT_END', 'live_room', row.ref, { student: s.student_name, why: what, strikes: score, autopilot: true }).catch(() => undefined); });
            continue;
          } else {
            made.push(entry('warned', `Warning sent: ${what} (strike ${score} of ${row.rules.seriousStrikes}).${verdict === 'flag' ? ' Flagged for your report.' : ''}`, s.student_name));
            const note = row.rules.serious === 'end' ? `Warning: ${what} is not allowed in this test and was recorded. If it happens again your test will end.` : `Warning: ${what} is not allowed in this test. ${ADVICE_NOTE}`;
            actions.push(async () => { await sendNotice(load, note, s.id); await auditAction(row.ownerId, 'MYSEB_AGENT_WARN', 'live_room', row.ref, { student: s.student_name, why: what, strikes: score }).catch(() => undefined); });
          }
        }
      }
    }
    if (s.status !== 'PAUSED' && s.status !== 'LEFT') { pausedSince.delete(k); for (const t of [...told]) if (t.startsWith(`${k}:p`)) told.delete(t); continue; }
    if (!pausedSince.has(k)) pausedSince.set(k, now);
    const waited = Math.round((now - (pausedSince.get(k) ?? now)) / 1000);
    let d = decide(s, row.rules, waited, counts[s.id] ?? 0);
    // Autopilot lets a warned student carry on (nobody is there to do it), within the strike policy.
    if (run && d.action === 'needs_you' && s.pause_reason && SERIOUS.has(s.pause_reason) && row.rules.autoResume && s.seen_ago <= 12 && waited >= row.rules.afterSeconds
      && (counts[s.id] ?? 0) < Math.max(row.rules.maxResumes, row.rules.serious === 'flag' ? 5 : 0)
      && ((serious[s.id] ?? 0) < row.rules.seriousStrikes || row.rules.serious === 'flag')) d = { action: 'resume', why: `after a warning (${niceReason(s.pause_reason)})` };
    if ((d.action === 'resume' || d.action === 'end') && row.rules.dryRun) {
      // Practice mode: say what it would do, once per pause, and do nothing.
      if (!told.has(`${k}:w${pausedSince.get(k)}`)) {
        told.add(`${k}:w${pausedSince.get(k)}`);
        made.push(entry('would', `${d.action === 'resume' ? 'Would have let back in' : 'Would have ended the test'}: ${d.why}.`, s.student_name));
      }
    } else if (d.action === 'resume') {
      counts[s.id] = (counts[s.id] ?? 0) + 1; pausedSince.delete(k);
      made.push(entry('resumed', `Let back in: ${d.why} (${counts[s.id]} of ${row.rules.maxResumes}).`, s.student_name));
      actions.push(async () => { await sessionAction(load, s.id, 'resume'); await auditAction(row.ownerId, 'MYSEB_AGENT_RESUME', 'live_room', row.ref, { student: s.student_name, why: d.why }).catch(() => undefined); });
    } else if (d.action === 'end') {
      pausedSince.delete(k);
      made.push(entry('ended', `Test ended: ${d.why}.`, s.student_name));
      actions.push(async () => { await sessionAction(load, s.id, 'end'); await auditAction(row.ownerId, 'MYSEB_AGENT_END', 'live_room', row.ref, { student: s.student_name, why: d.why }).catch(() => undefined); });
    } else if (d.action === 'needs_you' && !told.has(`${k}:p${pausedSince.get(k)}`)) {
      told.add(`${k}:p${pausedSince.get(k)}`);
      made.push(entry('needs_you', d.why, s.student_name));
    }
  }
  for (const a of actions) await a().catch((e) => logger.debug?.('[myseb-agent] action failed', { error: (e as Error)?.message }));
  if (made.length || Object.keys(serious).length !== Object.keys(row.serious ?? {}).length || Object.keys(vseen).length !== Object.keys(row.vseen ?? {}).length)
    await mutate(row.kind, row.ref, row.ownerId, (r) => { r.counts = { ...r.counts, ...counts }; r.serious = { ...(r.serious ?? {}), ...serious }; r.vseen = { ...(r.vseen ?? {}), ...vseen }; r.log.push(...made); }, 'agent');
  // What only the lecturer can decide goes to their phone too (Telegram, else email), one message per look, if they have alerts on.
  const needs = made.filter((e) => e.kind === 'needs_you' || e.kind === 'card');
  if (needs.length) void alertOwner(row, needs).catch(() => undefined);

  if (run) {
    const live = students.filter((s) => s.status !== 'ENDED');
    // A lot of connections lost at once is a fault, not cheating: give time (within the limit) and say so.
    if (massDisconnect(students) && now - (incidentAt.get(row.ref) ?? 0) > 15 * 60_000) {
      incidentAt.set(row.ref, now);
      const room = row.rules.maxAddMinutes - (row.usage?.addedMinutes ?? 0);
      const minutes = Math.min(10, room);
      if (minutes >= 1) {
        const r = await roomAction(load, { action: 'add_time', minutes }, 'agent', row.ownerId).catch(() => null);
        if (r?.ok) await roomAction(load, { action: 'notice', text: `Many connections were lost. ${minutes} minutes were added for everyone still in the test.` }, 'agent', row.ownerId).catch(() => undefined);
      }
    }
    // Time announcements: ten minutes and one minute before the longest deadline.
    const left = minutesLeft(live.map((s) => s.deadline_at), now);
    if (left !== null && left > 0) {
      for (const t of [1, 10]) {
        const key = `${row.ref}:ann${t}`;
        if (left <= t && !told.has(key)) {
          told.add(key); if (t === 1) told.add(`${row.ref}:ann10`);
          await roomAction(load, { action: 'notice', text: `${t} minute${t === 1 ? '' : 's'} left. Please finish and submit.` }, 'agent', row.ownerId).catch(() => undefined);
          break;
        }
      }
    }
    // Everyone has finished: close the test after a short pause, so nobody joins late; the next look sends the report.
    if (row.rules.autoClose && students.length > 0 && students.every((s) => s.status === 'ENDED')) {
      const since = quietSince.get(row.ref) ?? now; quietSince.set(row.ref, since);
      if (now - since >= 120_000) {
        quietSince.delete(row.ref);
        if (row.rules.dryRun) await mutate(row.kind, row.ref, row.ownerId, (r) => { r.log.push(entry('would', 'Would have closed the test: everyone has finished.')); }, 'agent');
        else { await endAll(load).catch(() => undefined); await mutate(row.kind, row.ref, row.ownerId, (r) => { r.log.push(entry('finished', 'Everyone has finished: the test was closed.')); }, 'agent'); }
      }
    } else quietSince.delete(row.ref);
  }
  return made;
}

let running = false;
/** One pass over every room that has the assistant on. */
export async function tickAgents(now = Date.now()) {
  if (running || !flagOn('myseb.enabled')) return;
  running = true;
  try {
    const rows = await db.appSetting.findMany({ where: { key: { startsWith: 'myseb-agent:' } }, orderBy: { updatedAt: 'desc' }, take: 300 });
    const live = rows.map((r: any) => r.value as Row).filter((v: Row) => v?.rules?.on && v.ownerId && v.ref);
    for (let i = 0; i < live.length; i += 5) await Promise.all(live.slice(i, i + 5).map((v: Row) => runRoom({ ...v, rules: cleanRules(v.rules), counts: v.counts ?? {}, log: v.log ?? [] }, now).catch((e) => logger.debug?.('[myseb-agent] room skipped', { error: (e as Error)?.message }))));
  } finally { running = false; }
}

let timer: ReturnType<typeof setInterval> | undefined;
export function startMySebAgent() { timer ??= setInterval(() => void tickAgents().catch(() => undefined), 10_000); timer.unref?.(); }
export const __resetAgentMemoryForTests = () => { pausedSince.clear(); told.clear(); quietSince.clear(); incidentAt.clear(); };
