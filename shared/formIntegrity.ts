/**
 * Quiz and test integrity signals, shared by the respondent page (which records them) and the server (which
 * re-checks and turns them into flags for the lecturer).
 *
 * These are SIGNALS FOR REVIEW, not proof: a browser can be modified, and a flag only says "look at this answer".
 * They never change a mark by themselves.
 */

export interface FieldActivity {
  /** Characters entered by typing (keyboard, phone keyboard, voice dictation counts as typing). */
  typed: number;
  /** Times text was pasted or dropped into the box (or tried to be, when pasting is blocked). */
  pasted: number;
  /** Paste attempts that were stopped because the lecturer turned pasting off. */
  blocked: number;
  /** Length of the answer at the end. */
  length: number;
}

export interface IntegrityReport {
  v: 1;
  /** Time on the form, in seconds. */
  seconds: number;
  /** Times the person left the page or window, and for how many seconds in total. */
  awayCount: number;
  awaySeconds: number;
  fields: Record<string, FieldActivity>;
}

export type FlagCode = 'PASTED' | 'PASTE_BLOCKED' | 'TYPED_LESS_THAN_ANSWER' | 'LEFT_PAGE' | 'TOO_FAST' | 'NO_SIGNALS';
export interface IntegrityFlag { code: FlagCode; fieldId?: string; level: 'review' | 'info'; message: string }

const int = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0);

/** Keeps only known fields with bounded numbers (a modified request cannot store anything else). */
export function sanitizeReport(input: unknown, fieldIds: Set<string>): IntegrityReport | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, any>;
  const fields: Record<string, FieldActivity> = {};
  if (o.fields && typeof o.fields === 'object') {
    for (const [id, a] of Object.entries<any>(o.fields)) {
      if (!fieldIds.has(id) || !a || typeof a !== 'object') continue;
      fields[id] = { typed: int(a.typed, 200_000), pasted: int(a.pasted, 1000), blocked: int(a.blocked, 1000), length: int(a.length, 200_000) };
    }
  }
  return { v: 1, seconds: int(o.seconds, 7 * 86400), awayCount: int(o.awayCount, 10_000), awaySeconds: int(o.awaySeconds, 7 * 86400), fields };
}

/**
 * Turns a report into flags. `labels` names the questions for the lecturer; `openIds` are the typed-answer
 * questions (only those are checked for pasting); `questionCount` is the number of questions the person answered.
 */
export function integrityFlags(report: IntegrityReport | null, opts: { labels: Record<string, string>; openIds: Set<string>; questionCount: number; expected: boolean }): IntegrityFlag[] {
  if (!report) return opts.expected ? [{ code: 'NO_SIGNALS', level: 'info', message: 'No activity record came with this response (sent without the form page).' }] : [];
  const flags: IntegrityFlag[] = [];
  const name = (id: string) => `"${(opts.labels[id] ?? id).slice(0, 60)}"`;
  for (const [id, a] of Object.entries(report.fields)) {
    if (!opts.openIds.has(id)) continue;
    if (a.blocked > 0) flags.push({ code: 'PASTE_BLOCKED', fieldId: id, level: 'review', message: `Tried to paste into ${name(id)} ${a.blocked} time${a.blocked === 1 ? '' : 's'} (blocked).` });
    if (a.pasted - a.blocked > 0) flags.push({ code: 'PASTED', fieldId: id, level: 'review', message: `Pasted text into ${name(id)}.` });
    if (a.length >= 60 && a.typed < a.length * 0.5 && a.pasted - a.blocked <= 0) {
      flags.push({ code: 'TYPED_LESS_THAN_ANSWER', fieldId: id, level: 'review', message: `The answer to ${name(id)} is ${a.length} characters but only ${a.typed} were typed.` });
    }
  }
  if (report.awayCount >= 3 || report.awaySeconds >= 60) flags.push({ code: 'LEFT_PAGE', level: 'review', message: `Left the page ${report.awayCount} time${report.awayCount === 1 ? '' : 's'} (${report.awaySeconds} s away).` });
  if (opts.questionCount >= 5 && report.seconds < opts.questionCount * 2) flags.push({ code: 'TOO_FAST', level: 'info', message: `Finished ${opts.questionCount} questions in ${report.seconds} s.` });
  return flags;
}
