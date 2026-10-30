import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, ContentPart, ToolDefinition } from '../types.js';
import { batchCollector, isOvernight, type BatchCollector } from '../batchMode.js';
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
  /**
   * Claude's own web search and web fetch on agent turns (requests that carry tools), so answers can be
   * researched and cited. maxUses caps searches per request.
   */
  webTools?: { maxUses?: number } | false;
  /** Sends requests made in overnight mode (see batchMode.ts) as half-price batches. Default: the shared collector. */
  batch?: BatchCollector | false;
}

/** Longest a paused server-tool turn is resumed (each resume continues the same answer). */
const MAX_RESUMES = 4;

/** "Sources" list from the web citations in Claude's answer, numbered in first-cited order. */
export function webSources(content: Anthropic.ContentBlock[]): string {
  const seen = new Map<string, string>();
  for (const b of content) {
    if (b.type !== 'text' || !b.citations) continue;
    for (const c of b.citations) if (c.type === 'web_search_result_location' && c.url && !seen.has(c.url)) seen.set(c.url, c.title || c.url);
  }
  if (!seen.size) return '';
  return `\n\n**Sources**\n${[...seen].map(([url, title], i) => `${i + 1}. [${title.replace(/[[\]]/g, '')}](${url})`).join('\n')}`;
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
  const shared: ContentBlockParam[] = [];
  const images: ContentBlockParam[] = [];
  const text: ContentBlockParam[] = [];
  for (const part of content as ContentPart[]) {
    if (part.type === 'text') {
      if (!part.text) continue;
      if (part.cache) shared.push({ type: 'text', text: part.text });
      else text.push({ type: 'text', text: part.text });
    } else {
      const img = toImageBlock(part.image_url.url);
      if (img) images.push(img);
    }
  }
  // Shared text first, with a cache breakpoint after it so every request that repeats it reuses the cache;
  // then the images, before the text that refers to them.
  const last = shared.at(-1);
  if (last && last.type === 'text') last.cache_control = { type: 'ephemeral' };
  return [...shared, ...images, ...text];
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
    const own = toTools(req.tools);
    // Web research only on agent turns, never for structured output, and never shadowing a tool of ours.
    const web = this.opts.webTools && own?.length && !req.responseSchema && req.toolChoice !== 'none' && !own.some((t) => t.name === 'web_search' || t.name === 'web_fetch')
      ? [
          { type: 'web_search_20260209', name: 'web_search', max_uses: this.opts.webTools.maxUses ?? 5 },
          { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: this.opts.webTools.maxUses ?? 5 },
        ] as Anthropic.ToolUnion[]
      : [];
    const tools = own ? [...own, ...web] : undefined;
    const params: Anthropic.MessageStreamParams = {
      model: req.model,
      max_tokens: req.maxTokens ?? this.opts.defaultMaxTokens ?? 16_000,
      messages,
      ...(system ? { system } : {}),
      ...(tools ? { tools, tool_choice: { type: req.toolChoice === 'none' ? 'none' : 'auto' } as Anthropic.ToolChoice } : {}),
      ...(this.opts.promptCaching !== false ? { cache_control: { type: 'ephemeral' } } : {}),
      // Sampling parameters (temperature/top_p/top_k) are deliberately not sent: current Claude models reject them.
      output_config: {
        ...(this.opts.effort ? { effort: this.opts.effort } : {}),
        ...(req.responseSchema ? { format: { type: 'json_schema', schema: req.responseSchema } } : {}),
      },
    };

    let finalMessage!: Anthropic.Message;
    // Content of earlier parts of a paused turn (server tools stop after a set number of steps).
    const before: Anthropic.ContentBlock[] = [];
    const usage = { input: 0, output: 0 };
    // Overnight work goes through the Message Batches API at half price (no web research there).
    const batch = this.opts.batch !== false && isOvernight() && !web.length ? this.opts.batch ?? batchCollector : null;
    for (let resume = 0; ; resume++) {
      if (batch) {
        try {
          finalMessage = await batch.run(this.client, params as Anthropic.MessageCreateParamsNonStreaming, req.signal);
        } catch (err) {
          throw mapError(this.name, err, req.signal);
        }
        for (const b of finalMessage.content) {
          if (b.type === 'thinking' && b.thinking) yield { type: 'reasoning', text: b.thinking };
          else if (b.type === 'text' && b.text) yield { type: 'text', text: b.text };
        }
        const u = finalMessage.usage;
        usage.input += (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        usage.output += u.output_tokens ?? 0;
        break;
      }
      try {
        const stream = this.client.messages.stream(params, { signal: req.signal });
        const pending = new Map<number, { id: string; name: string; json: string }>();
        for await (const event of stream) {
          if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta' && event.delta.text) yield { type: 'text', text: event.delta.text };
            else if (event.delta.type === 'thinking_delta' && event.delta.thinking) yield { type: 'reasoning', text: event.delta.thinking };
            else if (event.delta.type === 'input_json_delta' && pending.has(event.index)) pending.get(event.index)!.json += event.delta.partial_json;
          } else if (event.type === 'content_block_start') {
            const b = event.content_block;
            if (b.type === 'server_tool_use') pending.set(event.index, { id: b.id, name: b.name, json: '' });
            else if (b.type === 'web_search_tool_result' || b.type === 'web_fetch_tool_result') {
              const ok = !(b.content && typeof b.content === 'object' && 'type' in b.content && /error/.test(String((b.content as { type: string }).type)));
              yield { type: 'server_tool_result', id: b.tool_use_id, name: b.type === 'web_search_tool_result' ? 'web_search' : 'web_fetch', ok };
            }
          } else if (event.type === 'content_block_stop' && pending.has(event.index)) {
            const t = pending.get(event.index)!;
            pending.delete(event.index);
            yield { type: 'server_tool', id: t.id, name: t.name, input: safeJson(t.json) };
          }
        }
        finalMessage = await stream.finalMessage();
      } catch (err) {
        throw mapError(this.name, err, req.signal);
      }
      const u = finalMessage.usage;
      usage.input += (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      usage.output += u.output_tokens ?? 0;
      if (finalMessage.stop_reason !== 'pause_turn' || resume >= MAX_RESUMES) break;
      // Resume the paused turn: send it back as is; the API continues where it stopped.
      before.push(...finalMessage.content);
      params.messages = [...messages, { role: 'assistant', content: before as unknown as ContentBlockParam[] }];
    }
    if (before.length) finalMessage = { ...finalMessage, content: [...before, ...finalMessage.content] };
    yield { type: 'usage', ...usage };
    const sources = webSources(finalMessage.content);
    if (sources) yield { type: 'text', text: sources };

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
