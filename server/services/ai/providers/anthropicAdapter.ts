import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, ContentPart, ToolDefinition } from '../types.js';
import { ProviderError, redactUpstreamText, parseRetryAfter, type ProviderAdapter, type ProviderChunk, type ProviderRequest } from './types.js';

export interface AnthropicAdapterOptions {
  apiKey?: string;
  /** Display name for logs/events. */
  name?: string;
  /** low | medium | high | xhigh | max. Claude Haiku 5.5 defaults to medium when omitted. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Default max_tokens when the request gives none (thinking counts toward it). */
  defaultMaxTokens?: number;
  requestTimeoutMs?: number;
  /** Automatic prompt caching of the stable prefix (tools + system + history). Default on. */
  promptCaching?: boolean;
  /** Injected client for tests. */
  client?: Pick<Anthropic, 'messages'>;
}

type MessageParam = Anthropic.MessageParam;
type ContentBlockParam = Anthropic.ContentBlockParam;

function toImageBlock(url: string): Anthropic.ImageBlockParam | null {
  const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/i.exec(url);
  if (m) return { type: 'image', source: { type: 'base64', media_type: m[1].toLowerCase() as 'image/png', data: m[2] } };
  if (/^https:\/\//i.test(url)) return { type: 'image', source: { type: 'url', url } };
  return null;
}

function userContent(content: ChatMessage['content']): string | ContentBlockParam[] {
  if (typeof content === 'string') return content;
  if (!content) return '';
  const blocks: ContentBlockParam[] = [];
  for (const part of content as ContentPart[]) {
    if (part.type === 'text') { if (part.text) blocks.push({ type: 'text', text: part.text }); }
    else {
      const img = toImageBlock(part.image_url.url);
      if (img) blocks.push(img);
    }
  }
  // Images go before the text that refers to them.
  return blocks.sort((a, b) => Number(a.type !== 'image') - Number(b.type !== 'image'));
}

function safeJson(args: string): Record<string, unknown> {
  try {
    const v = JSON.parse(args || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Converts the runtime's OpenAI-shaped history into Messages API params. */
export function toAnthropicMessages(messages: ChatMessage[]): { system: string; messages: MessageParam[] } {
  const system: string[] = [];
  const out: MessageParam[] = [];
  const pushUser = (blocks: ContentBlockParam[] | string) => {
    const last = out[out.length - 1];
    const asBlocks = typeof blocks === 'string' ? (blocks ? [{ type: 'text' as const, text: blocks }] : []) : blocks;
    if (!asBlocks.length) return;
    if (last?.role === 'user') {
      const prev = typeof last.content === 'string' ? [{ type: 'text' as const, text: last.content }] : last.content;
      last.content = [...prev, ...asBlocks];
    } else out.push({ role: 'user', content: asBlocks });
  };
  for (const m of messages) {
    if (m.role === 'system') {
      const text = typeof m.content === 'string' ? m.content : (m.content ?? []).map((p) => (p.type === 'text' ? p.text : '')).join('\n');
      if (text) system.push(text);
    } else if (m.role === 'user') {
      pushUser(userContent(m.content));
    } else if (m.role === 'tool') {
      pushUser([{ type: 'tool_result', tool_use_id: m.tool_call_id ?? '', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]);
    } else if (m.role === 'assistant') {
      if (m.providerState?.provider === 'anthropic') {
        // Replay Claude's own blocks unchanged (thinking blocks must be passed back as-is with tool results).
        out.push({ role: 'assistant', content: m.providerState.content as ContentBlockParam[] });
        continue;
      }
      const blocks: ContentBlockParam[] = [];
      const text = typeof m.content === 'string' ? m.content : (m.content ?? []).map((p) => (p.type === 'text' ? p.text : '')).join('');
      if (text.trim()) blocks.push({ type: 'text', text });
      for (const tc of m.tool_calls ?? []) blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: safeJson(tc.function.arguments) });
      if (blocks.length) out.push({ role: 'assistant', content: blocks });
    }
  }
  if (out[0]?.role !== 'user') out.unshift({ role: 'user', content: [{ type: 'text', text: '(conversation start)' }] });
  return { system: system.join('\n\n'), messages: out };
}

function toTools(tools?: ToolDefinition[]): Anthropic.Tool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool.InputSchema }));
}

function mapError(name: string, err: unknown, signal?: AbortSignal): unknown {
  if (signal?.aborted) return err;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError(`${name}: request timeout`, undefined, true, true, 'request');
  if (err instanceof Anthropic.APIUserAbortError) return err;
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError(`${name}: network error`, undefined, true);
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === 'number' ? err.status : undefined;
    const e = new ProviderError(`${name} request failed with HTTP ${status ?? 'error'}`, status);
    e.retryAfterMs = parseRetryAfter(err.headers?.get?.('retry-after') ?? null);
    const body = err.error as { error?: { type?: string; message?: string } } | undefined;
    e.upstreamMessage = redactUpstreamText([body?.error?.type, body?.error?.message].filter(Boolean).join(' ') || String(err.message));
    return e;
  }
  return err;
}

/**
 * Claude (Anthropic Messages API) as a ProviderAdapter, so the existing AgentRuntime, reliability
 * layer and tools work unchanged. Streams text; emits complete tool calls when the turn ends;
 * carries Claude's assistant blocks (including thinking) forward via `provider_state`.
 */
export class AnthropicAdapter implements ProviderAdapter {
  readonly name: string;
  private client: Pick<Anthropic, 'messages'>;

  constructor(private opts: AnthropicAdapterOptions = {}) {
    this.name = opts.name ?? 'Claude';
    // SDK retries are off: ReliableProviderAdapter owns the retry policy.
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 0, timeout: opts.requestTimeoutMs ?? 120_000 });
  }

  async *stream(req: ProviderRequest): AsyncGenerator<ProviderChunk> {
    const { system, messages } = toAnthropicMessages(req.messages);
    const params: Anthropic.MessageStreamParams = {
      model: req.model,
      max_tokens: req.maxTokens ?? this.opts.defaultMaxTokens ?? 16_000,
      messages,
      ...(system ? { system } : {}),
      ...(toTools(req.tools) ? { tools: toTools(req.tools), tool_choice: { type: req.toolChoice === 'none' ? 'none' : 'auto' } as Anthropic.ToolChoice } : {}),
      ...(this.opts.promptCaching !== false ? { cache_control: { type: 'ephemeral' } } : {}),
      // Sampling parameters (temperature/top_p/top_k) are deliberately not sent: current Claude models reject them.
      output_config: {
        ...(this.opts.effort ? { effort: this.opts.effort } : {}),
        ...(req.responseSchema ? { format: { type: 'json_schema', schema: req.responseSchema } } : {}),
      },
    };

    let finalMessage: Anthropic.Message;
    try {
      const stream = this.client.messages.stream(params, { signal: req.signal });
      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta' && event.delta.text) yield { type: 'text', text: event.delta.text };
          else if (event.delta.type === 'thinking_delta' && event.delta.thinking) yield { type: 'reasoning', text: event.delta.thinking };
        }
      }
      finalMessage = await stream.finalMessage();
    } catch (err) {
      throw mapError(this.name, err, req.signal);
    }

    const u = finalMessage.usage;
    yield { type: 'usage', input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0 };

    if (finalMessage.stop_reason === 'refusal') {
      const e = new ProviderError(`${this.name} declined the request`);
      e.category = 'CONTENT_REFUSED';
      e.exhausted = true;
      e.upstreamMessage = `refusal${finalMessage.stop_details && 'category' in finalMessage.stop_details ? ` (${String(finalMessage.stop_details.category)})` : ''}`;
      throw e;
    }

    const toolUses = finalMessage.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (finalMessage.stop_reason === 'max_tokens' && toolUses.length) {
      // A tool input cut off at max_tokens may parse as a valid partial object; never run it.
      yield { type: 'finish', reason: 'length' };
      return;
    }
    if (toolUses.length) {
      yield { type: 'provider_state', provider: 'anthropic', content: finalMessage.content as unknown[] };
      for (let i = 0; i < toolUses.length; i++) {
        yield { type: 'tool_call', index: i, id: toolUses[i].id, name: toolUses[i].name, args: JSON.stringify(toolUses[i].input ?? {}) };
      }
    }
    yield { type: 'finish', reason: finalMessage.stop_reason === 'max_tokens' ? 'length' : finalMessage.stop_reason ?? 'stop' };
  }
}
