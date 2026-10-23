import type { OwnedRecord } from '../storage/ownedRecordStore.js';
import type { MarkingScheme } from './scheme.js';

/**
 * Persisted examination records. One JSON record per exam (owner-scoped) holds the versioned marking
 * scheme, candidate submissions, marking runs, the current results, the audit trail and artifact metadata.
 */

export type CandidateState =
  | 'queued' | 'validating' | 'recognizing' | 'matching_questions' | 'marking' | 'verifying'
  | 'generating_artifacts' | 'completed' | 'completed_with_warnings' | 'failed';

export type BatchState = CandidateState;

export type ResultStatus = 'provisional' | 'needs_review' | 'user_corrected' | 'user_confirmed';

export type ReviewFlagCode =
  | 'unreadable_handwriting' | 'uncertain_reading' | 'recognition_disagreement' | 'mapping_uncertain'
  | 'unsupported_justification' | 'marks_inconsistent' | 'missing_evidence' | 'transcription_affects_mark'
  | 'rubric_ambiguity' | 'no_answer_found' | 'multiple_attempts' | 'scheme_changed' | 'marking_failed';

export interface ReviewFlag { code: ReviewFlagCode; severity: 'medium' | 'high'; detail: string }

export interface SchemeVersion {
  version: number;
  status: 'needs_confirmation' | 'confirmed' | 'invalid';
  scheme: MarkingScheme | null;
  errors: string[];
  warnings: string[];
  source: { kind: 'json' | 'text' | 'document' | 'edit'; fileIds: string[]; note?: string };
  createdAt: string;
  createdBy: string;
  confirmedAt?: string;
  confirmedBy?: string;
  /** Questions whose definition differs from the previous version (affected results). */
  changedQuestionIds?: string[];
}

export interface Submission {
  id: string;
  candidateId: string;
  candidateName?: string;
  /** How the candidate id was established. */
  identity: 'manifest' | 'message' | 'filename' | 'assigned';
  fileId: string;
  fileName: string;
  mime: string;
  sha256: string;
  pages: number;
  uploadedAt: string;
  state: CandidateState;
  stateAt: string;
  error?: { code: string; message: string };
  documentId?: string;
  recognitionCached?: boolean;
  /** Recognition settings fingerprint the document was produced with. */
  recognitionKey?: string;
}

export interface CriterionResult {
  criterionId: string; awardedMarks: number; maxMarks: number; reason: string;
  /** The scheme line this mark was judged against, as it stood when marking (kept for "why" questions). */
  rubric?: string;
}

/** How sure the marking is, from the marker's own estimate capped by what code found (flags, evidence). */
export interface MarkConfidence { level: 'high' | 'medium' | 'low'; score: number; basis: string[] }

export interface AiQuestionMark {
  runId: string;
  schemeVersion: number;
  /** Null when the model's marks failed validation; a reviewer must set them. */
  awardedMarks: number | null;
  criterionResults: CriterionResult[];
  path: string | null;
  level: string | null;
  feedback: string;
  lostMarks: string;
  answerFound: boolean;
  evidenceElementIds: string[];
  evidenceQuotes: Array<{ elementId: string; quote: string; verified: boolean }>;
  reviewFlags: ReviewFlag[];
  /** Marked from text the teacher corrected. */
  basedOnCorrection?: boolean;
  /** The candidate's answer as the AI read it when marking (evidence lines, in order). */
  answerAsRead?: string;
  /** Short red correction written under a wrong answer, e.g. "Area = 7 × 5 = 35 cm²". */
  correction?: string | null;
  confidence?: MarkConfidence;
  model: string;
  at: string;
}

export interface MarkOverride { marks: number; reason: string; by: string; at: string; rubricConflict: string | null }

export interface QuestionResult {
  questionId: string;
  number: string;
  maxMarks: number;
  ai: AiQuestionMark | null;
  override: MarkOverride | null;
  confirmed: { by: string; at: string } | null;
  /** Element ids of the candidate's answer from the deterministic question matcher. */
  mappedElementIds: string[];
  mappingFlags: ReviewFlag[];
  history: Array<{ revision: number; at: string; actor: string; kind: 'ai_mark' | 'ai_remark' | 'override' | 'confirm' | 'scheme_change'; before: number | null; after: number | null; reason: string }>;
}

/** A teacher's adjustment of where an item is drawn: page and position as fractions of the displayed page. */
export interface LayoutOverride { page: number; fx: number; fy: number; hidden?: boolean; by: string; at: string }

export interface CandidateResult {
  submissionId: string;
  candidateId: string;
  runId: string;
  schemeVersion: number;
  questions: QuestionResult[];
  updatedAt: string;
  usage: { input: number; output: number };
  /** Teacher adjustments keyed by layout item id ("<questionId>:mark", "<questionId>:correction", "total"). */
  layout?: Record<string, LayoutOverride>;
  /** Set when the teacher releases the marked PDF; cleared by any later change to marks or layout. */
  released?: { at: string; by: string; resultUpdatedAt: string } | null;
}

export interface MarkingRun {
  id: string;
  schemeVersion: number;
  submissionIds: string[];
  state: BatchState;
  createdAt: string;
  createdBy: string;
  startedAt?: string;
  finishedAt?: string;
  jobIds: string[];
  error?: string;
}

export interface AuditEvent {
  revision: number;
  at: string;
  actor: string;
  type: 'marked' | 'remarked' | 'override' | 'transcription_correction' | 'confirm' | 'scheme_version' | 'scheme_confirmed' | 'submission_added' | 'export' | 'layout' | 'release';
  submissionId?: string;
  candidateId?: string;
  questionId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

export interface ArtifactSet {
  id: string;
  resultRevision: number;
  createdAt: string;
  status: 'generating' | 'ready' | 'failed';
  error?: string;
  bundleFileId?: string;
  workbookFileId?: string;
  htmlFileId?: string;
  summaryFileId?: string;
  candidatePdfs: Record<string, string>;
  /** Result timestamp each candidate PDF was drawn from, so unchanged PDFs are reused. */
  candidatePdfStamps: Record<string, string>;
  problems: string[];
  bundleBytes?: number;
}

export interface ExamRecord extends OwnedRecord {
  title: string;
  passPercent: number;
  questionPaper: { fileId: string; name: string; documentId?: string } | null;
  schemes: SchemeVersion[];
  submissions: Submission[];
  runs: MarkingRun[];
  results: Record<string, CandidateResult>;
  resultRevision: number;
  audit: AuditEvent[];
  artifacts: ArtifactSet[];
}
