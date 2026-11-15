import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '../utils/authFetch';

/**
 * The live room: every student in a MySEB test or hand-in on one screen. A tile per student shows the camera picture (if you
 * asked for it), the question they are on, and what they did; Resume and End are on the tile. Nothing else to learn.
 */
type Status = 'IN_EXAM' | 'PAUSED' | 'LEFT' | 'ENDED';
interface Student {
  id: string; student_name: string; status: Status; client_type: string; platform: string | null; violation_count: number;
  last_violation: string | null; pause_reason: string | null; end_reason: string | null; seen_ago: number;
  live: { question: { index: number | null; total: number | null; label: string } | null; camera: string; frame: string | null; frame_age: number | null } | null;
}
interface Room { exam: { title: string; status: string; live_faces: boolean; live_mode?: 'off' | 'pictures' | 'live'; live_sound?: boolean }; counts: Record<Status, number>; students: Student[] }
interface Code { display: string; qrSvg: string; expiresAt: string }

const LABEL: Record<Status, string> = { IN_EXAM: 'In the test', PAUSED: 'Paused', LEFT: 'Left', ENDED: 'Finished' };
const TONE: Record<Status, string> = { IN_EXAM: 'bg-emerald-600', PAUSED: 'bg-amber-600', LEFT: 'bg-rose-600', ENDED: 'bg-slate-500' };
const RING: Record<Status, string> = { IN_EXAM: 'border-slate-200', PAUSED: 'border-amber-400 ring-2 ring-amber-200', LEFT: 'border-rose-400 ring-2 ring-rose-200', ENDED: 'border-slate-200 opacity-70' };
const WHY: Record<string, string> = {
  leave: 'Left the test screen', background: 'Left the app', blur: 'Switched window', heartbeat_lost: 'Lost connection', screenshot: 'Tried a screenshot',
  copy: 'Tried to copy', paste: 'Tried to paste', cut: 'Tried to cut', devtools: 'Opened developer tools', shortcut: 'Pressed a blocked key', close_attempt: 'Tried to close the app',
  extra_display: 'Second screen', forbidden_app: 'Remote or recording app', fullscreen_exit: 'Left full screen', split_screen: 'Split screen', screen_recording: 'Screen recording',
  visibility_hidden: 'Hid the tab', token_misuse: 'Used the key from another place', teacher: 'Paused by you',
};
const why = (k: string | null) => (k ? WHY[k] ?? k : '');

const btn = 'min-h-10 rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40';
const btnDark = 'min-h-10 rounded-xl bg-slate-900 px-3.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40';

/** How many students show live video at once. More than this and the lecturer's own computer, not ours, is the limit. */
const MAX_LIVE = 12;

/**
 * Live video. Each student's browser sends one small video stream straight to this browser (WebRTC); our servers only pass the
 * set-up messages. Only the tiles on screen (up to MAX_LIVE) connect, so a class of hundreds is fine: everyone else shows the
 * small picture. Sound is silent until you press Listen on one tile, so you hear one student at a time.
 */
function useLiveViewers(base: string, enabled: boolean, wanted: string[], listen: string | null) {
  const [streams, setStreams] = useState<Record<string, MediaStream>>({});
  const [tick, setTick] = useState(0);
  const viewer = useRef('v' + Math.random().toString(36).slice(2, 8));
  const pcs = useRef(new Map<string, RTCPeerConnection>());
  const requested = useRef(new Set<string>());
  const pending = useRef(new Map<string, RTCIceCandidateInit[]>());
  const wantedRef = useRef(new Set<string>());
  const iceRef = useRef<RTCIceServer[] | null>(null);
  const listening = useRef<string | null>(null);
  wantedRef.current = new Set(wanted);

  const post = useCallback((sid: string, msg: Record<string, unknown>) =>
    authFetch(`${base}/signal/${sid}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msg: { ...msg, viewer: viewer.current } }) }).catch(() => undefined), [base]);
  const drop = useCallback((sid: string) => {
    pcs.current.get(sid)?.close(); pcs.current.delete(sid); requested.current.delete(sid); pending.current.delete(sid);
    setStreams((s) => { if (!(sid in s)) return s; const n = { ...s }; delete n[sid]; return n; });
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
        pc.ontrack = (e) => setStreams((s) => ({ ...s, [sid]: e.streams[0] }));
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

  // Sound: one student at a time.
  useEffect(() => {
    const prev = listening.current;
    if (prev && prev !== listen) void post(prev, { type: 'listen', on: false });
    listening.current = listen;
    if (listen) void post(listen, { type: 'listen', on: true });
  }, [listen, post]);

  useEffect(() => () => { pcs.current.forEach((pc) => pc.close()); [...requested.current].forEach((sid) => void post(sid, { type: 'unwatch' })); if (listening.current) void post(listening.current, { type: 'listen', on: false }); }, [post]);
  return streams;
}

function LiveVideo({ stream, muted }: { stream: MediaStream; muted: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className="h-full w-full -scale-x-100 object-cover" />;
}

export default function LiveRoom({ kind, id, onBack }: { kind: 'form' | 'task'; id: string; onBack: () => void }) {
  const base = `${kind === 'form' ? '/api/forms' : '/api/assignments'}/${encodeURIComponent(id)}/myseb`;
  const [room, setRoom] = useState<Room | null>(null);
  const [err, setErr] = useState('');
  const [code, setCode] = useState<Code | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ name: string; rows: Array<{ id: number; type: string; created_at: string }> } | null>(null);
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [listen, setListen] = useState<string | null>(null);
  const [pics, setPics] = useState<Record<string, { frame: string; age: number | null }>>({});

  const call = useCallback(async (path: string, method = 'GET', body?: unknown) => {
    const r = await authFetch(`${base}${path}`, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b.error || 'Something went wrong.');
    return b;
  }, [base]);

  const refresh = useCallback(() => { call('/monitor?frames=0').then((b) => { setRoom(b); setErr(''); }).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load.')); }, [call]);
  useEffect(() => { document.title = 'Live room · Bwenge'; refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t); }, [refresh]);

  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); refresh(); } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong.'); } finally { setBusy(false); } };
  const makeCode = () => act(async () => { setCode(await call('/code', 'POST')); setShowCode(true); });
  const students = room?.students ?? [];
  const needs = (s: Student) => s.status === 'PAUSED' || s.status === 'LEFT' || s.live?.camera === 'denied';
  const shown = [...students].filter((s) => !onlyAttention || needs(s)).sort((a, b) => Number(needs(b)) - Number(needs(a)) || a.student_name.localeCompare(b.student_name));
  const attention = students.filter(needs).length;
  const open = room?.exam.status !== 'ended';
  const mode = room?.exam.live_mode ?? (room?.exam.live_faces ? 'pictures' : 'off');
  const sound = !!room?.exam.live_sound && mode === 'live';
  // Who gets live video: the tiles on screen (needs-attention first), up to MAX_LIVE, plus the one you listen to.
  const wanted = useMemo(() => {
    if (mode !== 'live') return [];
    const ids = shown.filter((s) => (s.status === 'IN_EXAM' || s.status === 'PAUSED') && visible.has(s.id)).map((s) => s.id).slice(0, MAX_LIVE);
    if (listen && !ids.includes(listen)) ids.push(listen);
    return ids;
  }, [mode, shown, visible, listen]);
  // Pictures only for the tiles on screen, so a big room does not download everyone's picture every few seconds.
  const picKey = [...visible].slice(0, 60).sort().join(',');
  useEffect(() => {
    if (mode === 'off' || !picKey) { setPics({}); return; }
    let stop = false;
    const get = () => call(`/frames?ids=${picKey}`).then((b) => { if (!stop) setPics(b.frames ?? {}); }).catch(() => undefined);
    void get(); const t = setInterval(get, 5000);
    return () => { stop = true; clearInterval(t); };
  }, [mode, picKey, call]);
  const streams = useLiveViewers(base, mode === 'live', wanted, sound ? listen : null);
  const observer = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    observer.current = new IntersectionObserver((entries) => setVisible((cur) => { const n = new Set(cur); for (const e of entries) { const id = (e.target as HTMLElement).dataset.sid!; if (e.isIntersecting) n.add(id); else n.delete(id); } return n; }), { rootMargin: '120px' });
    return () => observer.current?.disconnect();
  }, []);
  const watchTile = useCallback((el: HTMLElement | null) => { if (el) observer.current?.observe(el); }, []);
  useEffect(() => { if (listen && (!sound || !streams[listen])) { if (!sound) setListen(null); } }, [sound, listen, streams]);

  return (
    <div className="min-h-[100dvh] bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <button type="button" onClick={onBack} className={btn} aria-label="Back">←</button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold">{room?.exam.title ?? 'Live room'}</h1>
            <p className="text-xs text-slate-500">{open ? 'Live: updates every few seconds' : 'This test has ended'}</p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[12px] font-bold text-white">
            {(['IN_EXAM', 'PAUSED', 'LEFT', 'ENDED'] as Status[]).map((k) => <span key={k} className={`rounded-full px-3 py-1 ${TONE[k]}`}>{LABEL[k]}: {room?.counts[k] ?? 0}</span>)}
          </div>
        </div>
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 pb-3">
          <button type="button" className={btnDark} onClick={() => (code ? setShowCode((v) => !v) : void makeCode())} disabled={busy || !open}>{code ? (showCode ? 'Hide code' : 'Show code') : 'Get code for students'}</button>
          <button type="button" className={btn} disabled={busy || !open} onClick={() => act(() => call('/pause-all', 'POST'))}>Pause everyone</button>
          <button type="button" className={btn} disabled={busy || !open} onClick={() => act(() => call('/resume-all', 'POST'))}>Let everyone continue</button>
          <label className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold">
            Camera
            <select className="bg-transparent font-semibold outline-none" value={mode} disabled={busy || !open} onChange={(e) => act(() => call('/settings', 'POST', { liveMode: e.target.value, liveSound: sound }))}>
              <option value="off">Off</option><option value="pictures">Pictures (every 10 s)</option><option value="live">Live video</option>
            </select>
          </label>
          {mode === 'live' && (
            <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold">
              <input type="checkbox" className="h-4 w-4" checked={sound} disabled={busy || !open} onChange={(e) => act(() => call('/settings', 'POST', { liveMode: 'live', liveSound: e.target.checked }))} />
              Allow listening
            </label>
          )}
          <span className="flex-1" />
          <button type="button" className={`${btn} ${onlyAttention ? '!bg-amber-100' : ''}`} onClick={() => setOnlyAttention((v) => !v)}>{onlyAttention ? 'Show everyone' : `Needs attention${attention ? ` (${attention})` : ''}`}</button>
          <button type="button" className={`${btn} !border-rose-300 !text-rose-700`} disabled={busy || !open} onClick={() => { if (confirm('End the test for everyone? The code stops working.')) void act(() => call('/end', 'POST')); }}>End test</button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5">
        {err && <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{err}</p>}
        {mode !== 'off' && <p className="mb-4 text-xs text-slate-500">
          Students were told about the camera and must agree. {mode === 'live' ? `Live video is shown for the ${MAX_LIVE} students on screen at a time; the rest show a small picture. Nothing is recorded or saved.${sound ? ' Press Listen on a tile to hear that student; they see a notice while you do.' : ''}` : 'Pictures are small, replaced every 10 seconds, and never saved.'}
        </p>}

        {showCode && code && (
          <section className="mb-5 flex flex-wrap items-center gap-6 rounded-2xl border border-slate-200 bg-white p-5">
            <div>
              <p className="text-sm text-slate-500">Students type this in MySEB</p>
              <p className="my-1 font-mono text-4xl font-bold tracking-wider sm:text-5xl">{code.display}</p>
              <button type="button" className={btn} onClick={async () => { await navigator.clipboard.writeText(code.display); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : 'Copy'}</button>
              <button type="button" className={`${btn} ml-2`} onClick={() => void makeCode()}>New code</button>
              <p className="mt-2 max-w-sm text-xs text-slate-500">One code works for the whole class. It expires {new Date(code.expiresAt).toLocaleString()} or when you end the test. Install links: <a className="underline" href="/myseb" target="_blank" rel="noreferrer">bwenge.space/myseb</a>.</p>
            </div>
            <img alt="QR code: open MySEB on a phone" className="h-40 w-40 rounded-xl border border-slate-200 bg-white p-1" src={`data:image/svg+xml;utf8,${encodeURIComponent(code.qrSvg)}`} />
          </section>
        )}

        {!room ? <p className="py-20 text-center text-slate-500">Loading…</p> : students.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
            <p className="text-lg font-semibold">Nobody is in yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">Get a code, show it to your students, and they will appear here as they join MySEB.</p>
            {open && <button type="button" className={`${btnDark} mt-4`} onClick={() => void makeCode()} disabled={busy}>Get code for students</button>}
          </div>
        ) : shown.length === 0 ? <p className="py-16 text-center text-slate-500">Nobody needs attention right now.</p> : (
          <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">
            {shown.map((s) => {
              const q = s.live?.question;
              const pct = q?.index && q.total ? Math.min(100, Math.round((q.index / q.total) * 100)) : 0;
              return (
                <li key={s.id} data-sid={s.id} ref={watchTile} className={`flex flex-col overflow-hidden rounded-2xl border bg-white ${RING[s.status]}`}>
                  <div className="relative aspect-[4/3] bg-slate-100">
                    {streams[s.id] ? <LiveVideo stream={streams[s.id]} muted={listen !== s.id} /> : pics[s.id]?.frame ? <img src={pics[s.id].frame} alt={`Camera: ${s.student_name}`} className="h-full w-full -scale-x-100 object-cover" /> : (
                      <div className="flex h-full items-center justify-center px-3 text-center text-xs font-medium text-slate-400">
                        {mode === 'off' ? 'Camera is off' : s.live?.camera === 'denied' ? 'Camera blocked' : s.live?.camera === 'ask' ? 'Waiting for the student to agree' : s.status === 'ENDED' ? 'Finished' : 'No picture yet'}
                      </div>
                    )}
                    <span className={`absolute left-2 top-2 rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white ${TONE[s.status]}`}>{LABEL[s.status]}</span>
                    {streams[s.id] && <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />LIVE</span>}
                    {!streams[s.id] && pics[s.id]?.age != null && (pics[s.id].age as number) > 30 && <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 text-[10px] text-white">{pics[s.id].age}s ago</span>}
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5 p-3">
                    <p className="truncate text-sm font-bold" title={s.student_name}>{s.student_name}</p>
                    <p className="text-[11px] text-slate-500">{s.client_type}{s.platform ? ` · ${s.platform}` : ''}{s.status !== 'ENDED' && s.seen_ago > 15 ? ` · seen ${s.seen_ago}s ago` : ''}</p>
                    {s.status === 'ENDED' ? <p className="text-xs text-slate-500">{s.end_reason === 'student_exit' ? 'Student ended it' : s.end_reason === 'time_up' ? 'Time is up' : s.end_reason === 'teacher' ? 'Ended by you' : 'Finished'}</p> : (
                      <div>
                        <p className="truncate text-xs font-semibold text-slate-700" title={q?.label}>{q ? `${q.index ? `Q${q.index}${q.total ? ` of ${q.total}` : ''}` : ''}${q?.label ? `${q.index ? ' · ' : ''}${q.label}` : ''}` || '…' : 'Not started'}</p>
                        {q?.total ? <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div> : null}
                      </div>
                    )}
                    {(s.status === 'PAUSED' || s.status === 'LEFT') && <p className="text-xs font-semibold text-amber-700">{why(s.pause_reason ?? s.last_violation)}</p>}
                    <div className="mt-auto flex flex-wrap gap-1.5 pt-1.5">
                      {(s.status === 'PAUSED' || s.status === 'LEFT') && <button type="button" className={`${btnDark} !min-h-9 !px-3 text-xs`} disabled={busy} onClick={() => act(() => call(`/sessions/${s.id}/resume`, 'POST'))}>Resume</button>}
                      {sound && streams[s.id] && <button type="button" className={`${listen === s.id ? btnDark : btn} !min-h-9 !px-3 text-xs`} onClick={() => setListen(listen === s.id ? null : s.id)}>{listen === s.id ? 'Stop listening' : 'Listen'}</button>}
                      {s.status !== 'ENDED' && <button type="button" className={`${btn} !min-h-9 !px-3 text-xs !text-rose-700`} disabled={busy} onClick={() => { if (confirm(`End the test for ${s.student_name}?`)) void act(() => call(`/sessions/${s.id}/end`, 'POST')); }}>End</button>}
                      <button type="button" className={`${btn} !min-h-9 !px-3 text-xs`} onClick={async () => { try { setLog({ name: s.student_name, rows: await call(`/sessions/${s.id}/violations`) }); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load.'); } }}>
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

      {log && (
        <div role="dialog" aria-label="What happened" className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 p-3 sm:items-center" onClick={() => setLog(null)}>
          <div className="max-h-[80dvh] w-full max-w-md overflow-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">{log.name}: what happened</h2><button type="button" className={btn} onClick={() => setLog(null)}>Close</button></div>
            {log.rows.length === 0 ? <p className="text-sm text-slate-500">Nothing to report.</p> : (
              <ul className="space-y-1.5 text-sm">{log.rows.map((v) => <li key={v.id} className="flex justify-between gap-3"><span>{why(v.type)}</span><span className="text-slate-500">{new Date(v.created_at).toLocaleTimeString()}</span></li>)}</ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
