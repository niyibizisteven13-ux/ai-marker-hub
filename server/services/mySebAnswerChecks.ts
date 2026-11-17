import { prisma } from '../db.js';
import { classReview } from './forms/classReview.js';
import { reviewInputs } from './forms/classReviewInput.js';
import type { TargetLoader } from './mySeb.js';

/**
 * Answer-pattern checks for a test that was also taken in the live room: answers nearly the same as another student's, the same wrong
 * answers on several questions, one device used by two people, and finishing far faster than the class. They look at the submitted
 * responses of the quiz (so they appear once students have handed in), and are leads for a conversation, never proof.
 * A response is matched to a live-room student by the name typed in the quiz; when that is not clear (no name question, two people with
 * the same name) it is listed on its own, not blamed on anyone.
 */
export interface AnswerFlag { code: string; message: string }
export interface AnswerChecks { byStudent: Record<string, AnswerFlag[]>; unmatched: Array<{ name: string; message: string }>; checked: number }
export const NO_CHECKS: AnswerChecks = { byStudent: {}, unmatched: [], checked: 0 };

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
const mins = (ms: number) => Math.max(1, Math.round(ms / 60_000));

/** Who finished far faster than the rest: needs a real class (8+ finished, a typical time of 5+ minutes). Pure. */
export function tooFast(durations: Array<{ id: string; ms: number }>): Array<{ id: string; ms: number; medianMs: number }> {
  if (durations.length < 8) return [];
  const sorted = durations.map((d) => d.ms).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median < 5 * 60_000) return [];
  return durations.filter((d) => d.ms < median * 0.25).map((d) => ({ ...d, medianMs: median }));
}

interface LiveStudent { id: string; student_name: string; status: string; end_reason: string | null; started_at?: string; ended_at?: string }

/** Pure: the checks for one test, given its form, its saved responses and the live-room students. */
export function computeAnswerChecks(schema: any, rows: Array<{ id: string; data: string; createdAt: Date | string }>, students: LiveStudent[]): AnswerChecks {
  const out: AnswerChecks = { byStudent: {}, unmatched: [], checked: rows.length };
  if (!rows.length && !students.length) return out;
  const { questions, responses } = reviewInputs(schema, rows);
  const flags = classReview(questions, responses);
  // names that identify exactly one live-room student and exactly one response
  const stuBy = new Map<string, LiveStudent[]>(); for (const s of students) { const k = fold(s.student_name); (stuBy.get(k) ?? stuBy.set(k, []).get(k)!).push(s); }
  const respBy = new Map<string, number>(); for (const r of responses) if (r.name) respBy.set(fold(r.name), (respBy.get(fold(r.name)) ?? 0) + 1);
  const studentOf = (name: string): LiveStudent | null => { const k = fold(name); const list = name ? stuBy.get(k) : undefined; return list?.length === 1 && respBy.get(k) === 1 ? list[0] : null; };
  const put = (name: string, who: string, f: AnswerFlag) => {
    const s = studentOf(name);
    if (s) (out.byStudent[s.id] ??= []).push(f); else out.unmatched.push({ name: name || who, message: f.message });
  };
  for (const r of responses) for (const f of flags[r.id] ?? []) if (f.level === 'review') put(r.name, r.who, { code: f.code, message: f.message });
  // far faster than the class (only students who finished by themselves, matched by name)
  const finished = students.filter((s) => s.end_reason === 'student' && s.started_at && s.ended_at).map((s) => ({ id: s.id, ms: Date.parse(s.ended_at!) - Date.parse(s.started_at!) })).filter((d) => d.ms > 0);
  for (const f of tooFast(finished)) (out.byStudent[f.id] ??= []).push({ code: 'TOO_FAST', message: `Finished in ${mins(f.ms)} min; the class took about ${mins(f.medianMs)} min.` });
  return out;
}

/** The checks for a live test made from a quiz. Tasks and tests with no responses yet give nothing. */
export async function answerChecks(load: TargetLoader, students: LiveStudent[]): Promise<AnswerChecks> {
  const t = await load();
  if (t.kind !== 'form') return NO_CHECKS;
  const db = prisma as any;
  const form = await db.applicationForm.findFirst({ where: { id: t.ref, userId: t.ownerId }, select: { schema: true } }).catch(() => null);
  if (!form) return NO_CHECKS;
  let schema: any = {}; try { schema = JSON.parse(form.schema || '{}'); } catch { return NO_CHECKS; }
  const rows = await db.formSubmission.findMany({ where: { formId: t.ref }, orderBy: { createdAt: 'asc' }, take: 400 }).catch(() => []);
  return computeAnswerChecks(schema, rows, students);
}
