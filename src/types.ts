export type WorkflowStep = 1 | 2 | 3 | 4 | 5;

export type NavigationTab = 'highlights' | 'documents' | 'decks' | 'marking_hub' | 'insights' | 'results';

export interface UserSettings {
  defaultStrictness: 'LENIENT' | 'STANDARD' | 'STRICT';
  autoSummarize: boolean;
  preferredLanguage: string;
  theme: 'dark' | 'light';
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  settings?: UserSettings;
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
  name: string;
  size?: string;
  type?: string;
  mimeType?: string;
  fileType?: 'image' | 'pdf' | 'document' | 'text' | 'doc' | 'docx' | 'ppt' | 'pptx' | 'xlsx' | 'xls' | 'code' | 'unknown';
  url?: string;
  previewUrl?: string;
  rawText?: string;
  htmlContent?: string;
  base64Data?: string;
}

export interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  attachment?: ChatAttachment;
  attachments?: ChatAttachment[];
  timestamp: string;
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
  studentName: string;
  studentId: string;
  submittedAt: string;
  status: 'pending' | 'marking' | 'marked' | 'approved';
  answers: StudentAnswerInput[];
  rawText?: string;
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
