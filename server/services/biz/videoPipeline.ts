import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';
import type { MediaStore } from './media.js';
import type { VideoInfo } from './model.js';

/**
 * Turns an uploaded video into something that plays steadily on a phone, the way Instagram and YouTube do, instead of streaming the file as it was filmed
 * (a minute of phone video is often 100 MB or more, too heavy to stream on mobile data, and many files have their index at the end so they cannot start playing).
 * For every video it makes: a 720p file (H.264 + AAC, about 3 Mbit/s at most, index at the front so playback starts at once), a 360p file for slow connections,
 * and a poster picture. It also reads the real picture size after rotation (so the page can frame a portrait, square or landscape video correctly) and drops the
 * metadata (place, device) the phone recorded. The work runs one video at a time in the background; until it is done the page says "preparing".
 * Needs ffmpeg on the server (`apt install ffmpeg`); without it the video is kept as uploaded and plays as before.
 */
export interface Run { code: number | null; stdout: string; stderr: string }
export type Exec = (bin: string, args: string[], o?: { timeoutMs?: number }) => Promise<Run>;

/** Runs a program without a shell, with a time limit, keeping only the end of its messages. */
export const runProgram: Exec = (bin, args, o = {}) => new Promise((resolve) => {
  let out = '', err = '', done = false;
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const finish = (r: Run) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
  const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ code: null, stdout: out, stderr: `${err}\ntimed out` }); }, o.timeoutMs ?? 15 * 60_000);
  child.stdout.on('data', (d) => { if (out.length < 2_000_000) out += d; });
  child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
  child.on('error', (e) => finish({ code: -1, stdout: out, stderr: String(e.message) }));
  child.on('close', (code) => finish({ code, stdout: out, stderr: err }));
});

export interface Probe { w: number; h: number; duration: number; rotation: number; vcodec: string; pixFmt: string; acodec?: string; bitrate: number; fps: number }
/** What ffprobe said, as the picture a viewer sees (rotation applied). */
export function parseProbe(json: any): Probe | null {
  const v = (json?.streams ?? []).find((s: any) => s.codec_type === 'video' && Number(s.width) > 0 && Number(s.height) > 0); if (!v) return null;
  const a = (json?.streams ?? []).find((s: any) => s.codec_type === 'audio');
  const side = (v.side_data_list ?? []).find((x: any) => x.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0;
  const rotation = ((Math.round(Number(side) || 0) % 360) + 360) % 360;
  const swap = rotation === 90 || rotation === 270; const [n, d] = String(v.avg_frame_rate ?? v.r_frame_rate ?? '0/1').split('/').map(Number);
  const duration = Number(json?.format?.duration ?? v.duration ?? 0);
  return { w: swap ? Number(v.height) : Number(v.width), h: swap ? Number(v.width) : Number(v.height), duration: Number.isFinite(duration) ? duration : 0, rotation, vcodec: String(v.codec_name ?? ''), pixFmt: String(v.pix_fmt ?? ''), ...(a ? { acodec: String(a.codec_name ?? '') } : {}), bitrate: Number(json?.format?.bit_rate) || 0, fps: d ? n / d : 0 };
}

/** Scales so the SHORT side is at most `short` pixels, keeping the shape, and keeps both sides even (H.264 needs that). */
export const scaleFilter = (short: number) => `scale=w='if(gte(iw,ih),-2,trunc(min(${short},iw)/2)*2)':h='if(gte(iw,ih),trunc(min(${short},ih)/2)*2,-2)'`;

/** A file that is already a light, ordinary H.264/AAC mp4 only needs its index moved to the front (no re-encoding, so it takes seconds). */
export const canRemux = (p: Probe, ext: string) => ext === 'mp4' && p.vcodec === 'h264' && p.pixFmt === 'yuv420p' && p.rotation === 0 && p.bitrate > 0 && p.bitrate <= 3_800_000 && (!p.acodec || p.acodec === 'aac') && Math.max(p.w, p.h) <= 1920 && p.fps <= 31;

const COMMON = ['-y', '-hide_banner', '-loglevel', 'error'];
const MAPS = ['-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1'];
const vf = (short: number, p: Probe) => [scaleFilter(short), ...(p.fps > 31 ? ['fps=30'] : [])].join(',');
export const hqArgs = (inp: string, out: string, p: Probe, remux: boolean) => remux
  ? [...COMMON, '-i', inp, ...MAPS, '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', out]
  : [...COMMON, '-i', inp, ...MAPS, '-vf', vf(720, p), '-c:v', 'libx264', '-profile:v', 'main', '-preset', 'veryfast', '-crf', '24', '-maxrate', '3000k', '-bufsize', '6000k', '-pix_fmt', 'yuv420p', '-g', '60', '-c:a', 'aac', '-b:a', '112k', '-ac', '2', '-movflags', '+faststart', '-f', 'mp4', out];
export const lqArgs = (inp: string, out: string, p: Probe) => [...COMMON, '-i', inp, ...MAPS, '-vf', vf(360, p), '-c:v', 'libx264', '-profile:v', 'main', '-preset', 'veryfast', '-crf', '28', '-maxrate', '650k', '-bufsize', '1300k', '-pix_fmt', 'yuv420p', '-g', '60', '-c:a', 'aac', '-b:a', '56k', '-ac', '1', '-movflags', '+faststart', '-f', 'mp4', out];
export const posterArgs = (inp: string, out: string, p: Probe) => [...COMMON, '-ss', String(p.duration > 2 ? Math.min(1, p.duration * 0.1).toFixed(2) : 0), '-i', inp, '-frames:v', '1', '-vf', scaleFilter(720), '-q:v', '4', '-map_metadata', '-1', out];

export interface Job { biz: string; id: string; ext: string }
export interface Patch { mime?: string; size?: number; video: VideoInfo }
export interface PipelineDeps {
  store: MediaStore; onDone: (biz: string, id: string, patch: Patch) => Promise<void>;
  exec?: Exec; ffmpeg?: string; ffprobe?: string; tmpRoot?: string; log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export function createVideoPipeline(d: PipelineDeps) {
  const exec = d.exec ?? runProgram; const ffmpeg = d.ffmpeg ?? process.env.FFMPEG_PATH ?? 'ffmpeg'; const ffprobe = d.ffprobe ?? process.env.FFPROBE_PATH ?? (ffmpeg.endsWith('ffmpeg') ? `${ffmpeg.slice(0, -6)}ffprobe` : 'ffprobe');
  const log = d.log ?? (() => undefined);
  let available: Promise<boolean> | null = null;
  const isAvailable = () => (available ??= exec(ffmpeg, ['-version'], { timeoutMs: 10_000 }).then((r) => r.code === 0).catch(() => false).then((ok) => { if (!ok) log('ffmpeg is not installed: videos are kept as uploaded'); return ok; }));
  const queue: Job[] = []; let running = false; const waiting = new Set<string>(); let idle: Array<() => void> = [];

  async function work(job: Job): Promise<Patch> {
    const { biz, id, ext } = job;
    if (!(await isAvailable())) return { video: { state: 'ready', raw: true, rev: Date.now() } };
    const tmp = await mkdtemp(path.join(d.tmpRoot ?? os.tmpdir(), 'bwvid-'));
    try {
      const inp = path.join(tmp, `in.${ext}`); const src = await d.store.open(biz, id, ext); await pipeline(src.stream, createWriteStream(inp));
      const pr = await exec(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', inp], { timeoutMs: 60_000 });
      let probe: Probe | null = null; try { probe = parseProbe(JSON.parse(pr.stdout || '{}')); } catch { probe = null; }
      if (!probe) { log('not a readable video', { id }); return { video: { state: 'failed', rev: Date.now() } }; }
      const hq = path.join(tmp, 'hq.mp4'), lq = path.join(tmp, 'lq.mp4'), poster = path.join(tmp, 'poster.jpg');
      const h = await exec(ffmpeg, hqArgs(inp, hq, probe, canRemux(probe, ext))); if (h.code !== 0) { log('could not make the 720p file', { id, err: h.stderr.slice(-300) }); return { video: { state: 'failed', w: probe.w, h: probe.h, duration: probe.duration, rev: Date.now() } }; }
      const hqBytes = await readFile(hq);
      // The size recorded is that of the file viewers will get (after scaling and rotation), read back from it.
      const ho = await exec(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', hq], { timeoutMs: 60_000 }); let out: Probe | null = null; try { out = parseProbe(JSON.parse(ho.stdout || '{}')); } catch { out = null; }
      const shown = out ?? probe;
      // A light version for slow connections; skipped when the picture is already small (nothing to gain).
      let lqBytes: Buffer | null = null;
      if (Math.min(probe.w, probe.h) > 400 && probe.bitrate > 900_000) { const l = await exec(ffmpeg, lqArgs(inp, lq, probe)); if (l.code === 0) { const b = await readFile(lq); if (b.length < hqBytes.length * 0.85) lqBytes = b; } else log('could not make the 360p file', { id, err: l.stderr.slice(-300) }); }
      let posterBytes: Buffer | null = null; const po = await exec(ffmpeg, posterArgs(inp, poster, probe), { timeoutMs: 60_000 }); if (po.code === 0) posterBytes = await readFile(poster).catch(() => null);
      await d.store.put(biz, id, 'mp4', hqBytes);
      if (lqBytes) await d.store.put(biz, `${id}-lq`, 'mp4', lqBytes);
      if (posterBytes) await d.store.put(biz, `${id}-poster`, 'jpg', posterBytes);
      if (ext !== 'mp4') await d.store.remove(biz, id, ext).catch(() => undefined);
      return { mime: 'video/mp4', size: hqBytes.length, video: { state: 'ready', w: shown.w, h: shown.h, duration: Math.round((shown.duration || probe.duration) * 10) / 10, ...(lqBytes ? { lq: true } : {}), ...(posterBytes ? { poster: true } : {}), rev: Date.now() } };
    } finally { await rm(tmp, { recursive: true, force: true }).catch(() => undefined); }
  }

  async function drain() {
    if (running) return; running = true;
    try {
      for (let job = queue.shift(); job; job = queue.shift()) {
        waiting.delete(`${job.biz}/${job.id}`);
        let patch: Patch; try { patch = await work(job); } catch (e) { log('video processing failed', { id: job.id, err: String((e as Error)?.message ?? e).slice(0, 200) }); patch = { video: { state: 'failed', rev: Date.now() } }; }
        try { await d.onDone(job.biz, job.id, patch); } catch (e) { log('could not save the video result', { id: job.id, err: String((e as Error)?.message ?? e).slice(0, 200) }); }
      }
    } finally { running = false; const w = idle; idle = []; for (const f of w) f(); }
  }
  return {
    /** Queue a video; they are processed one at a time so the website stays fast. Safe to call again for the same video. */
    enqueue(job: Job) { const k = `${job.biz}/${job.id}`; if (waiting.has(k)) return; waiting.add(k); queue.push(job); void drain(); },
    available: isAvailable,
    /** Resolves when everything queued so far is done (for tests and shutdown). */
    whenIdle: () => new Promise<void>((resolve) => { if (!running && !queue.length) return resolve(); idle.push(resolve); }),
  };
}
export type VideoPipeline = ReturnType<typeof createVideoPipeline>;
