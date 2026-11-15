import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '../utils/authFetch';

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
  live: { question: { index: number | null; total: number | null; label: string } | null; camera: string; screen_state?: string; frame: string | null; frame_age: number | null; screen?: string | null; screen_age?: number | null } | null;
}
interface Room { exam: { title: string; status: string; live_faces: boolean; live_mode?: 'off' | 'pictures' | 'live'; live_sound?: boolean; live_source?: Source; leave_action?: string; allow_web?: boolean }; counts: Record<Status, number>; students: Student[] }
interface Code { display: string; qrSvg: string; expiresAt: string }

const LABEL: Record<Status, string> = { IN_EXAM: 'In the test', PAUSED: 'Paused', LEFT: 'Left', ENDED: 'Finished' };
const TONE: Record<Status, string> = { IN_EXAM: 'bg-emerald-600', PAUSED: 'bg-amber-600', LEFT: 'bg-rose-600', ENDED: 'bg-slate-500' };
const RING: Record<Status, string> = { IN_EXAM: 'border-slate-200', PAUSED: 'border-amber-400 ring-2 ring-amber-200', LEFT: 'border-rose-400 ring-2 ring-rose-200', ENDED: 'border-slate-200 opacity-70' };
const WHY: Record<string, string> = {
  leave: 'Left the test screen', background: 'Left the app', blur: 'Switched window', heartbeat_lost: 'Lost connection', screenshot: 'Tried a screenshot',
  copy: 'Tried to copy', paste: 'Tried to paste', cut: 'Tried to cut', devtools: 'Opened developer tools', shortcut: 'Pressed a blocked key', close_attempt: 'Tried to close the app',
  extra_display: 'Second screen', forbidden_app: 'Remote or recording app', fullscreen_exit: 'Left full screen', split_screen: 'Split screen', screen_recording: 'Screen recording',
  visibility_hidden: 'Hid the tab', screen_share_stopped: 'Stopped sharing the screen', token_misuse: 'Used the key from another place', teacher: 'Paused by you',
};
const why = (k: string | null) => (k ? WHY[k] ?? k : '');

/* The live room is a dark "control room": pictures stand out, and the lecturer's eyes are not tired after an hour of watching. */
const dBtn = 'min-h-10 rounded-xl border border-white/15 bg-white/5 px-3.5 text-sm font-semibold text-slate-100 hover:bg-white/10 disabled:opacity-40';
const dPrimary = 'min-h-10 rounded-xl bg-blue-500 px-4 text-sm font-bold text-white hover:bg-blue-400 disabled:opacity-40';
const dDanger = 'min-h-10 rounded-xl bg-rose-600 px-3.5 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-40';
const dSelect = 'min-h-9 w-full min-w-0 truncate rounded-lg border border-white/15 bg-slate-800 px-2.5 text-sm font-semibold text-slate-100 outline-none focus:border-blue-400';
const RING_D: Record<Status, string> = { IN_EXAM: 'border-slate-800', PAUSED: 'border-amber-500/70 ring-2 ring-amber-500/25', LEFT: 'border-rose-500/70 ring-2 ring-rose-500/25', ENDED: 'border-slate-800 opacity-60' };
const DOT: Record<Status, string> = { IN_EXAM: 'bg-emerald-400', PAUSED: 'bg-amber-400', LEFT: 'bg-rose-400', ENDED: 'bg-slate-400' };

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

/** How many students show live video at once. More than this and the lecturer's own computer, not ours, is the limit. */
const MAX_LIVE = 24;

/**
 * Live video. Each student's browser sends one small video stream straight to this browser (WebRTC); our servers only pass the
 * set-up messages. Only the tiles on screen (up to MAX_LIVE) connect, so a class of hundreds is fine: everyone else shows the
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

  // Ask the students on screen to start, and the others to stop.
  const key = wanted.join(',');
  useEffect(() => {
    if (!enabled) { [...requested.current].forEach((sid) => { void post(sid, { type: 'unwatch' }); drop(sid); }); return; }
    for (const sid of wanted) if (!requested.current.has(sid)) { requested.current.add(sid); void post(sid, { type: 'watch' }); }
    for (const sid of [...requested.current]) if (!wantedRef.current.has(sid)) { void post(sid, { type: 'unwatch' }); drop(sid); }
    // a student whose stream never arrived (page reloaded, camera asked again) is asked again after a while
    const t = setTimeout(() => { for (const sid of wanted) if (!pcs.current.has(sid)) { requested.current.delete(sid); setTick((x) => x + 1); } }, 12000);
    return () => clearTimeout(t);
  }, [enabled, key, tick, post, drop]); // eslint-disable-line react-hooks/exhaustive-deps

  // Zoom: the student in focus is sent at full size; the one you leave goes back to the light picture.
  useEffect(() => {
    const prev = focused.current;
    if (prev && prev !== focus) void post(prev, { type: 'quality', level: 'low' });
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
  return (
    <div role="dialog" aria-label={`${s.student_name}, zoomed in`} className="fixed inset-0 z-40 flex flex-col bg-slate-950 text-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <p className="min-w-0 flex-1 truncate text-sm font-bold">{s.student_name}<span className="ml-2 text-xs font-medium text-slate-400">{q ? `${q.index ? `Q${q.index}${q.total ? ` of ${q.total}` : ''}` : ''}${q.label ? ` · ${q.label}` : ''}` : ''}</span></p>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${TONE[s.status]}`}>{LABEL[s.status]}</span>
        {hd ? <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-[11px] font-bold">HD live</span> : <span className="rounded-full bg-slate-700 px-2.5 py-0.5 text-[11px] font-bold">Small picture</span>}
        <div className="flex items-center gap-1" aria-label="Zoom">
          <button type="button" aria-label="Zoom out" className="min-h-9 w-9 rounded-lg bg-white/10 text-lg font-bold hover:bg-white/20 disabled:opacity-40" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z - 0.5))}>−</button>
          <span className="w-12 text-center text-xs font-semibold tabular-nums">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" className="min-h-9 w-9 rounded-lg bg-white/10 text-lg font-bold hover:bg-white/20 disabled:opacity-40" disabled={zoom >= 4} onClick={() => setZoom((z) => Math.min(4, z + 0.5))}>+</button>
        </div>
        {(s.status === 'PAUSED' || s.status === 'LEFT') && <button type="button" disabled={p.busy} onClick={p.onResume} className="min-h-9 rounded-lg bg-white/10 px-3 text-xs font-semibold hover:bg-white/20">Resume</button>}
        {p.canListen && <button type="button" onClick={p.onListen} className="min-h-9 rounded-lg bg-white/10 px-3 text-xs font-semibold hover:bg-white/20">{p.listening ? 'Stop listening' : 'Listen'}</button>}
        {s.status !== 'ENDED' && <button type="button" disabled={p.busy} onClick={p.onEnd} className="min-h-9 rounded-lg bg-rose-600 px-3 text-xs font-bold hover:bg-rose-700 disabled:opacity-40">End test</button>}
        <button type="button" onClick={p.onClose} className="min-h-9 rounded-lg bg-white/10 px-3 text-xs font-semibold hover:bg-white/20">Close (Esc)</button>
      </div>
      {!p.live && <p className="bg-amber-500/20 px-4 py-1.5 text-xs text-amber-200">Small picture, refreshed every few seconds. For a sharp, moving picture, <button type="button" className="font-bold underline" onClick={p.onLive}>switch to Live video</button>.</p>}
      <div ref={box} className="relative min-h-0 flex-1 overflow-auto">
        <div style={{ width: `${zoom * 100}%`, aspectRatio: wantsScreen ? '16 / 9' : '4 / 3', maxWidth: zoom === 1 ? '100%' : undefined, maxHeight: zoom === 1 ? '100%' : undefined, margin: '0 auto' }} className="relative">
          {wantsScreen ? (p.screen ? <LiveVideo stream={p.screen} muted mirror={false} fit="object-contain" /> : <img src={p.screenPic ?? ''} alt={`Screen: ${s.student_name}`} className="h-full w-full object-contain" />)
            : p.camera ? <LiveVideo stream={p.camera} muted={!p.listening} /> : p.cameraPic ? <img src={p.cameraPic} alt={`Camera: ${s.student_name}`} className="h-full w-full -scale-x-100 object-contain" />
            : <div className="flex h-full items-center justify-center text-sm text-slate-400">No picture yet</div>}
        </div>
        {wantsScreen && p.source === 'both' && (p.camera || p.cameraPic) && (
          <div className="pointer-events-none absolute bottom-3 right-3 h-40 w-52 overflow-hidden rounded-xl border-2 border-white shadow-xl">
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
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ name: string; rows: Array<{ id: number; type: string; created_at: string }> } | null>(null);
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [listen, setListen] = useState<string | null>(null);
  const [pics, setPics] = useState<Record<string, { frame: string | null; age: number | null; screen?: string | null; screen_age?: number | null }>>({});
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [focus, setFocus] = useState<string | null>(null);   // zoomed-in student
  const stored = (k: string, d: string) => { try { return localStorage.getItem(`liveroom.${k}`) ?? d; } catch { return d; } };
  const [maxLive, setMaxLiveState] = useState<number>(() => [12, 24, 48].includes(Number(stored('maxLive', '24'))) ? Number(stored('maxLive', '24')) : 24);
  const [tileSize, setTileSizeState] = useState<'S' | 'M' | 'L'>(() => (['S', 'M', 'L'].includes(stored('size', 'M')) ? (stored('size', 'M') as 'S' | 'M' | 'L') : 'M'));
  const remember = (k: string, v: string) => { try { localStorage.setItem(`liveroom.${k}`, v); } catch { /* a private window: fine */ } };
  const setMaxLive = (n: number) => { setMaxLiveState(n); remember('maxLive', String(n)); };
  const setTileSize = (v: 'S' | 'M' | 'L') => { setTileSizeState(v); remember('size', v); };
  const seen = useRef<Map<string, { v: number; st: Status }> | null>(null);

  const call = useCallback(async (path: string, method = 'GET', body?: unknown) => {
    const r = await authFetch(`${base}${path}`, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b.error || 'Something went wrong.');
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
  const makeCode = () => act(async () => { setCode(await call('/code', 'POST')); setShowCode(true); });
  const students = room?.students ?? [];
  const needs = (s: Student) => s.status === 'PAUSED' || s.status === 'LEFT' || s.live?.camera === 'denied' || s.live?.screen_state === 'denied' || s.live?.screen_state === 'partial';
  const shown = [...students].filter((s) => (filter === 'all' || (filter === 'attention' ? needs(s) : s.status === 'IN_EXAM')) && (!query.trim() || s.student_name.toLowerCase().includes(query.trim().toLowerCase()))).sort((a, b) => Number(needs(b)) - Number(needs(a)) || a.student_name.localeCompare(b.student_name));
  const attention = students.filter(needs).length;
  const open = room?.exam?.status !== 'ended';
  const mode = room?.exam?.live_mode ?? (room?.exam?.live_faces ? 'pictures' : 'off');
  const sound = !!room?.exam?.live_sound && mode === 'live';
  const source: Source = room?.exam?.live_source ?? 'camera';
  const showScreen = mode !== 'off' && source !== 'camera';
  const leaveAction = room?.exam?.leave_action ?? 'pause';
  // Who gets live video: the tiles on screen (needs-attention first), up to MAX_LIVE, plus the one you listen to.
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

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <button type="button" onClick={onBack} className={dBtn} aria-label="Back">←</button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <h1 className="truncate text-lg font-bold">{room?.exam?.title ?? 'Live room'}</h1>
              {open
                ? <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-rose-600 px-2.5 py-0.5 text-[11px] font-extrabold tracking-wide text-white"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />LIVE</span>
                : <span className="shrink-0 rounded-full bg-slate-700 px-2.5 py-0.5 text-[11px] font-bold">Ended</span>}
            </div>
            <p className="text-xs text-slate-400">{open ? `${connected ? 'Instant updates' : `Updates every ${every / 1000} seconds`}${mode === 'live' ? ` · ${watching} live picture${watching === 1 ? '' : 's'} open` : ''}` : 'This test has ended'}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {chips.map(([k, label]) => (
              <span key={k} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[12px] font-semibold">
                <span className={`h-2 w-2 rounded-full ${DOT[k]}`} />{label}<b className="tabular-nums text-white">{room?.counts[k] ?? 0}</b>
              </span>
            ))}
          </div>
        </div>
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-2 px-4 pb-3">
          <button type="button" className={dPrimary} onClick={() => (code ? setShowCode((v) => !v) : void makeCode())} disabled={busy || !open}>{code ? (showCode ? 'Hide code' : 'Show code') : 'Get code for students'}</button>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a student" aria-label="Find a student"
            className="min-h-10 w-44 rounded-xl border border-white/15 bg-slate-900 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-400 sm:w-56" />
          <div role="tablist" aria-label="Who to show" className="flex overflow-hidden rounded-xl border border-white/15">
            {([['all', `Everyone (${students.length})`], ['attention', `Needs attention${attention ? ` (${attention})` : ''}`], ['testing', 'In the test']] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
                className={`min-h-10 px-3.5 text-sm font-semibold ${filter === k ? (k === 'attention' ? 'bg-amber-500 text-slate-950' : 'bg-white text-slate-950') : 'bg-white/5 text-slate-200 hover:bg-white/10'}`}>{label}</button>
            ))}
          </div>
          <span className="flex-1" />
          <button type="button" className={dBtn} disabled={busy || !open} onClick={() => act(() => call('/pause-all', 'POST'))}>Pause everyone</button>
          <button type="button" className={dBtn} disabled={busy || !open} onClick={() => act(() => call('/resume-all', 'POST'))}>Let everyone continue</button>
          <button type="button" aria-expanded={settingsOpen} className={`${dBtn} ${settingsOpen ? '!bg-white/15' : ''}`} onClick={() => setSettingsOpen((v) => !v)}>Settings</button>
          <button type="button" className={dBtn} disabled={busy || students.length === 0} title="Who joined, when, and everything the app saw, as an Excel file" onClick={() => void downloadReport()}>Report (Excel)</button>
          <button type="button" className="min-h-10 rounded-xl border border-rose-500/60 px-3.5 text-sm font-bold text-rose-300 hover:bg-rose-500/10 disabled:opacity-40" disabled={busy || !open} onClick={() => { if (confirm('End the test for everyone? The code stops working.')) void act(() => call('/end', 'POST')); }}>End test</button>
        </div>
        {settingsOpen && (
          <div className="border-t border-white/10 bg-slate-900/70">
            <div className="mx-auto grid max-w-[1800px] gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
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
                <select className={dSelect} style={{ colorScheme: 'dark' }} aria-label="If a student leaves" value={leaveAction} disabled={busy || !open} onChange={(e) => act(() => call('/settings', 'POST', { liveMode: mode, liveSound: sound, liveSource: source, leaveAction: e.target.value }))}>
                  <option value="record">Only record it</option><option value="pause">Pause them</option><option value="pause_then_end">Pause, then end the second time</option><option value="end">End their test at once</option>
                </select>
              </Setting>
              <Setting label="Tile size" hint="Small tiles fit a big class on one screen.">
                <select className={dSelect} style={{ colorScheme: 'dark' }} aria-label="Tile size" value={tileSize} onChange={(e) => setTileSize(e.target.value as 'S' | 'M' | 'L')}>
                  <option value="S">Small</option><option value="M">Medium</option><option value="L">Large</option>
                </select>
              </Setting>
              <Setting label="Live at once" hint="How many students move live. Click one to zoom in at full quality. More needs a stronger computer.">
                <select className={dSelect} style={{ colorScheme: 'dark' }} aria-label="Live at once" value={maxLive} disabled={mode !== 'live'} onChange={(e) => setMaxLive(Number(e.target.value))}>
                  <option value={12}>12 students</option><option value={24}>24 students</option><option value={48}>48 students</option>
                </select>
              </Setting>
              <Setting label="Browsers" hint="Lets students without the app (for example on an iPhone) take the test in their browser. It cannot lock their device, only watch it.">
                <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" className="h-4 w-4" checked={!!room?.exam?.allow_web} disabled={busy || !open} onChange={(e) => act(() => call('/settings', 'POST', { liveMode: mode, liveSound: sound, liveSource: source, leaveAction, allowWeb: e.target.checked }))} />
                  Allow browsers
                </label>
              </Setting>
              <Setting label="Listening" hint="Lets you hear one student at a time. They see a notice while you do.">
                <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" className="h-4 w-4" checked={sound} disabled={busy || !open || mode !== 'live' || source === 'screen'} onChange={(e) => act(() => call('/settings', 'POST', { liveMode: 'live', liveSound: e.target.checked, liveSource: source, leaveAction }))} />
                  Allow listening
                </label>
              </Setting>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1800px] px-4 py-5">
        {err && <p role="alert" className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-200">{err}</p>}
        {alerts.length > 0 && (
          <ul aria-live="assertive" className="mb-4 space-y-2">
            {alerts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-500/50 bg-rose-500/10 px-4 py-3">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
                <p className="min-w-0 flex-1 text-sm font-semibold text-rose-100"><strong>{a.name}</strong>: {a.text}</p>
                {!a.ended && <button type="button" disabled={busy} onClick={() => act(() => call(`/sessions/${a.id}/resume`, 'POST'))} className={`${dBtn} !min-h-9 text-xs`}>Let them continue</button>}
                {!a.ended && <button type="button" disabled={busy} onClick={() => { setAlerts((c) => c.filter((x) => x.id !== a.id)); void act(() => call(`/sessions/${a.id}/end`, 'POST')); }} className={`${dDanger} !min-h-9 text-xs`}>End {a.name}'s test now</button>}
                <button type="button" onClick={() => setAlerts((c) => c.filter((x) => x.id !== a.id))} className={`${dBtn} !min-h-9 text-xs`}>Dismiss</button>
              </li>
            ))}
          </ul>
        )}
        {mode !== 'off' && <p className="mb-4 text-xs text-slate-500">
          Students were told what is shown ({source === 'camera' ? 'their camera' : source === 'screen' ? 'their whole screen' : 'their screen and camera'}) and must agree.{showScreen ? ' If a student stops sharing the screen it counts as leaving the test.' : ''} {mode === 'live' ? `Live video is shown for the ${maxLive} students on screen at a time; click a student to zoom in and see them in full quality; the rest show a small picture. Nothing is recorded or saved.${sound ? ' Press Listen on a tile to hear that student; they see a notice while you do.' : ''}` : 'Pictures are small, replaced every 10 seconds, and never saved.'}
        </p>}

        {showCode && code && (
          <section className="mb-5 flex flex-wrap items-center gap-6 rounded-2xl border border-white/10 bg-slate-900 p-5">
            <div>
              <p className="text-sm text-slate-400">Students type this in MySEB</p>
              <p className="my-1 font-mono text-4xl font-bold tracking-wider text-white sm:text-5xl">{code.display}</p>
              <button type="button" className={dBtn} onClick={async () => { await navigator.clipboard.writeText(code.display); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : 'Copy'}</button>
              <button type="button" className={`${dBtn} ml-2`} onClick={() => void makeCode()}>New code</button>
              <p className="mt-2 max-w-sm text-xs text-slate-400">One code works for the whole class. It expires {new Date(code.expiresAt).toLocaleString()} or when you end the test. Install links: <a className="underline" href="/myseb/download" target="_blank" rel="noreferrer">bwenge.space/myseb/download</a>.</p>
            </div>
            <img alt="QR code: open MySEB on a phone" className="h-40 w-40 rounded-xl bg-white p-1" src={`data:image/svg+xml;utf8,${encodeURIComponent(code.qrSvg)}`} />
          </section>
        )}

        {!room ? <p className="py-20 text-center text-slate-500">Loading…</p> : students.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 py-16 text-center">
            <p className="text-lg font-semibold">Nobody is in yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-slate-400">Get a code, show it to your students, and they will appear here as they join MySEB.</p>
            {open && <button type="button" className={`${dPrimary} mt-4`} onClick={() => void makeCode()} disabled={busy}>Get code for students</button>}
          </div>
        ) : shown.length === 0 ? <p className="py-16 text-center text-slate-500">{filter === 'attention' ? 'Nobody needs attention right now.' : 'No student matches.'}</p> : (
          <ul className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${tileSize === 'S' ? 150 : tileSize === 'L' ? 330 : 210}px,1fr))` }}>
            {shown.map((s) => {
              const q = s.live?.question;
              const pct = q?.index && q.total ? Math.min(100, Math.round((q.index / q.total) * 100)) : 0;
              const qText = s.status === 'ENDED' ? (s.end_reason === 'student_exit' ? 'Student ended it' : s.end_reason === 'time_up' ? 'Time is up' : s.end_reason === 'teacher' ? 'Ended by you' : 'Finished')
                : q ? `${q.index ? `Q${q.index}${q.total ? ` of ${q.total}` : ''}` : ''}${q.label ? `${q.index ? ' · ' : ''}${q.label}` : ''}` || '…' : 'Not started';
              return (
                <li key={s.id} data-sid={s.id} ref={watchTile} className={`group flex flex-col overflow-hidden rounded-2xl border bg-slate-900 ${RING_D[s.status]}`}>
                  <div className={`relative cursor-zoom-in bg-slate-800 ${showScreen ? 'aspect-video' : 'aspect-[4/3]'}`} onClick={() => setFocus(s.id)}>
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
                        {mode === 'off' ? 'Live view is off' : s.live?.screen_state === 'partial' ? 'Shared a window, not the whole screen' : s.live?.screen_state === 'denied' ? 'Screen sharing is off' : s.live?.camera === 'denied' ? 'Camera blocked' : s.live?.camera === 'ask' ? 'Waiting for the student to agree' : s.status === 'ENDED' ? 'Finished' : 'No picture yet'}
                      </div>
                    )}
                    <span className={`absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-slate-950/80 px-2.5 py-0.5 text-[11px] font-bold text-white backdrop-blur`}><span className={`h-1.5 w-1.5 rounded-full ${DOT[s.status]}`} />{LABEL[s.status]}</span>
                    {(streams[s.id] || screens[s.id]) && <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />LIVE</span>}
                    {!streams[s.id] && !screens[s.id] && pics[s.id]?.age != null && (pics[s.id].age as number) > 30 && <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 text-[10px] text-white">{pics[s.id].age}s ago</span>}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pb-2.5 pt-10">
                      <p className="truncate text-sm font-bold text-white" title={s.student_name}>{s.student_name}</p>
                      <p className="truncate text-[11px] text-slate-300" title={q?.label}>{qText}</p>
                    </div>
                    {q?.total ? <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10"><div className="h-full bg-emerald-400" style={{ width: `${pct}%` }} /></div> : null}
                    <button type="button" aria-label={`Zoom in on ${s.student_name}`} onClick={(e) => { e.stopPropagation(); setFocus(s.id); }} className="absolute bottom-9 left-2 rounded-full bg-black/60 px-2.5 py-0.5 text-[11px] font-bold text-white opacity-100 hover:bg-black/80 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">Zoom</button>
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                    <p className="text-[11px] text-slate-500">{s.client_type === 'web' ? 'browser' : s.client_type}{s.platform ? ` · ${s.platform}` : ''}{s.status !== 'ENDED' && s.seen_ago > 15 ? ` · seen ${s.seen_ago}s ago` : ''}</p>
                    {(s.status === 'PAUSED' || s.status === 'LEFT') && <p className="text-xs font-semibold text-amber-300">{why(s.pause_reason ?? s.last_violation)}</p>}
                    <div className="mt-auto flex flex-wrap gap-1.5">
                      {(s.status === 'PAUSED' || s.status === 'LEFT') && <button type="button" className="min-h-9 rounded-lg bg-blue-500 px-3 text-xs font-bold text-white hover:bg-blue-400 disabled:opacity-40" disabled={busy} onClick={() => act(() => call(`/sessions/${s.id}/resume`, 'POST'))}>Resume</button>}
                      {sound && streams[s.id] && <button type="button" className={`${listen === s.id ? 'bg-white text-slate-950' : 'border border-white/15 bg-white/5 text-slate-100 hover:bg-white/10'} min-h-9 rounded-lg px-3 text-xs font-semibold`} onClick={() => setListen(listen === s.id ? null : s.id)}>{listen === s.id ? 'Stop listening' : 'Listen'}</button>}
                      {s.status !== 'ENDED' && <button type="button" className={needs(s) ? 'min-h-9 rounded-lg bg-rose-600 px-3 text-xs font-bold text-white hover:bg-rose-500 disabled:opacity-40' : 'min-h-9 rounded-lg border border-white/15 bg-white/5 px-3 text-xs font-semibold text-rose-300 hover:bg-white/10 disabled:opacity-40'} disabled={busy} onClick={() => { if (confirm(`End the test for ${s.student_name}?`)) void act(() => call(`/sessions/${s.id}/end`, 'POST')); }}>End</button>}
                      <button type="button" className="min-h-9 rounded-lg border border-white/15 bg-white/5 px-3 text-xs font-semibold text-slate-200 hover:bg-white/10" onClick={async () => { try { setLog({ name: s.student_name, rows: await call(`/sessions/${s.id}/violations`) }); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load.'); } }}>
                        {s.violation_count === 0 ? 'No problems' : `${s.violation_count} problem${s.violation_count === 1 ? '' : 's'}`}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>

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

      {log && (
        <div role="dialog" aria-label="What happened" className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center" onClick={() => setLog(null)}>
          <div className="max-h-[80dvh] w-full max-w-md overflow-auto rounded-2xl border border-white/10 bg-slate-900 p-5 text-slate-100 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">{log.name}: what happened</h2><button type="button" className={dBtn} onClick={() => setLog(null)}>Close</button></div>
            {log.rows.length === 0 ? <p className="text-sm text-slate-400">Nothing to report.</p> : (
              <ul className="space-y-1.5 text-sm">{log.rows.map((v) => <li key={v.id} className="flex justify-between gap-3"><span>{why(v.type)}</span><span className="text-slate-400">{new Date(v.created_at).toLocaleTimeString()}</span></li>)}</ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
