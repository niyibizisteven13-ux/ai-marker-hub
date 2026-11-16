import { q } from './db.js';
import { config, sha } from './config.js';
import { tokenHash } from './security.js';
import { forgetLive, sweepLive, sweepSignals } from './live.js';
import { notify } from './events.js';

export const VIOLATION_TYPES = new Set([
  'leave', 'blur', 'background', 'visibility_hidden', 'fullscreen_exit', 'split_screen', 'screen_recording',
  'screenshot', 'copy', 'paste', 'cut', 'devtools', 'close_attempt', 'shortcut', 'heartbeat_lost', 'token_misuse',
  'extra_display', 'forbidden_app', 'screen_share_stopped',
  'face_missing', 'camera_off', 'multiple_faces', 'face_check_unavailable',
]);
/** In a browser with strict rules (the default), these end the test on the spot: nothing is paused for the lecturer to forgive. */
const STRICT_END = new Set(['face_missing', 'camera_off']);   // 'multiple_faces' ends the test only when the lecturer chose it (multi_face = 'end')
/** Violations that mean "the student was not looking at the exam": exam.leave_action decides what happens. */
const LEAVE_LIKE = new Set(['leave', 'blur', 'background', 'visibility_hidden', 'fullscreen_exit', 'split_screen', 'screen_recording', 'extra_display', 'forbidden_app', 'screen_share_stopped']);

const MARK = /MySEB\//;
/** iPhone, iPad, iPod. An iPad in desktop mode sends a Mac user agent: the page says it has a touch screen (a claim the server cannot check). */
export const isIosDevice = (ua = '', claimsTouch = false) => /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && claimsTouch);

/**
 * Finds the session for a request and decides whether this client is allowed to use its key.
 * Returns { session, exam } or { error }. Never reveals *why* to the caller beyond a generic message.
 * `cookie` fallback exists only for mobile web views, which cannot attach a header to sub-resource requests;
 * the cookie is HttpOnly, set by this server on a request that DID carry the header, and is only honoured
 * for sessions that were opened by the mobile app and from a MySEB user agent.
 */
export async function authSession(req, { allowCookie = false } = {}) {
  let key = req.get('x-myseb-key');
  let viaCookie = false;
  if (!key && allowCookie) {
    key = (req.get('cookie') || '').match(/(?:^|;\s*)myseb_s=([A-Za-z0-9_-]{20,80})/)?.[1];
    viaCookie = !!key;
  }
  if (!key || key.length > 100) return { error: 'missing' };

  const { rows } = await q(
    `SELECT s.*, e.title, e.exam_url, e.require_myseb, e.allow_extension, e.allow_web, e.web_strict, e.web_devices, e.multi_face, e.id_check, e.leave_action, e.status AS exam_status
       FROM exam_sessions s JOIN exams e ON e.id = s.exam_id WHERE s.token_hash = $1`, [tokenHash(key)]);
  const row = rows[0];
  if (!row) return { error: 'invalid' };

  const ua = req.get('user-agent') || '';
  const client = viaCookie ? (row.client_type === 'web' ? 'web' : 'mobile') : (req.get('x-myseb-client') || '');
  const device = req.get('x-myseb-device') || '';
  let ok = client === row.client_type;
  if (row.client_type === 'web') ok = ok && viaCookie && row.allow_web && !!row.ua_hash && row.ua_hash === sha(ua);   // a browser: its secure cookie, from the same browser it was given to
  else if (viaCookie) ok = ok && row.client_type === 'mobile' && MARK.test(ua);
  else if (row.client_type === 'extension') ok = ok && row.allow_extension && device === row.device_id;
  else ok = ok && MARK.test(ua) && device === row.device_id; // desktop + mobile native calls: marker UA AND the device the token was issued to
  if (!ok) {
    // Someone is replaying a token from the wrong place (e.g. a normal Chrome tab). Block and tell the teacher.
    if (row.status !== 'ENDED') await recordViolation(row, row, 'token_misuse', { client, ua: ua.slice(0, 120), viaCookie });
    return { error: 'wrong_client' };
  }
  return { session: row, exam: row, viaCookie };
}

/** Records a violation and applies the exam's leave policy. */
export async function recordViolation(session, exam, type, detail = {}) {
  let json = JSON.stringify(detail ?? {});
  if (json.length > 2000) json = JSON.stringify({ truncated: json.slice(0, 1900) });
  await q('INSERT INTO violations (session_id, exam_id, type, detail) VALUES ($1,$2,$3,$4)', [session.id, session.exam_id, type, json]);
  await q('UPDATE exam_sessions SET violation_count = violation_count + 1 WHERE id = $1', [session.id]);
  const strict = session.client_type === 'web' && exam.web_strict !== false;
  if (session.status === 'ENDED' || !LEAVE_LIKE.has(type) && type !== 'heartbeat_lost' && !(strict && (STRICT_END.has(type) || (type === 'multiple_faces' && exam.multi_face === 'end')))) { notify(session.exam_id, 'violation'); return; }
  let action = exam.leave_action;
  // A weak connection is not a reason to reject anyone: a lost heartbeat still follows the lecturer's own leave rule.
  if (strict && type !== 'heartbeat_lost') action = 'end';
  if (action === 'pause_then_end') {
    // First time away: paused, the lecturer sees an alert and decides. Second time: the quiz is closed on the spot.
    const before = (await q(`SELECT count(*)::int AS n FROM violations WHERE session_id=$1 AND type = ANY($2::text[]) AND id < (SELECT max(id) FROM violations WHERE session_id=$1)`, [session.id, [...LEAVE_LIKE, 'heartbeat_lost']])).rows[0].n;
    action = before >= 1 ? 'end' : 'pause';
  }
  if (action === 'pause') {
    await q(`UPDATE exam_sessions SET status='PAUSED', pause_reason=$2 WHERE id=$1 AND status IN ('IN_EXAM','LEFT')`, [session.id, type]);
  } else if (action === 'end') {
    await q(`UPDATE exam_sessions SET status='ENDED', ended_at=now(), end_reason=$2 WHERE id=$1 AND status <> 'ENDED'`, [session.id, type]);
  }
}

/** Runs every few seconds: heartbeat timeouts become LEFT, and finished exams / deadlines become ENDED. */
/**
 * Heartbeats are the busiest thing a big class does (every student, every 5 s). Writing each one to the database made the database the
 * limit. Now a heartbeat is checked against the database once (is this key right?) and its "still here" time is kept in memory and
 * written for everyone in ONE statement every 2 s. The sweep writes any waiting ones first, so nobody is wrongly marked as left.
 */
const alive = new Set();
export const markAlive = (id) => { alive.add(id); };
export async function flushHeartbeats() {
  if (!alive.size) return;
  const ids = [...alive]; alive.clear();
  try { await q(`UPDATE exam_sessions SET last_heartbeat = now() WHERE id = ANY($1::uuid[]) AND status <> 'ENDED'`, [ids]); }
  catch (e) { for (const id of ids) alive.add(id); throw e; }   // try again at the next flush
}

export async function sweep() {
  await flushHeartbeats();
  const lost = await q(
    `UPDATE exam_sessions SET status='LEFT', pause_reason='heartbeat_lost'
      WHERE status='IN_EXAM' AND last_heartbeat < now() - make_interval(secs => CASE WHEN client_type='web' THEN $1 * 3 ELSE $1 END)   -- a phone on a weak network gets three times as long
      RETURNING id, exam_id`, [config.heartbeatTimeoutSeconds]);
  for (const r of lost.rows) {
    notify(r.exam_id, 'status');
    await q(`INSERT INTO violations (session_id, exam_id, type, detail) VALUES ($1,$2,'heartbeat_lost','{}')`, [r.id, r.exam_id]);
    await q('UPDATE exam_sessions SET violation_count = violation_count + 1 WHERE id=$1', [r.id]);
  }
  const timedOut = await q(`UPDATE exam_sessions SET status='ENDED', ended_at=now(), end_reason='time_up' WHERE status <> 'ENDED' AND deadline_at < now() RETURNING id, exam_id`);
  timedOut.rows.forEach((r) => { forgetLive(r.id); notify(r.exam_id, 'status'); });
  sweepLive();
  sweepSignals();
  await q(`UPDATE exams SET status='ended', ends_at=COALESCE(ends_at, now()) WHERE status='active' AND ends_at IS NOT NULL AND ends_at < now()`);
}

export const _sha = sha;

/**
 * Privacy: a finished exam's students, their violation logs and its codes are deleted after RETENTION_DAYS (default 90).
 * Nothing about a student is kept longer than the lecturer can need it for an appeal.
 */
export async function purgeOld(days = config.retentionDays) {
  if (!(days > 0)) return { sessions: 0, exams: 0 };
  const sessions = await q(`DELETE FROM exam_sessions WHERE ended_at IS NOT NULL AND ended_at < now() - make_interval(days => $1)`, [days]);
  const exams = await q(`DELETE FROM exams WHERE status = 'ended' AND ends_at < now() - make_interval(days => $1)`, [days]);
  return { sessions: sessions.rowCount, exams: exams.rowCount };
}
