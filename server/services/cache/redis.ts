import { Redis } from 'ioredis';
import { MemoryStore, type Options as RateLimitOptions, type Store, type ClientRateLimitInfo } from 'express-rate-limit';
import logger from '../../utils/logger.js';

/**
 * Shared state for running Bwenge on several servers: a cache, cluster-wide rate limits and instant messages
 * between servers (for example "AI paused"). Everything is optional: without REDIS_URL, or while Redis is
 * unreachable, each server falls back to its own memory, so Redis trouble never takes the site down.
 */

let client: Redis | null | undefined;
let subscriber: Redis | null = null;
let warned = false;

const url = () => process.env.REDIS_URL?.trim() || '';

export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  if (!url()) return (client = null);
  client = new Redis(url(), { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 3000, keyPrefix: 'bwenge:' });
  client.on('error', (e) => { if (!warned) { warned = true; logger.warn('[redis] unavailable, using local memory until it is back', { errorType: e?.name, message: e?.message }); } });
  client.on('ready', () => { if (warned) logger.info('[redis] connected again'); warned = false; });
  return client;
}

/** True when Redis is configured and connected right now. */
export const redisReady = () => getRedis()?.status === 'ready';

// ── Cache ──────────────────────────────────────────────────────────────────
const local = new Map<string, { at: number; ttl: number; value: unknown }>();

/** Returns the cached value, or computes it once and shares it with every server for `ttlMs`. */
export async function cached<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const r = getRedis();
  if (r && redisReady()) {
    try {
      const hit = await r.get(`cache:${key}`);
      if (hit !== null) return JSON.parse(hit) as T;
      const value = await compute();
      await r.set(`cache:${key}`, JSON.stringify(value), 'PX', ttlMs).catch(() => undefined);
      return value;
    } catch { /* fall through to the local cache */ }
  }
  const l = local.get(key);
  if (l && Date.now() - l.at < l.ttl) return l.value as T;
  const value = await compute();
  local.set(key, { at: Date.now(), ttl: ttlMs, value });
  return value;
}

export async function invalidate(key: string): Promise<void> {
  local.delete(key);
  const r = getRedis();
  if (r && redisReady()) await r.del(`cache:${key}`).catch(() => undefined);
}

// ── Messages between servers ─────────────────────────────────────────────
const handlers = new Map<string, Array<(message: string) => void>>();

export async function publish(channel: string, message: string): Promise<void> {
  const r = getRedis();
  if (r && redisReady()) await r.publish(`bwenge:${channel}`, message).catch(() => undefined);
}

export function subscribe(channel: string, handler: (message: string) => void): void {
  const list = handlers.get(channel) ?? [];
  list.push(handler);
  handlers.set(channel, list);
  if (!url()) return;
  if (!subscriber) {
    subscriber = new Redis(url(), { maxRetriesPerRequest: null, connectTimeout: 3000 });
    subscriber.on('error', () => undefined);
    subscriber.on('message', (ch: string, msg: string) => { for (const h of handlers.get(ch.replace(/^bwenge:/, '')) ?? []) { try { h(msg); } catch { /* a handler error must not stop others */ } } });
  }
  void subscriber.subscribe(`bwenge:${channel}`).catch(() => undefined);
}

// ── Rate limits shared by every server ──────────────────────────────────
/** express-rate-limit store: counts in Redis when it is up, in this server's memory when it is not. */
export class SharedRateLimitStore implements Store {
  private windowMs = 60_000;
  private memory = new MemoryStore();
  localKeys = false;
  constructor(readonly prefix: string) {}

  init(options: RateLimitOptions): void {
    this.windowMs = options.windowMs;
    this.memory.init(options);
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const r = getRedis();
    if (r && redisReady()) {
      try {
        const k = `rl:${this.prefix}:${key}`;
        const res = await r.multi().incr(k).pttl(k).exec();
        const hits = Number(res?.[0]?.[1] ?? 1);
        let ttl = Number(res?.[1]?.[1] ?? -1);
        if (ttl < 0) { await r.pexpire(k, this.windowMs); ttl = this.windowMs; }
        return { totalHits: hits, resetTime: new Date(Date.now() + ttl) };
      } catch { /* fall back to memory below */ }
    }
    return this.memory.increment(key);
  }

  async decrement(key: string): Promise<void> {
    const r = getRedis();
    if (r && redisReady()) { await r.decr(`rl:${this.prefix}:${key}`).catch(() => undefined); return; }
    await this.memory.decrement(key);
  }

  async resetKey(key: string): Promise<void> {
    const r = getRedis();
    if (r && redisReady()) await r.del(`rl:${this.prefix}:${key}`).catch(() => undefined);
    await this.memory.resetKey(key);
  }
}

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([client?.quit(), subscriber?.quit()]);
}
