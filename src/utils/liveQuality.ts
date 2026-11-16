/**
 * How heavy each student's live picture is. Every picture in the lecturer's grid is a separate video stream that the lecturer's
 * computer has to receive and decode, so the more students are live at once, the lighter each one must be:
 *   high  the one student the lecturer zooms in on (full size),
 *   low   the grid up to 48 students at once (half size),
 *   tiny  the grid beyond that (a quarter size, a few pictures per second): enough to see that a student is there and looking at the test.
 */
export type Quality = 'tiny' | 'low' | 'high';
export const clampQuality = (v: unknown): Quality => (v === 'high' ? 'high' : v === 'tiny' ? 'tiny' : 'low');
/** Beyond this many live students at once the grid switches to tiny pictures. */
export const TINY_ABOVE = 48;
export const gridQuality = (liveCount: number): Quality => (liveCount > TINY_ABOVE ? 'tiny' : 'low');

export interface EncodeParams { maxBitrate: number; maxFramerate: number; scaleResolutionDownBy: number }
export function qualityParams(level: Quality, isScreen: boolean): EncodeParams {
  if (level === 'high') return isScreen ? { maxBitrate: 1_800_000, maxFramerate: 8, scaleResolutionDownBy: 1 } : { maxBitrate: 600_000, maxFramerate: 15, scaleResolutionDownBy: 1 };
  if (level === 'tiny') return isScreen ? { maxBitrate: 60_000, maxFramerate: 2, scaleResolutionDownBy: 8 } : { maxBitrate: 40_000, maxFramerate: 4, scaleResolutionDownBy: 4 };
  return isScreen ? { maxBitrate: 120_000, maxFramerate: 3, scaleResolutionDownBy: 4 } : { maxBitrate: 120_000, maxFramerate: 8, scaleResolutionDownBy: 2 };
}

/** New students are asked to start in small groups with a short pause, so hundreds do not all answer in the same second. */
export const WATCH_BATCH = 6;
export const WATCH_GAP_MS = 350;
export function watchBatches<T>(items: T[], size = WATCH_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += Math.max(1, size)) out.push(items.slice(i, i + Math.max(1, size)));
  return out;
}
/** How long until the last of `n` students has been asked (ms). */
export const startUpMs = (n: number) => Math.max(0, watchBatches(new Array(n).fill(0)).length - 1) * WATCH_GAP_MS;
