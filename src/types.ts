export type WorkflowStep = 1 | 2 | 3 | 4 | 5;

export type NavigationTab = 'highlights' | 'documents' | 'decks' | 'marking_hub' | 'insights' | 'results';

export interface UserSettings {
  defaultStrictness: 'LENIENT' | 'STANDARD' | 'STRICT';
  autoSummarize: boolean;
  preferredLanguage: string;
  theme: 'dark' | 'light';
  longTermMemory: boolean;
  agentTone: 'PROFESSIONAL' | 'ENCOURAGING' | 'STRICT' | 'ACADEMIC';
  customInstructions?: string;
  /** Saved appearance (Settings → Appearance), JSON. */
  appearance?: string | null;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role?: 'ADMIN' | 'INSTRUCTOR';
  avatarUrl?: string;
  settings?: UserSettings;
  subscription?: {
    planType: 'BUSINESS' | 'STARTER' | 'PRO' | 'PLUS' | 'ORGANIZATION';
    status: 'ACTIVE' | 'EXPIRED' | 'CANCELED';
  };
}

export interface ResponseFeedbackDetails {
  question: string;
  response: string;
  reasons: string[];
  details: string;
  consentForImprovement?: boolean;
}

export type HighlightColor = 'terracotta' | 'yellow' | 'sage' | 'blue' | 'lilac';

export interface DocumentHighlight {
  id: string;
  docId: string;
  docTitle: string;
  text: string;
  color: HighlightColor;
  createdAt: string;
  note?: string;
  category?: string;
}

export interface Flashcard {
  id: string;
  deckId: string;
  front: string;
  back: string;
  sourceDocTitle?: string;
  createdAt: string;
}

export interface StudyDeck {
  id: string;
  title: string;
  cardsCount: number;
  description: string;
  updatedAt: string;
}

export interface AICard {
  id: string;
  type: 'summary' | 'translation' | 'flashcard' | 'rubric' | 'chat' | 'notion';
  role?: 'user' | 'assistant' | 'system';
  title: string;
  content: string;
  sourceText?: string;
  statusSign?: string;
  timestamp: string;
  language?: string;
  fileName?: string;
  fileSize?: string;
  fileType?: 'pdf' | 'image' | 'doc' | 'text' | 'unknown';
  suggestions?: string[];
  isUpload?: boolean;
}

export interface ChatAttachment {
  id: string;
  serverId?: string;
  /** Where the AI stored this file; sent with later messages so the AI can read it again. */
  storedFileId?: string;
  status?: 'uploading' | 'ready' | 'failed';
  name: string;
  size?: string;
  type?: string;
  mimeType?: string;
  fileType?: 'image' | 'pdf' | 'document' | 'text' | 'doc' | 'docx' | 'ppt' | 'pptx' | 'xlsx' | 'xls' | 'code' | 'unknown';
  url?: string;
  /** The original file in this browser session (an object URL), for previewing what was sent. */
  localUrl?: string;
  /** Size in bytes. */
  bytes?: number;
  /** Small picture or first lines of the file, made when it was sent, so the card still shows what is inside after a reload. */
  thumb?: { image?: string; text?: string; table?: string[][]; meta?: string };
  previewUrl?: string;
  rawText?: string;
  htmlContent?: string;
  base64Data?: string;
}

export interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  thinkingText?: string;
  isThinking?: boolean;
  provider?: string;
  taskId?: string;
  attachment?: ChatAttachment;
  attachments?: ChatAttachment[];
  generatedAttachments?: import('./components/types').AttachmentRef[];
  /** Examination this reply is marking: shows the live marking card. */
  examId?: string;
  /** Live agent tool steps for the activity line. */
  steps?: import('./components/ActivityLine').Step[];
  isBusy?: boolean;
  currentStatus?: string;
  startedAt?: number;
  endedAt?: number;
  timestamp: string;
  isStreaming?: boolean;
  isWaiting?: boolean;
  stopped?: boolean;
  rating?: 'up' | 'down';
  errorKind?: 'service_unavailable' | 'network' | 'generic';
  sources?: Array<{ filename: string; pageNumber?: number; tableNumber?: string; title?: string }>;
  citations?: Array<any>;
  actions?: Array<{
    label: string;
    value: string;
    actionType?: 'text' | 'scanner' | 'attach' | 'retry';
    attachment?: ChatAttachment;
  }>;
}


export interface ChatSession {
  id: string;
  title: string;
  date: string;
  messageCount: number;
  messages: Message[];
  lastInteractionId?: string;
}


export interface HardwarePenState {
  connected: boolean;
  batteryPercent: number;
  bluetoothVersion: string;
  streaming: boolean;
  lastOCRText?: string;
  lastSyncTime?: string;
  activePenModel: string;
}

export type QuestionType = 'short_answer' | 'essay' | 'mcq' | 'calculation';

export interface Question {
  id: string;
  number: string;
  questionText: string;
  maxMarks: number;
  questionType: QuestionType;
  modelAnswer?: string;
  options?: string[];
}

export interface RubricCriterion {
  id: string;
  criterion: string;
  marksAvailable: number;
  description?: string;
}

export interface QuestionRubric {
  questionId: string;
  questionNumber: string;
  maxMarks: number;
  criteria: RubricCriterion[];
}

export interface ExamPaper {
  id: string;
  title: string;
  subject: string;
  topic: string;
  gradeLevel: string;
  difficulty: string;
  totalMarks: number;
  durationMinutes: number;
  questions: Question[];
  rubrics: QuestionRubric[];
  createdAt: string;
}

export interface CriterionEvaluation {
  criterion: string;
  marksAvailable: number;
  marksAwarded: number;
  reason: string;
}

export type FlagType = 'none' | 'illegible' | 'blank' | 'off_topic' | 'possible_plagiarism' | 'needs_teacher_review';

export interface QuestionMarkResult {
  questionNumber: string;
  questionId: string;
  maxMarks: number;
  awardedMarks: number;
  criteriaBreakdown: CriterionEvaluation[];
  feedbackToStudent: string;
  flag: FlagType;
  teacherNotes?: string;
}

export interface UploadedFile {
  id: string;
  name: string;
  url: string;
  fileType: 'pdf' | 'image' | 'docx' | 'doc' | 'pptx' | 'ppt' | 'xlsx' | 'xls' | 'code' | 'text';
  rawText?: string;
  /** Original file retained in memory so it can be sent to the marking API. */
  sourceFile?: File;
  htmlContent?: string;
  studentName?: string;
  batchBadge?: string;
  isSoftDeleted?: boolean;
  isFlagged?: boolean;
  bonusMarks?: number;
}

export interface StudentAnswerInput {
  questionId: string;
  questionNumber: string;
  answerText: string;
}

export interface StudentScript {
  id: string;
  /** ID of the uploaded paper this marking record belongs to, when applicable. */
  sourceFileId?: string;
  studentName: string;
  studentId: string;
  submittedAt: string;
  status: 'pending' | 'marking' | 'marked' | 'approved';
  answers: StudentAnswerInput[];
  rawText?: string;
  /** Original scan/document bytes for server-side OCR and multimodal marking. */
  sourceFile?: File;
  fileName?: string;
  results?: QuestionMarkResult[];
  totalAwardedMarks?: number;
  maxTotalMarks?: number;
  percentage?: number;
  overallFeedback?: string;
  flags?: FlagType[];
  teacherApproved?: boolean;
  teacherApprovalTime?: string;
}

export interface ExamGeneratorRequest {
  subject: string;
  topic: string;
  gradeLevel: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced' | 'IB/AP Standard';
  questionTypes: string[];
  totalMarks: number;
  durationMinutes: number;
  additionalInstructions?: string;
}

export interface ScriptMarkingRequest {
  examPaper: ExamPaper;
  studentScript: StudentScript;
}

export interface ClassAnalytics {
  totalStudents: number;
  averageScore: number;
  highestScore: number;
  lowestScore: number;
  passRate: number;
  flaggedCount: number;
  approvedCount: number;
  questionAverages: { questionNumber: string; avgScore: number; maxScore: number; percentage: number }[];
  commonMisconceptions: string[];
}
