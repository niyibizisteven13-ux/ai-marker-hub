/** One contract for scanner, upload API and marking workers. */
export const DEFAULT_MARKING_LIMITS = {
  maxCandidates: 30,
  maxPagesPerPaper: 20,
  maxBatchPages: 50,
  maxFileBytes: 20 * 1024 * 1024,
  maxUploadBytes: 60 * 1024 * 1024,
  previewMaxSide: 1800,
  originalMaxSide: 4000,
};
export type MarkingLimits = typeof DEFAULT_MARKING_LIMITS;
