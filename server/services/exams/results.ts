import type { MarkingScheme } from './scheme.js';
import type { CandidateResult, ExamRecord, QuestionResult, ResultStatus, ReviewFlag, Submission } from './types.js';

/**
 * Authoritative result arithmetic. Effective mark = examiner override, else the validated AI mark.
 * Totals, percentages and class statistics are computed here, never taken from a model or a spreadsheet.
 */

const r4 = (n: number) => Number(n.toFixed(4));
const r2 = (n: number) => Number(n.toFixed(2));

export function effectiveMarks(q: QuestionResult): number | null {
  if (q.override) return q.override.marks;
  return q.ai?.awardedMarks ?? null;
}

export function questionStatus(q: QuestionResult): ResultStatus {
  if (q.confirmed) return 'user_confirmed';
  if (q.override || q.ai?.basedOnCorrection) return q.override || !openFlags(q).length ? 'user_corrected' : 'needs_review';
  if (effectiveMarks(q) === null || openFlags(q).length) return 'needs_review';
  return 'provisional';
}

/** Unresolved review flags: an examiner override or confirmation resolves them. */
export function openFlags(q: QuestionResult): ReviewFlag[] {
  if (q.confirmed || q.override) return [];
  if (!q.ai) return [...q.mappingFlags, { code: 'marking_failed', severity: 'high', detail: 'Not marked yet.' }];
  return q.ai.reviewFlags;
}

export interface CandidateSummary {
  submissionId: string;
  candidateId: string;
  candidateName: string | null;
  fileName: string;
  total: number;
  maxTotal: number;
  percent: number;
  complete: boolean;
  passed: boolean | null;
  status: ResultStatus;
  openFlags: number;
  changedByUser: boolean;
  questions: Array<{ questionId: string; number: string; maxMarks: number; marks: number | null; status: ResultStatus; flags: ReviewFlag[]; outcome: 'full' | 'partial' | 'zero' | 'unmarked' }>;
}

export function summarizeCandidate(res: CandidateResult, sub: Submission, scheme: MarkingScheme, passPercent: number): CandidateSummary {
  const questions = res.questions.map((q) => {
    const marks = effectiveMarks(q);
    const outcome: CandidateSummary['questions'][number]['outcome'] = marks === null ? 'unmarked' : marks >= q.maxMarks ? 'full' : marks <= 0 ? 'zero' : 'partial';
    return { questionId: q.questionId, number: q.number, maxMarks: q.maxMarks, marks, status: questionStatus(q), flags: openFlags(q), outcome };
  });
  const complete = questions.every((q) => q.marks !== null);
  const total = r4(questions.reduce((a, q) => a + (q.marks ?? 0), 0));
  const percent = scheme.totalMarks ? r2((100 * total) / scheme.totalMarks) : 0;
  const statuses = questions.map((q) => q.status);
  const status: ResultStatus = statuses.includes('needs_review') ? 'needs_review'
    : statuses.every((s) => s === 'user_confirmed') ? 'user_confirmed'
      : statuses.some((s) => s === 'user_corrected' || s === 'user_confirmed') ? 'user_corrected' : 'provisional';
  return {
    submissionId: sub.id, candidateId: sub.candidateId, candidateName: sub.candidateName ?? null, fileName: sub.fileName,
    total, maxTotal: scheme.totalMarks, percent, complete, passed: complete ? percent >= passPercent : null, status,
    openFlags: questions.reduce((a, q) => a + q.flags.length, 0), changedByUser: res.questions.some((q) => !!q.override), questions,
  };
}

export interface ClassStatistics {
  candidates: number;
  marked: number;
  complete: number;
  failedProcessing: number;
  flaggedCandidates: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  sd: number | null;
  passPercent: number;
  passRate: number | null;
  distribution: Array<{ from: number; to: number; count: number }>;
  questions: Array<{ questionId: string; number: string; maxMarks: number; marked: number; mean: number | null; median: number | null; meanPercent: number | null; fullRate: number | null; zeroRate: number | null; partialRate: number | null; flagged: number }>;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function classStatistics(summaries: CandidateSummary[], scheme: MarkingScheme, passPercent: number, failedProcessing: number): ClassStatistics {
  const complete = summaries.filter((s) => s.complete);
  const pct = complete.map((s) => s.percent);
  const totals = complete.map((s) => s.total);
  const mean = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
  const sd = totals.length > 1 && mean !== null ? Math.sqrt(totals.reduce((a, t) => a + (t - mean) ** 2, 0) / (totals.length - 1)) : null;
  const distribution = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: (i + 1) * 10, count: pct.filter((p) => (i === 9 ? p >= 90 : p >= i * 10 && p < (i + 1) * 10)).length }));
  const questions = scheme.questions.map((q) => {
    const rows = summaries.map((s) => s.questions.find((x) => x.questionId === q.id)).filter((x): x is CandidateSummary['questions'][number] => !!x);
    const marked = rows.filter((r) => r.marks !== null);
    const vals = marked.map((r) => r.marks!);
    const m = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    const rate = (k: 'full' | 'zero' | 'partial') => (marked.length ? r2((100 * marked.filter((r) => r.outcome === k).length) / marked.length) : null);
    return {
      questionId: q.id, number: q.number, maxMarks: q.maxMarks, marked: marked.length, mean: m === null ? null : r2(m), median: median(vals),
      meanPercent: m === null ? null : r2((100 * m) / q.maxMarks), fullRate: rate('full'), zeroRate: rate('zero'), partialRate: rate('partial'),
      flagged: rows.filter((r) => r.flags.length).length,
    };
  });
  return {
    candidates: summaries.length + failedProcessing, marked: summaries.length, complete: complete.length, failedProcessing,
    flaggedCandidates: summaries.filter((s) => s.openFlags > 0).length,
    mean: mean === null ? null : r2(mean), median: median(totals), min: totals.length ? Math.min(...totals) : null, max: totals.length ? Math.max(...totals) : null,
    sd: sd === null ? null : r2(sd), passPercent,
    passRate: complete.length ? r2((100 * complete.filter((s) => s.passed).length) / complete.length) : null,
    distribution, questions,
  };
}

/** Current scheme of a marking run (the frozen version). */
export function schemeOf(exam: ExamRecord, version: number): MarkingScheme | null {
  return exam.schemes.find((s) => s.version === version)?.scheme ?? null;
}

export function currentSummaries(exam: ExamRecord): { summaries: CandidateSummary[]; scheme: MarkingScheme | null; failed: Submission[] } {
  const results = Object.values(exam.results);
  const version = results.length ? Math.max(...results.map((r) => r.schemeVersion)) : (exam.schemes.filter((s) => s.status === 'confirmed').pop()?.version ?? 0);
  const scheme = schemeOf(exam, version);
  if (!scheme) return { summaries: [], scheme: null, failed: exam.submissions.filter((s) => s.state === 'failed') };
  const summaries = exam.submissions
    .filter((s) => exam.results[s.id])
    .map((s) => summarizeCandidate(exam.results[s.id], s, schemeOf(exam, exam.results[s.id].schemeVersion) ?? scheme, exam.passPercent));
  return { summaries, scheme, failed: exam.submissions.filter((s) => s.state === 'failed' && !exam.results[s.id]) };
}
