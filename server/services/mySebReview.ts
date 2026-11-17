import { prisma } from '../db.js';
import { auditAction } from './platform/audit.js';
import { MySebError, evidenceCounts, evidenceOf, reinstate, report, type TargetLoader } from './mySeb.js';
import { SERIOUS, ATTEMPTS, strikeScore } from './mySebAgent.js';
import { reasonWords } from '../../src/utils/studentHelp.js';
import { answerChecks, NO_CHECKS, type AnswerChecks } from './mySebAnswerChecks.js';

/**
 * The review queue: everyone the room flagged, with what happened in order, the pictures kept at those moments (memory only on the
 * MySEB server) and the lecturer's decision: confirm, dismiss, or dismiss and give the student time back. The agent never decides this.
 * Decisions are kept with the room in appSetting ("myseb-review:<kind>:<ref>").
 */
const db = prisma as any;
export type Decision = 'open' | 'confirmed' | 'dismissed';
export interface StoredDecision { decision: Decision; note: string; at: string; by: string; gaveMinutes?: number }
const NOT_RULE = new Set(['teacher', 'time_up', 'exam_ended', 'student', 'student_exit']);

export interface TimelineItem { at: string; type: string; words: string; kind: 'serious' | 'attempt' | 'small' | 'lecturer' | 'assistant' | 'answers' | 'vision' }
export interface ReviewItem {
  studentId: string; name: string; score: number; strikes: number; signals: number;
  ended: { reason: string; words: string } | null; reinstated: number;
  timeline: TimelineItem[]; evidence: number; canRestore: boolean; answerFlags: string[];
  decision: Decision; note: string; decidedAt?: string; gaveMinutes?: number;
}

const kindOf = (type: string): TimelineItem['kind'] => (SERIOUS.has(type) ? 'serious' : ATTEMPTS.has(type) ? 'attempt' : 'small');
const NOTE_WORDS: Record<string, string> = { reinstated: 'was let back in' };
const words = (type: string) => NOTE_WORDS[type] ?? (reasonWords(type) ? `${reasonWords(type)}` : type.replace(/_/g, ' '));

/** Pure: builds the queue from the full record of the test. */
export function buildReview(
  rep: { exam?: { status?: string }; students: Array<any>; events: Array<{ session_id: string; type: string; created_at: string }> },
  decisions: Record<string, StoredDecision>,
  evidence: Record<string, number>,
  assistantLog: Array<{ at: string; kind: string; student?: string; sid?: string; text: string }> = [],
  answers: AnswerChecks = NO_CHECKS,
): ReviewItem[] {
  const open = rep.exam?.status !== 'ended';
  const items: ReviewItem[] = [];
  for (const s of rep.students) {
    const mine = rep.events.filter((e) => e.session_id === s.id);
    const types = mine.map((e) => e.type);
    const strikes = strikeScore(types);
    const endedByRule = s.status === 'ENDED' && s.end_reason && !NOT_RULE.has(s.end_reason);
    const signals = mine.filter((e) => e.type !== 'reinstated').length;
    const answerFlags = (answers.byStudent[s.id] ?? []).map((f) => f.message);
    const seen = assistantLog.filter((a) => a.kind === 'vision' && (a as any).sid === s.id);
    if (!strikes && !endedByRule && signals < 3 && !s.reinstated_count && !answerFlags.length && !seen.length) continue;
    const timeline: TimelineItem[] = mine.map((e) => ({ at: e.created_at, type: e.type, words: words(e.type), kind: e.type === 'reinstated' ? 'lecturer' : kindOf(e.type) }));
    for (const a of assistantLog) if (a.student === s.student_name && ['warned', 'resumed', 'ended'].includes(a.kind)) timeline.push({ at: a.at, type: a.kind, words: a.text, kind: 'assistant' });
    for (const a of seen) timeline.push({ at: a.at, type: 'vision', words: a.text, kind: 'vision' });
    for (const f of answers.byStudent[s.id] ?? []) timeline.push({ at: s.ended_at ?? s.started_at ?? new Date().toISOString(), type: f.code, words: `Answer check: ${f.message}`, kind: 'answers' });
    timeline.sort((a, b) => a.at.localeCompare(b.at));
    const d = decisions[s.id];
    const score = (endedByRule ? 3 : 0) + Math.min(signals, 6) + strikes * 2 + (s.reinstated_count ? 1 : 0) + answerFlags.length * 2 + seen.length * 2;
    items.push({
      studentId: s.id, name: s.student_name, score, strikes, signals,
      ended: endedByRule ? { reason: s.end_reason, words: reasonWords(s.end_reason) || s.end_reason } : null, reinstated: s.reinstated_count ?? 0,
      timeline, evidence: evidence[s.id] ?? 0, answerFlags,
      canRestore: !!endedByRule && (open || (s.deadline_at && Date.parse(s.deadline_at) > Date.now())),
      decision: d?.decision ?? 'open', note: d?.note ?? '', decidedAt: d?.at, gaveMinutes: d?.gaveMinutes,
    });
  }
  const rank = (i: ReviewItem) => (i.decision === 'open' ? 0 : 1);
  return items.sort((a, b) => rank(a) - rank(b) || b.score - a.score || a.name.localeCompare(b.name));
}

const keyOf = (kind: string, ref: string) => `myseb-review:${kind}:${ref}`;
async function readDecisions(kind: string, ref: string): Promise<Record<string, StoredDecision>> {
  const v = (await db.appSetting.findUnique({ where: { key: keyOf(kind, ref) } }).catch(() => null))?.value;
  return v && typeof v === 'object' && v.items && typeof v.items === 'object' ? v.items : {};
}
async function writeDecisions(kind: string, ref: string, items: Record<string, StoredDecision>, by: string) {
  const key = keyOf(kind, ref);
  const existing = await db.appSetting.findUnique({ where: { key } });
  if (existing) await db.appSetting.update({ where: { key }, data: { value: { items }, updatedBy: by, updatedAt: new Date() } });
  else await db.appSetting.create({ data: { key, value: { items }, updatedBy: by, updatedAt: new Date() } });
}

export async function getReview(load: TargetLoader, assistantLog: Parameters<typeof buildReview>[3] = []) {
  const t = await load(); const kind = t.kind === 'form' ? 'form' : 'task';
  const [rep, decisions, counts] = await Promise.all([report(load) as Promise<any>, readDecisions(kind, t.ref), evidenceCounts(load).catch(() => ({}))]);
  const answers = await answerChecks(load, rep.students ?? []).catch(() => NO_CHECKS);
  const items = buildReview(rep, decisions, counts, assistantLog, answers);
  return { items, open: items.filter((i) => i.decision === 'open').length, total: items.length, testOpen: rep.exam?.status !== 'ended', unmatchedAnswerFlags: answers.unmatched.slice(0, 20) };
}

/** The lecturer's decision. "dismissed" with giveMinutes also lets a student ended by a rule back in with that much time. */
export async function decideReview(load: TargetLoader, sid: string, input: { decision: Decision; note?: string; giveMinutes?: number }, by: string): Promise<{ ok: true; gaveMinutes?: number }> {
  if (!['open', 'confirmed', 'dismissed'].includes(input.decision)) throw new MySebError('Choose confirm, dismiss or reopen.', 400, 'BAD_REQUEST');
  const t = await load(); const kind = t.kind === 'form' ? 'form' : 'task';
  const rep: any = await report(load);
  if (!rep.students.some((s: any) => s.id === sid)) throw new MySebError('That student is not in this test.', 404, 'NOT_FOUND');
  let gave: number | undefined;
  if (input.giveMinutes !== undefined) {
    if (input.decision !== 'dismissed') throw new MySebError('Time can only be given back when you dismiss the flag.', 400, 'BAD_REQUEST');
    const m = Math.round(Number(input.giveMinutes));
    if (!(m >= 1 && m <= 60)) throw new MySebError('Give back 1 to 60 minutes.', 400, 'BAD_REQUEST');
    await reinstate(load, sid, m); gave = m;     // MySEB refuses it if the test is closed or the lecturer ended the student themselves
  }
  const items = await readDecisions(kind, t.ref);
  items[sid] = { decision: input.decision, note: String(input.note ?? '').trim().slice(0, 500), at: new Date().toISOString(), by, ...(gave ? { gaveMinutes: gave } : {}) };
  await writeDecisions(kind, t.ref, items, by);
  await auditAction(by, 'MYSEB_REVIEW', 'live_room', t.ref, { kind, student: sid, decision: input.decision, gaveMinutes: gave }).catch(() => undefined);
  return { ok: true, ...(gave ? { gaveMinutes: gave } : {}) };
}

export async function getEvidence(load: TargetLoader, sid: string) { return evidenceOf(load, sid); }
