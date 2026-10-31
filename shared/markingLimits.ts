/** One contract for scanner, upload API and marking workers. */
export const DEFAULT_MARKING_LIMITS = {
  // A whole year group in one job: up to 300 students, 40 pages each, 2,000 pages in all.
  maxCandidates: 300,
  maxPagesPerPaper: 40,
  maxBatchPages: 2000,
  // A whole class scanned into one PDF can be large.
  maxFileBytes: 100 * 1024 * 1024,
  maxUploadBytes: 200 * 1024 * 1024,
  previewMaxSide: 1800,
  originalMaxSide: 4000,
};
export type MarkingLimits = typeof DEFAULT_MARKING_LIMITS;
