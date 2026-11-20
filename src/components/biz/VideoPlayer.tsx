import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Maximize2, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { useTx } from '../../biz/i18n';
import type { PublicMedia } from '../../biz/types';

/**
 * The video player of a business page, made to feel like Instagram and YouTube: a poster picture first, a frame that fits the video's real shape
 * (portrait, square or landscape) so the whole picture is always visible, steady playback from the 720p file (the 360p file on slow connections or after it stalls),
 * play only while it is on screen, one video at a time, a progress bar, sound and full screen.
 */
export type FrameKind = 'portrait' | 'square' | 'landscape';
/** The frame for a video of this shape. The whole video is always shown inside it ("contain"); a portrait video sits in a 4:5 frame at most, so a phone screen is never filled by one post. */
export function frameFor(w?: number, h?: number): { kind: FrameKind; aspect: number } {
  if (!w || !h || w <= 0 || h <= 0) return { kind: 'landscape', aspect: 16 / 9 };
  const r = w / h;
  if (r < 0.85) return { kind: 'portrait', aspect: Math.max(0.8, r) };
  if (r < 1.2) return { kind: 'square', aspect: 1 };
  return { kind: 'landscape', aspect: Math.min(1.91, r) };
}
type Quality = 'hq' | 'lq';
/** Which file to start with: the light one when the phone says the connection is slow or data saving is on. */
export function startQuality(hasLq: boolean, c?: { saveData?: boolean; effectiveType?: string; downlink?: number } | null): Quality {
  if (!hasLq || !c) return 'hq';
  return c.saveData || ['slow-2g', '2g', '3g'].includes(String(c.effectiveType)) || (typeof c.downlink === 'number' && c.downlink > 0 && c.downlink < 1.6) ? 'lq' : 'hq';
}
export function videoUrls(base: string, v?: PublicMedia['video']) {
  const r = v?.rev ? `r=${v.rev}` : ''; const q = (extra: string) => { const p = [extra, r].filter(Boolean).join('&'); return p ? `?${p}` : ''; };
  return { hq: `${base}${q('')}`, lq: v?.lq ? `${base}${q('q=lq')}` : null, poster: v?.poster ? `${base}/poster${q('')}` : null };
}
const clock = (s: number) => { const t = Math.max(0, Math.floor(s || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

/** Only one video plays at a time on a page. */
let playing: HTMLVideoElement | null = null;

export function VideoPlayer({ media, src, fill = false, autoPlay = true, startUnmuted = false, className = '' }: { media: PublicMedia; src: (id: string) => string; fill?: boolean; autoPlay?: boolean; startUnmuted?: boolean; className?: string }) {
  const tx = useTx();
  const info = media.video; const urls = useMemo(() => videoUrls(src(media.id), info), [src, media.id, info]);
  const box = useRef<HTMLDivElement>(null); const vid = useRef<HTMLVideoElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(info?.w && info.h ? { w: info.w, h: info.h } : null);
  const [q, setQ] = useState<Quality>(() => startQuality(!!urls.lq, typeof navigator !== 'undefined' ? (navigator as any).connection : null));
  const [paused, setPaused] = useState(true); const [muted, setMuted] = useState(!startUnmuted); const [t, setT] = useState(0); const [dur, setDur] = useState(info?.duration ?? 0); const [buf, setBuf] = useState(0);
  const [waiting, setWaiting] = useState(false); const [ended, setEnded] = useState(false); const [failed, setFailed] = useState(false); const [bars, setBars] = useState(true); const [light, setLight] = useState(false);
  const userPaused = useRef(false); const stalls = useRef<number[]>([]); const waitTimer = useRef(0); const hideTimer = useRef(0); const resume = useRef<{ t: number; play: boolean } | null>(null); const visible = useRef(false);
  const { kind, aspect } = frameFor(dims?.w, dims?.h);
  const src1 = q === 'lq' && urls.lq ? urls.lq : urls.hq;

  const showBars = useCallback(() => { setBars(true); window.clearTimeout(hideTimer.current); hideTimer.current = window.setTimeout(() => setBars(false), 2600); }, []);
  const toggle = useCallback(() => {
    const el = vid.current; if (!el) return; showBars();
    if (el.paused) { userPaused.current = false; if (ended) el.currentTime = 0; void el.play().catch(() => setPaused(true)); } else { userPaused.current = true; el.pause(); }
  }, [ended, showBars]);

  // Plays while at least 60% is on screen (muted, as phones require), stops when it leaves, and never fights a viewer who paused it.
  useEffect(() => {
    const el = box.current; if (!el || !autoPlay || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => {
      visible.current = e.intersectionRatio >= 0.6; const v = vid.current; if (!v) return;
      if (e.intersectionRatio >= 0.6 && !userPaused.current && v.paused && !v.ended) void v.play().catch(() => undefined);
      else if (e.intersectionRatio < 0.25 && !v.paused) v.pause();
    }, { threshold: [0, 0.25, 0.6, 1] });
    io.observe(el); return () => io.disconnect();
  }, [autoPlay]);
  useEffect(() => { if (startUnmuted && vid.current) { vid.current.muted = false; void vid.current.play().catch(() => { if (vid.current) { vid.current.muted = true; setMuted(true); void vid.current.play().catch(() => undefined); } }); } }, [startUnmuted]);
  useEffect(() => () => { window.clearTimeout(waitTimer.current); window.clearTimeout(hideTimer.current); if (playing === vid.current) playing = null; }, []);

  // A slow connection: after two stalls in twenty seconds, carry on from the same second with the light file.
  const stalled = () => {
    window.clearTimeout(waitTimer.current); waitTimer.current = window.setTimeout(() => setWaiting(true), 600);
    const now = Date.now(); stalls.current = [...stalls.current.filter((x) => now - x < 20_000), now];
    if (stalls.current.length >= 2 && q === 'hq' && urls.lq && vid.current) { resume.current = { t: vid.current.currentTime, play: !vid.current.paused }; setQ('lq'); setLight(true); window.setTimeout(() => setLight(false), 4000); stalls.current = []; }
  };
  const ready = () => { window.clearTimeout(waitTimer.current); setWaiting(false); };
  const onMeta = () => {
    const el = vid.current; if (!el) return; if (!dims && el.videoWidth) setDims({ w: el.videoWidth, h: el.videoHeight }); if (el.duration && Number.isFinite(el.duration)) setDur(el.duration);
    if (resume.current) { el.currentTime = resume.current.t; if (resume.current.play) void el.play().catch(() => undefined); resume.current = null; }
  };
  const onError = () => { if (q === 'hq' && urls.lq) { resume.current = { t: vid.current?.currentTime ?? 0, play: true }; setQ('lq'); } else setFailed(true); };
  const fullscreen = () => { const b = box.current as any; const v = vid.current as any; if (document.fullscreenElement) void document.exitFullscreen?.(); else if (b?.requestFullscreen) void b.requestFullscreen(); else v?.webkitEnterFullscreen?.(); };
  const key = (e: React.KeyboardEvent) => {
    const v = vid.current; if (!v) return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); } else if (e.key === 'ArrowRight') { v.currentTime = Math.min(dur || v.duration, v.currentTime + 5); showBars(); } else if (e.key === 'ArrowLeft') { v.currentTime = Math.max(0, v.currentTime - 5); showBars(); }
    else if (e.key === 'm') { v.muted = !v.muted; setMuted(v.muted); } else if (e.key === 'f') fullscreen();
  };

  if (info?.state === 'processing') return (
    <div className={`${fill ? 'absolute inset-0' : 'w-full'} flex flex-col items-center justify-center gap-2 bg-[#0B1420] px-6 text-center text-white ${className}`} style={fill ? undefined : { aspectRatio: '4 / 5' }} role="status">
      <Loader2 className="animate-spin" size={26} aria-hidden="true" /><p className="font-semibold">{tx('Preparing this video')}</p><p className="text-xs text-white/70">{tx('It will play smoothly in a minute.')}</p>
    </div>);

  return (
    <div ref={box} tabIndex={0} onKeyDown={key} onMouseMove={showBars} role="group" aria-label={media.caption || tx('Video')} data-frame={kind}
      className={`${fill ? 'absolute inset-0' : 'relative w-full'} group select-none overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-[var(--acc,#fff)] ${className}`} style={fill ? undefined : { aspectRatio: String(aspect), maxHeight: '85vh' }}>
      {/* the poster, enlarged and blurred, fills whatever the frame leaves empty around the video */}
      {urls.poster ? <img src={urls.poster} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-125 object-cover opacity-60 blur-2xl" /> : <div className="absolute inset-0 bg-gradient-to-br from-[#1b2635] to-black" aria-hidden="true" />}
      <video ref={vid} key={src1} src={src1} poster={urls.poster ?? undefined} muted={muted} playsInline preload={visible.current ? 'auto' : 'metadata'} disablePictureInPicture={false} aria-label={media.caption || tx('Video')}
        onLoadedMetadata={onMeta} onPlay={() => { setPaused(false); setEnded(false); if (playing && playing !== vid.current) playing.pause(); playing = vid.current; showBars(); }} onPause={() => { setPaused(true); setBars(true); }}
        onEnded={() => { setEnded(true); setPaused(true); setBars(true); }} onTimeUpdate={() => { const el = vid.current; if (!el) return; setT(el.currentTime); const b = el.buffered; setBuf(b.length ? b.end(b.length - 1) : 0); }}
        onWaiting={stalled} onPlaying={ready} onCanPlay={ready} onSeeked={ready} onError={onError} onClick={toggle} className="absolute inset-0 h-full w-full cursor-pointer object-contain" />
      {waiting && !paused && <div className="pointer-events-none absolute inset-0 flex items-center justify-center" role="status" aria-label={tx('Loading')}><span className="rounded-full bg-black/55 p-3"><Loader2 className="animate-spin text-white" size={26} /></span></div>}
      {(paused || ended) && !failed && <button type="button" onClick={toggle} aria-label={ended ? tx('Replay') : tx('Play')} className="absolute inset-0 flex items-center justify-center"><span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-sm transition group-hover:scale-105">{ended ? <RotateCcw size={28} /> : <Play size={30} className="ml-1" fill="currentColor" />}</span></button>}
      {failed && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 px-6 text-center text-white" role="alert"><p className="font-semibold">{tx('This video could not be played.')}</p><button type="button" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black" onClick={() => { setFailed(false); vid.current?.load(); }}>{tx('Try again')}</button></div>}
      {light && <p role="status" className="absolute left-3 top-3 rounded-full bg-black/65 px-3 py-1 text-xs text-white">{tx('Slow connection: using a lighter version.')}</p>}
      <button type="button" onClick={() => { const v = vid.current; if (!v) return; v.muted = !v.muted; setMuted(v.muted); showBars(); }} aria-label={muted ? tx('Unmute') : tx('Mute')} className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">{muted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
      <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-8 transition-opacity ${bars || paused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        <div className="relative h-5">
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/25"><div className="h-full rounded-full bg-white/40" style={{ width: `${dur ? Math.min(100, (buf / dur) * 100) : 0}%` }} /><div className="absolute left-0 top-0 h-full rounded-full bg-[var(--acc,#fff)]" style={{ width: `${dur ? Math.min(100, (t / dur) * 100) : 0}%` }} /></div>
          <input type="range" min={0} max={dur || 1} step={0.1} value={Math.min(t, dur || 1)} aria-label={tx('Seek')} onChange={(e) => { const v = vid.current; if (v) { v.currentTime = Number(e.target.value); setT(v.currentTime); showBars(); } }} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-white">
          <button type="button" onClick={toggle} aria-label={paused ? tx('Play') : tx('Pause')} className="flex h-7 w-7 items-center justify-center">{paused ? <Play size={16} fill="currentColor" /> : <Pause size={16} fill="currentColor" />}</button>
          <span className="tabular-nums">{clock(t)} / {clock(dur)}</span>
          <button type="button" onClick={fullscreen} aria-label={tx('Full screen')} className="ml-auto flex h-7 w-7 items-center justify-center"><Maximize2 size={15} /></button>
        </div>
      </div>
    </div>
  );
}

export default VideoPlayer;
