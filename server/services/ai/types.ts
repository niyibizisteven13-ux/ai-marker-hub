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
