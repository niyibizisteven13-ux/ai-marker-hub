import { isOvernight } from '../services/ai/batchMode.js';

/**
 * Small concurrency helpers for the AI pipelines: a counting limiter shared across callers, and a pool that maps
 * items with bounded parallelism while keeping results in input order.
 */

export interface Limiter {
  run<T>(fn: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly waiting: number;
}

export function createLimiter(max: number): Limiter {
  const cap = Math.max(1, Math.floor(max) || 1);
  let active = 0;
  const queue: Array<() => void> = [];
  const release = () => {
    active--;
    queue.shift()?.();
  };
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (active >= cap) await new Promise<void>((resolve) => queue.push(resolve));
      active++;
      try {
        return await fn();
      } finally {
        release();
      }
    },
    get active() { return active; },
    get waiting() { return queue.length; },
  };
}

/** Maps `items` with at most `n` running at once. Results keep input order; the first error rejects. */
export async function mapPool<T, R>(items: readonly T[], n: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i], i);
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, Math.floor(n) || 1), items.length) }, worker));
  return out;
}

const envInt = (v: string | undefined, d: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.min(max, Math.floor(n)) : d;
};

/**
 * Vision-model calls in flight across this process (page readings, close-up tiles, marking with images). One cap
 * for all of them keeps a big class from hitting the provider's rate limits while still running many at once.
 */
const liveVisionCalls = createLimiter(envInt(process.env.VISION_MAX_CONCURRENT, 8, 64));
// Overnight requests wait in a batch for up to hours: they never hold the slots that live marking needs.
export const visionCalls: Limiter = {
  run: (fn) => (isOvernight() ? fn() : liveVisionCalls.run(fn)),
  get active() { return liveVisionCalls.active; },
  get waiting() { return liveVisionCalls.waiting; },
};
/** Pages of one document read at the same time (all of them overnight, so they share one batch). */
export const pageConcurrency = () => (isOvernight() ? 64 : envInt(process.env.DOC_PAGE_CONCURRENCY, 3, 16));
