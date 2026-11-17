/**
 * Shared types for the Bwenge AI capability layer.
 * Messages use the OpenAI chat-completions shape internally (Gonka, NVIDIA NIM,
 * OpenRouter and OpenAI all accept it); other providers are adapted at the edge.
 */

export type JsonSchema = Record<string, unknown>;

export type ContentPart =
  /** `cache`: the text is the same across many requests (a marking scheme, a question paper); providers that
   *  support prompt caching store everything up to and including it, so later requests reuse it. */
  | { type: 'text'; text: string; cache?: boolean }
  | { type: 'image_url'; image_url: { url: string } };

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  /**
   * Provider-native content for an assistant turn (e.g. Claude thinking + tool_use blocks), replayed
   * unchanged to the same provider within an agent loop. Never sent to other providers.
   */
  providerState?: { provider: string; content: unknown[] };
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema (type: object). */
  parameters: JsonSchema;
}

export type AttachmentKind =
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'pdf'
  | 'text'
  | 'code'
  | 'image'
  | 'drawing'
  | 'chart'
  | 'diagram'
  | 'archive'
  | 'model3d';

/** What the UI receives for every file the AI creates. */
export interface AttachmentRef {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  /** Download URL (signed, time-limited). */
  url: string;
  /** Optional image preview URL (PNG) for drawings, charts and diagrams. */
  previewUrl?: string;
  /** Stored file id of the preview. Persist this with the message so links can be re-signed later. */
  previewId?: string;
  expiresAt: string;
}

export interface ToolOutput {
  /** Text returned to the model. Keep it short and factual. */
  text: string;
  attachments?: AttachmentRef[];
  /** Knowledge passages used, so the UI can show source chips. */
  sources?: KnowledgePassage[];
  isError?: boolean;
  /** Images the model should look at next (e.g. PDF pages), shown to it right after the tool results. */
  images?: Array<{ mime: string; base64: string; label?: string }>;
}

export interface Tool {
  definition: ToolDefinition;
  execute(input: any, ctx: ToolContext): Promise<ToolOutput>;
  /** Longer than the runtime's default tool timeout (whole-document analysis). */
  timeoutMs?: number;
}

export interface KnowledgePassage {
  text: string;
  title?: string;
  publisher?: string;
  year?: number;
  page?: number;
  table?: string;
  url?: string;
  score?: number;
  /** Repository file the passage comes from (datasets in Admin → Datasets & Curations). */
  fileId?: string;
  path?: string;
}

/** Optional services injected from the host app. Tools that need a service are only offered when it exists. */
export interface ToolServices {
  /** Plain text completion on the document model, for tools that read long documents section by section. */
  llm?: { complete(req: { system: string; prompt: string; maxTokens?: number; userId: string; signal?: AbortSignal }): Promise<string> };
  knowledge?: { search(query: string, opts: { topK: number; userId: string }): Promise<KnowledgePassage[]> };
  webSearch?: {
    search(query: string): Promise<Array<{ title: string; url: string; snippet: string }>>;
    fetchUrl?(url: string): Promise<string>;
  };
  python?: {
    execute(code: string, ctx: { userId: string }): Promise<{
      stdout: string;
      stderr?: string;
      files?: Array<{ name: string; mime?: string; base64: string }>;
    }>;
  };
  image?: ImageProvider;
  /** Memory across all chats (PRO). Calls are refused with a clear message when memory is off. */
  memory?: {
    remember(userId: string, content: string, kind: 'fact' | 'preference' | 'note'): Promise<string>;
    recall(userId: string, query: string): Promise<Array<{ id: string; content: string; kind: string; createdAt: string }>>;
    forget(userId: string, query: string): Promise<number>;
  };
  /** Datasets curated by admins in Admin → Datasets & Curations (knowledge repositories). */
  datasets?: {
    catalog(userId: string): Promise<DatasetSummary[]>;
    browse(userId: string, datasetId: string, opts: { path?: string; search?: string; limit?: number }): Promise<DatasetListing>;
    read(userId: string, fileId: string, opts: { maxChars?: number; sheet?: string; rowOffset?: number }): Promise<DatasetFileContent>;
    /** Whole text of a library file with page marks, for analyze_document. */
    fullText?(userId: string, fileId: string): Promise<{ name: string; path: string; repository: string; text: string }>;
    /** The bytes of a library file (same access rules), for looking at its pages. */
    open?(userId: string, fileId: string): Promise<{ name: string; mime: string; data: Buffer }>;
  };
  /** Assignments: tasks shared with a class by link, the students' hand-ins, and marking them. */
  assignments?: {
    create(userId: string, input: { title: string; instructions: string; dueAt?: string }): Promise<{ id: string; title: string; link: string; dueAt: string | null }>;
    list(userId: string): Promise<Array<{ id: string; title: string; dueAt: string | null; open: boolean; link: string; submitted: number; lastSubmissionAt: string | null }>>;
    get(userId: string, id: string): Promise<{ id: string; title: string; instructions: string; dueAt: string | null; open: boolean; link: string; submissions: Array<{ studentName: string; studentId?: string; files: Array<{ name: string }>; text?: string; submittedAt: string; late: boolean }> }>;
  };
  /** The rest of the platform, for the chat to read and act on: live rooms (MySEB), classes and marked exams. Every call is scoped to the signed-in user. */
  platform?: {
    liveRooms(userId: string): Promise<Array<{ kind: 'form' | 'task'; id: string; title: string; hasRoom: boolean }>>;
    roomStatus(userId: string, kind: 'form' | 'task', id: string): Promise<{
      exam: { title: string; status: string; live_mode?: string; allow_web?: boolean; web_devices?: string; web_strict?: boolean; multi_face?: string; id_check?: boolean; leave_action?: string };
      counts: Record<string, number>;
      students: Array<{ id: string; student_name: string; status: string; client_type: string; violation_count: number; last_violation: string | null; pause_reason: string | null; end_reason: string | null; id_status?: string; aside_seconds?: number; reinstated_count?: number; has_partial?: boolean }>;
    }>;
    roomSavedAnswers(userId: string, kind: 'form' | 'task', id: string, studentId: string): Promise<{ student: string; saved_at: string | null; labels: Record<string, string>; answers: Record<string, unknown> }>;
    roomCode(userId: string, kind: 'form' | 'task', id: string): Promise<{ display: string; joinUrl: string; expiresAt: string }>;
    roomSettings(userId: string, kind: 'form' | 'task', id: string, patch: { allowBrowsers?: boolean; strictBrowsers?: boolean; faces?: 'off' | 'warn' | 'end'; studentCard?: boolean; browserDevices?: 'any' | 'ios'; ifStudentLeaves?: 'record' | 'pause' | 'end' | 'pause_then_end' }): Promise<void>;
    roomStudent(userId: string, kind: 'form' | 'task', id: string, studentId: string, action: 'let_back_in' | 'resume' | 'end'): Promise<void>;
    /** The room assistant: rules the lecturer sets for routine moments during a test, and the log of what it did. */
    roomAssistant(userId: string, kind: 'form' | 'task', id: string, patch?: { on?: boolean; autoResume?: boolean; afterSeconds?: number; maxResumes?: number; endAfterMax?: boolean; level?: 'watch' | 'assist' | 'run'; dryRun?: boolean; maxAddMinutes?: number; maxRoomPauses?: number; serious?: 'flag' | 'end'; seriousStrikes?: number; autoClose?: boolean; closeAfterMinutes?: number; confirmedAutopilot?: boolean }): Promise<{
      rules: { on: boolean; autoResume: boolean; afterSeconds: number; maxResumes: number; endAfterMax: boolean; level: 'watch' | 'assist' | 'run'; dryRun: boolean; maxAddMinutes: number; maxRoomPauses: number; serious: 'flag' | 'end'; seriousStrikes: number; autoClose: boolean; closeAfterMinutes: number }; usage: { roomPauses: number; addedMinutes: number; notices: number }; report?: { at: string; text: string }; resumed: number; log: Array<{ at: string; kind: string; student?: string; text: string }>;
    }>;
    /** Pause or release everyone, add time, or send a message to students: done for the lecturer, logged and audited. */
    roomAction(userId: string, kind: 'form' | 'task', id: string, a: { action: 'pause_room' | 'resume_room' | 'add_time' | 'notice'; minutes?: number; text?: string; studentId?: string; reason?: string }): Promise<{ ok: boolean; text: string }>;
    /** The review queue (flagged students with their timeline) and the lecturer's decision on one. */
    roomReview(userId: string, kind: 'form' | 'task', id: string, decide?: { studentId: string; decision: 'open' | 'confirmed' | 'dismissed'; note?: string; giveMinutes?: number }): Promise<{ items: Array<{ studentId: string; name: string; score: number; strikes: number; signals: number; ended: { words: string } | null; timeline: Array<{ at: string; words: string; kind: string }>; evidence: number; canRestore: boolean; decision: string; note: string }>; open: number; total: number; testOpen: boolean; decided?: { gaveMinutes?: number } }>;
    /** What one student's problems were, newest last (for the debrief). */
    roomViolations(userId: string, kind: 'form' | 'task', id: string, studentId: string): Promise<Array<{ type: string; created_at: string }>>;
    courses(userId: string): Promise<Array<{ id: string; name: string; code: string; term: string; students: number; items: number }>>;
    courseOverview(userId: string, id: string): Promise<{
      course: { id: string; name: string; code: string; term: string };
      columns: Array<{ kind: string; title: string; dueAt: string | null; average: number | null; submitted: number; flagged: number }>;
      students: Array<{ id: string; name: string; status: string; average: number | null; missing: number; flagged: number; late: number; risk: string; hasAccommodation: boolean }>;
      totals: { students: number; withAccommodations: number; needAttention: number; flaggedResponses: number; average: number | null };
    }>;
    markedExams(userId: string): Promise<Array<{ examId: string; title: string; updatedAt: string; candidates: number; marked: number; released: number; needsReview: number }>>;
  };
  /** Records what the chat changed on someone's behalf in the audit log (action names start with CHAT_). */
  audit?: (userId: string, action: string, resourceType: string, resourceId: string | null, details?: unknown) => Promise<void>;
  /** Doing the work in the chat: marking a task's hand-ins, releasing results, classes, exam results and Excel files. Every call is scoped to the signed-in user. */
  work?: {
    taskResults(userId: string, id: string): Promise<{
      title: string; open: boolean; dueAt: string | null; autoMark: boolean; link: string;
      submissions: Array<{ id: string; studentName: string; studentId?: string; late: boolean; marking?: { state: string; total: number | null; maxTotal: number | null; percent: number | null; released: boolean; error?: string } }>;
    }>;
    taskSettings(userId: string, id: string, patch: { open?: boolean; dueAt?: string | null; title?: string; instructions?: string }): Promise<{ title: string; open: boolean; dueAt: string | null }>;
    markTask(userId: string, id: string, input: { scheme?: string; confirm?: boolean }): Promise<{ kind: string; summary?: string | null; warnings?: string[]; errors?: string[]; count?: number }>;
    releaseTask(userId: string, id: string, studentIds?: string[]): Promise<{ released: number; skipped: Array<{ studentName: string; reason: string }> }>;
    exportTask(userId: string, id: string): Promise<{ name: string; data: Buffer }>;
    createCourse(userId: string, input: { name: string; code?: string; term?: string; students?: string }): Promise<{ id: string; name: string; students: number }>;
    addCourseStudents(userId: string, id: string, text: string): Promise<{ added: number; updated: number }>;
    linkCourseWork(userId: string, id: string, items: Array<{ kind: 'task' | 'quiz'; id: string }>): Promise<void>;
    exportCourse(userId: string, id: string): Promise<{ name: string; data: Buffer }>;
    examResults(userId: string, examId: string): Promise<{ title: string; rows: Array<{ candidateId: string; candidateName: string | null; total: number; maxTotal: number; percent: number; released: boolean; openFlags: number; lowConfidence: number }> }>;
    releaseExam(userId: string, examId: string): Promise<{ released: number; skipped: Array<{ candidateId: string; reason: string }> }>;
    practiceClasses(userId: string): Promise<Array<{ id: string; name: string; code: string; students: number }>>;
    createPracticeClass(userId: string, name: string): Promise<{ id: string; name: string; code: string }>;
    practiceClassOverview(userId: string, id: string): Promise<{ class: { name: string; code: string }; students: number; active7d: number | null; topics: Array<{ topic: string; learners: number; accuracy: number | null; meanMastery: number; bands: { struggling: number; developing: number; secure: number }; misconceptions: Array<{ tag: string; learners: number }> }>; note: string | null }>;
    examCandidate(userId: string, examId: string, candidate: string): Promise<{ candidateId: string; candidateName: string | null; total: number; maxTotal: number; percent: number; passed: boolean | null; questions: Array<{ number: string; maxMarks: number; marks: number | null; outcome: string; flags: number }> } | null>;
    changeExamMark(userId: string, examId: string, candidate: string, question: string, marks: number, reason: string): Promise<void>;
  };
  /** Scheduled tasks, plans that wait for a yes, and what the chat may tell the owner of the platform. */
  agenda?: {
    /** Runs one tool as this user (a plan step). Used only after the user's yes. */
    exec(userId: string, tool: string, input: Record<string, unknown>): Promise<{ ok: boolean; text: string }>;
    has(tool: string): boolean;
  };
  /** Platform owner tools: only offered to administrators (checked on every call). */
  admin?: {
    isAdmin(userId: string): Promise<boolean>;
    pendingPayments(): Promise<Array<{ id: string; name: string; email: string; plan: string; note: string; createdAt: string }>>;
    decidePayment(id: string, approve: boolean, by: string, grant?: { months?: number; tests?: number }): Promise<{ ok: boolean; text: string }>;
    overview(): Promise<{ users: number; newUsers7d: number; pendingPayments: number; liveExams: number | null; liveStudents: number | null; subscribers: number }>;
  };
  /** Universal output engine (server/services/outputs). */
  outputs?: {
    create(userId: string, spec: unknown): Promise<{ artifact: any; reused: boolean }>;
    waitReady(userId: string, id: string, ms?: number): Promise<any>;
    readAnalysis(userId: string, id: string): Promise<any>;
    attachmentRef(artifact: any): Promise<AttachmentRef | null>;
  };
}

export interface DatasetSummary { id: string; name: string; description: string; files: number; totalBytes: number; types: Record<string, number>; indexed: number; folders: string[] }
export interface DatasetListing {
  repository: { id: string; name: string };
  path: string;
  search?: string;
  folders: Array<{ name: string; path: string; files: number }>;
  files: Array<{ id: string; path: string; name: string; type: string; sizeBytes: number; status: string }>;
  totalFiles: number;
}
export interface DatasetFileContent {
  file: { id: string; path: string; name: string; type: string; sizeBytes: number; repository: string };
  supported: boolean;
  method: string;
  pages?: number;
  sheets: Array<{ name: string; columns: string[]; totalRows: number }>;
  text: string;
  truncated: boolean;
  warnings: string[];
}

export interface ImageProvider {
  generate(prompt: string, opts: { size?: string; signal?: AbortSignal }): Promise<{ data: Buffer; mime: string }>;
}

export interface StoredFileMeta {
  id: string;
  userId: string;
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  sha256: string;
  createdAt: string;
  expiresAt: string;
}

export interface ToolContext {
  userId: string;
  chatId?: string;
  locale?: 'en' | 'rw' | 'fr';
  signal?: AbortSignal;
  files: import('./files/FileStore.js').FileStore;
  services: ToolServices;
}

export type AgentEvent =
  | { type: 'text'; data: { text: string; replaceFullText?: boolean; isThinking?: boolean; provider?: string } }
  | { type: 'tool_call'; data: { id: string; name: string; input: unknown } }
  | { type: 'tool_result'; data: { id: string; name: string; output: string; isError?: boolean } }
  | { type: 'attachment'; data: AttachmentRef }
  | { type: 'sources'; data: { passages: KnowledgePassage[] } }
  | { type: 'usage'; data: { input_tokens: number; output_tokens: number; model?: string } }
  | { type: 'turn_reset'; data: { reason: string } }
  /** Uploads stored for this turn, so later turns can name them (read_attachment). */
  | { type: 'files_stored'; data: { files: Array<{ fileId: string; name: string }> } }
  | { type: 'done'; data: { hitMaxTurns?: boolean } };

export interface AgentResult {
  text: string;
  messages: ChatMessage[];
  attachments: AttachmentRef[];
  sources: KnowledgePassage[];
  usage: { input_tokens: number; output_tokens: number };
  hitMaxTurns: boolean;
}

export interface AgentTraceRecord {
  id: string;
  userIdHash: string;
  chatIdHash: string | null;
  capability: string;
  model: string;
  provider: string;
  promptVersion: string;
  toolCalls: Array<{
    name: string;
    argsValid: boolean;
    durationMs: number;
    ok: boolean;
    errorCode: string | null;
  }>;
  retries: number;
  tokensIn: number;
  tokensOut: number;
  finalStatus: 'ok' | 'failed' | 'partial' | 'refused';
  failureClass: string | null;
  latencyMs: number;
  costUsd: number | null;
  createdAt: string;
}
