import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import logger from '../../utils/logger.js';
import { ProviderError } from './providers/types.js';

/**
 * Overnight work at half price: inside runOvernight(), Claude requests go through the Message Batches API
 * instead of being streamed. Requests made within a short window are sent as one batch, the batch is polled
 * until it ends (usually within an hour, at most 24 h), and each caller gets its message back as if it had
 * been streamed. A request already sent is remembered on disk, so a restarted job waits for the same batch
 * instead of paying twice.
 */

interface OvernightContext { overnight: true }
const als = new AsyncLocalStorage<OvernightContext>();

/** Runs fn (and everything it awaits) in overnight mode. */
export const runOvernight = <T>(fn: () => Promise<T>): Promise<T> => als.run({ overnight: true }, fn);
export const isOvernight = () => als.getStore()?.overnight === true;
/** Batch requests cost half of the same request streamed. */
export const BATCH_PRICE_FACTOR = 0.5;

type BatchClient = Pick<Anthropic, 'messages'>;
type Params = Anthropic.MessageCreateParamsNonStreaming;
interface Waiter { resolve: (m: Anthropic.Message) => void; reject: (e: unknown) => void }
interface Pending { key: string; params: Params; bytes: number; waiters: Waiter[] }
interface Sent { batchId: string; customId: string; at: string }

export interface BatchCollectorOptions {
  dir?: string;
  /** How long requests are collected before a batch is sent. */
  windowMs?: number;
  /** How often a running batch is checked. */
  pollMs?: number;
  /** A batch is sent early when it reaches this many requests or bytes (API limits: 100,000 / 256 MB). */
  maxRequests?: number;
  maxBytes?: number;
  /** Remembered requests older than this are forgotten. */
  keepMs?: number;
}

const env = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d);

export class BatchCollector {
  private readonly o: Required<BatchCollectorOptions>;
  private pending = new Map<string, Pending>();
  private pendingBytes = 0;
  private timer: NodeJS.Timeout | null = null;
  /** Callers waiting per batch and custom id; a batch is polled by one loop. */
  private waiting = new Map<string, Map<string, Waiter[]>>();
  private polling = new Set<string>();
  private client: BatchClient | null = null;
  private pruned = false;

  constructor(opts: BatchCollectorOptions = {}) {
    this.o = {
      dir: opts.dir ?? process.env.BATCH_DIR ?? './data/batches',
      windowMs: opts.windowMs ?? env(process.env.BATCH_WINDOW_MS, 5_000),
      pollMs: opts.pollMs ?? env(process.env.BATCH_POLL_MS, 60_000),
      maxRequests: opts.maxRequests ?? 5_000,
      maxBytes: opts.maxBytes ?? 150 * 1024 * 1024,
      keepMs: opts.keepMs ?? 7 * 86_400_000,
    };
  }

  /** Sends params in the next batch (or finds it in a batch already sent) and resolves with Claude's message. */
  async run(client: BatchClient, params: Params, signal?: AbortSignal): Promise<Anthropic.Message> {
    this.client = client;
    if (!this.pruned) { this.pruned = true; void this.prune().catch(() => undefined); }
    const body = JSON.stringify(params);
    const key = createHash('sha256').update(body).digest('hex').slice(0, 48);
    return new Promise<Anthropic.Message>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      if (signal) {
        if (signal.aborted) return reject(abortError(signal));
        signal.addEventListener('abort', () => { this.drop(key, waiter); reject(abortError(signal)); }, { once: true });
      }
      void this.enqueue(key, params, body.length, waiter).catch(reject);
    });
  }

  private async enqueue(key: string, params: Params, bytes: number, waiter: Waiter) {
    const sent = await this.readSent(key);
    if (sent) { this.wait(sent, waiter); return; }
    const p = this.pending.get(key);
    if (p) { p.waiters.push(waiter); return; }
    this.pending.set(key, { key, params, bytes, waiters: [waiter] });
    this.pendingBytes += bytes;
    if (this.pending.size >= this.o.maxRequests || this.pendingBytes >= this.o.maxBytes) void this.flush();
    else this.timer ??= setTimeout(() => void this.flush(), this.o.windowMs);
  }

  private drop(key: string, waiter: Waiter) {
    const p = this.pending.get(key);
    if (p) {
      p.waiters = p.waiters.filter((w) => w !== waiter);
      if (!p.waiters.length) { this.pending.delete(key); this.pendingBytes -= p.bytes; }
    }
    for (const byId of this.waiting.values()) {
      const list = byId.get(key);
      if (list) byId.set(key, list.filter((w) => w !== waiter));
    }
  }

  /** Sends everything collected so far as one batch. */
  async flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const items = [...this.pending.values()];
    this.pending.clear();
    this.pendingBytes = 0;
    if (!items.length || !this.client) return;
    try {
      const batch = await this.client.messages.batches.create({ requests: items.map((p) => ({ custom_id: p.key, params: p.params })) });
      const at = new Date().toISOString();
      await mkdir(this.o.dir, { recursive: true });
      await Promise.all(items.map((p) => writeFile(this.file(p.key), JSON.stringify({ batchId: batch.id, customId: p.key, at } satisfies Sent))));
      logger.info('[batch] sent', { batchId: batch.id, requests: items.length });
      for (const p of items) for (const w of p.waiters) this.wait({ batchId: batch.id, customId: p.key, at }, w);
    } catch (e) {
      const err = toProviderError(e, 'The overnight batch could not be sent.');
      for (const p of items) for (const w of p.waiters) w.reject(err);
    }
  }

  private wait(sent: Sent, waiter: Waiter) {
    const byId = this.waiting.get(sent.batchId) ?? new Map<string, Waiter[]>();
    byId.set(sent.customId, [...(byId.get(sent.customId) ?? []), waiter]);
    this.waiting.set(sent.batchId, byId);
    if (!this.polling.has(sent.batchId)) { this.polling.add(sent.batchId); void this.poll(sent.batchId); }
  }

  private async poll(batchId: string) {
    try {
      for (let failures = 0; ;) {
        try {
          const b = await this.client!.messages.batches.retrieve(batchId);
          if (b.processing_status === 'ended') break;
          failures = 0;
        } catch (e) {
          // A network blip while checking does not lose the batch; give up only after a long outage.
          if (++failures >= 30) throw e;
        }
        await new Promise((r) => setTimeout(r, this.o.pollMs));
        if (!this.waiting.get(batchId)?.size || [...this.waiting.get(batchId)!.values()].every((l) => !l.length)) {
          // Everyone waiting gave up (stopped runs); a later caller resumes polling from the saved record.
          this.waiting.delete(batchId);
          return;
        }
      }
      const byId = this.waiting.get(batchId) ?? new Map<string, Waiter[]>();
      for await (const r of await this.client!.messages.batches.results(batchId)) {
        const list = byId.get(r.custom_id);
        if (!list?.length) continue;
        byId.delete(r.custom_id);
        const res = r.result;
        if (res.type === 'succeeded') { for (const w of list) w.resolve(res.message); continue; }
        // Errors and expiries are not kept: a retry sends the request again in a new batch.
        await rm(this.file(r.custom_id), { force: true });
        const err = res.type === 'errored'
          ? toProviderError({ status: res.error.error?.type === 'invalid_request_error' ? 400 : 500, message: res.error.error?.message ?? 'batch request failed' }, 'The overnight request failed.')
          : Object.assign(new ProviderError(`Overnight request ${res.type}`, 503, true), { category: 'PROVIDER_BUSY' as const });
        for (const w of list) w.reject(err);
      }
      for (const [id, list] of byId) {
        await rm(this.file(id), { force: true });
        for (const w of list) w.reject(Object.assign(new ProviderError('The overnight batch returned no result for this request', 503, true), { category: 'PROVIDER_BUSY' as const }));
      }
    } catch (e) {
      const err = toProviderError(e, 'The overnight batch could not be checked.');
      for (const list of this.waiting.get(batchId)?.values() ?? []) for (const w of list) w.reject(err);
    } finally {
      this.waiting.delete(batchId);
      this.polling.delete(batchId);
    }
  }

  private file(key: string) { return path.join(this.o.dir, `${key}.json`); }

  private async readSent(key: string): Promise<Sent | null> {
    try {
      const s = JSON.parse(await readFile(this.file(key), 'utf8')) as Sent;
      return s.batchId && Date.now() - Date.parse(s.at) < this.o.keepMs ? s : null;
    } catch { return null; }
  }

  private async prune() {
    const names = await readdir(this.o.dir).catch(() => [] as string[]);
    for (const n of names) {
      const f = path.join(this.o.dir, n);
      const st = await stat(f).catch(() => null);
      if (st && Date.now() - st.mtimeMs > this.o.keepMs) await rm(f, { force: true });
    }
  }
}

const abortError = (signal: AbortSignal) => (signal.reason instanceof Error ? signal.reason : new ProviderError('Request aborted'));

function toProviderError(e: unknown, message: string): ProviderError {
  if (e instanceof ProviderError) return e;
  const status = (e as { status?: number })?.status;
  const retryable = status === undefined || status === 429 || status >= 500;
  const err = new ProviderError(message, status, retryable);
  err.upstreamMessage = String((e as Error)?.message ?? '').slice(0, 200);
  return err;
}

/** One collector per process. */
export const batchCollector = new BatchCollector();
