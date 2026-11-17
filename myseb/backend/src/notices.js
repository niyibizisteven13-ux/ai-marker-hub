// A short message from the lecturer (or the room assistant) to the students of one test, or to one student. Kept in memory for ten
// minutes: a notice is "right now" information, and the students' heartbeat carries it, so nothing is stored in the database.
import { randomUUID } from 'node:crypto';
const TTL_MS = 10 * 60_000;
const byExam = new Map();      // examId -> { id, text, at }
const bySession = new Map();   // sessionId -> { id, text, at }

export function cleanText(v) { return String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 300); }
export function setNotice(examId, text, sessionId) {
  const t = cleanText(text); if (!t) return null;
  const n = { id: randomUUID().slice(0, 8), text: t, at: Date.now() };
  (sessionId ? bySession : byExam).set(sessionId || examId, n);
  if (byExam.size + bySession.size > 5000) sweep();
  return n;
}
/** The newest notice this student should see: their own, or the one for the whole test. */
export function noticeFor(examId, sessionId, now = Date.now()) {
  const a = bySession.get(sessionId), b = byExam.get(examId);
  const live = [a, b].filter((n) => n && now - n.at < TTL_MS).sort((x, y) => y.at - x.at)[0];
  return live ? { id: live.id, text: live.text } : null;
}
export function sweep(now = Date.now()) { for (const m of [byExam, bySession]) for (const [k, n] of m) if (now - n.at >= TTL_MS) m.delete(k); }
export function _resetNotices() { byExam.clear(); bySession.clear(); }
