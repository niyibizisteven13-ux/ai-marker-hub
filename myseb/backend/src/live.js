/**
 * What the live room shows besides the status: the question each student is on and a small camera picture.
 * Everything here is in memory only. Nothing is written to the database or to disk, a picture is replaced by the next
 * one, and it is forgotten when the student ends, the exam ends, or 3 minutes pass without an update.
 */
const store = new Map(); // sessionId -> { question, camera, frame, at, frameAt }
const MAX_FRAME = 16_000;
const MAX_SCREEN = 30_000;  // a 400x225 JPEG of the screen, about 10-20 KB  // characters of data URL (~12 KB): a 160x120 JPEG is about 4-6 KB

export function cleanLive(body = {}) {
  const q = body.question && typeof body.question === 'object' ? body.question : null;
  const num = (v, max) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Math.round(Number(v)))) : null);
  const question = q ? { index: num(q.index, 10_000), total: num(q.total, 10_000), label: String(q.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) } : null;
  const camera = ['on', 'off', 'denied', 'ask', 'busy'].includes(body.camera) ? body.camera : 'off';
  const frame = typeof body.frame === 'string' && body.frame.length <= MAX_FRAME && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(body.frame) ? body.frame : null;
  const screen = typeof body.screen === 'string' && body.screen.length <= MAX_SCREEN && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(body.screen) ? body.screen : null;
  const screenState = ['on', 'off', 'denied', 'ask', 'partial'].includes(body.screenState) ? body.screenState : 'off';
  return { question, camera, frame, screen, screenState };
}

// Pictures live only in memory. A hard cap keeps a very big room from using all of it: past the cap new pictures are skipped (the
// question and status still update), so the server slows down gracefully instead of running out of memory.
const MAX_PICTURE_BYTES = Number(process.env.MYSEB_MAX_PICTURE_MB || 400) * 1_000_000;
let pictureBytes = 0;
const size = (v) => (v ? (v.frame?.length ?? 0) + (v.screen?.length ?? 0) : 0);
export const pictureMemory = () => pictureBytes;

// Pictures are only wanted from the students a lecturer is actually looking at (the tiles on screen, at most about 60). Everyone else
// sends only a few words of status. Asking for a student's picture keeps them "wanted" for 20 s; each report answers yes or no.
const wanted = new Map();   // sessionId -> expires at (ms)
export function wantPictures(ids) { const until = Date.now() + 20_000; for (const id of ids) wanted.set(id, until); }
export const picturesWanted = (id) => (wanted.get(id) ?? 0) > Date.now();
/** How often a student should report, so a very big room does not send thousands of reports a second. */
export const reportEverySeconds = () => (store.size < 500 ? 5 : store.size < 2000 ? 8 : store.size < 6000 ? 12 : 20);

/** Did anything the lecturer sees as text change (question, camera or screen state)? Then the room is told at once. */
export function liveChanged(prev, next, bigRoom = false) {
  // In a very big room a new question is not news (it would mean thousands of refreshes a second); a camera/screen problem always is.
  return !prev || (!bigRoom && prev.question?.index !== next.question?.index) || prev.camera !== next.camera || prev.screenState !== next.screenState;
}

export function saveLive(sessionId, body, keepFrames) {
  const c = cleanLive(body);
  const prev = store.get(sessionId);
  if (pictureBytes > MAX_PICTURE_BYTES) { c.frame = null; c.screen = null; }
  const now = Date.now();
  const next = {
    question: c.question ?? prev?.question ?? null,
    camera: c.camera,
    frame: keepFrames ? (c.frame ?? prev?.frame ?? null) : null,
    frameAt: keepFrames && c.frame ? now : (keepFrames ? prev?.frameAt ?? null : null),
    screenState: c.screenState,
    screen: keepFrames ? (c.screen ?? prev?.screen ?? null) : null,
    screenAt: keepFrames && c.screen ? now : (keepFrames ? prev?.screenAt ?? null : null),
    at: now,
  };
  pictureBytes += size(next) - size(prev);
  store.set(sessionId, next);
}
// How long (seconds) a browser student's face was turned well away from the camera: a number for the lecturer to judge, never a penalty.
const aside = new Map();
export const setAside = (id, secs) => { if (Number.isFinite(secs) && secs >= 0 && secs < 86_400) aside.set(id, Math.round(secs)); };
// Student card pictures waiting for the lecturer: server memory only (never the database), dropped at the decision or after 30 minutes.
const idPics = new Map();
export const setIdPic = (id, image) => { if (idPics.size < 3000 || idPics.has(id)) idPics.set(id, { image, at: Date.now() }); };
export const getIdPic = (id) => idPics.get(id)?.image ?? null;
export const dropIdPic = (id) => { idPics.delete(id); };
export const sweepIdPics = () => { const old = Date.now() - 30 * 60_000; for (const [k, v] of idPics) if (v.at < old) idPics.delete(k); };
export const getAside = (id) => aside.get(id) ?? 0;
export const getLive = (sessionId) => store.get(sessionId) ?? null;
export const forgetLive = (sessionId) => { pictureBytes -= size(store.get(sessionId)); store.delete(sessionId); };
export const forgetAside = (id) => { aside.delete(id); };
export function forgetAllLive(sessionIds) { for (const id of sessionIds) forgetLive(id); }
export function sweepLive() { sweepIdPics(); const now = Date.now(); for (const [k, until] of wanted) if (until < now) wanted.delete(k); const old = Date.now() - 180_000; for (const [k, v] of store) if (v.at < old) { pictureBytes -= size(v); store.delete(k); } }

/* ---------------------------------------------------------------------------------------------------------------------
 * Set-up messages for live video (WebRTC). The video itself never touches this server: the student's browser sends it to
 * the lecturer's browser. Here only short messages pass (watch / offer / answer / ice candidates), in memory, for about a minute.
 * --------------------------------------------------------------------------------------------------------------------- */
const boxes = new Map(); // key -> { msgs: [{n, at, msg}], next, waiters:Set<fn> }
const box = (key) => { let b = boxes.get(key); if (!b) { b = { msgs: [], next: 1, waiters: new Set() }; boxes.set(key, b); } return b; };

const SIGNAL_TYPES = new Set(['watch', 'unwatch', 'listen', 'offer', 'answer', 'ice', 'state', 'quality']);
export function cleanSignal(m) {
  if (!m || typeof m !== 'object' || !SIGNAL_TYPES.has(m.type)) return null;
  const out = { type: m.type, viewer: String(m.viewer ?? '').replace(/[^\w-]/g, '').slice(0, 40) };
  if (typeof m.sdp === 'string') { if (m.sdp.length > 14_000) return null; out.sdp = m.sdp; }
  if (m.candidate && typeof m.candidate === 'object') {
    const c = { candidate: String(m.candidate.candidate ?? '').slice(0, 600), sdpMid: m.candidate.sdpMid == null ? null : String(m.candidate.sdpMid).slice(0, 20), sdpMLineIndex: Number.isInteger(m.candidate.sdpMLineIndex) ? m.candidate.sdpMLineIndex : null };
    out.candidate = c;
  }
  if (typeof m.screenStream === 'string') out.screenStream = m.screenStream.replace(/[^\w{}-]/g, '').slice(0, 80);
  if (m.type === 'quality') out.level = m.level === 'high' ? 'high' : m.level === 'tiny' ? 'tiny' : 'low';
  if (typeof m.on === 'boolean') out.on = m.on;
  if (typeof m.audio === 'boolean') out.audio = m.audio;
  if (typeof m.state === 'string') out.state = m.state.slice(0, 20);
  return out;
}

// One lecturer's inbox collects the offers and network candidates of every student they watch (about 10 each): 500 live students need room for a few thousand.
export const SIGNAL_CAP = Number(process.env.MYSEB_SIGNAL_CAP) > 0 ? Number(process.env.MYSEB_SIGNAL_CAP) : 6000;
export function pushSignal(key, msg) {
  const b = box(key);
  b.msgs.push({ n: b.next++, at: Date.now(), msg });
  if (b.msgs.length > SIGNAL_CAP) b.msgs.splice(0, b.msgs.length - SIGNAL_CAP);
  for (const w of [...b.waiters]) w();
}

/** Messages after `after`. Waits up to `waitMs` (long poll) when there are none yet. `signal` is aborted when the caller goes away. */
const MAX_WAITERS = Number(process.env.MYSEB_MAX_WAITERS || 8000);   // students waiting for a lecturer message at one moment
let waiting = 0;
export const waitingCount = () => waiting;
export function pullSignal(key, after, waitMs, signal) {
  if (waiting >= MAX_WAITERS) waitMs = 0;            // overloaded: answer now (empty) instead of holding one more connection
  const b = box(key);
  const ready = () => b.msgs.filter((m) => m.n > after);
  const done = () => { const msgs = ready(); return { msgs: msgs.map((m) => ({ n: m.n, ...m.msg })), next: msgs.length ? msgs[msgs.length - 1].n : Math.max(after, b.next - 1) }; };
  if (ready().length || waitMs <= 0) return Promise.resolve(done());
  return new Promise((resolve) => {
    let over = false;
    const finish = () => { if (!over) { over = true; waiting--; } clearTimeout(t); b.waiters.delete(finish); signal?.removeEventListener?.('abort', finish); resolve(done()); };
    const t = setTimeout(finish, waitMs);
    waiting++;
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
export const liveStats = () => ({ reports: store.size, mailboxes: boxes.size, waiting, pictureMb: Math.round(pictureBytes / 1e6) });
