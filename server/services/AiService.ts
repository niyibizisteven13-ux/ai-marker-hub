import { GoogleGenAI, Type } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { evaluateStudentSubmission as deepseekEvaluate } from '../../src/services/deepseekMarker.js';
import { BWENGE_GENERAL_SYSTEM_PROMPT } from './prompts/bwengeGeneralPrompt.js';
import { MemoryService } from './MemoryService.js';
import logger from '../utils/logger.js';

const MODELS = {
  SONNET: 'claude-sonnet-5',
  HAIKU: 'claude-haiku-4-5-20251001',
};

const NVIDIA_MODELS = {
  LARGE: 'meta/llama-4-maverick-17b-128e-instruct', // World-class reasoning MoE
  FAST: 'meta/llama-4-scout-17b-16e-instruct',      // High-throughput MoE
};

type ProviderKey = 'gemini' | 'openai' | 'deepseek' | 'openrouter' | 'anthropic' | 'ollama' | 'nvidianim';

// --- Shared infra -------------------------------------------------------

/** Default timeout for any raw fetch() to a third-party provider. */
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

/**
 * fetch() with an AbortController-backed timeout. Without this, a stalled
 * provider (Ollama on a dead local box, an overloaded OpenRouter route,
 * NVIDIA NIM under load) hangs the request indefinitely instead of failing
 * fast so a caller can retry or fall back to another provider.
 */
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

/**
 * Distinguishes transient/retryable failures (rate limits, 5xx, network
 * blips, our own timeout) from permanent ones (bad API key, malformed
 * request, model refusal). Retrying a 400/401/403 just adds latency to a
 * failure that will never succeed — only retry what might actually recover.
 */
function isRetryableError(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  if (typeof status === 'number') {
    return status === 429 || status >= 500;
  }
  const message = String(err?.message || '');
  if (/timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|network/i.test(message)) return true;
  return false;
}

/**
 * Best-effort extraction of plain text from an Anthropic message's content,
 * whether it's a plain string or a multi-part array (image/document +
 * text blocks, which is the normal shape once `files` are attached).
 */
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

/**
 * Matches likely API keys / bearer tokens so they never leak into a tool
 * error string that gets fed back into a model conversation (and from
 * there, potentially surfaced to an end user).
 */
const SECRET_PATTERN = /(sk-[a-zA-Z0-9_-]{10,}|Bearer\s+[a-zA-Z0-9._-]{10,}|api[_-]?key["':\s=]+[a-zA-Z0-9._-]{10,})/gi;

/**
 * Turns a caught tool-execution error into a safe, bounded string to hand
 * back to the model. Always logs the full, unredacted error server-side
 * first — sanitization is about what the model/user sees, not about
 * losing the detail needed to debug.
 */
function sanitizeToolError(toolName: string, err: unknown): string {
  logger.error(`Tool execution failed: ${toolName}`, err);
  const rawMessage = err instanceof Error ? err.message : String(err);
  const redacted = rawMessage.replace(SECRET_PATTERN, '[redacted]');
  const singleLine = redacted.split('\n')[0].slice(0, 300);
  return `ERROR: ${toolName} failed: ${singleLine}`;
}

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
      this.geminiClient = new GoogleGenAI({ apiKey });
    }
  }

  private initializeAnthropic() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.anthropicClient = new Anthropic({ apiKey });
    }
  }

  public async providerAvailable(name: ProviderKey): Promise<boolean> {
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

  /**
   * Races the given providers and returns every successful result plus
   * every error. Built around a labeled task list (rather than positional
   * array indices) so adding/removing an optional provider can never
   * silently shift which error/result maps to which provider.
   */
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

  public async streamNvidiaNimChat(prompt: string, options: {
    model?: string; system?: string; history?: any[]; onToken: (token: string) => void; tools?: any[];
    temperature?: number; max_tokens?: number;
  }) {
    const apiKey = process.env.NVIDIA_NIM_API_KEY;
    if (!apiKey) throw new Error('NVIDIA_NIM_API_KEY is not configured.');

    let model = options.model || process.env.NVIDIA_NIM_MODEL || NVIDIA_MODELS.FAST;

    // Safety Force-Upgrade: Llama 3.1/3.3 have reached EOL and will return 410 Gone.
    // If the configured model is an old variant, we force it to the Llama 4 equivalent.
    if (model.includes('llama-3.1') || model.includes('llama-3.3')) {
      logger.warn(`NVIDIA NIM: Detected EOL model ${model}. Forcing upgrade to ${NVIDIA_MODELS.FAST}`);
      model = NVIDIA_MODELS.FAST;
    }

    const baseUrl = (process.env.NVIDIA_NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '') + '/chat/completions';

    logger.info(`NVIDIA NIM: Sending request to ${baseUrl} with model ${model}`);

    const messages = [
      { role: 'system', content: options.system || 'You are Bwenge AI, powered by NVIDIA NIM.' },
      ...(Array.isArray(options.history) ? options.history : []).map(h => ({ role: h.role, content: h.text })),
      { role: 'user', content: prompt },
    ];

    const body: any = {
      model,
      messages,
      stream: true,
      temperature: Number(options.temperature ?? process.env.NVIDIA_NIM_TEMPERATURE ?? 0.2),
      max_tokens: Number(options.max_tokens ?? process.env.NVIDIA_NIM_MAX_TOKENS ?? 4096),
    };

    if (options.tools) {
      body.tools = options.tools.map((t: any) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
    }

    logger.info(`NVIDIA NIM: Sending request to ${baseUrl} with model ${model}`);
    // Streaming responses can legitimately run longer than the default
    // timeout, so give this call more headroom than a plain JSON request.
    const response = await fetchWithTimeout(baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }, 60_000);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('NVIDIA NIM API Error:', { status: response.status, statusText: response.statusText, errorText });
      throw new Error(`NVIDIA NIM API error (${response.status}): ${errorText || response.statusText}`);
    }

    const reader = response.body;
    if (!reader) throw new Error('No response body from NVIDIA NIM');

    let buffer = '';
    let tokenCount = 0;
    const decoder = new TextDecoder();

    // @ts-ignore
    for await (const chunk of reader) {
      buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;

        const dataStr = trimmedLine.slice(6).trim();
        if (dataStr === '[DONE]') {
          logger.info(`NVIDIA NIM Stream finished. Total tokens: ${tokenCount}`);
          return;
        }

        try {
          const data = JSON.parse(dataStr);
          const token = data.choices?.[0]?.delta?.content;
          if (token) {
            tokenCount++;
            options.onToken(token);
          }
        } catch (e) {
          // Fragmented JSON chunk split across a read boundary — expected
          // with SSE streams, safe to skip and let the next chunk complete it.
        }
      }
    }
  }

  public async runNvidiaAgentLoop(options: {
    prompt: string;
    system: string;
    history?: any[];
    tools: any[];
    executeTool: (name: string, input: any) => Promise<string>;
    onEvent: (event: { type: 'text' | 'tool_call' | 'tool_result' | 'done' | 'usage'; data: any }) => void;
    model?: string;
  }) {
    const apiKey = process.env.NVIDIA_NIM_API_KEY;
    if (!apiKey) throw new Error('NVIDIA_NIM_API_KEY is not configured.');

    let model = options.model || process.env.NVIDIA_NIM_MODEL || NVIDIA_MODELS.FAST;

    // Safety Force-Upgrade: Llama 3.1/3.3 have reached EOL and will return 410 Gone.
    // If the configured model is an old variant, we force it to the Llama 4 equivalent.
    if (model.includes('llama-3.1') || model.includes('llama-3.3')) {
      logger.warn(`NVIDIA NIM: Detected EOL model ${model}. Forcing upgrade to ${NVIDIA_MODELS.FAST}`);
      model = NVIDIA_MODELS.FAST;
    }

    const baseUrl = (process.env.NVIDIA_NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '') + '/chat/completions';

    logger.info(`NVIDIA NIM Agent: Using model ${model}`);

    let messages = [
      { role: 'system', content: options.system },
      ...(options.history || []).map(h => ({ role: h.role, content: h.text })),
      { role: 'user', content: options.prompt },
    ];

    const nimTools = options.tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    let accumulatedUsage = { input_tokens: 0, output_tokens: 0 };
    let retryCount = 0;
    const MAX_RETRIES = 3;

    for (let turn = 0; turn < 10; turn++) {
      let reader: ReadableStream<Uint8Array> | null = null;

      try {
        const response = await fetchWithTimeout(baseUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, tools: nimTools, tool_choice: 'auto', stream: true }),
        }, 60_000);

        if (!response.ok) {
          const errorText = await response.text();
          const httpErr: any = new Error(`NVIDIA NIM Agent error (${response.status}): ${errorText || response.statusText}`);
          httpErr.status = response.status;
          throw httpErr;
        }

        reader = response.body;
        retryCount = 0;
      } catch (err: any) {
        logger.error(`NVIDIA NIM Agent error on turn ${turn}:`, err);
        // Only retry transient failures (429/5xx/timeout/network) — retrying
        // a 400 (bad request) or 401 (bad key) just delays an unavoidable
        // failure by several seconds for no benefit.
        if (isRetryableError(err) && retryCount < MAX_RETRIES) {
          retryCount++;
          options.onEvent({ type: 'text', data: { text: `\n> 🔄 **NVIDIA Recovery**: Retrying turn ${turn} (Attempt ${retryCount}/${MAX_RETRIES})...\n`, isThinking: true } });
          turn--;
          await new Promise(r => setTimeout(r, 1000 * retryCount));
          continue;
        }
        throw err;
      }

      if (!reader) throw new Error('No response body from NVIDIA NIM');

      let buffer = '';
      const decoder = new TextDecoder();
      let turnMessage: any = { role: 'assistant', content: '' };

      // @ts-ignore
      for await (const chunk of reader) {
        buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;
          const dataStr = trimmedLine.slice(6).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const data = JSON.parse(dataStr);
            const delta = data.choices?.[0]?.delta;
            if (delta?.content) {
              turnMessage.content += delta.content;
              options.onEvent({ type: 'text', data: { text: delta.content } });
            }
            if (delta?.tool_calls) {
              if (!turnMessage.tool_calls) turnMessage.tool_calls = [];
              for (const tc of delta.tool_calls) {
                const existing = turnMessage.tool_calls[tc.index || 0];
                if (existing) {
                  if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
                } else {
                  turnMessage.tool_calls[tc.index || 0] = tc;
                }
              }
            }
            if (data.usage) {
              accumulatedUsage.input_tokens += data.usage.prompt_tokens || 0;
              accumulatedUsage.output_tokens += data.usage.completion_tokens || 0;
              options.onEvent({ type: 'usage', data: { ...data.usage, model } });
            }
          } catch (e) {}
        }
      }

      messages.push(turnMessage);

      if (!turnMessage.tool_calls || turnMessage.tool_calls.length === 0) {
        options.onEvent({ type: 'done', data: {} });
        (messages as any)._usage = accumulatedUsage;
        return messages;
      }

      for (const toolCall of turnMessage.tool_calls.filter(Boolean)) {
        const name = toolCall.function.name;

        // The model streams its function arguments token-by-token; if the
        // stream is cut short, retried mid-flight, or the model emits
        // slightly malformed JSON, this must not kill the whole multi-turn
        // loop — report it back to the model as a tool error instead.
        let input: any;
        try {
          input = JSON.parse(toolCall.function.arguments);
        } catch (parseErr) {
          const reason = parseErr instanceof Error ? parseErr.message : String(parseErr);
          logger.error('NVIDIA NIM: failed to parse tool call arguments', { name, raw: toolCall.function.arguments, reason });
          options.onEvent({ type: 'tool_result', data: { name, output: `ERROR: could not parse arguments for ${name}: ${reason}` } });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name,
            content: `ERROR: your arguments for ${name} were not valid JSON. Please retry with valid JSON arguments.`,
          } as any);
          continue;
        }

        options.onEvent({ type: 'tool_call', data: { name, input } });

        let result: string;
        try {
          result = await options.executeTool(name, input);
        } catch (toolErr) {
          result = sanitizeToolError(name, toolErr);
        }
        options.onEvent({ type: 'tool_result', data: { name, output: result } });

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: name,
          content: result,
        } as any);
      }
    }

    options.onEvent({ type: 'done', data: { hitMaxTurns: true } });
    (messages as any)._usage = accumulatedUsage;
    return messages;
  }

  /**
   * Recursive Multi-Step Research (Deep Search)
   */
  public async runDeepResearch(options: {
    query: string;
    userId: string;
    onEvent: (event: any) => void;
  }) {
    const { query, userId, onEvent } = options;
    onEvent({ type: 'text', data: { text: `\n> 🌐 **Deep Research**: Initiating recursive web search for "${query}"...\n`, isThinking: true } });

    const researchSystem = `You are a Senior Research Analyst. Your goal is to provide a comprehensive, multi-perspective report on a topic.
    1. Search for primary facts.
    2. Identify conflicting reports or nuances.
    3. Synthesize into a structured markdown report.
    Use web_search tool repeatedly if needed.`;

    const { ToolRegistry } = await import('./ToolRegistry.js');
    const { executeAgentTool } = await import('./executeAgentTool.js');

    const result = await this.runAgentLoop({
      messages: [{ role: 'user', content: `Perform deep research on: ${query}` }],
      tools: [ToolRegistry.web_search.metadata, ToolRegistry.manage_files.metadata] as any,
      systemPrompt: researchSystem,
      executeTool: async (name, input) => executeAgentTool(userId, name, input),
      onEvent,
      model: MODELS.SONNET,
    });

    return result[result.length - 1].content;
  }

  public async streamOllamaChat(prompt: string, options: { model?: string; system?: string; onToken: (token: string) => void }) {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model = options.model || process.env.OLLAMA_MODEL || 'qwen2.5:7b';

    const messages = [];
    if (options.system) {
      messages.push({ role: 'system', content: options.system });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetchWithTimeout(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true }),
    }, 60_000);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${error}`);
    }

    const reader = response.body;
    if (!reader) throw new Error('No response body from Ollama');

    let buffer = '';
    // @ts-ignore
    for await (const chunk of reader) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        try {
          const data = JSON.parse(trimmedLine);
          if (data.message?.content) {
            options.onToken(data.message.content);
          }
          if (data.done) return;
        } catch (e) {
          // Fragmented JSON
        }
      }
    }
  }

  public async runAgenticWorkflow(options: {
    draftPrompt: string;
    reviewPrompt: string;
    draftSystemInstruction: string;
    reviewSystemInstruction: string;
    responseSchema: any;
    model?: string;
  }) {
    if (!this.geminiClient) throw new Error('Gemini AI client is not initialized.');

    const {
      draftPrompt, reviewPrompt, draftSystemInstruction, reviewSystemInstruction, responseSchema,
      model = 'gemini-2.0-flash',
    } = options;

    const draftResponse = await this.geminiClient.models.generateContent({
      model,
      contents: draftPrompt,
      config: { systemInstruction: draftSystemInstruction, responseMimeType: 'application/json', responseSchema },
    });

    const draft = this.parseModelJson(draftResponse.text || '{}');

    const reviewResponse = await this.geminiClient.models.generateContent({
      model,
      contents: `${reviewPrompt}\n\nDRAFT_OUTPUT:\n${JSON.stringify(draft, null, 2)}`,
      config: { systemInstruction: reviewSystemInstruction, responseMimeType: 'application/json', responseSchema },
    });

    return this.parseModelJson(reviewResponse.text || '{}');
  }

  // NOTE: the earlier speculative `runTreeOfThoughtOrchestrator` (a
  // multi-agent "hybrid provider" planner/critic pipeline) has been removed.
  // It was never wired into server.ts, called an unverified MemoryService
  // method with no type backing, and its design fanned every request out
  // into several extra Sonnet/Haiku calls with no evaluation showing it
  // improved output quality. `runAgentLoop` below is the supported,
  // tested agent path. If multi-agent orchestration is needed later, it
  // should be reintroduced behind a feature flag with cost/quality
  // benchmarks, not as default behavior. (Prior implementation is in git
  // history if it needs to be resurrected.)

  public parseModelJson(rawText: string): any {
    if (!rawText) return {};
    const cleaned = rawText.trim();
    const fenced = cleaned.match(/```(?:json)?([\s\S]*?)```/i);
    const content = fenced ? fenced[1].trim() : cleaned;

    try {
      return JSON.parse(content);
    } catch {
      const objectStart = content.indexOf('{');
      const objectEnd = content.lastIndexOf('}');
      if (objectStart >= 0 && objectEnd > objectStart) {
        try { return JSON.parse(content.slice(objectStart, objectEnd + 1)); } catch {}
      }
      const arrayStart = content.indexOf('[');
      const arrayEnd = content.lastIndexOf(']');
      if (arrayStart >= 0 && arrayEnd > arrayStart) {
        try { return JSON.parse(content.slice(arrayStart, arrayEnd + 1)); } catch {}
      }
    }
    return {};
  }

  public async generateContent(options: { model?: string; contents: any; config?: any }) {
    if (!this.geminiClient) throw new Error('Gemini AI client is not initialized.');
    return this.geminiClient.models.generateContent({
      model: options.model || 'gemini-2.0-flash',
      contents: options.contents,
      config: options.config,
    });
  }

  /**
   * Thin wrapper over generateContent for callers using the
   * "interaction" shape. The underlying SDK does not yet expose a real
   * stateful interactions endpoint, so `previousInteractionId`/`store`
   * are accepted but not honored — every call is a fresh, stateless
   * generateContent request. We warn rather than silently drop this,
   * since a caller relying on conversation continuity here would
   * otherwise fail invisibly.
   */
  public async createInteraction(options: {
    model?: string;
    userInput: string;
    previousInteractionId?: string;
    systemInstruction?: string;
    store?: boolean;
    config?: any;
  }) {
    if (!this.geminiClient) throw new Error('Gemini AI client is not initialized.');

    if (options.previousInteractionId || options.store) {
      logger.warn('createInteraction: previousInteractionId/store are not supported yet — falling back to a stateless generateContent call.');
    }

    return this.geminiClient.models.generateContent({
      model: options.model || 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: options.userInput }] }],
      config: {
        ...options.config,
        ...(options.systemInstruction ? { systemInstruction: options.systemInstruction } : {}),
      },
    });
  }

  public async streamClaudeChat(options: { system: string; messages: any[]; max_tokens?: number; model?: string }) {
    if (!this.anthropicClient) throw new Error('Anthropic client is not initialized.');
    return this.anthropicClient.messages.stream({
      model: options.model || MODELS.SONNET,
      max_tokens: options.max_tokens || 4096,
      system: options.system,
      messages: options.messages,
    });
  }

  public async sendClaudeChat(promptOrOptions: string | any, options: { system?: string; model?: string; max_tokens?: number } = {}) {
    if (!this.anthropicClient) throw new Error('Anthropic client is not initialized.');

    let params: any;
    if (typeof promptOrOptions === 'string') {
      params = {
        model: options.model || MODELS.HAIKU,
        max_tokens: options.max_tokens || 4096,
        system: options.system,
        messages: [{ role: 'user', content: promptOrOptions }],
      };
    } else {
      params = { model: MODELS.HAIKU, max_tokens: 4096, ...promptOrOptions };
    }

    const response = await this.anthropicClient.messages.create(params);
    const content = response.content[0];
    let text = '';
    if (content.type === 'text') text = content.text;

    return { text, usage: response.usage, model: params.model, content: response.content };
  }

  /**
   * Real single-shot vision call used to back the `cross_reference_visuals`
   * tool in server.ts. Sends the (optionally cropped) image/PDF to Claude
   * along with a focused question and returns Claude's real answer text.
   *
   * Kept separate from generalAssist/runAgentLoop on purpose: this is a
   * single non-agentic turn (no tools, no multi-turn loop) so it's fast and
   * cheap to call from inside an already-running tool executor without
   * recursing into the full agent loop.
   */
  public async analyzeImage(options: {
    base64: string;
    mediaType: string;
    question: string;
    model?: string;
    max_tokens?: number;
  }): Promise<string> {
    if (!this.anthropicClient) throw new Error('Anthropic client is not initialized.');

    const isPdf = options.mediaType === 'application/pdf';

    const response = await this.anthropicClient.messages.create({
      model: options.model || MODELS.SONNET,
      max_tokens: options.max_tokens || 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: isPdf ? 'document' : 'image',
              source: {
                type: 'base64',
                media_type: options.mediaType as any,
                data: options.base64,
              },
            } as any,
            { type: 'text', text: options.question },
          ],
        },
      ],
      // Prompt caching is GA — no beta header/flag needed here anymore.
    });

    const block = response.content[0];
    return block && block.type === 'text' ? block.text : '';
  }

  public async streamGeminiContent(options: { model?: string; contents: any; config?: any }) {
    if (!this.geminiClient) throw new Error('Gemini AI client is not initialized.');
    return this.geminiClient.models.generateContentStream({
      model: options.model || 'gemini-2.0-flash',
      contents: options.contents,
      config: options.config,
    });
  }

  /**
   * The core Anthropic tool-use agent loop. Note what is deliberately
   * NOT here: there used to be a "self-correction" pass (re-checking any
   * response that looked numeric with an extra Haiku call) and an
   * "adversary" pass (critiquing any response over 200 characters with
   * another Haiku call) on every turn. Both fired unconditionally, had no
   * evaluation behind them, and roughly doubled or tripled API cost per
   * agent turn — directly at odds with a product priced at a thin, fixed
   * margin over cost. They were removed rather than fixed. If a
   * verification step is wanted later, it should be selective (e.g. only
   * for high-stakes outputs like final grades) and its impact on quality
   * should be measured before it ships as default behavior.
   */
  public async runAgentLoop(options: {
    messages: Anthropic.MessageParam[];
    tools: Anthropic.Tool[];
    systemPrompt: string;
    executeTool: (name: string, input: any) => Promise<string>;
    onEvent: (event: { type: 'text' | 'tool_call' | 'tool_result' | 'done' | 'usage'; data: any }) => void;
    model?: string;
    maxTurns?: number;
  }): Promise<Anthropic.MessageParam[]> {
    if (!this.anthropicClient) throw new Error('Anthropic client is not initialized.');

    const { tools, systemPrompt, executeTool, onEvent, model = MODELS.SONNET, maxTurns = 25 } = options;
    let messages = [...options.messages];
    let activeTools = [...tools];
    let isThinking = false;
    let retryCount = 0;
    const MAX_RETRIES = 3;

    for (let turn = 0; turn < maxTurns; turn++) {
      let response: Anthropic.Message;

      try {
        const stream = this.anthropicClient.messages.stream({
          model,
          max_tokens: 4096,
          system: systemPrompt,
          tools: activeTools as any,
          messages,
          // Prompt caching is GA and driven by `cache_control` blocks on
          // content — the old beta flag is a no-op now and has been removed.
        });

        stream.on('text', (text) => {
          if (text.includes('<thinking>')) isThinking = true;
          onEvent({ type: 'text', data: { text, isThinking } });
          if (text.includes('</thinking>')) isThinking = false;
        });

        (stream as any).on('tool_use', (toolUse: any) => {
          isThinking = false;
          onEvent({ type: 'tool_call', data: { name: toolUse.name, input: toolUse.input, status: 'started' } });
        });

        response = await stream.finalMessage();
        retryCount = 0;
      } catch (err: any) {
        logger.error(`Agent loop error on turn ${turn}:`, err);
        // Only retry transient failures — a bad API key or malformed request
        // will fail identically on every attempt, so don't burn 3 retries
        // and several seconds of latency on a guaranteed failure.
        if (isRetryableError(err) && retryCount < MAX_RETRIES) {
          retryCount++;
          onEvent({ type: 'text', data: { text: `\n> 🔄 **System Recovery**: AI encountered a transient error. Retrying turn ${turn} (Attempt ${retryCount}/${MAX_RETRIES})...\n`, isThinking: true } });
          turn--;
          await new Promise(r => setTimeout(r, 1000 * retryCount));
          continue;
        }
        throw err;
      }

      if (response.usage) {
        const reasoningTokens = (response.usage as any).cache_read_input_tokens || 0;
        onEvent({ type: 'usage', data: { ...response.usage, reasoningTokens, model } });
      }

      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason !== 'tool_use') {
        onEvent({ type: 'done', data: {} });
        return messages;
      }

      const toolResults: Anthropic.MessageParam['content'] = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          let result: string;
          const blockInput = block.input as any;

          if (block.name === 'load_specialized_tool') {
            const { ToolRegistry } = await import('./ToolRegistry.js');
            const tool = ToolRegistry[blockInput.tool_name];
            if (tool) {
              activeTools.push(tool.metadata);
              result = `SUCCESS: Tool ${blockInput.tool_name} loaded into context. Instructions: ${tool.instructions}`;
              onEvent({ type: 'text', data: { text: `\n> 📥 **Registry**: Loaded specialized logic for ${blockInput.tool_name}...\n`, isThinking: true } });
            } else {
              result = `ERROR: Tool ${blockInput.tool_name} not found in registry.`;
            }
          } else if (block.name === 'analyze_data_with_python') {
            onEvent({ type: 'text', data: { text: `\n> 🏗️ **Bwenge Engine**: Running MCP-Standard Python Sandbox...\n`, isThinking: true } });
            try {
              const sandbox = await import('./ExecutionSandbox.js');
              const mcpResponse = await (sandbox as any).ExecutionSandbox.getInstance().callMcpTool('python/execute', { code: blockInput.code });

              if (mcpResponse.error) {
                result = `MCP ERROR: ${mcpResponse.error.message}`;
              } else {
                result = typeof mcpResponse.result.output === 'string' ? mcpResponse.result.output : JSON.stringify(mcpResponse.result.output);
              }
            } catch (e) {
              result = sanitizeToolError('analyze_data_with_python', e);
            }
          } else {
            try {
              result = await executeTool(block.name, block.input);
            } catch (toolErr) {
              // A throwing tool must not bubble up and kill the whole agent
              // loop mid-conversation. Report the failure back to the model
              // as a tool result instead so it can react (retry with
              // different input, apologize, try another tool).
              result = sanitizeToolError(block.name, toolErr);
            }
          }

          onEvent({ type: 'tool_result', data: { name: block.name, output: result } });
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
        }
      }
      messages.push({ role: 'user', content: toolResults as any });
    }

    onEvent({ type: 'done', data: { hitMaxTurns: true } });
    return messages;
  }

  public async generalAssist(options: {
    userId: string;
    messages: Anthropic.MessageParam[];
    files?: { type: 'image' | 'document'; base64: string; mediaType: string }[];
    pinnedSyllabus?: string | null;
    extractSchema?: string;
    tools?: Anthropic.Tool[];
    executeTool?: (name: string, input: any) => Promise<string>;
    onEvent?: (event: { type: 'text' | 'tool_call' | 'tool_result' | 'done' | 'usage'; data: any }) => void;
  }) {
    if (!this.anthropicClient) throw new Error('Anthropic client is not initialized.');

    const memoryService = MemoryService.getInstance();

    // Once `files` are attached, `content` is an array of image/document +
    // text blocks; extractPlainText pulls the real question out of either
    // shape so the memory-context lookup queries on actual user text.
    const currentQuery = extractPlainText(options.messages[options.messages.length - 1].content);

    // A memory-lookup failure (timeout, bad data, service hiccup) is not a
    // reason to fail the whole request — the assistant should still answer
    // without personalized context rather than erroring out entirely.
    let memoryContext = '';
    try {
      memoryContext = await memoryService.getLongTermContext(options.userId, currentQuery);
    } catch (err) {
      logger.warn('generalAssist: getLongTermContext failed, continuing without memory context', err);
    }

    let systemPrompt = options.extractSchema
      ? `${BWENGE_GENERAL_SYSTEM_PROMPT}${memoryContext}\n\nFor this request, respond with ONLY valid JSON matching this shape, no other text: ${options.extractSchema}`
      : `${BWENGE_GENERAL_SYSTEM_PROMPT}${memoryContext}`;

    if (options.pinnedSyllabus) {
      systemPrompt += `\n\n[MASTER CONTEXT]: ${options.pinnedSyllabus}\n(Note: This is the primary curriculum/rubric source. Prioritize this document above all other context.)`;
    }

    if (options.files && options.files.length > 0) {
      systemPrompt += `\n\n[CRITICAL] You have been provided with visual/document attachments. Analyze them directly and answer based on what you actually see/read in them — describe concrete details (names, numbers, text, layout) rather than generic summaries. Only use tools like build_form if the user explicitly asks to "create", "build", "calculate", or "translate" something. If you use the cross_reference_visuals tool to look closer at part of an image, treat its returned text as the real answer and report it plainly — do not restate the tool's own description back to the user.`;
    }

    const lastMessage = options.messages[options.messages.length - 1];
    const userContent: any[] = typeof lastMessage.content === 'string'
      ? [{ type: 'text', text: lastMessage.content }]
      : [...(lastMessage.content as any)];

    if (typeof lastMessage.content === 'string' && (lastMessage.content.toLowerCase().includes('current') || lastMessage.content.toLowerCase().includes('research') || lastMessage.content.toLowerCase().includes('latest'))) {
      options.onEvent?.({ type: 'text', data: { text: `\n> 🧠 **Reasoning**: Detecting need for up-to-date information...\n`, isThinking: true } });
    }

    for (const file of options.files || []) {
      userContent.unshift({
        type: file.type === 'image' ? 'image' : 'document',
        source: { type: 'base64', media_type: file.mediaType, data: file.base64 },
        cache_control: { type: 'ephemeral' },
      });
    }

    const processedMessages = [...options.messages.slice(0, -1), { ...lastMessage, content: userContent }];

    if (options.tools && options.executeTool && options.onEvent) {
      let accumulatedUsage: {
        input_tokens: number;
        output_tokens: number;
        cache_read_tokens: number;
        cache_creation_tokens: number;
      } = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 };

      const messages = await this.runAgentLoop({
        messages: processedMessages,
        tools: options.tools,
        systemPrompt,
        executeTool: options.executeTool,
        onEvent: (event) => {
          if (event.type === 'usage') {
            accumulatedUsage.input_tokens += event.data.input_tokens || 0;
            accumulatedUsage.output_tokens += event.data.output_tokens || 0;
            accumulatedUsage.cache_read_tokens += event.data.cache_read_input_tokens || 0;
            accumulatedUsage.cache_creation_tokens += event.data.cache_creation_input_tokens || 0;
          }
          options.onEvent?.(event);
        },
        model: MODELS.SONNET,
      });

      if (options.extractSchema) {
        const lastMsg = messages[messages.length - 1];
        const lastText = extractPlainText(lastMsg.content);
        const parsed = this.parseModelJson(lastText);
        return { ...parsed, _usage: accumulatedUsage };
      }

      (messages as any)._usage = accumulatedUsage;
      return messages;
    }

    if (options.onEvent) {
      const stream = this.anthropicClient.messages.stream({
        model: MODELS.SONNET,
        max_tokens: 8192,
        system: systemPrompt,
        messages: processedMessages,
      });

      stream.on('text', (text) => options.onEvent!({ type: 'text', data: { text } }));
      stream.on('message', (msg) => {
        if (msg.usage) options.onEvent!({ type: 'usage', data: { ...msg.usage, model: MODELS.SONNET } });
      });

      const finalMsg = await stream.finalMessage();
      if (options.extractSchema) {
        const text = finalMsg.content[0].type === 'text' ? finalMsg.content[0].text : '{}';
        return { ...this.parseModelJson(text), _usage: finalMsg.usage };
      }
      return finalMsg;
    }

    const response = await this.anthropicClient.messages.create({
      model: MODELS.SONNET,
      max_tokens: 8192,
      system: systemPrompt,
      messages: processedMessages,
    });

    if (options.extractSchema) {
      const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
      return { ...this.parseModelJson(text), _usage: response.usage };
    }

    (response as any)._usage = response.usage;
    return response;
  }
}