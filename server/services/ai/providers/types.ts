import type { ChatMessage, ToolDefinition } from '../types.js';

export interface ProviderRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required';
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export type ProviderChunk =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call'; index: number; id?: string; name?: string; args?: string }
  | { type: 'usage'; input: number; output: number }
  | { type: 'finish'; reason: string };

export interface ProviderAdapter {
  readonly name: string;
  stream(req: ProviderRequest): AsyncGenerator<ProviderChunk>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public status?: number,
    public retryable = false,
    public timeout = false,
    public timeoutKind?: 'connect' | 'idle' | 'request',
  ) {
    super(message);
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof ProviderError) return err.retryable || err.status === 429 || (err.status !== undefined && err.status >= 500);
  const msg = String((err as any)?.message ?? '');
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|terminated|network/i.test(msg);
}
