import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '../utils/authFetch';
import MySebPayPanel, { type Payment } from './MySebPayPanel';
import { WATCH_BATCH, WATCH_GAP_MS, gridQuality, startUpMs, type Quality } from '../utils/liveQuality';

/**
 * The live room: every student in a MySEB test or hand-in on one screen. A tile per student shows the camera picture (if you
 * asked for it), the question they are on, and what they did; Resume and End are on the tile. Nothing else to learn.
 */
type Status = 'IN_EXAM' | 'PAUSED' | 'LEFT' | 'ENDED';
type Source = 'camera' | 'screen' | 'both';
interface Alert { id: string; name: string; text: string; ended: boolean }
interface Student {
  id: string; student_name: string; status: Status; client_type: string; platform: string | null; violation_count: number;
  last_violation: string | null; pause_reason: string | null; end_reason: string | null; seen_ago: number;
  aside_seconds?: number; reinstated_count?: number; id_status?: string; has_partial?: boolean;
  live: { question: { index: number | null; total: number | null; label: string } | null; camera: string; screen_state?: string; frame: string | null; frame_age: number | null; screen?: string | null; screen_age?: number | null } | null;
}
interface Room { exam: { title: string; status: string; live_faces: boolean; live_mode?: 'off' | 'pictures' | 'live'; live_sound?: boolean; live_source?: Source; leave_action?: string; allow_web?: boolean; web_strict?: boolean; multi_face?: 'off' | 'warn' | 'end'; id_check?: boolean; web_devices?: 'any' | 'ios' }; counts: Record<Status, number>; students: Student[] }
interface AgentView { rules: { on: boolean; autoResume: boolean; afterSeconds: number; maxResumes: number; endAfterMax: boolean }; resumed: number; log: Array<{ at: string; kind: string; student?: string; text: string }> }
interface Code { display: string; qrSvg: string; expiresAt: string; joinUrl?: string }

const LABEL: Record<Status, string> = { IN_EXAM: 'In the test', PAUSED: 'Paused', LEFT: 'Left', ENDED: 'Finished' };
const TONE: Record<Status, string> = { IN_EXAM: 'bg-emerald-600', PAUSED: 'bg-amber-600', LEFT: 'bg-rose-600', ENDED: 'bg-slate-500' };
const RING: Record<Status, string> = { IN_EXAM: 'border-slate-200', PAUSED: 'border-amber-400 ring-2 ring-amber-200', LEFT: 'border-rose-400 ring-2 ring-rose-200', ENDED: 'border-slate-200 opacity-70' };
const WHY: Record<string, string> = {
  leave: 'Left the test screen', background: 'Left the app', blur: 'Switched window', heartbeat_lost: 'Lost connection', screenshot: 'Tried a screenshot',
  copy: 'Tried to copy', paste: 'Tried to paste', cut: 'Tried to cut', devtools: 'Opened developer tools', shortcut: 'Pressed a blocked key', close_attempt: 'Tried to close the app',
  extra_display: 'Second screen', forbidden_app: 'Remote or recording app', fullscreen_exit: 'Left full screen', split_screen: 'Split screen', screen_recording: 'Screen recording',
  id_refused: 'Student card refused', visibility_hidden: 'Hid the tab', screen_share_stopped: 'Stopped sharing the screen', token_misuse: 'Used the key from another place', teacher: 'Paused by you',
  face_missing: 'Face left the camera', camera_off: 'Turned the camera off', multiple_faces: 'More than one face', face_check_unavailable: 'Face check could not load',
};
const why = (k: string | null) => (k ? WHY[k] ?? k : '');

/* The live room is a dark "control room": pictures stand out, and the lecturer's eyes are not tired after an hour of watching. */
const FOCUS = 'touch-manipulation outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950';
const dBtn = `min-h-11 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-semibold text-slate-100 hover:bg-white/10 active:bg-white/15 disabled:opacity-40 md:min-h-10 md:px-3.5 ${FOCUS}`;
const dPrimary = `min-h-11 rounded-xl bg-blue-500 px-4 text-sm font-bold text-white hover:bg-blue-400 active:bg-blue-600 disabled:opacity-40 md:min-h-10 ${FOCUS}`;
const dDanger = `min-h-11 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white hover:bg-rose-500 active:bg-rose-700 disabled:opacity-40 md:min-h-10 md:px-3.5 ${FOCUS}`;
const dSelect = 'min-h-11 w-full min-w-0 truncate rounded-lg border border-white/15 bg-slate-800 px-2.5 text-base font-semibold text-slate-100 outline-none focus:border-blue-400 md:min-h-9 md:text-sm';
const RING_D: Record<Status, string> = { IN_EXAM: 'border-slate-800', PAUSED: 'border-amber-500/70 ring-2 ring-amber-500/25', LEFT: 'border-rose-500/70 ring-2 ring-rose-500/25', ENDED: 'border-slate-800 opacity-60' };
const SHORT: Record<Status, string> = { IN_EXAM: 'In test', PAUSED: 'Paused', LEFT: 'Left', ENDED: 'Done' };
const DOT: Record<Status, string> = { IN_EXAM: 'bg-emerald-400', PAUSED: 'bg-amber-400', LEFT: 'bg-rose-400', ENDED: 'bg-slate-400' };

/** True while the screen matches the query (for example a phone). Layout that CSS alone cannot switch, such as where the settings live. */
function useMedia(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(query); const f = () => setOn(m.matches); f();
    m.addEventListener('change', f); return () => m.removeEventListener('change', f);
  }, [query]);
  return on;
}

/** A panel that slides up from the bottom on a phone (easy to reach with a thumb) and is a centred dialog on a bigger screen. */
function Sheet({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={onClose}>
      <div className={`flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-slate-900 text-slate-100 shadow-2xl sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-xl'}`} onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 border-b border-white/10 px-4 pb-3 pt-2.5">
          <span aria-hidden className="mx-auto mb-2 block h-1 w-10 rounded-full bg-white/20 sm:hidden" />
          <div className="flex items-center justify-between gap-3"><h2 className="min-w-0 truncate text-base font-bold">{title}</h2><button type="button" className={`${dBtn} !min-h-10 shrink-0`} onClick={onClose}>Close</button></div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

function Setting({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <p className="text-[12px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-1.5">{children}</div>
      <p className="mt-1.5 text-[12px] leading-snug text-slate-500">{hint}</p>
    </div>
  );
}

const btn = 'min-h-10 rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40';
const btnDark = 'min-h-10 rounded-xl bg-slate-900 px-3.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40';


/**
 * Live video. Each student's browser sends one small video stream straight to this browser (WebRTC); our servers only pass the
 * set-up messages. Only the tiles on screen (up to the number chosen in Settings, at most 500) connect, so a class of hundreds is fine: everyone else shows the
 * small picture. Sound is silent until you press Listen on one tile, so you hear one student at a time.
 */
function useLiveViewers(base: string, enabled: boolean, wanted: string[], listen: string | null, focus: string | null) {
  const [streams, setStreams] = useState<Record<string, MediaStream>>({});
  const [screens, setScreens] = useState<Record<string, MediaStream>>({});
  const screenIds = useRef(new Map<string, string>());   // which of a student's streams is their screen (the student says so in the offer)
  const [tick, setTick] = useState(0);
  const viewer = useRef('v' + Math.random().toString(36).slice(2, 8));
  const pcs = useRef(new Map<string, RTCPeerConnection>());
  const requested = useRef(new Set<string>());
  const pending = useRef(new Map<string, RTCIceCandidateInit[]>());
  const wantedRef = useRef(new Set<string>());
  const iceRef = useRef<RTCIceServer[] | null>(null);
  const listening = useRef<string | null>(null);
  const focused = useRef<string | null>(null);   // the student being zoomed in on gets the full-quality picture
  wantedRef.current = new Set(wanted);
  const grid: Quality = gridQuality(wanted.length);   // beyond 48 live students the grid pictures are tiny
  const gridRef = useRef<Quality>(grid); gridRef.current = grid;

  const post = useCallback((sid: string, msg: Record<string, unknown>) =>
    authFetch(`${base}/signal/${sid}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msg: { ...msg, viewer: viewer.current } }) }).catch(() => undefined), [base]);
  const drop = useCallback((sid: string) => {
    pcs.current.get(sid)?.close(); pcs.current.delete(sid); requested.current.delete(sid); pending.current.delete(sid);
    setStreams((s) => { if (!(sid in s)) return s; const n = { ...s }; delete n[sid]; return n; });
    setScreens((s) => { if (!(sid in s)) return s; const n = { ...s }; delete n[sid]; return n; });
    screenIds.current.delete(sid);
  }, []);

  // Messages from students (offers and network candidates), by long poll.
  useEffect(() => {
    if (!enabled) return;
    let stopped = false; const ac = new AbortController();
    const ice = async () => { if (!iceRef.current) { try { iceRef.current = (await (await authFetch(`${base}/ice`)).json()).iceServers ?? []; } catch { iceRef.current = []; } } return iceRef.current!; };
    const onMsg = async (m: any) => {
      if (m.viewer && m.viewer !== viewer.current) return;
      const sid = String(m.sid);
      if (m.type === 'offer' && wantedRef.current.has(sid)) {
        pcs.current.get(sid)?.close();
        const pc = new RTCPeerConnection({ iceServers: await ice() });
        pcs.current.set(sid, pc);
        if (m.screenStream) screenIds.current.set(sid, String(m.screenStream)); else screenIds.current.delete(sid);
        pc.ontrack = (e) => { const st = e.streams[0]; if (!st) return; if (screenIds.current.get(sid) === st.id) setScreens((s) => ({ ...s, [sid]: st })); else setStreams((s) => ({ ...s, [sid]: st })); };
        pc.onicecandidate = (e) => { if (e.candidate) void post(sid, { type: 'ice', candidate: e.candidate.toJSON() }); };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { if (pcs.current.get(sid) === pc) { drop(sid); setTick((t) => t + 1); } }
          else if (pc.connectionState === 'disconnected') setTimeout(() => { if (pcs.current.get(sid) === pc && pc.connectionState !== 'connected') { drop(sid); setTick((t) => t + 1); } }, 6000);
        };
        await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
        for (const c of pending.current.get(sid) ?? []) await pc.addIceCandidate(c).catch(() => undefined);
        pending.current.delete(sid);
        await pc.setLocalDescription(await pc.createAnswer());
        void post(sid, { type: 'answer', sdp: pc.localDescription?.sdp });
        if (listening.current === sid) void post(sid, { type: 'listen', on: true });
        if (focused.current === sid) void post(sid, { type: 'quality', level: 'high' });
        else if (gridRef.current === 'tiny') void post(sid, { type: 'quality', level: 'tiny' });
      } else if (m.type === 'ice' && m.candidate) {
        const pc = pcs.current.get(sid);
        if (pc?.remoteDescription) await pc.addIceCandidate(m.candidate).catch(() => undefined);
        else pending.current.set(sid, [...(pending.current.get(sid) ?? []), m.candidate]);
      }
    };
    (async () => {
      let after = 0;
      while (!stopped) {
        try {
          const r = await authFetch(`${base}/signal?after=${after}`, { signal: ac.signal });
          if (!r.ok) { await new Promise((x) => setTimeout(x, 3000)); continue; }
          const b = await r.json(); after = b.next ?? after;
          for (const m of b.msgs ?? []) await onMsg(m).catch(() => undefined);
        } catch { if (stopped) return; await new Promise((x) => setTimeout(x, 2000)); }
      }
    })();
    return () => { stopped = true; ac.abort(); };
  }, [base, enabled, post, drop]);

  // Ask the students on screen to start, and the others to stop. New students are asked in small groups with a short pause: with hundreds
  // on screen, asking everyone in the same second would flood the room's set-up channel and the lecturer's own computer.
  const key = wanted.join(',');
  useEffect(() => {
    if (!enabled) { [...requested.current].forEach((sid) => { void post(sid, { type: 'unwatch' }); drop(sid); }); return; }
    for (const sid of [...requested.current]) if (!wantedRef.current.has(sid)) { void post(sid, { type: 'unwatch' }); drop(sid); }
    const fresh = wanted.filter((sid) => !requested.current.has(sid));
    let i = 0; let batch: number | undefined;
    const next = () => {
      for (const sid of fresh.slice(i, i + WATCH_BATCH)) if (wantedRef.current.has(sid) && !requested.current.has(sid)) { requested.current.add(sid); void post(sid, { type: 'watch' }); }
      i += WATCH_BATCH;
      if (i < fresh.length) batch = window.setTimeout(next, WATCH_GAP_MS);
    };
    if (fresh.length) next();
    // a student whose stream never arrived (page reloaded, camera asked again) is asked again after a while (longer when many are starting)
    const t = setTimeout(() => { for (const sid of wanted) if (!pcs.current.has(sid)) { requested.current.delete(sid); setTick((x) => x + 1); } }, 12000 + startUpMs(fresh.length));
    return () => { clearTimeout(t); if (batch) clearTimeout(batch); };
  }, [enabled, key, tick, post, drop]); // eslint-disable-line react-hooks/exhaustive-deps

  // The grid gets lighter (or heavier again) when the number of live students crosses the line.
  useEffect(() => { for (const sid of pcs.current.keys()) if (focused.current !== sid) void post(sid, { type: 'quality', level: grid }); }, [grid, post]);

  // Zoom: the student in focus is sent at full size; the one you leave goes back to the light picture.
  useEffect(() => {
    const prev = focused.current;
    if (prev && prev !== focus) void post(prev, { type: 'quality', level: gridRef.current });
    focused.current = focus;
    if (focus) void post(focus, { type: 'quality', level: 'high' });
  }, [focus, post]);

  // Sound: one student at a time.
  useEffect(() => {
    const prev = listening.current;
    if (prev && prev !== listen) void post(prev, { type: 'listen', on: false });
    listening.current = listen;
    if (listen) void post(listen, { type: 'listen', on: true });
  }, [listen, post]);

  useEffect(() => () => { pcs.current.forEach((pc) => pc.close()); [...requested.current].forEach((sid) => void post(sid, { type: 'unwatch' })); if (listening.current) void post(listening.current, { type: 'listen', on: false }); }, [post]);
  return { streams, screens };
}

/**
 * Instant updates: the server keeps one stream open and says "something changed" the moment a student joins, leaves, breaks a rule or
 * moves to another question; the room then asks for the fresh list at once. If the stream is not available the room falls back to
 * checking on a timer, so it keeps working either way. Returns whether the stream is connected.
 */
function useRoomEvents(base: string, onChange: () => void, roomSize: number): boolean {
  const [connected, setConnected] = useState(false);
  const cb = useRef(onChange); cb.current = onChange;
  const size = useRef(roomSize); size.current = roomSize;
  useEffect(() => {
    let stopped = false, wait = 1000, timer = 0, pending = false;
    const ac = new AbortController();
    const kick = () => { if (pending) return; pending = true; timer = window.setTimeout(() => { pending = false; cb.current(); }, Math.min(1000, 120 + size.current * 0.5)); };   // a burst becomes one refresh; a big room refreshes a little less often so the list is not downloaded over and over
    (async () => {
      while (!stopped) {
        let idle = wait;
        try {
          const r = await authFetch(`${base}/events`, { signal: ac.signal, headers: { Accept: 'text/event-stream' } });
          if (!r.ok || !r.body || r.status === 204) idle = r.status === 204 ? 5000 : Math.min(30_000, (wait *= 2));
          else {
            setConnected(true); wait = 1000;
            const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
            for (;;) {
              const { done, value } = await reader.read(); if (done) break;
              buf += dec.decode(value, { stream: true });
              let i: number;
              while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); if (chunk.includes('data:')) kick(); }
            }
          }
        } catch { if (stopped) return; idle = Math.min(30_000, (wait *= 2)); }
        setConnected(false);
        await new Promise((x) => setTimeout(x, idle));
      }
    })();
    return () => { stopped = true; ac.abort(); window.clearTimeout(timer); };
  }, [base]);
  return connected;
}

function LiveVideo({ stream, muted, mirror = true, fit = 'object-cover' }: { stream: MediaStream; muted: boolean; mirror?: boolean; fit?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={`h-full w-full ${mirror ? '-scale-x-100' : ''} ${fit}`} />;
}

/**
 * One student, large. Their screen fills the window in full quality (their computer is told to send it at full size only while you
 * look), their face is in the corner. Zoom in further with + / − to read small text; scroll or drag the picture to move around.
 */
function ZoomView(p: {
  student: Student; screen: MediaStream | null; camera: MediaStream | null; screenPic: string | null; cameraPic: string | null; live: boolean; source: Source;
  busy: boolean; listening: boolean; canListen: boolean; onListen: () => void; onResume: () => void; onEnd: () => void; onLive: () => void; onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose(); else if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(4, z + 0.5)); else if (e.key === '-') setZoom((z) => Math.max(1, z - 0.5)); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [p.onClose]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = p.student;
  const wantsScreen = p.source !== 'camera' && (p.screen || p.screenPic);
  const q = s.live?.question;
  const hd = p.live && (p.screen || p.camera);
  const zb = 'min-h-11 shrink-0 rounded-lg bg-white/10 px-3.5 text-xs font-semibold hover:bg-white/20 active:bg-white/25 disabled:opacity-40 md:min-h-9 ' + FOCUS;
  return (
    <div role="dialog" aria-label={`${s.student_name}, zoomed in`} className="fixed inset-0 z-40 flex flex-col bg-slate-950 text-white">
      <div className="shrink-0 border-b border-white/10 bg-slate-950/95 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-2 px-3 py-2.5 md:px-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{s.student_name}</p>
            <p className="truncate text-xs text-slate-400">{q ? `${q.index ? `Question ${q.index}${q.total ? ` of ${q.total}` : ''}` : ''}${q.label ? `${q.index ? ' · ' : ''}${q.label}` : ''}` : 'Not started'}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${TONE[s.status]}`}>{LABEL[s.status]}</span>
          {hd ? <span className="hidden shrink-0 rounded-full bg-emerald-600 px-2.5 py-0.5 text-[11px] font-bold sm:inline">HD live</span> : <span className="hidden shrink-0 rounded-full bg-slate-700 px-2.5 py-0.5 text-[11px] font-bold sm:inline">Small picture</span>}
          <button type="button" onClick={p.onClose} aria-label="Close" className={`${zb} !px-4`}>Close<span className="hidden md:inline"> (Esc)</span></button>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto px-3 pb-2.5 md:px-4 [scrollbar-width:none]">
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Zoom">
            <button type="button" aria-label="Zoom out" className={`${zb} w-11 !px-0 text-lg font-bold`} disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z - 0.5))}>−</button>
            <span className="w-12 text-center text-xs font-semibold tabular-nums">{Math.round(zoom * 100)}%</span>
            <button type="button" aria-label="Zoom in" className={`${zb} w-11 !px-0 text-lg font-bold`} disabled={zoom >= 4} onClick={() => setZoom((z) => Math.min(4, z + 0.5))}>+</button>
          </div>
          {(s.status === 'PAUSED' || s.status === 'LEFT') && <button type="button" disabled={p.busy} onClick={p.onResume} className={`${zb} !bg-blue-500 font-bold hover:!bg-blue-400`}>Resume</button>}
          {p.canListen && <button type="button" onClick={p.onListen} className={zb}>{p.listening ? 'Stop listening' : 'Listen'}</button>}
          {s.status !== 'ENDED' && <button type="button" disabled={p.busy} onClick={p.onEnd} className={`${zb} !bg-rose-600 font-bold hover:!bg-rose-700`}>End test</button>}
        </div>
      </div>
      {!p.live && <p className="bg-amber-500/15 px-4 py-2 text-xs text-amber-200">Small picture, refreshed every few seconds. For a sharp, moving picture, <button type="button" className="font-bold underline" onClick={p.onLive}>switch to Live video</button>.</p>}
      <div ref={box} className="relative flex min-h-0 flex-1 overflow-auto overscroll-contain">
        <div style={{ width: `${zoom * 100}%`, aspectRatio: wantsScreen ? '16 / 9' : '4 / 3', maxWidth: zoom === 1 ? '100%' : undefined, maxHeight: zoom === 1 ? '100%' : undefined, margin: 'auto', flex: 'none' }} className="relative">
          {wantsScreen ? (p.screen ? <LiveVideo stream={p.screen} muted mirror={false} fit="object-contain" /> : <img src={p.screenPic ?? ''} alt={`Screen: ${s.student_name}`} className="h-full w-full object-contain" />)
            : p.camera ? <LiveVideo stream={p.camera} muted={!p.listening} /> : p.cameraPic ? <img src={p.cameraPic} alt={`Camera: ${s.student_name}`} className="h-full w-full -scale-x-100 object-contain" />
            : <div className="flex h-full items-center justify-center text-sm text-slate-400">No picture yet</div>}
        </div>
        {wantsScreen && p.source === 'both' && (p.camera || p.cameraPic) && (
          <div className="pointer-events-none absolute bottom-3 right-3 h-24 w-32 overflow-hidden rounded-xl border-2 border-white shadow-xl sm:h-40 sm:w-52">
            {p.camera ? <LiveVideo stream={p.camera} muted={!p.listening} /> : <img src={p.cameraPic ?? ''} alt="" className="h-full w-full -scale-x-100 object-cover" />}
          </div>
        )}
      </div>
    </div>
  );
}

export default function LiveRoom({ kind, id, onBack }: { kind: 'form' | 'task'; id: string; onBack: () => void }) {
  const base = `${kind === 'form' ? '/api/forms' : '/api/assignments'}/${encodeURIComponent(id)}/myseb`;
  const [room, setRoom] = useState<Room | null>(null);
  const [err, setErr] = useState('');
  const [code, setCode] = useState<Code | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [filter, setFilter] = useState<'all' | 'attention' | 'testing'>('all');
  const [query, setQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agent, setAgent] = useState<AgentView | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pay, setPay] = useState<Payment | null>(null);
  const [saved, setSaved] = useState<{ name: string; at: string | null; rows: Array<{ q: string; a: string }> } | null>(null);
  const [log, setLog] = useState<{ name: string; rows: Array<{ id: number; type: string; created_at: string }> } | null>(null);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [listen, setListen] = useState<string | null>(null);
  const [pics, setPics] = useState<Record<string, { frame: string | null; age: number | null; screen?: string | null; screen_age?: number | null }>>({});
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [focus, setFocus] = useState<string | null>(null);   // zoomed-in student
  const LIVE_CHOICES = [12, 24, 48, 100, 250, 500];
  const stored = (k: string, d: string) => { try { return localStorage.getItem(`liveroom.${k}`) ?? d; } catch { return d; } };
  const [maxLive, setMaxLiveState] = useState<number>(() => LIVE_CHOICES.includes(Number(stored('maxLive', '24'))) ? Number(stored('maxLive', '24')) : 24);
  const [tileSize, setTileSizeState] = useState<'XS' | 'S' | 'M' | 'L'>(() => (['XS', 'S', 'M', 'L'].includes(stored('size', 'M')) ? (stored('size', 'M') as 'XS' | 'S' | 'M' | 'L') : 'M'));
  const remember = (k: string, v: string) => { try { localStorage.setItem(`liveroom.${k}`, v); } catch { /* a private window: fine */ } };
  const setMaxLive = (n: number) => { setMaxLiveState(n); remember('maxLive', String(n)); };
  const setTileSize = (v: 'XS' | 'S' | 'M' | 'L') => { setTileSizeState(v); remember('size', v); };
  const seen = useRef<Map<string, { v: number; st: Status }> | null>(null);

  const call = useCallback(async (path: string, method = 'GET', body?: unknown) => {
    const r = await authFetch(`${base}${path}`, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(b.error || 'Something went wrong.'), { payment: b.payment as Payment | undefined, code: b.code as string | undefined });
    return b;
  }, [base]);

  const refresh = useCallback(() => { call('/monitor?frames=0').then((b) => { setRoom(b); setErr(''); }).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load.')); }, [call]);
  // Instant updates arrive on their own stream; the timer is only a safety net (slower while the stream is connected, quick if it is not).
  const connected = useRoomEvents(base, refresh, room?.students.length ?? 0);
  const every = connected ? 10_000 : (room?.students.length ?? 0) > 200 ? 4000 : 2000;
  useEffect(() => { document.title = 'Live room · Bwenge'; refresh(); const t = setInterval(refresh, every); return () => clearInterval(t); }, [refresh, every]);

  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); refresh(); } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong.'); } finally { setBusy(false); } };
  const downloadReport = () => act(async () => {
    const r = await authFetch(`${base}/report.xlsx`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not make the report.');
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a'); a.href = url; a.download = `${room?.exam?.title ?? 'Test'} MySEB report.xlsx`; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  // MySEB is sold: without a plan or a test credit the server answers 402 with how to pay, and the payment panel opens instead of an error.
  const makeCode = () => act(async () => {
    try { setCode(await call('/code', 'POST')); setShowCode(true); setPay(null); } catch (e) { const p = (e as { payment?: Payment }).payment; if (p) setPay(p); else throw e; }
  });
  const students = room?.students ?? [];
  // The room assistant (rules and what it did). Read with every refresh while it is on or its panel is open; one small read.
  useEffect(() => {
    if (!room || (agent && !agent.rules.on && !agentOpen)) return;
    let live = true;
    call('/agent').then((b) => { if (live && b?.data) setAgent(b.data); }).catch(() => undefined);
    return () => { live = false; };
  }, [room, call]); // eslint-disable-line react-hooks/exhaustive-deps
  const setRules = (patch: Partial<AgentView['rules']>) => act(async () => { const b = await call('/agent', 'PUT', patch); if (b?.data) setAgent(b.data); });
  // Student cards waiting for a look (browsers, when the card check is on). Fetched only while someone is waiting; each picture is deleted at the decision.
  const [idq, setIdq] = useState<Array<{ id: string; student_name: string; image: string }>>([]);
  const waitingIds = students.filter((s) => s.id_status === 'pending' && s.status !== 'ENDED').map((s) => s.id).join(',');
  useEffect(() => {
    if (!waitingIds) { setIdq([]); return; }
    let live = true;
    call('/id-checks').then((b) => { if (live) setIdq(b.pending ?? []); }).catch(() => undefined);
    return () => { live = false; };
  }, [waitingIds, call]);
  const decideId = (sid: string, allow: boolean) => act(async () => { await call(`/sessions/${sid}/id-decision`, 'POST', { allow }); setIdq((c) => c.filter((x) => x.id !== sid)); });
  const needs = (s: Student) => s.status === 'PAUSED' || s.status === 'LEFT' || s.live?.camera === 'denied' || s.live?.camera === 'busy' || s.live?.screen_state === 'denied' || s.live?.screen_state === 'partial';
  const shown = [...students].filter((s) => (filter === 'all' || (filter === 'attention' ? needs(s) : s.status === 'IN_EXAM')) && (!query.trim() || s.student_name.toLowerCase().includes(query.trim().toLowerCase()))).sort((a, b) => Number(needs(b)) - Number(needs(a)) || a.student_name.localeCompare(b.student_name));
  const attention = students.filter(needs).length;
  const open = room?.exam?.status !== 'ended';
  const mode = room?.exam?.live_mode ?? (room?.exam?.live_faces ? 'pictures' : 'off');
  const sound = !!room?.exam?.live_sound && mode === 'live';
  const source: Source = room?.exam?.live_source ?? 'camera';
  const showScreen = mode !== 'off' && source !== 'camera';
  const leaveAction = room?.exam?.leave_action ?? 'pause';
  // Who gets live video: the tiles on screen (needs-attention first), up to the number chosen in Settings, plus the one you listen to.
  const wanted = useMemo(() => {
    if (mode !== 'live') return [];
    const ids = shown.filter((s) => (s.status === 'IN_EXAM' || s.status === 'PAUSED') && visible.has(s.id)).map((s) => s.id).slice(0, maxLive);
    if (listen && !ids.includes(listen)) ids.push(listen);
    if (focus && !ids.includes(focus)) ids.push(focus);
    return ids;
  }, [mode, shown, visible, listen, focus, maxLive]);
  // Pictures only for the tiles on screen, so a big room does not download everyone's picture every few seconds.
  const picKey = [...new Set([...visible, ...(focus ? [focus] : [])])].slice(0, 60).sort().join(',');
  useEffect(() => {
    if (mode === 'off' || !picKey) { setPics({}); return; }
    let stop = false;
    const get = () => call(`/frames?ids=${picKey}`).then((b) => { if (!stop) setPics(b.frames ?? {}); }).catch(() => undefined);
    void get(); const t = setInterval(get, 5000);
    return () => { stop = true; clearInterval(t); };
  }, [mode, picKey, call]);
  const { streams, screens } = useLiveViewers(base, mode === 'live', wanted, sound ? listen : null, focus);

  // A student who leaves the test, or whose quiz was closed by the rule, appears at the top with a one-click End. Short beep and a flashing tab title.
  useEffect(() => {
    const prev = seen.current;
    seen.current = new Map(students.map((s) => [s.id, { v: s.violation_count, st: s.status }]));
    if (!prev) return;
    const fresh: Alert[] = [];
    for (const s of students) {
      const p = prev.get(s.id);
      if ((s.status === 'PAUSED' || s.status === 'LEFT') && (!p || p.st === 'IN_EXAM' || s.violation_count > p.v)) fresh.push({ id: s.id, name: s.student_name, text: why(s.pause_reason ?? s.last_violation) || 'Left the test', ended: false });
      else if (s.status === 'ENDED' && p && p.st !== 'ENDED' && !['teacher', 'time_up', 'student_exit'].includes(s.end_reason ?? '')) fresh.push({ id: s.id, name: s.student_name, text: `${why(s.end_reason) || 'Left the test'}: the test was closed automatically`, ended: true });
    }
    setAlerts((cur) => {
      const live = cur.filter((a) => { const st = students.find((x) => x.id === a.id); return st && (a.ended ? true : st.status === 'PAUSED' || st.status === 'LEFT'); });
      return [...live.filter((a) => !fresh.some((f) => f.id === a.id)), ...fresh];
    });
    if (fresh.length) {
      try { const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; const c = new AC(); const o = c.createOscillator(); const g = c.createGain(); o.frequency.value = 880; g.gain.value = 0.12; o.connect(g); g.connect(c.destination); o.start(); window.setTimeout(() => { o.stop(); void c.close(); }, 300); } catch { /* sound is a bonus */ }
      let on = true, n = 0; const title = document.title; const t = window.setInterval(() => { document.title = on ? `(!) ${fresh[0].name} left` : title; on = !on; if (++n > 8) { window.clearInterval(t); document.title = title; } }, 700);
    }
  }, [students]);
  const observer = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    observer.current = new IntersectionObserver((entries) => setVisible((cur) => { const n = new Set(cur); for (const e of entries) { const id = (e.target as HTMLElement).dataset.sid!; if (e.isIntersecting) n.add(id); else n.delete(id); } return n; }), { rootMargin: '120px' });
    return () => observer.current?.disconnect();
  }, []);
  const watchTile = useCallback((el: HTMLElement | null) => { if (el) observer.current?.observe(el); }, []);
  useEffect(() => { if (listen && (!sound || !streams[listen])) { if (!sound) setListen(null); } }, [sound, listen, streams]);

  const chips: Array<[Status, string]> = [['IN_EXAM', 'In the test'], ['PAUSED', 'Paused'], ['LEFT', 'Left'], ['ENDED', 'Finished']];
  const watching = Object.keys(streams).length + Object.keys(screens).length;
  const isPhone = useMedia('(max-width: 767px)');
  const [moreOpen, setMoreOpen] = useState(false);
  const [view, setView] = useState<'room' | 'needs'>('room');
  const post = (extra: Record<string, unknown>) => act(() => call('/settings', 'POST', { liveMode: mode, liveSound: sound, liveSource: source, leaveAction, ...extra }));
  const endAll = () => { if (confirm('End the test for everyone? The code stops working.')) void act(() => call('/end', 'POST')); };
  const codeLabel = code ? (showCode ? 'Hide code' : 'Show code') : 'Get code for students';
  const onCode = () => (code ? setShowCode((v) => !v) : void makeCode());
  const dense = tileSize === 'XS';   // tiny tiles: the picture and the name only (everything else is one tap away in the zoom view)
  const tileMin = isPhone ? 0 : tileSize === 'XS' ? 92 : tileSize === 'S' ? 140 : tileSize === 'L' ? 300 : 175;
  const columns = isPhone ? `repeat(${tileSize === 'L' ? 1 : tileSize === 'XS' ? 3 : 2},minmax(0,1fr))` : `repeat(auto-fill,minmax(${tileMin}px,1fr))`;
  const tab = (k: typeof filter) => `min-h-11 flex-1 whitespace-nowrap px-3 text-sm font-semibold md:min-h-10 md:flex-none md:px-3.5 ${FOCUS} ${filter === k ? (k === 'attention' ? 'bg-amber-500 text-slate-950' : 'bg-white text-slate-950') : 'bg-white/5 text-slate-200 hover:bg-white/10'}`;

  /* The settings are the same on every screen: a panel under the header on a computer, a sheet from the bottom on a phone. */
  const settingsBody = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <Setting label="Show" hint="What each student shares with you.">
        <select className={dSelect} style={{ colorScheme: 'dark' }} aria-label="Show" value={source} disabled={busy || !open} onChange={(e) => act(() => call('/settings', 'POST', { liveMode: mode === 'off' ? 'pictures' : mode, liveSound: sound, liveSource: e.target.value, leaveAction }))}>
          <option value="camera">Face</option><option value="screen">Screen</option><option value="both">Face and screen</option>
        </select>
      </Setting>
      <Setting label="View" hint="Live video moves smoothly; pictures refresh every few seconds and use much less internet.">
        <select className={dSelect} style={{ colorScheme: 'dark' }} aria-label="View" value={mode} disabled={busy || !open} onChange={(e) => act(() => call('/settings', 'POST', { liveMode: e.target.value, liveSound: sound, liveSource: source, leaveAction }))}>
          <option value="off">Off</option><option value="pictures">Pictures (every 10 s)</option><option value="live">Live video</option>
        </select>
      </Setting>
      <Setting label="If a student leaves" hint="When a student switches window or stops sharing the screen.">
        <select className={dSelect} style={{ colorScheme: 'dark' }} aria-label="If a student leaves" value={leaveAction} disabled={busy || !open} onChange={(e) => void post({ leaveAction: e.target.value })}>
          <option value="record">Only record it</option><option value="pause">Pause them</option><option value="pause_then_end">Pause, then end the second time</option><option value="end">End their test at once</option>
        </select>
      </Setting>
      <Setting label="Tile size" hint="Small tiles fit a big class on one screen.">
        <select className={dSelect} style={{ colorScheme: 'dark' }} aria-label="Tile size" value={tileSize} onChange={(e) => setTileSize(e.target.value as 'XS' | 'S' | 'M' | 'L')}>
          <option value="XS">Tiny (fits hundreds)</option><option value="S">Small</option><option value="M">Medium</option><option value="L">Large</option>
        </select>
      </Setting>
      <Setting label="Live at once" hint={maxLive > 48 ? 'Only the tiles on screen are live, so scroll to see more. Over 48 the pictures are tiny and need a strong computer (Chrome on a laptop with 16 GB and a wired connection). If the page gets slow, choose fewer, or set View to Pictures.' : 'How many students move live. Tap one to zoom in at full quality. More needs a stronger device.'}>
        <select className={dSelect} style={{ colorScheme: 'dark' }} aria-label="Live at once" value={maxLive} disabled={mode !== 'live'} onChange={(e) => setMaxLive(Number(e.target.value))}>
          {LIVE_CHOICES.map((n) => <option key={n} value={n}>{n} students</option>)}
        </select>
      </Setting>
      <Setting label="Browsers" hint="Lets students without the app (for example on an iPhone) take the test in their browser. It cannot lock their device, only watch it.">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold md:min-h-9">
          <input type="checkbox" className="h-5 w-5 accent-blue-500" checked={!!room?.exam?.allow_web} disabled={busy || !open} onChange={(e) => void post({ allowWeb: e.target.checked })} />
          Allow browsers
        </label>
      </Setting>
      <Setting label="Browsers on" hint="Which devices may use the browser. iPhone and iPad only: laptops and Android phones must use the MySEB app (a device can claim to be an iPhone, so this stops ordinary students, not a determined one).">
        <select className={dSelect} style={{ colorScheme: 'dark' }} aria-label="Browsers on" value={room?.exam?.web_devices ?? 'any'} disabled={busy || !open || !room?.exam?.allow_web} onChange={(e) => void post({ webDevices: e.target.value })}>
          <option value="any">Any device</option><option value="ios">iPhone and iPad only</option>
        </select>
      </Setting>
      <Setting label="Browser rules" hint="Strict (recommended): a student in a browser is rejected at once if they leave the page, close the tab, turn the camera off or their face leaves the camera. They get one attempt. Gentler: your 'If a student leaves' rule applies.">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold md:min-h-9">
          <input type="checkbox" className="h-5 w-5 accent-blue-500" checked={room?.exam?.web_strict !== false} disabled={busy || !open || !room?.exam?.allow_web} onChange={(e) => void post({ webStrict: e.target.checked })} />
          Strict for browsers
        </label>
      </Setting>
      <Setting label="Faces in the camera" hint="Browsers only. If more than one person is in the camera: do nothing, warn the student (recorded), or disqualify them after 5 seconds.">
        <select className={dSelect} style={{ colorScheme: 'dark' }} aria-label="Faces in the camera" value={room?.exam?.multi_face ?? 'warn'} disabled={busy || !open || !room?.exam?.allow_web} onChange={(e) => void post({ multiFace: e.target.value })}>
          <option value="off">Ignore</option><option value="warn">Warn and record</option><option value="end">Disqualify</option>
        </select>
      </Setting>
      <Setting label="Student card" hint="Browsers only. Before the test opens, each student shows their student card to the camera and you let them in or refuse. You see one picture, and it is deleted when you decide.">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold md:min-h-9">
          <input type="checkbox" className="h-5 w-5 accent-blue-500" checked={!!room?.exam?.id_check} disabled={busy || !open || !room?.exam?.allow_web} onChange={(e) => void post({ idCheck: e.target.checked })} />
          Check the student card
        </label>
      </Setting>
      <Setting label="Listening" hint="Lets you hear one student at a time. They see a notice while you do.">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold md:min-h-9">
          <input type="checkbox" className="h-5 w-5 accent-blue-500" checked={sound} disabled={busy || !open || mode !== 'live' || source === 'screen'} onChange={(e) => act(() => call('/settings', 'POST', { liveMode: 'live', liveSound: e.target.checked, liveSource: source, leaveAction }))} />
          Allow listening
        </label>
      </Setting>
    </div>
  );

  const needsCount = alerts.length + idq.length;
  const menu: Array<{ label: string; hint?: string; onClick: () => void; disabled?: boolean; danger?: boolean }> = [
    { label: 'Pause everyone', hint: 'Stops every student until you let them continue', disabled: busy || !open, onClick: () => void act(() => call('/pause-all', 'POST')) },
    { label: 'Let everyone continue', hint: 'Lets every paused student carry on', disabled: busy || !open, onClick: () => void act(() => call('/resume-all', 'POST')) },
    { label: 'Room assistant', hint: agent?.rules.on ? 'On: handles routine moments' : 'Off', onClick: () => { setView('needs'); setAgentOpen(true); } },
    { label: 'Settings', hint: 'Browsers, rules, tile size', onClick: () => setSettingsOpen(true) },
    { label: 'Report (Excel)', hint: 'Who joined, when, everything MySEB saw', disabled: busy || students.length === 0, onClick: () => void downloadReport() },
    { label: 'End test for everyone', danger: true, disabled: busy || !open, onClick: endAll },
  ];
  const menuButton = (m: (typeof menu)[number]) => (
    <button key={m.label} type="button" disabled={m.disabled} onClick={() => { setMoreOpen(false); m.onClick(); }}
      className={`flex min-h-12 w-full flex-col items-start justify-center rounded-xl px-3.5 py-2 text-left text-sm font-semibold hover:bg-white/10 active:bg-white/15 disabled:opacity-40 ${m.danger ? 'text-rose-300' : 'text-slate-100'} ${FOCUS}`}>
      {m.label}{m.hint && <span className="mt-0.5 text-xs font-normal text-slate-400">{m.hint}</span>}
    </button>
  );
  const navItem = (id: 'room' | 'needs' | 'code' | 'more', label: string, icon: string, active: boolean, onClick: () => void, badge = 0) => (
    <button key={id} type="button" onClick={onClick} aria-current={active ? 'page' : undefined} aria-label={badge ? `${label}, ${badge} waiting` : label}
      className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold ${active ? 'text-white' : 'text-slate-400'} ${FOCUS}`}>
      <span className={`relative flex h-7 w-12 items-center justify-center rounded-full ${active ? 'bg-white/10' : ''}`}>
        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg>
        {badge > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-rose-600 px-1 text-center text-[10px] font-bold leading-[18px] text-white">{badge}</span>}
      </span>
      {label}
    </button>
  );
  const ICON = {
    room: 'M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v5H4zM13 14h7v5h-7z',
    needs: 'M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0',
    code: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h3v3h-3zM19 14v3M14 19h6',
    more: 'M12 5.5v.01M12 12v.01M12 18.5v.01',
  };

  const needsPanel = (
    <div className="space-y-3">
      <h2 className="flex items-center justify-between text-sm font-bold md:text-base">Needs you<span className={`rounded-full px-2 py-0.5 text-xs font-bold ${needsCount ? 'bg-rose-600 text-white' : 'bg-white/10 text-slate-300'}`}>{needsCount}</span></h2>
      {needsCount === 0 && <p className="rounded-2xl border border-dashed border-white/15 px-4 py-6 text-center text-sm text-slate-400">Nothing needs you right now. Alerts, student cards and what the assistant could not decide appear here.</p>}
        {idq.length > 0 && (
          <section aria-label="Student cards to check" className="rounded-2xl border border-sky-400/40 bg-sky-500/10 p-3">
            <p className="mb-2 text-sm font-bold text-sky-100">{idq.length} student{idq.length === 1 ? '' : 's'} showed a card. Check the name and photo, then let them in.</p>
            <ul className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0">
              {idq.map((c) => (
                <li key={c.id} className="w-64 shrink-0 snap-start overflow-hidden rounded-xl border border-white/10 bg-slate-900 md:w-full">
                  <img src={c.image} alt={`Card shown by ${c.student_name}`} className="aspect-[4/3] w-full object-cover" />
                  <div className="space-y-2 p-2.5"><p className="truncate text-sm font-bold text-white" title={c.student_name}>Typed name: {c.student_name}</p>
                    <div className="flex gap-2">
                      <button type="button" disabled={busy} onClick={() => void decideId(c.id, true)} className={`min-h-11 flex-1 rounded-lg bg-emerald-500 px-3 text-sm font-bold text-white hover:bg-emerald-400 disabled:opacity-40 md:min-h-9 md:text-xs ${FOCUS}`}>Let in</button>
                      <button type="button" disabled={busy} onClick={() => void decideId(c.id, false)} className={`min-h-11 flex-1 rounded-lg bg-rose-600 px-3 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-40 md:min-h-9 md:text-xs ${FOCUS}`}>Refuse</button>
                    </div></div>
                </li>
              ))}
            </ul>
          </section>
        )}
        {alerts.length > 0 && (
          <ul aria-live="assertive" className="space-y-2">
            {alerts.slice(0, 30).map((a) => (
              <li key={a.id} className="rounded-xl border border-rose-500/50 bg-rose-500/10 p-3">
                <p className="flex min-w-0 items-start gap-2.5 text-sm font-semibold text-rose-100"><span className="mt-1.5 h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-rose-500" /><span className="min-w-0"><strong>{a.name}</strong>: {a.text}</span></p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {!a.ended && <button type="button" disabled={busy} onClick={() => act(() => call(`/sessions/${a.id}/resume`, 'POST'))} className={`${dBtn} flex-1 !min-h-10 text-xs md:flex-none`}>Let them continue</button>}
                  {!a.ended && <button type="button" disabled={busy} onClick={() => { setAlerts((c) => c.filter((x) => x.id !== a.id)); void act(() => call(`/sessions/${a.id}/end`, 'POST')); }} className={`${dDanger} flex-1 !min-h-10 text-xs md:flex-none`}>End test now</button>}
                  <button type="button" onClick={() => setAlerts((c) => c.filter((x) => x.id !== a.id))} className={`${dBtn} flex-1 !min-h-10 text-xs md:flex-none`}>Dismiss</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {room && (
          <section aria-label="Room assistant" className="rounded-2xl border border-white/10 bg-slate-900 p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${agent?.rules.on ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-slate-400'}`}>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-bold">Room assistant <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold tracking-wide ${agent?.rules.on ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-200'}`}>{agent?.rules.on ? 'ON' : 'OFF'}</span></p>
                <p className="text-xs leading-snug text-slate-400">{agent?.rules.on
                  ? `Lets a student back in after ${agent.rules.afterSeconds} s when the reason is small (face left the camera, lost connection), up to ${agent.rules.maxResumes} time${agent.rules.maxResumes === 1 ? '' : 's'} each${agent.rules.endAfterMax ? ', then ends their test' : ', then tells you'}. Let back in so far: ${agent.resumed}.`
                  : 'Handles the routine moments for you and lists only what needs you. It never touches anyone you paused or anyone who looks like cheating.'}</p>
              </div>
              <div className="flex w-full gap-2">
                <button type="button" className={`${agent?.rules.on ? dBtn : dPrimary} flex-1`} disabled={busy || !open} onClick={() => void setRules({ on: !agent?.rules.on })}>{agent?.rules.on ? 'Turn off' : 'Turn on'}</button>
                <button type="button" aria-expanded={agentOpen} className={`${dBtn} flex-1`} onClick={() => setAgentOpen((v) => !v)}>Rules</button>
              </div>
            </div>
            {agentOpen && (
              <div className="mt-3 grid gap-3 border-t border-white/10 pt-3 sm:grid-cols-3">
                <Setting label="Wait before letting back in" hint="They must be connected again.">
                  <select className={dSelect} style={{ colorScheme: 'dark' }} aria-label="Wait before letting back in" value={agent?.rules.afterSeconds ?? 30} disabled={busy || !open} onChange={(e) => void setRules({ afterSeconds: Number(e.target.value) })}>
                    {[10, 20, 30, 60, 120].map((n) => <option key={n} value={n}>{n} seconds</option>)}
                  </select>
                </Setting>
                <Setting label="Times each student" hint="After this it tells you instead.">
                  <select className={dSelect} style={{ colorScheme: 'dark' }} aria-label="Times each student" value={agent?.rules.maxResumes ?? 2} disabled={busy || !open} onChange={(e) => void setRules({ maxResumes: Number(e.target.value) })}>
                    {[1, 2, 3, 5].map((n) => <option key={n} value={n}>{n} time{n === 1 ? '' : 's'}</option>)}
                  </select>
                </Setting>
                <Setting label="After the limit" hint="Off: you are told and decide. On: their test ends by itself.">
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold md:min-h-9">
                    <input type="checkbox" className="h-5 w-5 accent-blue-500" checked={!!agent?.rules.endAfterMax} disabled={busy || !open} onChange={(e) => { if (!e.target.checked || confirm('End a student\'s test by itself when they have used all their chances?')) void setRules({ endAfterMax: e.target.checked }); }} />
                    End their test
                  </label>
                </Setting>
              </div>
            )}
            {agent && agent.log.length > 0 && (
              <ul className="mt-3 divide-y divide-white/10 border-t border-white/10 text-sm" aria-label="What the assistant did">
                {agent.log.slice(0, 6).map((e, i) => (
                  <li key={`${e.at}-${i}`} className="flex items-start gap-2.5 py-2">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.kind === 'resumed' ? 'bg-emerald-400' : e.kind === 'needs_you' || e.kind === 'card' ? 'bg-amber-400' : e.kind === 'ended' ? 'bg-rose-400' : 'bg-slate-500'}`} />
                    <p className="min-w-0 flex-1 text-slate-200">{e.student && <strong className="font-semibold text-white">{e.student}: </strong>}{e.text}</p>
                    <time className="shrink-0 text-xs tabular-nums text-slate-500" dateTime={e.at}>{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

    </div>
  );

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-slate-100 antialiased">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] items-center gap-2.5 px-3 py-2.5 md:gap-3 md:px-4 md:py-3">
          <button type="button" onClick={onBack} className={`${dBtn} !px-0 w-11 shrink-0 text-lg md:w-10`} aria-label="Back">←</button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-bold leading-tight md:text-lg">{room?.exam?.title ?? 'Live room'}</h1>
              {open
                ? <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-white"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />LIVE</span>
                : <span className="shrink-0 rounded-full bg-slate-700 px-2 py-0.5 text-[10px] font-bold">Ended</span>}
            </div>
            <p className="truncate text-xs text-slate-400">{open ? `${students.length} student${students.length === 1 ? '' : 's'} · ${connected ? 'instant updates' : `updates every ${every / 1000} s`}${mode === 'live' ? ` · ${watching} live picture${watching === 1 ? '' : 's'}` : ''}` : 'This test has ended'}</p>
          </div>
          <div className="relative hidden items-center gap-2 md:flex">
            <button type="button" className={dPrimary} onClick={onCode} disabled={busy || !open}>{codeLabel}</button>
            <button type="button" className={dBtn} onClick={() => setSettingsOpen(true)}>Settings</button>
            <button type="button" className={`${dBtn} !px-0 w-10`} aria-haspopup="menu" aria-expanded={moreOpen} aria-label="More actions" onClick={() => setMoreOpen((v) => !v)}>
              <svg aria-hidden viewBox="0 0 24 24" className="mx-auto h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d={ICON.more} /></svg>
            </button>
            {moreOpen && !isPhone && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMoreOpen(false)} />
                <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-72 rounded-2xl border border-white/10 bg-slate-900 p-1.5 shadow-2xl">
                  {menu.slice(0, 5).map(menuButton)}
                  <div className="my-1 border-t border-white/10" />
                  {menu.slice(5).map(menuButton)}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1800px] px-3 pb-28 pt-3 md:px-4 md:pb-8 md:pt-4">
        {err && <p role="alert" className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-200">{err}</p>}
        <div className="md:grid md:grid-cols-[minmax(0,1fr)_340px] md:items-start md:gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section aria-label="Students" className={`min-w-0 ${view === 'needs' ? 'hidden md:block' : ''}`}>
            <div className="mb-3 grid grid-cols-4 gap-1.5 md:flex md:flex-wrap md:gap-2" aria-label="How many students are where">
              {chips.map(([k, label]) => (
                <div key={k} className="flex min-w-0 flex-col-reverse items-start rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1.5 md:flex-row md:items-center md:gap-2 md:rounded-full md:px-3.5 md:py-1">
                  <p className="flex min-w-0 items-center gap-1.5 text-[10px] font-semibold text-slate-400 md:text-[12px] md:text-slate-200"><span className={`h-1.5 w-1.5 shrink-0 md:h-2 md:w-2 rounded-full ${DOT[k]}`} /><span className="truncate">{isPhone ? SHORT[k] : label}</span></p>
                  <p className="text-lg font-bold leading-none tabular-nums text-white md:text-sm">{room?.counts[k] ?? 0}</p>
                </div>
              ))}
            </div>
            <div className="mb-3 flex flex-col gap-2">
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a student" aria-label="Find a student" enterKeyHint="search"
                className="min-h-11 w-full rounded-xl border border-white/15 bg-slate-900 px-3.5 text-base text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-400 md:min-h-10 md:text-sm" />
              <div role="tablist" aria-label="Who to show" className="flex overflow-hidden rounded-xl border border-white/15">
                <button type="button" role="tab" aria-selected={filter === 'all'} onClick={() => setFilter('all')} className={tab('all')}>Everyone <span className="opacity-70">{students.length}</span></button>
                <button type="button" role="tab" aria-selected={filter === 'attention'} onClick={() => setFilter('attention')} className={tab('attention')}>Paused or away{attention ? <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-slate-950">{attention}</span> : null}</button>
                <button type="button" role="tab" aria-selected={filter === 'testing'} onClick={() => setFilter('testing')} className={tab('testing')}>In the test</button>
              </div>
            </div>
        {mode !== 'off' && <p className="mb-4 text-xs leading-relaxed text-slate-500">
          Students were told what is shown ({source === 'camera' ? 'their camera' : source === 'screen' ? 'their whole screen' : 'their screen and camera'}) and must agree.{showScreen ? ' If a student stops sharing the screen it counts as leaving the test.' : ''} {mode === 'live' ? `Live video is shown for the ${maxLive} students on screen at a time; tap a student to zoom in and see them in full quality; the rest show a small picture. Nothing is recorded or saved.${sound ? ' Press Listen on a tile to hear that student; they see a notice while you do.' : ''}` : 'Pictures are small, replaced every 10 seconds, and never saved.'}
        </p>}

          {!room ? <p className="py-20 text-center text-slate-500">Loading…</p> : students.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/15 px-4 py-14 text-center">
              <svg aria-hidden viewBox="0 0 24 24" className="mx-auto mb-3 h-10 w-10 text-slate-600" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.4 3.5 5.2" /></svg>
              <p className="text-lg font-semibold">Nobody is in yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-slate-400">Get a code, show it to your students, and they will appear here as they join MySEB.</p>
              {open && <button type="button" className={`${dPrimary} mt-4`} onClick={() => void makeCode()} disabled={busy}>Get code for students</button>}
            </div>
          ) : shown.length === 0 ? <p className="py-16 text-center text-slate-500">{filter === 'attention' ? 'Nobody needs attention right now.' : 'No student matches.'}</p> : (
            <ul className="grid gap-2.5 md:gap-3" style={{ gridTemplateColumns: columns }}>
              {shown.map((s) => {
                const q = s.live?.question;
                const pct = q?.index && q.total ? Math.min(100, Math.round((q.index / q.total) * 100)) : 0;
                const qText = s.status === 'ENDED' ? (s.end_reason === 'student_exit' ? 'Student ended it' : s.end_reason === 'time_up' ? 'Time is up' : s.end_reason === 'teacher' ? 'Ended by you' : s.end_reason && s.end_reason !== 'exam_ended' && WHY[s.end_reason] ? `Disqualified · ${WHY[s.end_reason]}` : 'Finished')
                  : q ? `${q.index ? `Q${q.index}${q.total ? ` of ${q.total}` : ''}` : ''}${q.label ? `${q.index ? ' · ' : ''}${q.label}` : ''}` || '…' : 'Not started';
                const act2 = 'min-h-11 flex-1 rounded-lg px-3 text-xs font-semibold md:min-h-9 md:flex-none disabled:opacity-40 ' + FOCUS;
                return (
                  <li key={s.id} data-sid={s.id} ref={watchTile} className={`group flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-slate-900 ${RING_D[s.status]}`}>
                    <div role="button" tabIndex={0} aria-label={`Zoom in on ${s.student_name}`} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFocus(s.id); } }}
                      className={`relative cursor-zoom-in bg-slate-800 ${FOCUS} ${showScreen ? 'aspect-video' : 'aspect-[4/3]'}`} onClick={() => setFocus(s.id)}>
                      {showScreen && (screens[s.id] || pics[s.id]?.screen) ? (
                        <>
                          {screens[s.id] ? <LiveVideo stream={screens[s.id]} muted mirror={false} fit="object-contain" /> : <img src={pics[s.id]?.screen ?? ''} alt={`Screen: ${s.student_name}`} className="h-full w-full object-contain" />}
                          {source === 'both' && (streams[s.id] || pics[s.id]?.frame) && (
                            <div className="absolute bottom-9 right-2 h-1/3 w-[28%] overflow-hidden rounded-lg border-2 border-white/80 shadow">
                              {streams[s.id] ? <LiveVideo stream={streams[s.id]} muted={listen !== s.id} /> : <img src={pics[s.id]?.frame ?? ''} alt={`Camera: ${s.student_name}`} className="h-full w-full -scale-x-100 object-cover" />}
                            </div>
                          )}
                        </>
                      ) : streams[s.id] ? <LiveVideo stream={streams[s.id]} muted={listen !== s.id} /> : pics[s.id]?.frame ? <img src={pics[s.id].frame ?? ''} alt={`Camera: ${s.student_name}`} className="h-full w-full -scale-x-100 object-cover" /> : (
                        <div className="flex h-full items-center justify-center px-3 text-center text-xs font-medium text-slate-500">
                          {mode === 'off' ? 'Live view is off' : s.live?.screen_state === 'partial' ? 'Shared a window, not the whole screen' : s.live?.screen_state === 'denied' ? 'Screen sharing is off' : s.live?.camera === 'busy' ? 'Another app is using the camera' : s.live?.camera === 'denied' ? 'Camera blocked' : s.live?.camera === 'ask' ? 'Waiting for the student to agree' : s.status === 'ENDED' ? 'Finished' : 'No picture yet'}
                        </div>
                      )}
                      <span title={LABEL[s.status]} className="absolute left-1.5 top-1.5 inline-flex items-center gap-1.5 rounded-full bg-slate-950/80 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur md:px-2.5 md:text-[11px]"><span className={`h-1.5 w-1.5 rounded-full ${DOT[s.status]}`} />{!dense && LABEL[s.status]}</span>
                      {(streams[s.id] || screens[s.id]) && <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />LIVE</span>}
                      {!streams[s.id] && !screens[s.id] && pics[s.id]?.age != null && (pics[s.id].age as number) > 30 && <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 text-[10px] text-white">{pics[s.id].age}s ago</span>}
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2.5 pb-2 pt-9 md:px-3 md:pb-2.5 md:pt-10">
                        <p className={`truncate font-bold text-white ${dense ? 'text-[11px] leading-tight' : 'text-sm'}`} title={s.student_name}>{s.student_name}</p>
                        {!dense && <p className="truncate text-[11px] text-slate-300" title={q?.label}>{qText}</p>}
                      </div>
                      {q?.total ? <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10"><div className="h-full bg-emerald-400" style={{ width: `${pct}%` }} /></div> : null}
                      <button type="button" tabIndex={-1} aria-hidden onClick={(e) => { e.stopPropagation(); setFocus(s.id); }} className="absolute bottom-9 left-2 hidden rounded-full bg-black/60 px-2.5 py-0.5 text-[11px] font-bold text-white opacity-0 hover:bg-black/80 group-hover:opacity-100 md:block">Zoom</button>
                    </div>
                    {!dense && <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                      <p className="truncate text-[11px] text-slate-500">{s.client_type === 'web' ? 'browser' : s.client_type}{s.platform ? ` · ${s.platform}` : ''}{s.status !== 'ENDED' && s.seen_ago > 15 ? ` · seen ${s.seen_ago}s ago` : ''}</p>
                      {(s.status === 'PAUSED' || s.status === 'LEFT') && <p className="text-xs font-semibold text-amber-300">{why(s.pause_reason ?? s.last_violation)}</p>}
                      {s.id_status === 'pending' && s.status !== 'ENDED' && <p className="text-xs font-semibold text-sky-300">Showing their student card</p>}
                      {(s.aside_seconds ?? 0) >= 10 && s.status !== 'ENDED' && <p className="text-xs text-slate-400" title="How long their face was turned well away from the camera. Only a number for you to judge: it never disqualifies anyone.">Looked aside {s.aside_seconds} s</p>}
                      {(s.reinstated_count ?? 0) > 0 && <p className="text-xs text-slate-400">Let back in {s.reinstated_count === 1 ? 'once' : `${s.reinstated_count} times`}</p>}
                      <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                        {(s.status === 'PAUSED' || s.status === 'LEFT') && <button type="button" className={`${act2} bg-blue-500 font-bold text-white hover:bg-blue-400`} disabled={busy} onClick={() => act(() => call(`/sessions/${s.id}/resume`, 'POST'))}>Resume</button>}
                        {sound && streams[s.id] && <button type="button" className={`${listen === s.id ? 'bg-white text-slate-950' : 'border border-white/15 bg-white/5 text-slate-100 hover:bg-white/10'} ${act2}`} onClick={() => setListen(listen === s.id ? null : s.id)}>{listen === s.id ? 'Stop listening' : 'Listen'}</button>}
                        {s.status === 'ENDED' && s.end_reason && !['teacher', 'time_up', 'exam_ended', 'student', 'student_exit'].includes(s.end_reason) && <button type="button" className={`${act2} bg-emerald-500 font-bold text-white hover:bg-emerald-400`} disabled={busy} title="Use this when the rule was broken by mistake: the student continues where they were. It is written in their log." onClick={() => { if (confirm(`Let ${s.student_name} back in? It is recorded in their log.`)) void act(() => call(`/sessions/${s.id}/reinstate`, 'POST')); }}>Let back in</button>}
                        {s.status !== 'ENDED' && <button type="button" className={`${act2} ${needs(s) ? 'bg-rose-600 font-bold text-white hover:bg-rose-500' : 'border border-white/15 bg-white/5 text-rose-300 hover:bg-white/10'}`} disabled={busy} onClick={() => { if (confirm(`End the test for ${s.student_name}?`)) void act(() => call(`/sessions/${s.id}/end`, 'POST')); }}>End</button>}
                        {s.has_partial && <button type="button" className={`${act2} border border-emerald-400/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20`} title="What this student had typed, saved every few seconds" onClick={async () => { try { const d = await call(`/sessions/${s.id}/partial`); const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')); setSaved({ name: s.student_name, at: d.saved_at ?? null, rows: Object.entries(d.answers ?? {}).map(([id, v]) => ({ q: (d.labels ?? {})[id] || id, a: show(v) })) }); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load.'); } }}>Saved answers</button>}
                        <button type="button" className={`${act2} border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10`} onClick={async () => { try { setLog({ name: s.student_name, rows: await call(`/sessions/${s.id}/violations`) }); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load.'); } }}>
                          {s.violation_count === 0 ? 'No problems' : `${s.violation_count} problem${s.violation_count === 1 ? '' : 's'}`}
                        </button>
                      </div>
                    </div>}
                </li>
                );
              })}
            </ul>
          )}
          </section>
          <aside aria-label="Needs you" className={`min-w-0 md:sticky md:top-[76px] md:max-h-[calc(100dvh-92px)] md:overflow-y-auto md:overscroll-contain md:pr-0.5 ${view === 'room' ? 'hidden md:block' : ''}`}>{needsPanel}</aside>
        </div>
      </main>

      {/* Phone: a bottom bar with four places. Desktop: the same things are in the header and the side panel. */}
      <nav aria-label="Live room" className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-slate-950/95 px-2 pt-1.5 backdrop-blur md:hidden" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
        <div className="mx-auto flex max-w-md items-stretch">
          {navItem('room', 'Students', ICON.room, view === 'room', () => setView('room'))}
          {navItem('needs', 'Needs you', ICON.needs, view === 'needs', () => setView('needs'), needsCount)}
          {navItem('code', code ? 'Code' : 'Get code', ICON.code, false, onCode)}
          {navItem('more', 'More', ICON.more, false, () => setMoreOpen(true))}
        </div>
      </nav>

      {isPhone && moreOpen && (
        <Sheet title="More" onClose={() => setMoreOpen(false)}>
          <div className="space-y-0.5">
            {menu.slice(0, 5).map(menuButton)}
            <div className="my-1.5 border-t border-white/10" />
            {menu.slice(5).map(menuButton)}
          </div>
        </Sheet>
      )}
      {showCode && code && (
        <Sheet title="Code for students" wide onClose={() => setShowCode(false)}>
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-8">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-400">Students type this in MySEB</p>
              <p className="my-1.5 break-words font-mono text-[1.9rem] font-bold leading-tight tracking-wider text-white sm:text-4xl md:text-5xl">{code.display}</p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:flex">
                <button type="button" className={dBtn} onClick={async () => { await navigator.clipboard.writeText(code.display); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : 'Copy'}</button>
                <button type="button" className={dBtn} onClick={() => void makeCode()}>New code</button>
              </div>
              {code.joinUrl && (
                <div className="mt-4 max-w-md rounded-xl border border-white/10 bg-white/[0.04] p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Link for students</p>
                  <p className="mt-1 break-all font-mono text-sm text-white" data-testid="join-link">{code.joinUrl}</p>
                  <div className="mt-2.5 grid grid-cols-2 gap-2 sm:flex">
                    <button type="button" className={dPrimary} onClick={async () => { await navigator.clipboard.writeText(code.joinUrl!); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500); }}>{linkCopied ? 'Link copied' : 'Copy link'}</button>
                    <a className={`${dBtn} inline-flex items-center justify-center`} target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`Join your test: ${code.joinUrl}`)}`}>Share on WhatsApp</a>
                  </div>
                  <p className="mt-2.5 text-xs leading-relaxed text-slate-400">One link for everyone. On a laptop or an Android phone it opens MySEB with the code filled in, and downloads MySEB first if it is missing. On an iPhone it starts the test in the browser{room?.exam?.allow_web ? '' : ' (needs Settings → Browsers)'}.</p>
                  {!room?.exam?.allow_web && <button type="button" disabled={busy || !open} className={`${dBtn} mt-2.5 w-full sm:w-auto`} onClick={() => void post({ allowWeb: true })}>Turn on browsers for iPhones</button>}
                </div>
              )}
              <p className="mt-3 max-w-sm text-xs leading-relaxed text-slate-400">One code works for the whole class. It expires {new Date(code.expiresAt).toLocaleString()} or when you end the test. Install links: <a className="underline" href="/myseb/download" target="_blank" rel="noreferrer">bwenge.space/myseb/download</a>.</p>
            </div>
            <img alt="QR code: open MySEB on a phone" className="mx-auto h-44 w-44 shrink-0 rounded-xl bg-white p-1.5 md:mx-0 md:h-40 md:w-40" src={`data:image/svg+xml;utf8,${encodeURIComponent(code.qrSvg)}`} />
          </div>

        </Sheet>
      )}
      {settingsOpen && <Sheet title="Settings" wide onClose={() => setSettingsOpen(false)}>{settingsBody}</Sheet>}

      {focus && (() => {
        const s = students.find((x) => x.id === focus);
        if (!s) return null;
        return (
          <ZoomView
            student={s} screen={screens[s.id] ?? null} camera={streams[s.id] ?? null} screenPic={pics[s.id]?.screen ?? s.live?.screen ?? null} cameraPic={pics[s.id]?.frame ?? s.live?.frame ?? null}
            live={mode === 'live'} source={source} busy={busy} listening={listen === s.id} canListen={sound && !!streams[s.id]}
            onListen={() => setListen(listen === s.id ? null : s.id)}
            onResume={() => act(() => call(`/sessions/${s.id}/resume`, 'POST'))}
            onEnd={() => { void act(() => call(`/sessions/${s.id}/end`, 'POST')); }}
            onLive={() => act(() => call('/settings', 'POST', { liveMode: 'live', liveSound: sound, liveSource: source, leaveAction }))}
            onClose={() => setFocus(null)}
          />
        );
      })()}

      {pay && <MySebPayPanel payment={pay} onClose={() => setPay(null)} onAccess={() => { setPay(null); void makeCode(); }} />}
      {saved && (
        <Sheet title={`${saved.name}: saved answers`} onClose={() => setSaved(null)}>
          <p className="mb-3 text-xs text-slate-400">What the student had typed{saved.at ? `, last saved ${new Date(saved.at).toLocaleTimeString()}` : ''}. Saved every few seconds, so the last few seconds may be missing. Files are not included.</p>
          {saved.rows.length === 0 ? <p className="text-sm text-slate-400">Nothing was saved.</p> : (
            <ol className="space-y-3 text-sm">{saved.rows.map((r, i) => <li key={i} className="rounded-xl bg-white/[0.04] p-3"><p className="font-semibold text-slate-200">{r.q}</p><p className="mt-1 whitespace-pre-wrap break-words text-slate-300">{r.a || '(empty)'}</p></li>)}</ol>
          )}
        </Sheet>
      )}
      {log && (
        <Sheet title={`${log.name}: what happened`} onClose={() => setLog(null)}>
          {log.rows.length === 0 ? <p className="text-sm text-slate-400">Nothing to report.</p> : (
            <ul className="divide-y divide-white/10 text-sm">{log.rows.map((v) => <li key={v.id} className="flex justify-between gap-3 py-2.5"><span>{why(v.type)}</span><span className="shrink-0 text-slate-400">{new Date(v.created_at).toLocaleTimeString()}</span></li>)}</ul>
          )}
        </Sheet>
      )}
    </div>
  );
}
