import { DEFAULT_MARKING_LIMITS } from '../../../shared/markingLimits.js';
const positive = (value: string | undefined, fallback: number) => {
  const n = Number(value); return Number.isInteger(n) && n > 0 ? n : fallback;
};
export const markingLimits = {
  ...DEFAULT_MARKING_LIMITS,
  maxCandidates: positive(process.env.EXAM_MAX_CANDIDATES, DEFAULT_MARKING_LIMITS.maxCandidates),
  maxPagesPerPaper: positive(process.env.DOC_MAX_PAGES, DEFAULT_MARKING_LIMITS.maxPagesPerPaper),
  maxBatchPages: positive(process.env.EXAM_MAX_BATCH_PAGES, DEFAULT_MARKING_LIMITS.maxBatchPages),
};
