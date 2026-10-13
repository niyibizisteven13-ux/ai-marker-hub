import { AgentRuntime, type RuntimeConfig } from './AgentRuntime.js';
import { buildCapabilitiesPrompt } from './capabilitiesPrompt.js';
import type { FileStore } from './files/FileStore.js';
import { ingestUploads, type UploadedFile } from './ingest.js';
import { OpenAICompatibleAdapter, type OpenAICompatibleOptions } from './providers/openaiCompatible.js';
import type { ProviderAdapter } from './providers/types.js';
import { buildToolkit } from './tools/index.js';
import type { AgentEvent, AgentResult, ChatMessage, ToolServices } from './types.js';

export interface AiAgentConfig {
  /** An existing adapter, or options to build an OpenAI-compatible one (GonkaRouter, NVIDIA NIM, OpenRouter, OpenAI). */
  provider: ProviderAdapter | OpenAICompatibleOptions;
  model: string;
  files: FileStore;
  services?: ToolServices;
  runtime?: RuntimeConfig;
  temperature?: number;
  maxTokens?: number;
}

export interface AgentRunInput {
  userId: string;
  chatId?: string;
  locale?: 'en' | 'rw' | 'fr';
  /** Your persona prompt (for example BWENGE_GENERAL_SYSTEM_PROMPT) plus any memory context. */
  system: string;
  /** Earlier turns, oldest first. */
  history?: Array<{ role: 'user' | 'assistant'; text: string }>;
  /** The new user message. */
  prompt: string;
  uploads?: UploadedFile[];
  onEvent?: (e: AgentEvent) => void;
  signal?: AbortSignal;
  toolNames?: string[];
  maxTurns?: number;
}

/** Single entry point for the host app: build once, call run() per message. */
export function createAiAgent(cfg: AiAgentConfig) {
  const adapter = 'stream' in cfg.provider ? cfg.provider : new OpenAICompatibleAdapter(cfg.provider);
  const tools = buildToolkit(cfg.services ?? {});
  const runtime = new AgentRuntime(adapter, tools, cfg.runtime);

  return {
    tools,
    async run(input: AgentRunInput): Promise<AgentResult & { fileIds: string[]; warnings: string[] }> {
      const ctx = { userId: input.userId, chatId: input.chatId, locale: input.locale, signal: input.signal, files: cfg.files, services: cfg.services ?? {} };
      const ingested = await ingestUploads(input.prompt, input.uploads, ctx);
      const messages: ChatMessage[] = [
        ...(input.history ?? []).map((h) => ({ role: h.role, content: h.text }) as ChatMessage),
        { role: 'user', content: ingested.parts.length === 1 && ingested.parts[0].type === 'text' ? ingested.parts[0].text : ingested.parts },
      ];
      const available = input.toolNames ? tools.names().filter((n) => input.toolNames!.includes(n)) : tools.names();
      const system = `${input.system}\n\n${buildCapabilitiesPrompt({ tools: available, locale: input.locale })}`;
      const result = await runtime.run({
        system, messages, ctx, model: cfg.model, onEvent: input.onEvent,
        temperature: cfg.temperature, maxTokens: cfg.maxTokens, maxTurns: input.maxTurns, toolNames: input.toolNames,
      });
      return { ...result, fileIds: ingested.fileIds, warnings: ingested.warnings };
    },
  };
}
