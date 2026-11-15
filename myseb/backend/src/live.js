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
