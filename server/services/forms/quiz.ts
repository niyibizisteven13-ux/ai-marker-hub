/**
 * Quiz marking for forms: each question with points and a correct answer is marked the moment a response arrives,
 * by comparing answers (no AI, so it is instant, free and the same every time).
 *
 * Choice questions: the chosen option must match. Checkboxes: the set of ticked options must match exactly.
 * Typed answers: compared ignoring case, spaces and accents; numbers compared as numbers; a key may list
 * alternatives separated by "|" (e.g. "4|four").
 */

import { normalizeAssessment, report, usesAiGrading, type Assessment } from '../../../shared/assessment.js';
import { kindOf } from './model.js';

export interface QuizItem {
  id: string; title: string; points: number; earned: number; correct: boolean; given: unknown; correctAnswer: unknown;
  /** A written answer: marked by AI or by the lecturer, not by comparing with a key. */
  written?: boolean; pending?: boolean; by?: 'ai' | 'lecturer'; feedback?: string; confidence?: 'high' | 'low';
}
export interface QuizResult { score: number; maxScore: number; percent: number; items: QuizItem[]; /** Written answers still waiting for a mark. */ pending: number }
/** The marks given to written answers, kept with the response: { questionId: { marks, feedback, by } }. */
export type WrittenMarks = Record<string, { marks: number; feedback?: string; by: 'ai' | 'lecturer'; confidence?: 'high' | 'low' }>;

const fold = (v: unknown) => String(v ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const asNumber = (v: unknown) => { const s = String(v ?? '').replace(/,/g, '.').replace(/\s/g, ''); return s !== '' && Number.isFinite(Number(s)) ? Number(s) : null; };

function matches(given: unknown, key: unknown): boolean {
  if (Array.isArray(key)) {
    const want = new Set(key.map(fold).filter(Boolean));
    const got = new Set((Array.isArray(given) ? given : given === undefined || given === null || given === '' ? [] : [given]).map(fold).filter(Boolean));
    return want.size > 0 && want.size === got.size && [...want].every((x) => got.has(x));
  }
  if (given === undefined || given === null || given === '' || (Array.isArray(given) && !given.length)) return false;
  const answer = Array.isArray(given) ? given[0] : given;
  return String(key ?? '').split('|').some((alt) => {
    const a = asNumber(alt), b = asNumber(answer);
    if (a !== null && b !== null) return Math.abs(a - b) < 1e-9;
    return fold(alt) !== '' && fold(alt) === fold(answer);
  });
}

/** Marks one response against the form's answer key; null when the form is not a quiz or has no marked questions. */
export function gradeQuiz(schema: any, values: Record<string, unknown>): QuizResult | null {
  if (!schema?.isQuiz) return null;
  const list: any[] = Array.isArray(schema.fields) ? schema.fields : Array.isArray(schema.questions) ? schema.questions : [];
  const written: WrittenMarks = values?._written && typeof values._written === 'object' ? (values._written as WrittenMarks) : {};
  const assessment = normalizeAssessment(schema.assessment);
  const items: QuizItem[] = [];
  let pending = 0;
  for (const [i, q] of list.entries()) {
    const points = Number(q?.points);
    const key = q?.correctAnswer;
    const kind = kindOf(q?.type);
    const aiGrades = usesAiGrading(kind, q, assessment.aiMarking);
    const id = String(q.id ?? q.number ?? i + 1);
    const given = values[id];
    // A written answer is marked by AI (when the lecturer chose that) or by the lecturer; before it is marked it waits and counts as 0.
    if (points > 0 && Number.isFinite(points) && (aiGrades || (kind === 'long_text' && assessment.manualWritten) || (kind === 'long_text' || kind === 'text') && written[id])) {
      const w = written[id];
      const earned = w && Number.isFinite(Number(w.marks)) ? Math.max(0, Math.min(points, Math.round(Number(w.marks) * 2) / 2)) : 0;
      const wait = !w && given !== undefined && given !== null && String(given).trim() !== '';
      if (wait) pending++;
      items.push({ id, title: String(q.label ?? q.title ?? q.text ?? `Question ${i + 1}`), points, earned, correct: !!w && earned >= points, given: given ?? null, correctAnswer: typeof key === 'string' && (!aiGrades || q.aiGradingBasis !== 'knowledge') ? key : null, written: true, pending: wait, ...(w ? { by: w.by, ...(w.feedback ? { feedback: String(w.feedback).slice(0, 600) } : {}), ...(w.confidence ? { confidence: w.confidence } : {}) } : {}) });
      continue;
    }
    if (kind === 'long_text') continue;
    if (!(points > 0) || key === undefined || key === null || key === '' || (Array.isArray(key) && !key.length)) continue;
    const correct = matches(given, key);
    items.push({ id, title: String(q.label ?? q.title ?? q.text ?? `Question ${i + 1}`), points, earned: correct ? points : 0, correct, given: given ?? null, correctAnswer: key });
  }
  if (!items.length) return null;
  const maxScore = items.reduce((a, x) => a + x.points, 0);
  const score = items.reduce((a, x) => a + x.earned, 0);
  return { score, maxScore, percent: maxScore ? Math.round((score / maxScore) * 1000) / 10 : 0, items, pending };
}

/** What is kept with a response and shown in Results, the gradebook and the student's result: score, percent, and the CAT report. */
export function quizRecord(quiz: QuizResult, assessment?: unknown) {
  const a: Assessment = normalizeAssessment(assessment);
  const r = report(quiz.score, quiz.maxScore, a);
  return { score: quiz.score, maxScore: quiz.maxScore, percent: quiz.percent, correct: quiz.items.filter((x) => x.correct).map((x) => x.id), pending: quiz.pending, mark: r.mark, outOf: r.outOf, grade: r.grade, passed: r.passed };
}

/**
 * The lecturer's explanation for a question ("why the answer is right"). It is on the private list of the public form, so a
 * student can read it only through their own results after they submit (and only if the lecturer shows answers).
 */
export function explanationOf(schema: any, id: string): string | undefined {
  return reviewerText(questionOf(schema, id)?.explanation);
}

export function answerFeedbackOf(schema: unknown, item: QuizItem): string | undefined {
  if (item.written) return item.feedback;
  const question = questionOf(schema, item.id);
  return reviewerText(item.correct ? question?.correctFeedback : question?.incorrectFeedback);
}

function questionOf(schema: any, id: string) {
  const list: any[] = Array.isArray(schema?.fields) ? schema.fields : Array.isArray(schema?.questions) ? schema.questions : [];
  return list.find((field, i) => String(field?.id ?? field?.number ?? i + 1) === id);
}

function reviewerText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 600) : undefined;
}
