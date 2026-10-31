import type { OwnedRecord } from '../storage/ownedRecordStore.js';
import type { MarkingScheme } from './scheme.js';

/**
 * Persisted examination records. One JSON record per exam (owner-scoped) holds the versioned marking
 * scheme, candidate submissions, marking runs, the current results, the audit trail and artifact metadata.
 */

export type CandidateState =
  | 'queued' | 'validating' | 'recognizing' | 'matching_questions' | 'marking' | 'verifying'
  | 'generating_artifacts' | 'completed' | 'completed_with_warnings' | 'failed';

export type BatchState = CandidateState | 'cancelled';

export type ResultStatus = 'provisional' | 'needs_review' | 'user_corrected' | 'user_confirmed';

export type ReviewFlagCode =
  | 'unreadable_handwriting' | 'uncertain_reading' | 'recognition_disagreement' | 'mapping_uncertain'
  | 'unsupported_justification' | 'marks_inconsistent' | 'missing_evidence' | 'transcription_affects_mark'
  | 'rubric_ambiguity' | 'no_answer_found' | 'multiple_attempts' | 'scheme_changed' | 'marking_failed' | 'second_opinion_differs';

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
  identity: 'manifest' | 'message' | 'filename' | 'assigned' | 'paper';
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
  activity?: { questionId: string; at: string };
  /** Recognition settings fingerprint the document was produced with. */
  recognitionKey?: string;
  /** Typed answers (Word, text…): fileId is the printed PDF made from them; the teacher's file is kept here unchanged. */
  typed?: boolean;
  originalFileId?: string;
}

export interface CriterionResult {
  criterionId: string; awardedMarks: number; maxMarks: number; reason: string;
  /** The scheme line this mark was judged against, as it stood when marking (kept for "why" questions). */
  rubric?: string;
  evidenceElementIds?: string[];
  /** How a teacher would mark the cited working on the paper, chosen by the marker. */
  pen?: PenStyle | null;
  /** A few words written next to it ("sign error", "units?", "good method"). */
  note?: string | null;
}

/** Pen marks drawn on the script: the marker's, and the teacher's own. */
export type PenStyle = 'underline' | 'circle' | 'box' | 'highlight';
export type PenKind = PenStyle | 'tick' | 'cross' | 'note';
/** A mark the teacher drew on a page (fractions of the page as displayed, top-left origin). */
export interface PenMark { id: string; page: number; kind: PenKind; x0: number; y0: number; x1: number; y1: number; text?: string; by: string; at: string }

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
  /** A second, independent marking of a low-confidence answer: its mark and whether it agreed. */
  secondOpinion?: { awardedMarks: number; agreed: boolean };
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
  /** The teacher's own pen marks (ticks, crosses, circles, boxes, highlights, underlines, notes). */
  pen?: PenMark[];
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
  /** overnight = sent as half-price batches, results within 24 h (usually much sooner). */
  mode?: 'live' | 'overnight';
  /** Credits charged for this run so far: reading the handwriting, marking and second markings. */
  credits?: number;
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
  classPdfFileId?: string;
  workbookFileId?: string;
  htmlFileId?: string;
  summaryFileId?: string;
  candidatePdfs: Record<string, string>;
  /** Result timestamp each candidate PDF was drawn from, so unchanged PDFs are reused. */
  candidatePdfStamps: Record<string, string>;
  problems: string[];
  bundleBytes?: number;
  /** Candidate PDFs that were reopened, rendered and matched to the stored marks before release. */
  verified?: number;
}

/**
 * Live marking events (contract v1). Each one records a real state change in this record, with a
 * per-exam sequence number so a reconnecting viewer can replay what it missed. Payloads never carry
 * document text, prompts or file contents: only ids, counts, marks and short teacher-facing messages.
 */
export type ExamEventType =
  | 'job_created' | 'document_inspected' | 'page_processing_started' | 'handwriting_recovery_started'
  | 'handwriting_recovery_completed' | 'question_detected' | 'clarification_required' | 'rubric_processing_started'
  | 'rubric_ready' | 'marking_started' | 'question_marking_started' | 'question_marked' | 'uncertainty_detected'
  | 'teacher_review_required' | 'script_marked' | 'pdf_generation_started' | 'pdf_generation_completed' | 'job_completed'
  | 'job_failed' | 'job_cancelled';

export interface ExamEvent {
  v: 1;
  seq: number;
  type: ExamEventType;
  at: string;
  runId?: string;
  jobId?: string;
  submissionId?: string;
  candidateId?: string;
  questionId?: string;
  page?: number;
  message: string;
  /** Completed work, e.g. scripts marked of the run's scripts. */
  progress?: { done: number; total: number };
  data?: Record<string, string | number | boolean | null>;
}

/** How the teacher wants this exam marked (asked in chat or set on the review screen). */
export interface MarkingPreferences {
  /** partial: credit each satisfied criterion; strict: a criterion earns marks only when fully met. */
  credit: 'partial' | 'strict';
  /** Red corrections under wrong answers on the marked PDF. */
  corrections: boolean;
  /** Feedback length in the report and on the summary page. */
  feedback: 'brief' | 'detailed';
  /** The teacher's own marking instructions ("accept g = 9.8 or 10"); followed unless they contradict the scheme. */
  instructions?: string;
  /** Mark overnight as half-price batches (results within 24 h) instead of now. */
  overnight?: boolean;
  updatedAt?: string;
}

export const DEFAULT_PREFERENCES: MarkingPreferences = { credit: 'partial', corrections: true, feedback: 'brief' };

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
  /** Live marking events (latest 2,000) and the last sequence number used. */
  events?: ExamEvent[];
  eventSeq?: number;
  preferences?: MarkingPreferences;
}
