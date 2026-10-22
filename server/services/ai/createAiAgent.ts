import { AgentRuntime, type RuntimeConfig } from './AgentRuntime.js';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { buildCapabilitiesPrompt } from './capabilitiesPrompt.js';
import type { FileStore } from './files/FileStore.js';
import { ingestUploads, type UploadedFile } from './ingest.js';
import { OpenAICompatibleAdapter, type OpenAICompatibleOptions } from './providers/openaiCompatible.js';
import type { ProviderAdapter } from './providers/types.js';
import { buildToolkit } from './tools/index.js';
import type { AgentEvent, AgentResult, AgentTraceRecord, ChatMessage, ToolServices } from './types.js';

const ephemeralTraceHashSecret = randomBytes(32);

function hashTraceIdentifier(value: string, secret?: string): string {
  return createHmac('sha256', secret ?? ephemeralTraceHashSecret).update(value).digest('hex');
}

export interface AiAgentConfig {
  /** An existing adapter, or options to build an OpenAI-compatible one (GonkaRouter, NVIDIA NIM, OpenRouter, OpenAI). */
  provider: ProviderAdapter | OpenAICompatibleOptions;
  model: string;
  files: FileStore;
  services?: ToolServices;
  runtime?: RuntimeConfig;
  temperature?: number;
  maxTokens?: number;
  promptVersion?: string;
  traceHashSecret?: string;
  writeTrace?: (trace: AgentTraceRecord) => Promise<void>;
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
  temperature?: number;
  maxTokens?: number;
  /** Overrides the configured model for this run (set by the task router). */
  model?: string;
  /** Per-run fallback model from the routing policy; null disables fallback. */
  fallbackModel?: string | null;
  requestId?: string;
}

/** Single entry point for the host app: build once, call run() per message. */
export function createAiAgent(cfg: AiAgentConfig) {
  const adapter = 'stream' in cfg.provider ? cfg.provider : new OpenAICompatibleAdapter(cfg.provider);
  const tools = buildToolkit(cfg.services ?? {});
  const runtime = new AgentRuntime(adapter, tools, cfg.runtime);

  return {
    tools,
    async run(input: AgentRunInput): Promise<AgentResult & { fileIds: string[]; warnings: string[] }> {
      const requestStartedAt = performance.now();
      const ctx = { userId: input.userId, chatId: input.chatId, locale: input.locale, signal: input.signal, files: cfg.files, services: cfg.services ?? {} };
      let ingested: Awaited<ReturnType<typeof ingestUploads>>;
      try {
        ingested = await ingestUploads(input.prompt, input.uploads, ctx);
      } catch (error) {
        if (cfg.writeTrace) {
          try {
            await cfg.writeTrace({
              id: randomUUID(),
              userIdHash: hashTraceIdentifier(input.userId, cfg.traceHashSecret),
              chatIdHash: input.chatId ? hashTraceIdentifier(input.chatId, cfg.traceHashSecret) : null,
              capability: input.uploads?.length ? 'D' : 'UNCLASSIFIED',
              model: input.model ?? cfg.model,
              provider: adapter.name,
              promptVersion: cfg.promptVersion ?? 'unversioned',
              toolCalls: [],
              retries: 0,
              tokensIn: 0,
              tokensOut: 0,
              finalStatus: 'failed',
              failureClass: 'input_processing_error',
              latencyMs: Math.max(0, Math.round(performance.now() - requestStartedAt)),
              costUsd: null,
              createdAt: new Date().toISOString(),
            });
          } catch (traceError) {
            console.error('[AI trace] Failed to persist preprocessing failure trace:', traceError instanceof Error ? traceError.name : 'unknown error');
          }
        }
        throw error;
      }
      const messages: ChatMessage[] = [
        ...(input.history ?? []).map((h) => ({ role: h.role, content: h.text }) as ChatMessage),
        { role: 'user', content: ingested.parts.length === 1 && ingested.parts[0].type === 'text' ? ingested.parts[0].text : ingested.parts },
      ];
      const available = input.toolNames ? tools.names().filter((n) => input.toolNames!.includes(n)) : tools.names();
      const system = `${input.system}\n\n${buildCapabilitiesPrompt({ tools: available, locale: input.locale })}`;
      const startedAt = requestStartedAt;
      const toolCalls: AgentTraceRecord['toolCalls'] = [];
      const activeTools = new Map<string, { startedAt: number; trace: AgentTraceRecord['toolCalls'][number] }>();
      let retries = 0;
      let tokensIn = 0;
      let tokensOut = 0;
      let hitMaxTurns = false;
      let finalStatus: AgentTraceRecord['finalStatus'] = 'ok';
      let failureClass: string | null = null;
      const traceId = randomUUID();
      const emit = (event: AgentEvent) => {
        if (event.type === 'tool_call') {
          const trace: AgentTraceRecord['toolCalls'][number] = {
            name: event.data.name,
            argsValid: event.data.input !== null,
            durationMs: 0,
            ok: false,
            errorCode: null,
          };
          toolCalls.push(trace);
          activeTools.set(event.data.id, { startedAt: performance.now(), trace });
        } else if (event.type === 'tool_result') {
          const active = activeTools.get(event.data.id);
          if (active) {
            const tool = active.trace;
            tool.durationMs = Math.round(performance.now() - active.startedAt);
            tool.ok = !event.data.isError;
            if (event.data.isError) {
              tool.argsValid = !event.data.output.startsWith('ERROR: invalid arguments') &&
                !event.data.output.startsWith('ERROR: the arguments') &&
                !event.data.output.startsWith('ERROR: unknown tool');
              tool.errorCode = event.data.output.startsWith('ERROR: invalid arguments')
                ? 'INVALID_ARGUMENTS'
                : event.data.output.startsWith('ERROR: the arguments')
                  ? 'INVALID_JSON'
                  : event.data.output.startsWith('ERROR: unknown tool')
                    ? 'UNKNOWN_TOOL'
                    : 'TOOL_EXECUTION';
            }
          }
          activeTools.delete(event.data.id);
        } else if (event.type === 'usage') {
          tokensIn = event.data.input_tokens;
          tokensOut = event.data.output_tokens;
        } else if (event.type === 'done') {
          hitMaxTurns = !!event.data.hitMaxTurns;
        }
        input.onEvent?.(event);
      };
      const saveTrace = async () => {
        if (!cfg.writeTrace) return;
        const toolError = toolCalls.some((tool) => !tool.ok);
        if (finalStatus !== 'failed' && hitMaxTurns) finalStatus = 'partial';
        else if (finalStatus === 'ok' && toolError) finalStatus = 'partial';
        const normalizedTools = toolCalls.map((tool) => tool.name.toLowerCase());
        const capability =
          normalizedTools.some((name) => /search_knowledge|web_search|fetch_url/.test(name)) ? 'A' :
          normalizedTools.some((name) => /create_drawing|create_chart|create_diagram|generate_image/.test(name)) ? 'C' :
          normalizedTools.some((name) => /read_attachment/.test(name)) ? 'D' :
          normalizedTools.some((name) => /create_document|create_spreadsheet|create_presentation|create_text_file|create_archive/.test(name)) ? 'B' :
          'UNCLASSIFIED';
        if (toolError && !failureClass) failureClass = 'tool_error';
        const record: AgentTraceRecord = {
          id: traceId,
          userIdHash: hashTraceIdentifier(input.userId, cfg.traceHashSecret),
          chatIdHash: input.chatId ? hashTraceIdentifier(input.chatId, cfg.traceHashSecret) : null,
          capability,
          model: input.model ?? cfg.model,
          provider: adapter.name,
          promptVersion: cfg.promptVersion ?? 'unversioned',
          toolCalls,
          retries,
          tokensIn,
          tokensOut,
          finalStatus,
          failureClass,
          latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
          costUsd: null,
          createdAt: new Date().toISOString(),
        };
        await cfg.writeTrace(record);
      };
      const persistTrace = async () => {
        try {
          await saveTrace();
        } catch (traceError) {
          console.error('[AI trace] Failed to persist trace:', traceError instanceof Error ? traceError.name : 'unknown error');
        }
      };

      try {
        const result = await runtime.run({
          system, messages, ctx, model: input.model ?? cfg.model, onEvent: emit,
          temperature: input.temperature ?? cfg.temperature,
          maxTokens: input.maxTokens ?? cfg.maxTokens,
          maxTurns: input.maxTurns,
          toolNames: input.toolNames,
          requestId: input.requestId,
          fallbackModel: input.fallbackModel,
          onRetry: () => { retries += 1; },
        });
        await persistTrace();
        return { ...result, fileIds: ingested.fileIds, warnings: ingested.warnings };
      } catch (error) {
        finalStatus = 'failed';
        // Normalized provider category (e.g. PROVIDER_BUSY) when the reliability layer supplied one.
        failureClass = (error as { category?: string })?.category ?? 'runtime_error';
        await persistTrace();
        throw error;
      }
    },
  };
}
