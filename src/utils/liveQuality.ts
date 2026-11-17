/**
 * How heavy each student's live picture is. Every picture in the lecturer's grid is a separate video stream that the lecturer's
 * computer has to receive and decode, so the more students are live at once, the lighter each one must be, and the fewer there are
 * (or the bigger the tiles), the sharper each one can be:
 *   high  the one student the lecturer zooms in on: full size (camera 720p, whole screen 1080p),
 *   mid   a few students on big tiles: readable text on a shared screen, a clear face,
 *   low   the usual grid up to 48 students (half size),
 *   tiny  the grid beyond that (a quarter size, a few pictures per second): enough to see that a student is there.
 */
export type Quality = 'tiny' | 'low' | 'mid' | 'high';
export const clampQuality = (v: unknown): Quality => (v === 'high' ? 'high' : v === 'mid' ? 'mid' : v === 'tiny' ? 'tiny' : 'low');
/** Beyond this many live students at once the grid switches to tiny pictures. */
export const TINY_ABOVE = 48;

/** What the lecturer chose in Settings → Picture quality. */
export type QualityPref = 'auto' | 'sharp' | 'light';
export type TileSize = 'XS' | 'S' | 'M' | 'L';
/** The quality of the grid pictures for this many live students, this tile size and this preference. */
export function gridQuality(liveCount: number, tile: TileSize = 'M', pref: QualityPref = 'auto'): Quality {
  if (liveCount > TINY_ABOVE) return 'tiny';
  if (pref === 'light') return 'low';
  if (pref === 'sharp') return liveCount <= 24 ? 'mid' : 'low';
  // auto: sharper only when there is room for it (few students, or big tiles)
  if (tile === 'L' && liveCount <= 12) return 'mid';
  if (tile === 'M' && liveCount <= 6) return 'mid';
  return 'low';
}

export interface EncodeParams { maxBitrate: number; maxFramerate: number; scaleResolutionDownBy: number }
export function qualityParams(level: Quality, isScreen: boolean): EncodeParams {
  if (isScreen) {
    // A shared screen is mostly text: keep the size, spend the bits on sharpness, not on pictures per second.
    if (level === 'high') return { maxBitrate: 2_500_000, maxFramerate: 10, scaleResolutionDownBy: 1 };
    if (level === 'mid') return { maxBitrate: 900_000, maxFramerate: 5, scaleResolutionDownBy: 2 };
    if (level === 'tiny') return { maxBitrate: 60_000, maxFramerate: 2, scaleResolutionDownBy: 8 };
    return { maxBitrate: 160_000, maxFramerate: 3, scaleResolutionDownBy: 4 };
  }
  if (level === 'high') return { maxBitrate: 1_000_000, maxFramerate: 24, scaleResolutionDownBy: 1 };
  if (level === 'mid') return { maxBitrate: 350_000, maxFramerate: 12, scaleResolutionDownBy: 1 };
  if (level === 'tiny') return { maxBitrate: 40_000, maxFramerate: 4, scaleResolutionDownBy: 4 };
  return { maxBitrate: 120_000, maxFramerate: 8, scaleResolutionDownBy: 2 };
}

/**
 * What the student's phone or computer must capture to be able to send that quality. Most of the time it captures small
 * (cheap for the student); only while the lecturer zooms in does it capture full size.
 */
export function captureFor(high: boolean): { camera: MediaTrackConstraints; screen: MediaTrackConstraints } {
  return high
    ? { camera: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } }, screen: { frameRate: { ideal: 10, max: 12 } } }
    : { camera: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 12 } }, screen: { frameRate: { ideal: 5, max: 8 } } };
}

/** Sound for listening to one student: speech, one channel, 32 kbit/s. */
export const AUDIO_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
export const AUDIO_MAX_BITRATE = 32_000;
/**
 * Opus (the sound codec) tuned for a voice over a weak connection: lost packets are repaired (in-band FEC), silence costs almost
 * nothing (DTX), one channel, no more than 32 kbit/s. Only changes the Opus line; anything else is left alone.
 * Apply it to the ANSWER (the lecturer's side): the settings in a session description say how the other side should send to this one.
 */
export function tuneOpus(sdp: string): string {
  const pt = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp)?.[1];
  if (!pt) return sdp;
  const want: Record<string, string> = { useinbandfec: '1', usedtx: '1', stereo: '0', 'sprop-stereo': '0', maxaveragebitrate: String(AUDIO_MAX_BITRATE) };
  const re = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  const m = re.exec(sdp);
  if (!m) return sdp.replace(new RegExp(`(a=rtpmap:${pt} opus/48000[^\\r\\n]*)(\\r?\\n)`), `$1$2a=fmtp:${pt} ${Object.entries(want).map(([k, v]) => `${k}=${v}`).join(';')}$2`);
  const have = new Map(m[1].split(';').filter(Boolean).map((p) => { const i = p.indexOf('='); return i < 0 ? [p, ''] as [string, string] : [p.slice(0, i), p.slice(i + 1)] as [string, string]; }));
  for (const [k, v] of Object.entries(want)) have.set(k, v);
  return sdp.replace(re, `a=fmtp:${pt} ${[...have].map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join(';')}`);
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

/** A tile that has asked for live video for a while and still has none: say so instead of showing nothing. */
export const LIVE_GIVE_UP_MS = 25_000;
export type TileLive = 'live' | 'connecting' | 'picture';
export function tileLiveState(hasStream: boolean, askedAt: number | undefined, now: number, startUpDelay = 0): TileLive {
  if (hasStream) return 'live';
  if (askedAt === undefined) return 'connecting';
  return now - askedAt > LIVE_GIVE_UP_MS + startUpDelay ? 'picture' : 'connecting';
}
