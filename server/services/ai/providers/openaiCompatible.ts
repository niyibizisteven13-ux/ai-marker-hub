import { ProviderAdapter, ProviderChunk, ProviderError, ProviderRequest } from './types.js';

export interface OpenAICompatibleOptions {
  /** Display name for logs/events, e.g. "GonkaRouter". */
  name: string;
  /** Full chat-completions URL or a base URL ending in /v1 (the path is added automatically). */
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  /** Time allowed to receive response headers. */
  connectTimeoutMs?: number;
  /** Abort if no data arrives for this long while streaming. */
  idleTimeoutMs?: number;
  /** Maximum total time for the request, including streaming. */
  requestTimeoutMs?: number;
  /** Ask for token usage in the stream (OpenAI-style). Disable if the gateway rejects it. */
  includeUsage?: boolean;
  /** Last-chance edit of the request body for gateway quirks. */
  transformBody?: (body: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * One streaming adapter for every OpenAI-compatible gateway: GonkaRouter, NVIDIA NIM, OpenRouter, OpenAI.
 * Handles SSE framing, tool-call deltas, JSON (non-SSE) fallbacks, mid-stream errors, and idle timeouts.
 */
export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly name: string;
  private url: string;

  constructor(private opts: OpenAICompatibleOptions) {
    this.name = opts.name;
    const base = opts.baseUrl.replace(/\/$/, '');
    this.url = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
  }

  async *stream(req: ProviderRequest): AsyncGenerator<ProviderChunk> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: true,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      ...(this.opts.includeUsage !== false ? { stream_options: { include_usage: true } } : {}),
    };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      body.tool_choice = req.toolChoice ?? 'auto';
    }
    const finalBody = this.opts.transformBody ? this.opts.transformBody(body) : body;

    const controller = new AbortController();
    const onAbort = () => controller.abort(req.signal?.reason ?? new Error('aborted'));
    req.signal?.addEventListener('abort', onAbort, { once: true });
    let timedOut: 'connect' | 'idle' | 'request' | null = null;
    const connectTimer = setTimeout(() => { timedOut = 'connect'; controller.abort(); }, this.opts.connectTimeoutMs ?? 30_000);
    const requestTimer = setTimeout(() => { timedOut = 'request'; controller.abort(); }, this.opts.requestTimeoutMs ?? 60_000);
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { timedOut = 'idle'; controller.abort(); }, this.opts.idleTimeoutMs ?? 45_000);
    };

    try {
      let res: Response;
      try {
        res = await fetch(this.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream, application/json',
            ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}),
            ...(this.opts.headers ?? {}),
          },
          body: JSON.stringify(finalBody),
          signal: controller.signal,
        });
      } catch (err: any) {
        if (timedOut) throw new ProviderError(`${this.name}: ${timedOut} timeout`, undefined, true, true, timedOut);
        if (req.signal?.aborted) throw err;
        throw new ProviderError(`${this.name}: ${err?.cause?.code ?? err?.message ?? 'network error'}`, undefined, true);
      } finally {
        clearTimeout(connectTimer);
      }

      if (!res.ok) {
        throw new ProviderError(`${this.name} request failed with HTTP ${res.status}`, res.status);
      }

      const type = (res.headers.get('content-type') ?? '').toLowerCase();
      if (!type.includes('text/event-stream')) {
        // Gateways sometimes ignore stream:true and return plain JSON.
        const data: any = await res.json().catch(() => {
          if (timedOut) throw new ProviderError(`${this.name}: ${timedOut} timeout`, undefined, true, true, timedOut);
          return null;
        });
        if (!data) throw new ProviderError(`${this.name}: response was not valid JSON`);
        if (data.error) throw new ProviderError(`${this.name} returned an upstream error`, Number(data.error.status ?? data.error.code) || undefined);
        const msg = data.choices?.[0]?.message ?? {};
        const content = typeof msg.content === 'string' ? msg.content : data.message?.content ?? data.response;
        if (content) yield { type: 'text', text: String(content) };
        const calls: any[] = msg.tool_calls ?? [];
        for (let i = 0; i < calls.length; i++) {
          yield { type: 'tool_call', index: i, id: calls[i].id, name: calls[i].function?.name, args: calls[i].function?.arguments ?? '' };
        }
        if (data.usage) yield { type: 'usage', input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 };
        yield { type: 'finish', reason: data.choices?.[0]?.finish_reason ?? 'stop' };
        return;
      }

      if (!res.body) throw new ProviderError(`${this.name}: empty response body`);
      armIdle();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        // @ts-ignore Node's ReadableStream is async-iterable.
        for await (const chunk of res.body) {
          armIdle();
          buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line || line.startsWith(':') || !line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') return;
            let data: any;
            try { data = JSON.parse(payload); } catch { continue; }
            if (data.error) throw new ProviderError(`${this.name} returned an upstream error`, Number(data.error.status ?? data.error.code) || undefined);
            const choice = data.choices?.[0];
            const delta = choice?.delta ?? {};
            const text = typeof delta.content === 'string' ? delta.content : Array.isArray(delta.content) ? delta.content.map((p: any) => p?.text ?? '').join('') : '';
            if (text) yield { type: 'text', text };
            const reasoning = delta.reasoning_content ?? delta.reasoning;
            if (typeof reasoning === 'string' && reasoning) yield { type: 'reasoning', text: reasoning };
            for (const tc of delta.tool_calls ?? []) {
              yield { type: 'tool_call', index: tc.index ?? 0, id: tc.id, name: tc.function?.name, args: tc.function?.arguments };
            }
            if (data.usage) yield { type: 'usage', input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 };
            if (choice?.finish_reason) yield { type: 'finish', reason: choice.finish_reason };
          }
        }
      } catch (err: any) {
        if (err instanceof ProviderError) throw err;
        if (timedOut) throw new ProviderError(`${this.name}: ${timedOut} timeout`, undefined, true, true, timedOut);
        if (req.signal?.aborted) throw err;
        throw new ProviderError(`${this.name}: stream interrupted (${err?.message ?? 'unknown'})`, undefined, true);
      }
    } finally {
      clearTimeout(connectTimer);
      clearTimeout(requestTimer);
      if (idleTimer) clearTimeout(idleTimer);
      req.signal?.removeEventListener('abort', onAbort);
    }
  }
}
