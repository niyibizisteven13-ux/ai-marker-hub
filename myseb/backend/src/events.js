/**
 * Instant updates for the lecturer's live room. A lecturer's room keeps one stream open (Server-Sent Events); the moment something
 * changes (a student joins, leaves, breaks a rule, is paused or ended, or moves to another question) a short "changed" message
 * goes down it and the room asks for the fresh list at once, instead of waiting for the next timed refresh.
 * Messages are merged over 120 ms, so a class that all submits together causes a few messages, not thousands.
 * Nothing about a student is in the message: it only says "look again".
 */
const rooms = new Map();                 // examId -> { subs: Set<res>, timer, kinds: Set }
const MAX_PER_EXAM = Number(process.env.MYSEB_MAX_ROOM_STREAMS || 12);
const MAX_TOTAL = Number(process.env.MYSEB_MAX_STREAMS || 300);
let total = 0;

export function subscribe(examId, res) {
  if (total >= MAX_TOTAL) return false;
  let room = rooms.get(examId);
  if (!room) { room = { subs: new Set(), timer: null, kinds: new Set() }; rooms.set(examId, room); }
  if (room.subs.size >= MAX_PER_EXAM) return false;
  room.subs.add(res); total++;
  const gone = () => { if (room.subs.delete(res)) total--; if (!room.subs.size && !room.timer) rooms.delete(examId); };
  res.on('close', gone); res.on('error', gone);
  return true;
}

/** Bumped on every change, so a shared copy of the student list knows when it is out of date. */
const versions = new Map();
export const roomVersion = (examId) => versions.get(examId) ?? 0;

export function notify(examId, kind = 'change') {
  versions.set(examId, (versions.get(examId) ?? 0) + 1);
  if (versions.size > 5000) versions.clear();
  const room = rooms.get(examId);
  if (!room) return;                    // nobody is watching this exam: nothing to do (the usual case, and free)
  room.kinds.add(kind);
  if (room.timer) return;
  room.timer = setTimeout(() => {
    room.timer = null;
    const msg = `data: ${JSON.stringify({ t: Date.now(), kinds: [...room.kinds] })}\n\n`;
    room.kinds.clear();
    for (const res of room.subs) { try { res.write(msg); } catch { /* closing */ } }
    if (!room.subs.size) rooms.delete(examId);
  }, 120);
  room.timer.unref?.();
}

/** Keeps idle streams alive through proxies (they close silent connections after about a minute). */
const ping = setInterval(() => { for (const room of rooms.values()) for (const res of room.subs) { try { res.write(': ping\n\n'); } catch { /* closing */ } } }, 15_000);
ping.unref?.();

export const eventStats = () => ({ streams: total, rooms: rooms.size });
