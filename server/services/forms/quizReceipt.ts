import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { normalizeAssessment } from '../../../shared/assessment.js';
import { answerFeedbackOf, explanationOf, type QuizResult, type quizRecord, type WrittenMarks } from './quiz.js';

type Score = ReturnType<typeof quizRecord>;

export function quizReview(quiz: QuizResult, schema: unknown) {
  return quiz.items.map(item => ({
    id: item.id,
    correct: item.correct,
    points: item.earned,
    maxPoints: item.points,
    yourAnswer: item.given,
    correctAnswer: item.correctAnswer ?? undefined,
    explanation: explanationOf(schema, item.id),
    feedback: answerFeedbackOf(schema, item),
    ...(item.written ? { written: true } : {}),
  }));
}

export function quizCompletion(score: Score, assessment: unknown, showScore: boolean, review?: ReturnType<typeof quizReview>, aiFinished = false) {
  const settings = normalizeAssessment(assessment);
  if (!showScore && !review) return {};
  if (score.pending > 0) return {
    pending: true,
    markingWithAi: settings.aiMarking && !aiFinished,
    pendingNote: settings.aiMarking && !aiFinished
      ? 'Your response is saved. This page will show your result as soon as marking finishes.'
      : 'Your response is saved. Your teacher needs to review the remaining answers.',
  };
  return {
    ...(showScore ? {
      score: score.score, maxScore: score.maxScore, percent: score.percent, grade: score.grade, passed: score.passed,
      ...(score.outOf ? { mark: score.mark, outOf: score.outOf } : {}),
      scoreLabel: settings.title ? `Your score (${settings.title})` : 'Your score',
    } : {}),
    ...(review ? { results: review } : {}),
  };
}

export function newQuizReceipt() {
  const token = randomBytes(32).toString('base64url');
  return { token, digest: hashReceipt(token) };
}
const hashReceipt = (token: string) => createHash('sha256').update(token).digest('hex');

export function matchesQuizReceipt(token: unknown, digest: unknown): boolean {
  return typeof token === 'string' && /^[\w-]{43}$/.test(token) && typeof digest === 'string' && /^[0-9a-f]{64}$/.test(digest)
    && timingSafeEqual(Buffer.from(hashReceipt(token), 'hex'), Buffer.from(digest, 'hex'));
}

export function completeWrittenReview(review: ReturnType<typeof quizReview>, marks: WrittenMarks = {}) {
  return review.map(item => {
    const mark = item.written && marks[item.id];
    if (!item.written || !mark) return item;
    return { ...item, points: mark.marks, correct: mark.marks >= item.maxPoints, feedback: mark.feedback };
  });
}
