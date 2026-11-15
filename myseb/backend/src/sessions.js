import { q } from './db.js';
import { config, sha } from './config.js';
import { tokenHash } from './security.js';
import { forgetLive, sweepLive, sweepSignals } from './live.js';

export const VIOLATION_TYPES = new Set([
  'leave', 'blur', 'background', 'visibility_hidden', 'fullscreen_exit', 'split_screen', 'screen_recording',
  'screenshot', 'copy', 'paste', 'cut', 'devtools', 'close_attempt', 'shortcut', 'heartbeat_lost', 'token_misuse',
  'extra_display', 'forbidden_app',
]);
/** Violations that mean "the student was not looking at the exam": exam.leave_action decides what happens. */
const LEAVE_LIKE = new Set(['leave', 'blur', 'background', 'visibility_hidden', 'fullscreen_exit', 'split_screen', 'screen_recording', 'extra_display', 'forbidden_app']);

const MARK = /MySEB\//;

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
    `SELECT s.*, e.title, e.exam_url, e.require_myseb, e.allow_extension, e.leave_action, e.status AS exam_status
       FROM exam_sessions s JOIN exams e ON e.id = s.exam_id WHERE s.token_hash = $1`, [tokenHash(key)]);
  const row = rows[0];
  if (!row) return { error: 'invalid' };

  const ua = req.get('user-agent') || '';
  const client = viaCookie ? 'mobile' : (req.get('x-myseb-client') || '');
  const device = req.get('x-myseb-device') || '';
  let ok = client === row.client_type;
  if (viaCookie) ok = ok && row.client_type === 'mobile' && MARK.test(ua);
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
  if (session.status === 'ENDED' || !LEAVE_LIKE.has(type) && type !== 'heartbeat_lost') return;
  const action = exam.leave_action;
  if (action === 'pause') {
    await q(`UPDATE exam_sessions SET status='PAUSED', pause_reason=$2 WHERE id=$1 AND status IN ('IN_EXAM','LEFT')`, [session.id, type]);
  } else if (action === 'end') {
    await q(`UPDATE exam_sessions SET status='ENDED', ended_at=now(), end_reason=$2 WHERE id=$1 AND status <> 'ENDED'`, [session.id, type]);
  }
}

/** Runs every few seconds: heartbeat timeouts become LEFT, and finished exams / deadlines become ENDED. */
export async function sweep() {
  const lost = await q(
    `UPDATE exam_sessions SET status='LEFT', pause_reason='heartbeat_lost'
      WHERE status='IN_EXAM' AND last_heartbeat < now() - make_interval(secs => $1)
      RETURNING id, exam_id`, [config.heartbeatTimeoutSeconds]);
  for (const r of lost.rows) {
    await q(`INSERT INTO violations (session_id, exam_id, type, detail) VALUES ($1,$2,'heartbeat_lost','{}')`, [r.id, r.exam_id]);
    await q('UPDATE exam_sessions SET violation_count = violation_count + 1 WHERE id=$1', [r.id]);
  }
  const timedOut = await q(`UPDATE exam_sessions SET status='ENDED', ended_at=now(), end_reason='time_up' WHERE status <> 'ENDED' AND deadline_at < now() RETURNING id`);
  timedOut.rows.forEach((r) => forgetLive(r.id));
  sweepLive();
  sweepSignals();
  await q(`UPDATE exams SET status='ended', ends_at=COALESCE(ends_at, now()) WHERE status='active' AND ends_at IS NOT NULL AND ends_at < now()`);
}

export const _sha = sha;
