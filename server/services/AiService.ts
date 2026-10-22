import { GoogleGenAI, Type } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { evaluateStudentSubmission as deepseekEvaluate } from '../../src/services/deepseekMarker.js';
import { BWENGE_CHAT_RESPONSE_RULES, BWENGE_GENERAL_SYSTEM_PROMPT } from './prompts/bwengeGeneralPrompt.js';
import { MemoryService } from './MemoryService.js';
import { toKnowledgePassage } from './knowledge/citations.js';
import { asksAboutDatasets } from './knowledge/published.js';
import { retrieveKnowledgeChunks } from './KnowledgeRetrievalService.js';
import { ExecutionSandbox } from './ExecutionSandbox.js';
import { createAiAgent, FileStore, OpenAICompatibleAdapter, AnthropicAdapter, loadClaudeAgentConfig, ReliableProviderAdapter, ModelDispatchAdapter, ModelPolicyManager, TaskClassifier, loadComplexProvider, loadModelPolicies, TaskRouter, FileJobQueue, NisrIngestionPipeline, isStatisticsQuery, BudgetManager, DocumentPipeline, DeterministicTools } from './ai/index.js';
import { prisma } from '../db.js';
import { getFileUrlSecret } from '../auth/secrets.js';
import { extractJsonFragment, stripThinkingTags } from '../utils/textSanitizers.js';
import { extractChatCompletionText, readProviderJson } from '../utils/providerResponse.js';
export { stripThinkingTags };
import logger from '../utils/logger.js';
import { planHint, planOutput } from './outputs/planner.js';
import { runDeliverableTurn, TOOL_TURN_RULES } from './outputs/chatTurn.js';

const MODELS = {
  SONNET: 'claude-sonnet-5',
  HAIKU: 'claude-haiku-4-5-20251001',
};

const GEMINI_FLASH = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const GEMINI_PRO   = process.env.GEMINI_PRO_MODEL || 'gemini-3.8-flash';

const NVIDIA_MODELS = {
  LARGE: 'meta/llama-4-maverick-17b-128e-instruct',
  FAST: 'meta/llama-4-scout-17b-16e-instruct',
};

const GONKA_MODELS = {
  DEFAULT: 'zai-org/GLM-5.3-Flash',
};

type ProviderKey = 'gemini' | 'openai' | 'deepseek' | 'openrouter' | 'anthropic' | 'ollama' | 'nvidianim' | 'gonkarouter';

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function isRetryableError(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  if (typeof status === 'number') {
    return status === 429 || status >= 500;
  }
  const message = String(err?.message || '');
  if (/timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|network/i.test(message)) return true;
  return false;
}

function extractPlainText(content: Anthropic.MessageParam['content'] | string): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
      .map((block: any) => block.text)
      .join('\n');
  }
  return '';
}

const SECRET_PATTERN = /(sk-[a-zA-Z0-9_-]{10,}|Bearer\s+[a-zA-Z0-9._-]{10,}|api[_-]?key["':\s=]+[a-zA-Z0-9._-]{10,})/gi;

function sanitizeToolError(toolName: string, err: unknown): string {
  logger.error(`Tool execution failed: ${toolName}`, err);
  const rawMessage = err instanceof Error ? err.message : String(err);
  const redacted = rawMessage.replace(SECRET_PATTERN, '[redacted]');
  const singleLine = redacted.split('\n')[0].slice(0, 300);
  return `ERROR: ${toolName} failed: ${singleLine}`;
}

// ── Bwenge AI Capabilities FileStore & Agent Integration ──────────────────
const fileStoreSecret = getFileUrlSecret();
export const fileStore = new FileStore({
  dir: process.env.FILE_STORE_DIR ?? './data/generated',
  secret: fileStoreSecret,
  // Default 25 MB; raise it for large examination packages (all marked papers in one ZIP).
  maxFileBytes: Number(process.env.FILE_STORE_MAX_BYTES) > 0 ? Number(process.env.FILE_STORE_MAX_BYTES) : undefined,
});

export const fileJobQueue = new FileJobQueue({
  storageDir: process.env.JOBS_DIR ?? './data/jobs',
  concurrency: Number(process.env.JOBS_CONCURRENCY) > 0 ? Number(process.env.JOBS_CONCURRENCY) : 2,
  maxActivePerUser: Number(process.env.JOBS_MAX_ACTIVE_PER_USER) > 0 ? Number(process.env.JOBS_MAX_ACTIVE_PER_USER) : 5,
  log: (event, data) => logger.info(`[jobs] ${event}`, data),
});
export const nisrPipeline = new NisrIngestionPipeline();
export const budgetManager = new BudgetManager();
export const documentPipeline = new DocumentPipeline();
export const deterministicTools = new DeterministicTools();

function envMs(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// One reliability policy for every Gonka call: transient-only retries before first output,
// Retry-After, a total deadline below the 60s proxy limit, a per-model circuit breaker and
// an optional configured fallback. See docs/AI_RELIABILITY.md.
const providerLog = (e: { event: string }) => {
  if (e.event === 'provider_retry') logger.info('[AI provider]', e);
  else logger.warn('[AI provider]', e);
};
const reliability = {
  maxAttempts: envMs('AI_MAX_ATTEMPTS', 3),
  initialBackoffMs: envMs('AI_INITIAL_BACKOFF_MS', 500),
  maxBackoffMs: envMs('AI_MAX_BACKOFF_MS', 8_000),
  totalDeadlineMs: envMs('AI_TOTAL_DEADLINE_MS', 45_000),
  breakerThreshold: envMs('AI_BREAKER_THRESHOLD', 5),
  breakerCooldownMs: envMs('AI_BREAKER_COOLDOWN_MS', 30_000),
  log: providerLog,
};
const httpTimeouts = {
  connectTimeoutMs: envMs('AI_CONNECT_TIMEOUT_MS', 15_000),
  idleTimeoutMs: envMs('AI_IDLE_TIMEOUT_MS', 30_000),
  requestTimeoutMs: envMs('AI_REQUEST_TIMEOUT_MS', 60_000),
};

// One reliability policy for every provider call: transient-only retries before first output,
// Retry-After, a total deadline below the 60s proxy limit, a per-model circuit breaker and
// an optional configured fallback. See docs/AI_RELIABILITY.md.
export const gonkaAdapter = new ReliableProviderAdapter({
  primary: new OpenAICompatibleAdapter({
    name: 'GonkaRouter',
    baseUrl: process.env.GONKA_BASE_URL ?? 'https://api.gonkarouter.io/v1',
    apiKey: process.env.GONKA_API_KEY ?? '',
    ...httpTimeouts,
  }),
  ...reliability,
});

// Everyday chat stays on Gonka. Big tasks (COMPLEX, ARTIFACT_SPEC) can go to a second provider
// (AI_COMPLEX_PROVIDER), which falls back to Gonka's complex-task model if it is unavailable.
const complexProvider = loadComplexProvider();
logger.info('[AI routing] big-task provider', { provider: complexProvider.config?.name ?? 'gonka', model: complexProvider.config?.model, reason: complexProvider.reason });
export const complexAdapter = complexProvider.config
  ? new ReliableProviderAdapter({
    primary: new OpenAICompatibleAdapter({ name: complexProvider.config.name, baseUrl: complexProvider.config.baseUrl, apiKey: complexProvider.config.apiKey, ...httpTimeouts, requestTimeoutMs: envMs('AI_COMPLEX_REQUEST_TIMEOUT_MS', 90_000) }),
    ...reliability,
    fallbackAdapter: complexProvider.config.fallbackToGonka ? gonkaAdapter : undefined,
    fallbackModel: complexProvider.config.fallbackToGonka ? loadModelPolicies(process.env, GONKA_MODELS.DEFAULT).COMPLEX.model : undefined,
  })
  : null;

export const taskRouter = new TaskRouter(
  new ModelPolicyManager(),
  new TaskClassifier(),
  (process.env.AI_MODEL_ROUTING ?? 'on').toLowerCase() !== 'off',
  process.env.GONKA_FALLBACK_SUPPORTS_VISION === 'true',
  complexProvider.config,
);

// Agent tasks (tool loops, rubric assessment, report interpretation) can run on Claude
// (AI_AGENT_PROVIDER=anthropic, default model claude-haiku-5-5). Transient Claude failures fall back
// to Gonka's standard model when CLAUDE_FALLBACK_TO_GONKA is on; refusals never fall back.
const claudeAgent = loadClaudeAgentConfig();
logger.info('[AI routing] agent provider', { provider: claudeAgent.config ? 'anthropic' : 'gonka', model: claudeAgent.config?.model, reason: claudeAgent.reason });
const gonkaStandardModel = loadModelPolicies(process.env, GONKA_MODELS.DEFAULT).STANDARD.model;
export const claudeAdapter = claudeAgent.config
  ? new ReliableProviderAdapter({
    primary: new AnthropicAdapter({ apiKey: claudeAgent.config.apiKey, name: 'Claude', effort: claudeAgent.config.effort, requestTimeoutMs: envMs('CLAUDE_REQUEST_TIMEOUT_MS', 120_000) }),
    ...reliability,
    fallbackAdapter: claudeAgent.config.fallbackToGonka ? gonkaAdapter : undefined,
    fallbackModel: claudeAgent.config.fallbackToGonka ? gonkaStandardModel : undefined,
  })
  : null;

const agentProvider = new ModelDispatchAdapter(
  gonkaAdapter,
  new Map([
    ...(complexProvider.config && complexAdapter ? [[complexProvider.config.model, complexAdapter] as const] : []),
    ...(claudeAgent.config && claudeAdapter ? [[claudeAgent.config.model, claudeAdapter] as const] : []),
  ]),
);

/** Adapter + model for agent tasks: Claude when configured, otherwise Gonka's standard model. */
export function agentTarget(): { adapter: typeof agentProvider; model: string; provider: 'anthropic' | 'gonka'; fallbackModel: string | null | undefined } {
  return claudeAgent.config
    ? { adapter: agentProvider, model: claudeAgent.config.model, provider: 'anthropic', fallbackModel: undefined }
    : { adapter: agentProvider, model: gonkaStandardModel, provider: 'gonka', fallbackModel: null };
}

/** Picks model and fallback for a chat request and logs the decision (never the prompt). */
function routeChat(prompt: string, opts: { hasImages?: boolean; hasTools?: boolean; requestId?: string }) {
  const route = taskRouter.route({ prompt, hasFiles: opts.hasImages, hasImages: opts.hasImages, hasTools: opts.hasTools });
  logger.info('[AI routing]', { requestId: opts.requestId, taskClass: route.taskClass, reasonCode: route.reasonCode, provider: route.provider, model: route.model, fallback: route.fallbackModel !== null });
  return route;
}

export const bwengeAgent = createAiAgent({
  provider: agentProvider,
  // The adapter owns retry policy; the runtime only retries a stream that broke after partial output.
  runtime: { maxRetries: 1, retryDelayMs: 1000 },
  model: process.env.GONKA_MODEL ?? GONKA_MODELS.DEFAULT,
  files: fileStore,
  temperature: 0.3,
  maxTokens: 8192,
  promptVersion: 'bwenge-general-v1',
  traceHashSecret: process.env.TRACE_HASH_SECRET || fileStoreSecret,
  // Scanned PDFs on turns whose model cannot see images (Tesseract, loaded only when needed).
  ocr: async (png) => (await import('./documents/ocr.js')).tesseractOcr(png),
  writeTrace: async (trace) => {
    if (process.env.NODE_ENV === 'test') return;
    await prisma.aiTrace.create({
      data: {
        ...trace,
        toolCalls: JSON.stringify(trace.toolCalls),
        createdAt: new Date(trace.createdAt),
      },
    });
  },
  services: {
    knowledge: {
      async search(query, { topK, userId }) {
        // NISR index is consulted only for statistics questions; a missing/broken index never blocks the knowledge base.
        const nisrHits = isStatisticsQuery(query)
          ? await nisrPipeline.search(query, Math.min(topK ?? 6, 6)).catch((err) => {
            logger.warn('[NISR] search failed', { errorType: err?.name });
            return [];
          })
          : [];
        const knowledgeHits = await retrieveKnowledgeChunks(query, { limit: topK, userId });
        const combined = [
          ...nisrHits.map((n) => ({
            text: `${n.text}\nReference period: ${n.citation.referencePeriod}. Source: ${n.citation.source}${n.citation.row ? ` row ${n.citation.row}` : ''}.`,
            title: n.citation.title,
            publisher: n.citation.organization,
            year: Number(n.citation.publicationDate.slice(0, 4)) || undefined,
            table: n.record ? n.record.indicator : undefined,
            url: n.citation.sourceUrl,
            score: n.score,
          })),
          ...knowledgeHits.map((h: any) => toKnowledgePassage(h))
        ];
        return combined;
      },
    },
    // Datasets from Admin → Datasets & Curations (lazy import: educationRuntime imports this module).
    datasets: {
      catalog: async (userId) => (await import('./educationRuntime.js')).knowledgeService.assistantCatalog(userId),
      browse: async (userId, id, opts) => (await import('./educationRuntime.js')).knowledgeService.assistantBrowse(userId, id, opts),
      read: async (userId, id, opts) => (await import('./educationRuntime.js')).knowledgeService.assistantRead(userId, id, opts) as any,
    },
    // Lazy import: educationRuntime imports this module.
    outputs: {
      create: async (userId, spec) => (await import('./educationRuntime.js')).outputService.create(userId, spec),
      waitReady: async (userId, id, ms) => (await import('./educationRuntime.js')).outputService.waitReady(userId, id, ms),
      readAnalysis: async (userId, id) => (await import('./educationRuntime.js')).outputService.readAnalysis(userId, id),
      attachmentRef: async (a) => (await import('./educationRuntime.js')).outputService.attachmentRef(a),
    },
    python: {
      async execute(code) {
        const r = await ExecutionSandbox.getInstance().callMcpTool('python/execute', { code });
        if (r.error) throw new Error(r.error.message);
        const out = r.result.output;
        return { stdout: typeof out === 'string' ? out : JSON.stringify(out) };
      },
    },
  },
});
// ──────────────────────────────────────────────────────────────────────────

export class AiService {
  private static instance: AiService;
  private geminiClient: GoogleGenAI | null = null;
  private anthropicClient: Anthropic | null = null;

  private constructor() {
    this.initializeGemini();
    this.initializeAnthropic();
  }

  public static getInstance(): AiService {
    if (!AiService.instance) {
      AiService.instance = new AiService();
    }
    return AiService.instance;
  }

  private initializeGemini() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.geminiClient = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    }
  }

  private initializeAnthropic() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.anthropicClient = new Anthropic({ apiKey });
    }
  }

  public async providerAvailable(name: ProviderKey): Promise<boolean> {
    if (name === 'gonkarouter') return Boolean(process.env.GONKA_API_KEY);
    if (name === 'gemini') return Boolean(process.env.GEMINI_API_KEY);
    if (name === 'openai') return Boolean(process.env.OPENAI_API_KEY);
    if (name === 'deepseek') return Boolean(process.env.DEEPSEEK_API_KEY);
    if (name === 'openrouter') return Boolean(process.env.OPENROUTER_API_KEY);
    if (name === 'anthropic') return Boolean(process.env.ANTHROPIC_API_KEY);
    if (name === 'nvidianim') return Boolean(process.env.NVIDIA_NIM_API_KEY);
    if (name === 'ollama') {
      try {
        const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        const res = await fetchWithTimeout(`${baseUrl}/api/tags`, {}, 5_000);
        return res.ok;
      } catch {
        return false;
      }
    }
    return false;
  }

  public async runProviderRace<T>(
    geminiWork: () => Promise<T>,
    openAIWork: () => Promise<T>,
    deepseekWork?: () => Promise<T>,
    openRouterWork?: () => Promise<T>,
  ) {
    const tasks: Array<{ provider: string; key: ProviderKey; run: () => Promise<T> }> = [
      { provider: 'Gemini', key: 'gemini', run: geminiWork },
      { provider: 'OpenAI', key: 'openai', run: openAIWork },
    ];
    if (deepseekWork) tasks.push({ provider: 'Deepseek', key: 'deepseek', run: deepseekWork });
    if (openRouterWork) tasks.push({ provider: 'OpenRouter', key: 'openrouter', run: openRouterWork });

    const settled = await Promise.allSettled(
      tasks.map(async (t) => {
        if (!(await this.providerAvailable(t.key))) {
          throw new Error(`${t.provider} is not configured.`);
        }
        return t.run();
      }),
    );

    const successes: Array<{ provider: string; value: T }> = [];
    const errors: string[] = [];

    settled.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        successes.push({ provider: tasks[i].provider, value: result.value });
      } else {
        errors.push((result.reason && result.reason.message) || String(result.reason));
      }
    });

    if (!successes.length) {
      throw new Error(errors.join(' | '));
    }

    return { successes, errors };
  }

  public async sendOpenAIChat(prompt: string, options: { json?: boolean; system?: string } = {}) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const isReasoningModel = /^(gpt-5|o[1-9])/i.test(model);

    const requestBody: Record<string, unknown> = {
      model,
      max_completion_tokens: Number(process.env.OPENAI_MAX_TOKENS || 5000),
      response_format: options.json ? { type: 'json_object' } : undefined,
      messages: [
        { role: 'system', content: options.system || 'You are Marker AI, a precise and fair academic assessment assistant.' },
        { role: 'user', content: prompt },
      ],
    };

    if (!isReasoningModel) {
      requestBody.temperature = 0.1;
      requestBody.max_tokens = requestBody.max_completion_tokens;
      delete requestBody.max_completion_tokens;
    }

    const response = await fetchWithTimeout(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const data: any = await response.json();
    if (!response.ok) throw new Error(`OpenAI API error: ${data?.error?.message || `${response.status} ${response.statusText}`}`);

    const answer = data?.choices?.[0]?.message?.content;
    if (!answer) throw new Error('OpenAI returned an empty response.');
    return String(answer).trim();
  }

  public async sendOpenRouterChat(prompt: string, options: { system?: string, history?: Array<{ role: 'user' | 'assistant', text: string }> } = {}) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured.');

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    if (process.env.OPENROUTER_SITE_URL) headers['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL;
    if (process.env.OPENROUTER_SITE_NAME) headers['X-Title'] = process.env.OPENROUTER_SITE_NAME;

    const messages = [
      { role: 'system', content: options.system || 'You are Bwenge AI Assistant.' },
      ...(Array.isArray(options.history) ? options.history : []).map(h => ({ role: h.role, content: h.text })),
      { role: 'user', content: prompt },
    ];

    const response = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o',
        max_tokens: 1200,
        temperature: 0.2,
        messages,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message || data?.error || `${response.status} ${response.statusText}`;
      throw new Error(`OpenRouter API error: ${message}`);
    }

    return (data?.choices?.[0]?.message?.content || '').trim();
  }

  public async sendOllamaChat(prompt: string, options: { model?: string; system?: string; json?: boolean } = {}) {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model = options.model || process.env.OLLAMA_MODEL || 'qwen2.5:3b';

    const messages = [];
    if (options.system) {
      messages.push({ role: 'system', content: options.system });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetchWithTimeout(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        format: options.json ? 'json' : undefined,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${error}`);
    }

    const data: any = await response.json();
    return (data.message?.content || '').trim();
  }

  public async sendGonkaChat(prompt: string, options: {
    system?: string;
    history?: Array<{ role: 'user' | 'assistant'; text: string }>;
    images?: Array<{ base64: string; mediaType: string }>;
    timeoutMs?: number;
    maxTokens?: number;
    model?: string;
    signal?: AbortSignal;
  } = {}) {
    const uploads = options.images?.map(img => ({ type: 'image' as const, base64: img.base64, mediaType: img.mediaType }));
    const r = await bwengeAgent.run({
      userId: 'system',
      system: options.system || BWENGE_GENERAL_SYSTEM_PROMPT,
      history: options.history,
      prompt,
      uploads,
      toolNames: [],
      maxTokens: options.maxTokens,
      signal: options.signal,
    });
    return r.text;
  }

  public async streamGonkaChat(prompt: string, options: {
    model?: string; system?: string; history?: any[]; images?: Array<{ base64: string; mediaType: string }>;
    onToken: (token: string) => void; onReset?: () => void; tools?: any[];
    temperature?: number; max_tokens?: number;
    signal?: AbortSignal;
    userId?: string; requestId?: string;
  }) {
    const uploads = options.images?.map(img => ({ type: 'image' as const, base64: img.base64, mediaType: img.mediaType }));
    const route = routeChat(prompt, { hasImages: !!uploads?.length, requestId: options.requestId });
    const model = options.model ?? route.model;
    await bwengeAgent.run({
      userId: options.userId || 'system',
      system: options.system || BWENGE_GENERAL_SYSTEM_PROMPT,
      history: options.history,
      prompt,
      uploads,
      toolNames: [],
      temperature: options.temperature,
      // An explicit caller limit wins; the class cap applies only when none is given.
      maxTokens: options.max_tokens ?? route.maxOutputTokens,
      model,
      fallbackModel: options.model ? null : route.fallbackModel,
      requestId: options.requestId,
      signal: options.signal,
      onEvent: (e) => {
        if (e.type === 'text') {
          options.onToken(e.data.text);
        } else if (e.type === 'turn_reset') {
          options.onReset?.();
        }
      },
    });
  }

  public async runGonkaAgentLoop(options: {
    prompt: string;
    system: string;
    history?: any[];
    tools: any[];
    executeTool: (name: string, input: any) => Promise<string>;
    onEvent: (event: { type: 'text' | 'tool_call' | 'tool_result' | 'done' | 'usage' | 'attachment' | 'sources' | 'turn_reset'; data: any }) => void;
    model?: string;
    signal?: AbortSignal;
    requestId?: string;
  }) {
    // options.model is ignored as before. Agent loops run on Claude when AI_AGENT_PROVIDER=anthropic;
    // otherwise the task router picks Gonka or the big-task provider.
    const agent = agentTarget();
    const route = agent.provider === 'anthropic'
      ? { model: agent.model, fallbackModel: agent.fallbackModel }
      : routeChat(options.prompt, { hasTools: true, requestId: options.requestId });
    const r = await bwengeAgent.run({
      userId: 'system',
      system: options.system,
      history: options.history,
      prompt: options.prompt,
      model: route.model,
      fallbackModel: route.fallbackModel,
      onEvent: options.onEvent as any,
      signal: options.signal,
    });
    return [
      ...(options.history || []).map((h: any) => ({ role: h.role, content: h.text })),
      { role: 'user', content: options.prompt },
      { role: 'assistant', content: r.text },
    ];
  }

  public async streamNvidiaNimChat(options: {
    model?: string; system?: string; history?: any[]; onToken: (token: string) => void; tools?: any[];
    temperature?: number; max_tokens?: number; signal?: AbortSignal; prompt?: string;
  }) {
    const promptText = options.prompt || (options.history?.length ? options.history[options.history.length - 1].text : '');
    const history = options.history?.slice(0, -1);
    // options.model is an NVIDIA model id; Gonka chooses its own model via the task router.
    await this.streamGonkaChat(promptText, {
      system: options.system,
      history,
      onToken: options.onToken,
      tools: options.tools,
      temperature: options.temperature,
      max_tokens: options.max_tokens,
      signal: options.signal,
    });
  }

  public async runNvidiaAgentLoop(options: {
    prompt: string;
    system: string;
    history?: any[];
    tools: any[];
    executeTool: (name: string, input: any) => Promise<string>;
    onEvent: (event: any) => void;
    model?: string;
    signal?: AbortSignal;
  }) {
    return this.runGonkaAgentLoop(options);
  }

  public async runDeepResearch(options: {
    query: string;
    userId: string;
    onEvent: (event: any) => void;
    signal?: AbortSignal;
  }) {
    const { query, userId, onEvent, signal } = options;
    onEvent({ type: 'text', data: { text: `\n> 🌐 **Deep Research**: Initiating recursive research for "${query}"...\n`, isThinking: true } });

    const r = await bwengeAgent.run({
      userId,
      system: 'You are a Senior Research Analyst. Provide a comprehensive, multi-perspective report using available knowledge and tools.',
      prompt: `Perform deep research on: ${query}`,
      onEvent,
      signal,
    });
    return r.text;
  }

  public async streamOllamaChat(prompt: string, options: { model?: string; system?: string; onToken: (token: string) => void; signal?: AbortSignal }) {
    await this.streamGonkaChat(prompt, {
      system: options.system,
      onToken: options.onToken,
      signal: options.signal,
    });
  }

  public async runAgenticWorkflow(options: {
    draftPrompt: string;
    reviewPrompt: string;
    draftSystemInstruction: string;
    reviewSystemInstruction: string;
    responseSchema: any;
    model?: string;
  }) {
    const r = await bwengeAgent.run({
      userId: 'system',
      system: options.draftSystemInstruction,
      prompt: options.draftPrompt,
      toolNames: [],
    });
    return this.parseModelJson(r.text);
  }

  public parseModelJson(rawText: string): any {
    if (!rawText) return {};
    const content = extractJsonFragment(rawText);
    if (!content) return {};

    try {
      return JSON.parse(content);
    } catch {
      const stripped = content.trim().replace(/^\s*JSON\s*[:=]\s*/i, '');
      if (stripped !== content) {
        try {
          return JSON.parse(stripped);
        } catch {}
      }
      return {};
    }
  }

  public async generateContent(options: { model?: string; contents: any; config?: any; signal?: AbortSignal }) {
    let promptText = '';
    if (typeof options.contents === 'string') {
      promptText = options.contents;
    } else if (Array.isArray(options.contents)) {
      promptText = options.contents.map((c: any) => {
        if (typeof c === 'string') return c;
        if (c?.parts) return c.parts.map((p: any) => p.text || '').join('\n');
        return JSON.stringify(c);
      }).join('\n');
    } else if (typeof options.contents === 'object') {
      promptText = JSON.stringify(options.contents);
    }
    const systemPrompt = options.config?.systemInstruction || '';
    const text = await this.sendGonkaChat(promptText, { system: systemPrompt, signal: options.signal });
    return { text };
  }

  public async createInteraction(options: {
    model?: string;
    userInput: string;
    previousInteractionId?: string;
    systemInstruction?: string;
    store?: boolean;
    config?: any;
    signal?: AbortSignal;
  }) {
    const text = await this.sendGonkaChat(options.userInput, { system: options.systemInstruction, signal: options.signal });
    return { text };
  }

  public async streamClaudeChat(options: { system: string; messages: any[]; max_tokens?: number; model?: string; signal?: AbortSignal; onToken?: (token: string) => void }) {
    const promptText = options.messages.map((m: any) => extractPlainText(m.content)).join('\n');
    await this.streamGonkaChat(promptText, {
      system: options.system,
      onToken: options.onToken || (() => {}),
      signal: options.signal,
    });
  }

  public async sendClaudeChat(promptOrOptions: string | any, options: { system?: string; model?: string; max_tokens?: number; signal?: AbortSignal } = {}) {
    let promptText = '';
    let systemPrompt = options.system || '';
    if (typeof promptOrOptions === 'string') {
      promptText = promptOrOptions;
    } else if (promptOrOptions && Array.isArray(promptOrOptions.messages)) {
      promptText = promptOrOptions.messages.map((m: any) => m.content).join('\n');
      systemPrompt = promptOrOptions.system || systemPrompt;
    } else if (promptOrOptions) {
      promptText = typeof promptOrOptions === 'object' ? JSON.stringify(promptOrOptions) : String(promptOrOptions);
    }

    const text = await this.sendGonkaChat(promptText, { system: systemPrompt, signal: options.signal });
    return {
      text,
      usage: { input_tokens: 0, output_tokens: 0 },
      model: GONKA_MODELS.DEFAULT,
      content: [{ type: 'text', text }],
    };
  }

  public async analyzeImage(options: {
    base64: string;
    mediaType: string;
    question: string;
    model?: string;
    max_tokens?: number;
    signal?: AbortSignal;
  }): Promise<string> {
    const r = await bwengeAgent.run({
      userId: 'system',
      system: 'You are an accurate visual analysis assistant. Analyze the supplied image and follow the user instructions.',
      prompt: options.question,
      uploads: [{ type: 'image', base64: options.base64, mediaType: options.mediaType }],
      toolNames: [],
      signal: options.signal,
    });
    return r.text;
  }

  public async streamGeminiContent(options: { model?: string; contents: any; config?: any }) {
    let promptText = '';
    if (typeof options.contents === 'string') promptText = options.contents;
    else promptText = JSON.stringify(options.contents);
    const r = await bwengeAgent.run({ userId: 'system', system: options.config?.systemInstruction || '', prompt: promptText, toolNames: [] });
    return [{ text: r.text }];
  }

  public async runAgentLoop(options: {
    messages: Anthropic.MessageParam[];
    tools: Anthropic.Tool[];
    systemPrompt: string;
    executeTool: (name: string, input: any) => Promise<string>;
    onEvent: (event: any) => void;
    model?: string;
    maxTurns?: number;
    signal?: AbortSignal;
  }): Promise<Anthropic.MessageParam[]> {
    const history = options.messages.slice(0, -1).map(m => ({ role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant', text: extractPlainText(m.content) }));
    const prompt = extractPlainText(options.messages[options.messages.length - 1]?.content || '');
    const r = await bwengeAgent.run({
      userId: 'system',
      system: options.systemPrompt,
      history,
      prompt,
      onEvent: options.onEvent,
      signal: options.signal,
    });
    return [
      ...options.messages,
      { role: 'assistant', content: [{ type: 'text', text: r.text }] as any },
    ];
  }

  public async generalAssist(options: {
    userId: string;
    messages: Anthropic.MessageParam[];
    files?: { type: 'image' | 'document'; base64: string; mediaType: string; name?: string }[];
    pinnedSyllabus?: string | null;
    extractSchema?: string;
    tools?: Anthropic.Tool[];
    executeTool?: (name: string, input: any) => Promise<string>;
    onEvent?: (event: any) => void;
    signal?: AbortSignal;
    /** The user's own message for output planning, when the last message also carries injected context. */
    planText?: string;
  }) {
    const useGonka = process.env.AI_PROVIDER === 'gonkarouter' || await this.providerAvailable('gonkarouter');
    const allowFallback = process.env.ALLOW_GEMINI_FALLBACK === 'true';

    // Output planner: decides whether this turn must produce files/charts or computed numbers (tool turn).
    // Plan on the user's own words, never on attached-document text or injected context.
    const planText = options.planText ?? extractPlainText(options.messages[options.messages.length - 1]?.content || '');
    const userText = planText.includes('USER MESSAGE:') ? planText.slice(planText.lastIndexOf('USER MESSAGE:') + 13) : planText;
    const plan = !options.extractSchema && userText.trim()
      ? planOutput({ message: userText, attachments: (options.files ?? []).map((f) => ({ name: '', mime: f.mediaType })), hasDataset: (options.files ?? []).some((f) => /csv|spreadsheet|excel|json/i.test(f.mediaType)) || /\.(csv|xlsx|xls|tsv)\b/i.test(userText) })
      : null;
    // Questions the curated datasets may answer also need the tools (search, browse, read, analyse).
    const dataTurn = !options.extractSchema && await asksAboutDatasets(userText).catch(() => false);
    const toolTurn = !!plan && (plan.artifact || plan.needsComputation) || dataTurn;
    // Photos and PDFs need a model that can see them (handwriting, scans, diagrams).
    const visualUpload = (options.files ?? []).some((f) => f.type === 'image' || /^image\/|application\/pdf/.test(f.mediaType));
    // Tool and vision turns run on the agent model (Claude when AI_AGENT_PROVIDER=anthropic); everyday chat stays on Gonka.
    const agent = agentTarget();
    const runModel = (toolTurn || visualUpload) && agent.provider === 'anthropic' ? agent.model : undefined;
    const vision = Boolean(runModel) || process.env.DOC_VISION_GONKA === 'true';

    if (!runModel && !useGonka && !process.env.GONKA_API_KEY) {
      if (!allowFallback) {
        throw new Error('GonkaRouter API key is not configured and ALLOW_GEMINI_FALLBACK is false.');
      } else {
        logger.warn('Primary chat provider unavailable; configured secondary provider will be used.');
      }
    }

    const memoryService = MemoryService.getInstance();
    const currentQuery = extractPlainText(options.messages[options.messages.length - 1]?.content || '');
    let memoryContext = '';
    try {
      memoryContext = await memoryService.getLongTermContext(options.userId, currentQuery);
    } catch (err) {
      logger.warn('generalAssist: getLongTermContext failed, continuing without memory context', err);
    }

    let systemPrompt = options.extractSchema
      ? `${BWENGE_GENERAL_SYSTEM_PROMPT}${memoryContext}\n\nFor this request, respond with ONLY valid JSON matching this shape, no other text: ${options.extractSchema}`
      : `${BWENGE_GENERAL_SYSTEM_PROMPT}${memoryContext}\n\n${BWENGE_CHAT_RESPONSE_RULES}`;
    if (options.pinnedSyllabus) {
      systemPrompt += `\n\n[MASTER CONTEXT]: ${options.pinnedSyllabus}\n(Note: This is the primary curriculum/rubric source. Prioritize this document above all other context.)`;
    }

    const history = options.messages.slice(0, -1).map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      text: extractPlainText(m.content),
    }));
    const lastMsg = options.messages[options.messages.length - 1];
    const prompt = lastMsg ? extractPlainText(lastMsg.content) : '';
    const uploads = options.files?.map((f) => ({ type: f.type, base64: f.base64, mediaType: f.mediaType, ...(f.name ? { name: f.name } : {}) })) || [];

    // Steer this turn toward prose, a computed table, or the requested deliverables.
    if (plan && (plan.artifact || plan.needsComputation || plan.needsRetrieval)) systemPrompt += `\n\n${planHint(plan)}`;
    if (toolTurn) systemPrompt += `\n\n${TOOL_TURN_RULES}`;

    if (options.extractSchema) {
      const r = await bwengeAgent.run({
        userId: options.userId,
        system: `${systemPrompt}\n\nRespond with ONLY valid JSON matching: ${options.extractSchema}`,
        history,
        prompt,
        uploads,
        toolNames: [],
        signal: options.signal,
      });
      return { ...this.parseModelJson(r.text), _usage: r.usage };
    }

    const run = (correction?: { previousText: string; note: string }) => bwengeAgent.run({
      userId: options.userId,
      system: systemPrompt,
      history: correction ? [...history, { role: 'user', text: prompt }, { role: 'assistant', text: correction.previousText || '(no reply)' }] : history,
      prompt: correction ? correction.note : prompt,
      uploads: correction ? [] : uploads,
      onEvent: options.onEvent,
      signal: options.signal,
      vision,
      ...(runModel ? { model: runModel } : {}),
    });
    // A requested file only counts when a tool created it; otherwise one corrective turn, then an honest note.
    const checked = plan?.artifact ? await runDeliverableTurn({ plan, run, onEvent: options.onEvent }) : null;
    const r = checked ?? await run();
    if (toolTurn) logger.info('[AI chat] tool turn', { model: runModel ?? 'gonka-default', deliverables: plan!.deliverables.length, attachments: r.attachments.length, missing: checked?.missing.length ?? 0 });

    return {
      content: [{ type: 'text', text: r.text }],
      model: runModel ?? (process.env.GONKA_MODEL || GONKA_MODELS.DEFAULT),
      attachments: r.attachments,
      sources: r.sources,
      _usage: r.usage,
    };
  }
}
