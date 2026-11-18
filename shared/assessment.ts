/**
 * How a marked test is scored and reported: its kind (CAT, exam, quiz, test), the mark it is reported out of, the pass mark, and whether
 * written answers are marked by AI (for the lecturer to check). Shared by the form builder and the server so both read it the same way.
 *
 * A CAT (continuous assessment test) is usually reported out of a round number (10, 20, 30, 40) and graded against the same scale as the
 * course. The default scale below is the common one for Rwandan universities and schools; it is only a default and is shown on the result.
 */
export type AssessmentKind = 'QUIZ' | 'CAT' | 'TEST' | 'EXAM';
export type AiGradingBasis = 'guide' | 'knowledge';
export function usesAiGrading(kind: unknown, question: { aiGradeShortAnswer?: unknown }, enabled: boolean): boolean {
  return enabled && (kind === 'long_text' || (kind === 'text' && question.aiGradeShortAnswer === true));
}

export interface Assessment {
  kind: AssessmentKind;
  /** What it is called on results, for example "CAT 1" or "Mid-term". */
  title: string;
  /** The mark it is reported out of (for example 20). null = report the raw total of the question points. */
  outOf: number | null;
  /** Pass mark in percent. */
  passPercent: number;
  /** Written answers (long text) are marked by AI against the lecturer's model answer, and shown to the lecturer to confirm. */
  aiMarking: boolean;
  /** Count written questions toward the total while the teacher reviews them. */
  manualWritten?: boolean;
}
export const DEFAULT_ASSESSMENT: Assessment = { kind: 'QUIZ', title: '', outOf: null, passPercent: 50, aiMarking: false };
const KINDS: AssessmentKind[] = ['QUIZ', 'CAT', 'TEST', 'EXAM'];

export function normalizeAssessment(input: unknown): Assessment {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const kind = KINDS.includes(String(o.kind).toUpperCase() as AssessmentKind) ? (String(o.kind).toUpperCase() as AssessmentKind) : DEFAULT_ASSESSMENT.kind;
  const outOfN = Number(o.outOf);
  const passN = Number(o.passPercent);
  return {
    kind,
    title: typeof o.title === 'string' ? o.title.replace(/\s+/g, ' ').trim().slice(0, 60) : '',
    outOf: Number.isFinite(outOfN) && outOfN >= 1 && outOfN <= 1000 && o.outOf !== null && o.outOf !== '' ? Math.round(outOfN * 100) / 100 : null,
    passPercent: Number.isFinite(passN) && passN >= 1 && passN <= 100 ? Math.round(passN) : DEFAULT_ASSESSMENT.passPercent,
    aiMarking: o.aiMarking === true,
    ...(o.manualWritten === true ? { manualWritten: true } : {}),
  };
}

export interface GradeBand { min: number; grade: string; remark: string }
export const GRADE_SCALE: GradeBand[] = [
  { min: 80, grade: 'A', remark: 'Excellent' }, { min: 70, grade: 'B', remark: 'Very good' }, { min: 60, grade: 'C', remark: 'Good' },
  { min: 50, grade: 'D', remark: 'Satisfactory' }, { min: 40, grade: 'E', remark: 'Weak' }, { min: 0, grade: 'F', remark: 'Fail' },
];
export function gradeOf(percent: number): GradeBand {
  const p = Number.isFinite(percent) ? percent : 0;
  return GRADE_SCALE.find((b) => p >= b.min) ?? GRADE_SCALE[GRADE_SCALE.length - 1];
}

/** The mark out of `outOf` for a score out of `max` (to the nearest half mark, as lecturers report it). */
export function scaledMark(score: number, max: number, outOf: number | null): number {
  if (!outOf || !(max > 0)) return Math.round(score * 100) / 100;
  return Math.round(((score / max) * outOf) * 2) / 2;
}

export interface Reported { score: number; maxScore: number; percent: number; outOf: number | null; mark: number; grade: string; remark: string; passed: boolean }
/** Everything the student and lecturer see for one marked attempt. */
export function report(score: number, maxScore: number, a: Assessment): Reported {
  const percent = maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : 0;
  const g = gradeOf(percent);
  return { score, maxScore, percent, outOf: a.outOf, mark: scaledMark(score, maxScore, a.outOf), grade: g.grade, remark: g.remark, passed: percent >= a.passPercent };
}
