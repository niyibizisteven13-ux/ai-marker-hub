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
const LOCAL_CACHE_LIMIT = 512;
const local = new Map<string, { expires: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
const invalidating = new Map<string, Promise<void>>();

/** Shares concurrent misses within this process and successful fills across Redis clients. */
export async function cached<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  await invalidating.get(key);
  const active = pending.get(key);
  if (active) return active as Promise<T>;

  const redis = getRedis();
  const redisKey = `cache:${key}`;
  async function fill(): Promise<T> {
    let shared = false;
    if (redis?.status === 'ready') {
      try {
        const hit = await redis.get(redisKey);
        if (hit !== null) return JSON.parse(hit) as T;
        shared = true;
      } catch { /* Redis errors leave the local cache available. */ }
    }
    if (!shared) {
      const entry = local.get(key);
      if (entry) {
        local.delete(key);
        if (entry.expires > Date.now()) {
          local.set(key, entry);
          return entry.value as T;
        }
      }
    }
    // An application error belongs to the caller. It must never retry through the fallback.
    const value = await compute();
    if (pending.get(key) !== request) return value;

    if (ttlMs > 0) {
      local.delete(key);
      local.set(key, { expires: Date.now() + ttlMs, value });
      if (local.size > LOCAL_CACHE_LIMIT) local.delete(local.keys().next().value!);
      if (shared && redis) {
        try {
          const serialized = JSON.stringify(value);
          if (serialized !== undefined) await redis.set(redisKey, serialized, 'PX', ttlMs);
        } catch { /* A Redis write or serialization error should not fail the request. */ }
      }
    }
    return value;
  }

  const request = Promise.resolve().then(fill);
  pending.set(key, request);
  try {
    return await request;
  } finally {
    if (pending.get(key) === request) pending.delete(key);
  }
}

export async function invalidate(key: string): Promise<void> {
  pending.delete(key);
  local.delete(key);
  const redis = getRedis();
  if (redis?.status !== 'ready') return;
  const deletion = redis.del(`cache:${key}`).then(() => undefined, () => undefined);
  invalidating.set(key, deletion);
  try {
    await deletion;
  } finally {
    if (invalidating.get(key) === deletion) invalidating.delete(key);
  }
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
