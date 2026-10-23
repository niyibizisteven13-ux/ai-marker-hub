/**
 * The hard stop behind the admin "Pause AI" button. While paused, every outgoing request to an AI provider
 * (chat, marking, Telegram, forms, background jobs, embeddings) is refused before it leaves the server, and
 * requests already streaming are cancelled. It works on the network call itself, so no code path can miss it.
 *
 * Import this module first in server.ts: provider SDKs pick up the global fetch when they are created.
 */

export class AiPausedError extends Error {
  readonly code = 'AI_PAUSED';
  constructor() { super('Bwenge AI is paused by an administrator. Please try again a little later.'); this.name = 'AiPausedError'; }
}

let paused = false;
const inFlight = new Set<AbortController>();

export const isAiPaused = () => paused;

/** Called whenever the setting is read or saved. Pausing cancels every AI request in progress. */
export function setAiPaused(next: boolean) {
  if (next && !paused) for (const c of inFlight) c.abort(new AiPausedError());
  paused = next;
}

const KNOWN_HOSTS = ['api.anthropic.com', 'api.openai.com', 'openrouter.ai', 'api.gonkarouter.io', 'api.deepseek.com', 'generativelanguage.googleapis.com', 'integrate.api.nvidia.com', 'api.groq.com', 'api.together.xyz', 'api.mistral.ai'];
/** Model endpoints of any OpenAI-compatible, Anthropic or Gemini provider, whatever host an admin configured. */
const MODEL_PATH = /\/(?:chat\/completions|completions|messages|responses|embeddings)(?:[/?]|$)|:(?:stream)?generateContent|:embedContent|:batchEmbedContents|\/api\/(?:chat|generate|embed)(?:[/?]|$)/;

function envHosts(): string[] {
  return ['GONKA_BASE_URL', 'OPENAI_BASE_URL', 'OLLAMA_BASE_URL', 'ANTHROPIC_BASE_URL', 'AI_COMPLEX_BASE_URL']
    .map((k) => { try { return process.env[k] ? new URL(process.env[k] as string).host : ''; } catch { return ''; } })
    .filter(Boolean);
}

export function isAiRequest(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (KNOWN_HOSTS.includes(u.host) || envHosts().includes(u.host)) return true;
  const own = (() => { try { return new URL(process.env.APP_BASE_URL || 'http://localhost').host; } catch { return ''; } })();
  return u.host !== own && !/^(localhost|127\.0\.0\.1)(:|$)/.test(u.host) && MODEL_PATH.test(u.pathname + (u.search || ''));
}

const original = globalThis.fetch?.bind(globalThis);
if (original && !(globalThis.fetch as any).__aiKillSwitch) {
  const guarded = async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url ?? '';
    if (!isAiRequest(url)) return original(input, init);
    if (paused) throw new AiPausedError();
    const ctl = new AbortController();
    const outer: AbortSignal | undefined = init?.signal ?? (typeof input === 'object' && input?.signal) ?? undefined;
    if (outer) { if (outer.aborted) ctl.abort(outer.reason); else outer.addEventListener('abort', () => ctl.abort(outer.reason), { once: true }); }
    inFlight.add(ctl);
    try {
      const res = await original(input, { ...init, signal: ctl.signal });
      if (!res.body) { inFlight.delete(ctl); return res; }
      // Keep the stream cancellable until it has been read to the end.
      const reader = res.body.getReader();
      const body = new ReadableStream({
        async pull(c) {
          try {
            const { done, value } = await reader.read();
            if (done) { inFlight.delete(ctl); c.close(); } else c.enqueue(value);
          } catch (e) { inFlight.delete(ctl); c.error(ctl.signal.aborted && paused ? new AiPausedError() : e); }
        },
        cancel(r) { inFlight.delete(ctl); return reader.cancel(r); },
      });
      return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch (e) {
      inFlight.delete(ctl);
      throw ctl.signal.aborted && paused ? new AiPausedError() : e;
    }
  };
  (guarded as any).__aiKillSwitch = true;
  globalThis.fetch = guarded as typeof fetch;
}
