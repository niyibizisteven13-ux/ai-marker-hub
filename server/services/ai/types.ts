/**
 * Shared types for the Bwenge AI capability layer.
 * Messages use the OpenAI chat-completions shape internally (Gonka, NVIDIA NIM,
 * OpenRouter and OpenAI all accept it); other providers are adapted at the edge.
 */

export type JsonSchema = Record<string, unknown>;

export type ContentPart =
  | { type: 'text'; text: string }
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
  | 'archive';

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
}

export interface Tool {
  definition: ToolDefinition;
  execute(input: any, ctx: ToolContext): Promise<ToolOutput>;
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
}

/** Optional services injected from the host app. Tools that need a service are only offered when it exists. */
export interface ToolServices {
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
