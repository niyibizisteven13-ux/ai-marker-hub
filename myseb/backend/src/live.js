/**
 * What the live room shows besides the status: the question each student is on and a small camera picture.
 * Everything here is in memory only. Nothing is written to the database or to disk, a picture is replaced by the next
 * one, and it is forgotten when the student ends, the exam ends, or 3 minutes pass without an update.
 */
const store = new Map(); // sessionId -> { question, camera, frame, at, frameAt }
const MAX_FRAME = 16_000;  // characters of data URL (~12 KB): a 160x120 JPEG is about 4-6 KB

export function cleanLive(body = {}) {
  const q = body.question && typeof body.question === 'object' ? body.question : null;
  const num = (v, max) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Math.round(Number(v)))) : null);
  const question = q ? { index: num(q.index, 10_000), total: num(q.total, 10_000), label: String(q.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) } : null;
  const camera = ['on', 'off', 'denied', 'ask'].includes(body.camera) ? body.camera : 'off';
  const frame = typeof body.frame === 'string' && body.frame.length <= MAX_FRAME && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(body.frame) ? body.frame : null;
  return { question, camera, frame };
}

export function saveLive(sessionId, body, keepFrames) {
  const c = cleanLive(body);
  const prev = store.get(sessionId);
  const now = Date.now();
  store.set(sessionId, {
    question: c.question ?? prev?.question ?? null,
    camera: c.camera,
    frame: keepFrames ? (c.frame ?? prev?.frame ?? null) : null,
    frameAt: keepFrames && c.frame ? now : (keepFrames ? prev?.frameAt ?? null : null),
    at: now,
  });
}
export const getLive = (sessionId) => store.get(sessionId) ?? null;
export const forgetLive = (sessionId) => store.delete(sessionId);
export function forgetAllLive(sessionIds) { for (const id of sessionIds) store.delete(id); }
export function sweepLive() { const old = Date.now() - 180_000; for (const [k, v] of store) if (v.at < old) store.delete(k); }

/* ---------------------------------------------------------------------------------------------------------------------
 * Set-up messages for live video (WebRTC). The video itself never touches this server: the student's browser sends it to
 * the lecturer's browser. Here only short messages pass (watch / offer / answer / ice candidates), in memory, for about a minute.
 * --------------------------------------------------------------------------------------------------------------------- */
const boxes = new Map(); // key -> { msgs: [{n, at, msg}], next, waiters:Set<fn> }
const box = (key) => { let b = boxes.get(key); if (!b) { b = { msgs: [], next: 1, waiters: new Set() }; boxes.set(key, b); } return b; };

const SIGNAL_TYPES = new Set(['watch', 'unwatch', 'listen', 'offer', 'answer', 'ice', 'state']);
export function cleanSignal(m) {
  if (!m || typeof m !== 'object' || !SIGNAL_TYPES.has(m.type)) return null;
  const out = { type: m.type, viewer: String(m.viewer ?? '').replace(/[^\w-]/g, '').slice(0, 40) };
  if (typeof m.sdp === 'string') { if (m.sdp.length > 14_000) return null; out.sdp = m.sdp; }
  if (m.candidate && typeof m.candidate === 'object') {
    const c = { candidate: String(m.candidate.candidate ?? '').slice(0, 600), sdpMid: m.candidate.sdpMid == null ? null : String(m.candidate.sdpMid).slice(0, 20), sdpMLineIndex: Number.isInteger(m.candidate.sdpMLineIndex) ? m.candidate.sdpMLineIndex : null };
    out.candidate = c;
  }
  if (typeof m.on === 'boolean') out.on = m.on;
  if (typeof m.audio === 'boolean') out.audio = m.audio;
  if (typeof m.state === 'string') out.state = m.state.slice(0, 20);
  return out;
}

export function pushSignal(key, msg) {
  const b = box(key);
  b.msgs.push({ n: b.next++, at: Date.now(), msg });
  if (b.msgs.length > 300) b.msgs.splice(0, b.msgs.length - 300);
  for (const w of [...b.waiters]) w();
}

/** Messages after `after`. Waits up to `waitMs` (long poll) when there are none yet. `signal` is aborted when the caller goes away. */
export function pullSignal(key, after, waitMs, signal) {
  const b = box(key);
  const ready = () => b.msgs.filter((m) => m.n > after);
  const done = () => { const msgs = ready(); return { msgs: msgs.map((m) => ({ n: m.n, ...m.msg })), next: msgs.length ? msgs[msgs.length - 1].n : Math.max(after, b.next - 1) }; };
  if (ready().length || waitMs <= 0) return Promise.resolve(done());
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(t); b.waiters.delete(finish); signal?.removeEventListener?.('abort', finish); resolve(done()); };
    const t = setTimeout(finish, waitMs);
    b.waiters.add(finish);
    signal?.addEventListener?.('abort', finish);
  });
}
export function dropSignals(keys) { for (const k of keys) boxes.delete(k); }
export function sweepSignals() {
  const old = Date.now() - 90_000;
  for (const [k, b] of boxes) {
    b.msgs = b.msgs.filter((m) => m.at >= old);
    if (!b.msgs.length && !b.waiters.size) boxes.delete(k);
  }
}

/** Sizes of the in-memory stores, for monitoring. */
export const liveStats = () => ({ reports: store.size, mailboxes: boxes.size });
