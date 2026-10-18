import type { AgentEvent, AgentResult, AttachmentRef, ChatMessage, KnowledgePassage, ToolCall, ToolContext } from './types.js';
import { isRetryable, type ProviderAdapter } from './providers/types.js';
import type { ToolRegistry } from './tools/registry.js';
import { ThinkFilter } from './util/thinkFilter.js';
import { truncate } from './util/text.js';

export interface RunOptions {
  system: string;
  /** Conversation so far (no system message). The last item is normally the new user message. */
  messages: ChatMessage[];
  ctx: ToolContext;
  model: string;
  onEvent?: (e: AgentEvent) => void;
  temperature?: number;
  maxTokens?: number;
  maxTurns?: number;
  /** Restrict which tools the model may use in this run. */
  toolNames?: string[];
  onRetry?: () => void;
}

export interface RuntimeConfig {
  maxRetries?: number;
  retryDelayMs?: number;
  toolTimeoutMs?: number;
  maxToolResultChars?: number;
  maxParallelTools?: number;
  /** Label for UI events, e.g. "GonkaRouter". Never shown to normal users by default. */
  providerLabel?: string;
}

/**
 * One provider-agnostic agent loop: stream -> collect tool calls -> run tools -> repeat.
 * Replaces the separate Gonka / NVIDIA / Anthropic loops with a single tested implementation.
 */
export class AgentRuntime {
  private cfg: Required<RuntimeConfig>;

  constructor(private adapter: ProviderAdapter, private tools: ToolRegistry, cfg: RuntimeConfig = {}) {
    this.cfg = {
      maxRetries: cfg.maxRetries ?? 3,
      retryDelayMs: cfg.retryDelayMs ?? 800,
      toolTimeoutMs: cfg.toolTimeoutMs ?? 90_000,
      maxToolResultChars: cfg.maxToolResultChars ?? 20_000,
      maxParallelTools: cfg.maxParallelTools ?? 3,
      providerLabel: cfg.providerLabel ?? adapter.name,
    };
  }

  async run(opts: RunOptions): Promise<AgentResult> {
    const emit = (e: AgentEvent) => { try { opts.onEvent?.(e); } catch { /* UI errors must not break the loop */ } };
    const history: ChatMessage[] = [...opts.messages];
    const attachments: AttachmentRef[] = [];
    const sources: KnowledgePassage[] = [];
    const usage = { input_tokens: 0, output_tokens: 0 };
    const maxTurns = opts.maxTurns ?? 12;
    const defs = this.tools.definitions(opts.toolNames);
    let finalText = '';

    for (let turn = 0; turn < maxTurns; turn++) {
      const { text, calls } = await this.streamTurn(opts, history, defs, emit, usage);
      finalText = text;

      if (!calls.length) {
        history.push({ role: 'assistant', content: text });
        emit({ type: 'usage', data: { ...usage, model: opts.model } });
        emit({ type: 'done', data: {} });
        return { text, messages: history, attachments, sources, usage, hitMaxTurns: false };
      }

      history.push({ role: 'assistant', content: text || null, tool_calls: calls });
      const results = await this.runTools(calls, opts.ctx, emit);
      for (const r of results) {
        history.push({ role: 'tool', tool_call_id: r.id, name: r.name, content: r.text });
        for (const a of r.attachments) { attachments.push(a); emit({ type: 'attachment', data: a }); }
        if (r.sources.length) { sources.push(...r.sources); emit({ type: 'sources', data: { passages: r.sources } }); }
      }
    }

    // Out of turns: ask once for a final answer without tools so the user is never left with nothing.
    history.push({ role: 'user', content: 'You have used all available tool steps. Reply to the user now with what you have, without calling tools.' });
    const final = await this.streamTurn({ ...opts, toolNames: [] }, history, [], emit, usage);
    history.push({ role: 'assistant', content: final.text });
    emit({ type: 'usage', data: { ...usage, model: opts.model } });
    emit({ type: 'done', data: { hitMaxTurns: true } });
    return { text: final.text || finalText, messages: history, attachments, sources, usage, hitMaxTurns: true };
  }

  private async streamTurn(
    opts: RunOptions,
    history: ChatMessage[],
    defs: ReturnType<ToolRegistry['definitions']>,
    emit: (e: AgentEvent) => void,
    usage: { input_tokens: number; output_tokens: number },
  ): Promise<{ text: string; calls: ToolCall[] }> {
    for (let attempt = 0; ; attempt++) {
      const filter = new ThinkFilter();
      let text = '';
      let emitted = false;
      const calls = new Map<number, { id?: string; name: string; args: string }>();
      let turnUsage = { input: 0, output: 0 };
      try {
        const stream = this.adapter.stream({
          model: opts.model,
          messages: [{ role: 'system', content: opts.system }, ...history],
          tools: defs.length ? defs : undefined,
          temperature: opts.temperature,
          maxTokens: opts.maxTokens,
          signal: opts.ctx.signal,
        });
        for await (const c of stream) {
          if (c.type === 'text') {
            const visible = filter.push(c.text);
            if (visible) { text += visible; emitted = true; emit({ type: 'text', data: { text: visible, provider: this.cfg.providerLabel } }); }
          } else if (c.type === 'tool_call') {
            const cur = calls.get(c.index) ?? { id: undefined, name: '', args: '' };
            if (c.id) cur.id = c.id;
            if (c.name) cur.name += c.name;
            if (c.args) cur.args += c.args;
            calls.set(c.index, cur);
          } else if (c.type === 'usage') {
            turnUsage = { input: c.input, output: c.output };
          }
        }
        const tail = filter.flush();
        if (tail) { text += tail; emit({ type: 'text', data: { text: tail, provider: this.cfg.providerLabel } }); }
        usage.input_tokens += turnUsage.input;
        usage.output_tokens += turnUsage.output;
        const list: ToolCall[] = [...calls.entries()]
          .sort((a, b) => a[0] - b[0])
          .filter(([, v]) => v.name)
          .map(([i, v]) => ({ id: v.id || `call_${Date.now().toString(36)}_${i}`, type: 'function' as const, function: { name: v.name, arguments: v.args || '{}' } }));
        return { text: text.trim() ? text : text, calls: list };
      } catch (err) {
        if (opts.ctx.signal?.aborted) throw err;
        if (isRetryable(err) && attempt < this.cfg.maxRetries) {
          opts.onRetry?.();
          if (emitted) emit({ type: 'turn_reset', data: { reason: String((err as Error).message).slice(0, 120) } });
          await new Promise((r) => setTimeout(r, this.cfg.retryDelayMs * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
  }

  private async runTools(calls: ToolCall[], ctx: ToolContext, emit: (e: AgentEvent) => void) {
    type R = { id: string; name: string; text: string; attachments: AttachmentRef[]; sources: KnowledgePassage[] };
    const results: R[] = new Array(calls.length);
    let next = 0;
    const worker = async () => {
      while (next < calls.length) {
        const i = next++;
        results[i] = await this.runOne(calls[i], ctx, emit);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.cfg.maxParallelTools, calls.length) }, worker));
    return results;
  }

  private async runOne(call: ToolCall, ctx: ToolContext, emit: (e: AgentEvent) => void) {
    const name = call.function.name;
    const id = call.id;
    const finish = (text: string, isError = false, attachments: AttachmentRef[] = [], sources: KnowledgePassage[] = []) => {
      const out = truncate(text, this.cfg.maxToolResultChars, '\n[output truncated]');
      emit({ type: 'tool_result', data: { id, name, output: out, isError } });
      return { id, name, text: out, attachments, sources };
    };

    let input: unknown;
    try {
      input = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch (e) {
      emit({ type: 'tool_call', data: { id, name, input: null } });
      return finish(`ERROR: the arguments for ${name} were not valid JSON (${(e as Error).message}). Call the tool again with valid JSON.`, true);
    }
    emit({ type: 'tool_call', data: { id, name, input } });

    const tool = this.tools.get(name);
    if (!tool) return finish(`ERROR: unknown tool "${name}". Available tools: ${this.tools.names().join(', ')}.`, true);
    const problem = this.tools.validate(name, input);
    if (problem) return finish(`ERROR: invalid arguments for ${name}: ${problem}. Fix them and call the tool again.`, true);

    try {
      const timeout = AbortSignal.timeout(this.cfg.toolTimeoutMs);
      const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
      const out = await tool.execute(input, { ...ctx, signal });
      return finish(out.text, !!out.isError, out.attachments ?? [], out.sources ?? []);
    } catch (e: any) {
      // Never leak secrets or stack traces to the model or the user.
      const msg = String(e?.message ?? e).replace(/(sk-[\w-]{10,}|Bearer\s+[\w.-]{10,}|api[_-]?key["':\s=]+[\w.-]{10,})/gi, '[redacted]').split('\n')[0].slice(0, 300);
      return finish(`ERROR: ${name} failed: ${msg}`, true);
    }
  }
}
