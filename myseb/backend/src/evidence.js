// Evidence for a flagged moment: the camera and screen pictures that were on the server when a rule was broken. Like every picture here
// they stay in memory only (never the database or disk): a few per student, a hard total cap, and forgotten after 12 hours or at restart.
// They exist only if the lecturer had camera pictures on. The lecturer can download what they need to keep.
import { getLive } from './live.js';

const MAX_PER_STUDENT = 6;
const TTL_MS = 12 * 3600_000;
const MAX_BYTES = Number(process.env.MYSEB_MAX_EVIDENCE_MB || 100) * 1_000_000;
const byStudent = new Map();   // sessionId -> { examId, items: [{ at, type, frame, screen }] }
let bytes = 0;
const sz = (e) => (e.frame?.length ?? 0) + (e.screen?.length ?? 0);

/** Keep the pictures that are on the server right now, as evidence of this violation. */
export function captureEvidence(sessionId, examId, type, now = Date.now()) {
  const live = getLive(sessionId);
  if (!live || (!live.frame && !live.screen)) return false;
  const e = { at: now, type: String(type).slice(0, 40), frame: live.frame ?? null, screen: live.screen ?? null };
  if (bytes + sz(e) > MAX_BYTES) { evictOldest(sz(e)); if (bytes + sz(e) > MAX_BYTES) return false; }
  const rec = byStudent.get(sessionId) ?? { examId, items: [] };
  rec.items.push(e); bytes += sz(e);
  // keep the first picture (what the room looked like at the start of trouble) and the newest ones
  while (rec.items.length > MAX_PER_STUDENT) { const [gone] = rec.items.splice(1, 1); bytes -= sz(gone); }
  byStudent.set(sessionId, rec);
  return true;
}
function evictOldest(need) {
  const all = [...byStudent.entries()].sort((a, b) => (a[1].items[0]?.at ?? 0) - (b[1].items[0]?.at ?? 0));
  for (const [id, rec] of all) { for (const e of rec.items) bytes -= sz(e); byStudent.delete(id); if (bytes + need <= MAX_BYTES) break; }
}
export function evidenceOf(sessionId, now = Date.now()) {
  const rec = byStudent.get(sessionId);
  return (rec?.items ?? []).filter((e) => now - e.at < TTL_MS).map((e) => ({ at: new Date(e.at).toISOString(), type: e.type, frame: e.frame, screen: e.screen }));
}
export const evidenceCounts = (examId) => { const out = {}; for (const [id, rec] of byStudent) if (rec.examId === examId) out[id] = rec.items.length; return out; };
export function sweepEvidence(now = Date.now()) { for (const [id, rec] of byStudent) { const keep = rec.items.filter((e) => now - e.at < TTL_MS); for (const e of rec.items) if (!keep.includes(e)) bytes -= sz(e); if (keep.length) rec.items = keep; else byStudent.delete(id); } }
export const evidenceBytes = () => bytes;
export function _resetEvidence() { byStudent.clear(); bytes = 0; }
