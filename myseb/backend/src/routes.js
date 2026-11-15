import express from 'express';
import QRCode from 'qrcode';
import { q } from './db.js';
import { config, safeEqual } from './config.js';
import { newCode, parseCode, codeHash, secretHash, tokenHash, newToken, newSecret, rateLimit } from './security.js';
import { authSession, recordViolation, VIOLATION_TYPES } from './sessions.js';
import { forgetAllLive, forgetLive, getLive, saveLive } from './live.js';

export const api = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const isUuid = (s) => /^[0-9a-f-]{36}$/i.test(String(s));
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/* ---------------------------------------------------------------- teacher */
function requireTeacher(req, res, next) {
  const key = (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.get('x-teacher-key') || '';
  if (!key || !safeEqual(key, config.teacherKey)) return res.status(401).json({ error: 'Teacher key required' });
  next();
}
const teacherLimiter = rateLimit({ windowMs: 60_000, max: 30, keyFn: (r) => 'tk:' + r.ip });
api.use('/teacher/login', teacherLimiter);
api.post('/teacher/login', requireTeacher, (_req, res) => res.json({ ok: true }));

api.post('/exams', requireTeacher, wrap(async (req, res) => {
  const b = req.body || {};
  const title = str(b.title, 200);
  if (!title) return res.status(400).json({ error: 'title is required' });
  let examUrl = str(b.examUrl, 1000);
  if (examUrl && !/^https?:\/\//i.test(examUrl)) return res.status(400).json({ error: 'examUrl must start with http:// or https://' });
  const leave = ['record', 'pause', 'end'].includes(b.leaveAction) ? b.leaveAction : 'pause';
  const minutes = Math.max(1, Math.min(600, parseInt(b.durationMinutes, 10) || 60));
  const { rows } = await q(
    `INSERT INTO exams (title, exam_url, require_myseb, allow_extension, leave_action, duration_minutes)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [title, examUrl || 'pending', b.requireMyseb !== false, b.allowExtension === true, leave, minutes]);
  let exam = rows[0];
  if (!examUrl) exam = (await q('UPDATE exams SET exam_url=$2 WHERE id=$1 RETURNING *', [exam.id, `${config.publicUrl}/exam/${exam.id}/`])).rows[0];
  res.status(201).json(exam);
}));

api.get('/exams', requireTeacher, wrap(async (_req, res) => {
  const { rows } = await q(
    `SELECT e.*, (SELECT count(*) FROM exam_sessions s WHERE s.exam_id=e.id)::int AS students
       FROM exams e ORDER BY e.created_at DESC LIMIT 100`);
  res.json(rows);
}));

api.patch('/exams/:id', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const b = req.body || {};
  const sets = []; const vals = [req.params.id];
  const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (typeof b.requireMyseb === 'boolean') add('require_myseb', b.requireMyseb);
  if (typeof b.allowExtension === 'boolean') add('allow_extension', b.allowExtension);
  if (['record', 'pause', 'end'].includes(b.leaveAction)) add('leave_action', b.leaveAction);
  if (typeof b.liveFaces === 'boolean') add('live_faces', b.liveFaces);
  if (!sets.length) return res.status(400).json({ error: 'nothing to change' });
  const { rows } = await q(`UPDATE exams SET ${sets.join(',')} WHERE id=$1 RETURNING *`, vals);
  rows[0] ? res.json(rows[0]) : res.status(404).json({ error: 'not found' });
}));

/** One code = one exam. Many students may use the same code. The code and the secret are returned ONCE; only hashes are stored. */
api.post('/exams/:id/generate-code', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const { rows } = await q('SELECT * FROM exams WHERE id=$1', [req.params.id]);
  const exam = rows[0];
  if (!exam) return res.status(404).json({ error: 'not found' });
  if (exam.status === 'ended') return res.status(409).json({ error: 'This exam has ended' });

  const secret = newSecret();
  const expires = exam.ends_at ? new Date(exam.ends_at) : new Date(Date.now() + config.codeTtlHours * 3600_000);
  let code;
  for (let i = 0; i < 20; i++) {
    code = newCode();
    try {
      // An older code for the same exam keeps working until it expires: two classes can share an exam.
      await q('INSERT INTO exam_codes (exam_id, code_hash, secret_hash, expires_at) VALUES ($1,$2,$3,$4)',
        [exam.id, codeHash(code.digits), secretHash(secret), expires]);
      break;
    } catch (e) { if (e.code !== '23505' || i === 19) throw e; }
  }
  const joinUrl = `${config.publicUrl}/join/${code.digits}`;
  const qrSvg = await QRCode.toString(joinUrl, { type: 'svg', margin: 1, width: 240 });
  res.status(201).json({ code: code.digits, display: code.display, secret, joinUrl, qrSvg, expiresAt: expires });
}));

api.post('/exams/:id/end', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  await q(`UPDATE exams SET status='ended', ends_at=now() WHERE id=$1`, [req.params.id]);
  await q(`UPDATE exam_codes SET expires_at=now(), revoked_at=now() WHERE exam_id=$1`, [req.params.id]);   // code expires when the exam ends
  const ended = await q(`UPDATE exam_sessions SET status='ENDED', ended_at=now(), end_reason='exam_ended' WHERE exam_id=$1 AND status<>'ENDED' RETURNING id`, [req.params.id]);
  forgetAllLive(ended.rows.map((r) => r.id));
  res.json({ ok: true });
}));

api.get('/exams/:id/monitor', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const ex = (await q('SELECT id, title, status, live_faces, require_myseb, leave_action FROM exams WHERE id=$1', [req.params.id])).rows[0];
  if (!ex) return res.status(404).json({ error: 'not found' });
  const { rows } = await q(
    `SELECT s.id, s.student_name, s.status, s.client_type, s.platform, s.violation_count, s.pause_reason, s.end_reason,
            s.started_at, s.deadline_at, EXTRACT(EPOCH FROM (now() - s.last_heartbeat))::int AS seen_ago,
            (SELECT type FROM violations v WHERE v.session_id=s.id ORDER BY v.id DESC LIMIT 1) AS last_violation
       FROM exam_sessions s WHERE s.exam_id=$1 ORDER BY s.started_at`, [req.params.id]);
  const counts = { IN_EXAM: 0, PAUSED: 0, LEFT: 0, ENDED: 0 };
  const students = rows.map((r) => {
    counts[r.status]++;
    const l = r.status === 'ENDED' ? null : getLive(r.id);
    return { ...r, live: l ? { question: l.question, camera: l.camera, frame: ex.live_faces ? l.frame : null, frame_age: l.frameAt ? Math.round((Date.now() - l.frameAt) / 1000) : null } : null };
  });
  res.json({ exam: { id: ex.id, title: ex.title, status: ex.status, live_faces: ex.live_faces, leave_action: ex.leave_action }, counts, students });
}));

/** Pause everyone in the room at once (or let everyone back in). */
api.post('/exams/:id/pause-all', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const r = await q(`UPDATE exam_sessions SET status='PAUSED', pause_reason='teacher' WHERE exam_id=$1 AND status='IN_EXAM'`, [req.params.id]);
  res.json({ ok: true, changed: r.rowCount });
}));
api.post('/exams/:id/resume-all', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const r = await q(`UPDATE exam_sessions SET status='IN_EXAM', pause_reason=NULL, last_heartbeat=now() WHERE exam_id=$1 AND status IN ('PAUSED','LEFT')`, [req.params.id]);
  res.json({ ok: true, changed: r.rowCount });
}));

api.get('/sessions/:id/violations', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const { rows } = await q('SELECT id, type, detail, created_at FROM violations WHERE session_id=$1 ORDER BY id DESC LIMIT 200', [req.params.id]);
  res.json(rows);
}));

api.post('/sessions/:id/end', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  await q(`UPDATE exam_sessions SET status='ENDED', ended_at=now(), end_reason='teacher' WHERE id=$1 AND status<>'ENDED'`, [req.params.id]);
  forgetLive(req.params.id);
  res.json({ ok: true });
}));
api.post('/sessions/:id/resume', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  await q(`UPDATE exam_sessions SET status='IN_EXAM', pause_reason=NULL, last_heartbeat=now() WHERE id=$1 AND status IN ('PAUSED','LEFT')`, [req.params.id]);
  res.json({ ok: true });
}));

/** The exam page (via bwenge) reports the question the student is on and, if the lecturer asked, a small camera picture. */
api.post('/sessions/:id/live', requireTeacher, rateLimit({ windowMs: 60_000, max: 20_000, keyFn: () => 'live' }), wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const { rows } = await q(`SELECT s.status, e.live_faces FROM exam_sessions s JOIN exams e ON e.id=s.exam_id WHERE s.id=$1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  if (rows[0].status === 'ENDED') return res.json({ faces: false, status: 'ENDED' });
  saveLive(req.params.id, req.body || {}, rows[0].live_faces);   // pictures are dropped on the spot when the lecturer has not asked for them
  res.json({ faces: rows[0].live_faces, status: rows[0].status });
}));

/* ---------------------------------------------------------------- student apps */
// 6-digit codes can be guessed, so: 10 tries a minute per IP, and 200 a minute overall.
api.post('/verify-code',
  rateLimit({ windowMs: 60_000, max: Number(process.env.VERIFY_RATE_PER_MIN || 10) }),
  rateLimit({ windowMs: 60_000, max: 200, keyFn: () => 'global' }),
  wrap(async (req, res) => {
    const b = req.body || {};
    const digits = parseCode(b.code);
    const name = str(b.studentName, 80);
    const deviceId = str(b.deviceId, 100);
    const clientType = ['desktop', 'mobile', 'extension'].includes(b.clientType) ? b.clientType : null;
    if (!digits) return res.status(400).json({ error: 'That code is not valid. Check it and try again.' });
    if (!name) return res.status(400).json({ error: 'Enter your name' });
    if (!clientType || deviceId.length < 8) return res.status(400).json({ error: 'Unsupported client' });

    const { rows } = await q(
      `SELECT c.id AS code_id, c.expires_at, c.revoked_at, e.*
         FROM exam_codes c JOIN exams e ON e.id=c.exam_id WHERE c.code_hash=$1`, [codeHash(digits)]);
    const row = rows[0];
    if (!row || row.revoked_at || new Date(row.expires_at) < new Date() || row.status !== 'active')
      return res.status(404).json({ error: 'That code is not valid or has expired.' });
    if (row.require_myseb && clientType === 'extension' && !row.allow_extension)
      return res.status(403).json({ error: 'This exam needs the MySEB app (the browser extension is not allowed).' });

    // Same student coming back (app crash, restart): keep the state so a pause cannot be escaped by re-entering the code.
    const prev = (await q(
      `SELECT * FROM exam_sessions WHERE exam_id=$1 AND lower(student_name)=lower($2) ORDER BY started_at DESC LIMIT 1`, [row.id, name])).rows[0];
    const token = newToken();
    let session;
    if (prev) {
      if (prev.status === 'ENDED') return res.status(409).json({ error: 'Your exam has already ended.' });
      if (prev.device_id !== deviceId) return res.status(409).json({ error: 'You are already in this exam on another device. Ask your teacher.' });
      session = (await q(`UPDATE exam_sessions SET token_hash=$2, last_heartbeat=now(), client_type=$3 WHERE id=$1 RETURNING *`,
        [prev.id, tokenHash(token), clientType])).rows[0];   // rotating the token kills the old one
    } else {
      session = (await q(
        `INSERT INTO exam_sessions (exam_id, code_id, student_name, token_hash, client_type, platform, device_id, deadline_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, LEAST(now() + make_interval(mins => $8), COALESCE($9::timestamptz, 'infinity'))) RETURNING *`,
        [row.id, row.code_id, name, tokenHash(token), clientType, str(b.platform, 60), deviceId, row.duration_minutes, row.ends_at])).rows[0];
    }
    res.json({
      sessionId: session.id, token, title: row.title, examUrl: row.exam_url,
      status: session.status, requireMyseb: row.require_myseb, heartbeatSeconds: 5,
      remainingSeconds: Math.max(0, Math.floor((new Date(session.deadline_at) - Date.now()) / 1000)),
    });
  }));

async function studentAuth(req, res) {
  const a = await authSession(req);
  if (a.error) { res.status(a.error === 'wrong_client' ? 403 : 401).json({ error: 'MySEB Needed' }); return null; }
  return a;
}

api.post('/heartbeat', wrap(async (req, res) => {
  const a = await studentAuth(req, res); if (!a) return;
  let { session } = a;
  if (session.status === 'ENDED') return res.json({ status: 'ENDED', reason: session.end_reason, remainingSeconds: 0 });
  if (new Date(session.deadline_at) < new Date() || session.exam_status === 'ended') {
    await q(`UPDATE exam_sessions SET status='ENDED', ended_at=now(), end_reason='time_up' WHERE id=$1`, [session.id]);
    return res.json({ status: 'ENDED', reason: 'time_up', remainingSeconds: 0 });
  }
  let status = session.status;
  if (status === 'LEFT') status = a.exam.leave_action === 'record' ? 'IN_EXAM' : 'PAUSED';   // back after a lost connection: teacher decides
  await q(`UPDATE exam_sessions SET last_heartbeat=now(), status=$2 WHERE id=$1`, [session.id, status]);
  res.json({ status, reason: status === 'IN_EXAM' ? null : session.pause_reason,
    remainingSeconds: Math.max(0, Math.floor((new Date(session.deadline_at) - Date.now()) / 1000)) });
}));

api.post('/violation', wrap(async (req, res) => {
  const a = await studentAuth(req, res); if (!a) return;
  const type = str(req.body?.type, 40);
  if (!VIOLATION_TYPES.has(type)) return res.status(400).json({ error: 'unknown violation type' });
  await recordViolation(a.session, a.exam, type, req.body?.detail && typeof req.body.detail === 'object' ? req.body.detail : {});
  const { rows } = await q('SELECT status, pause_reason FROM exam_sessions WHERE id=$1', [a.session.id]);
  res.json({ status: rows[0].status, reason: rows[0].pause_reason });
}));

/** The student's own "I'm finished" / "I confirmed leaving the exam". */
api.post('/finish', wrap(async (req, res) => {
  const a = await studentAuth(req, res); if (!a) return;
  await q(`UPDATE exam_sessions SET status='ENDED', ended_at=now(), end_reason=$2 WHERE id=$1 AND status<>'ENDED'`,
    [a.session.id, str(req.body?.reason, 40) || 'student']);
  res.json({ ok: true });
}));

/**
 * For exam sites that live elsewhere (e.g. bwenge.space): they cannot read our database, so they ask us.
 * Two ways to prove who they are:
 *   X-MySEB-Service-Key: the server-to-server key (same as TEACHER_KEY) + body.examId  -> any session of that exam
 *   X-MySEB-Exam-Secret: the secret generate-code showed the teacher                    -> sessions opened with that code
 */
api.post('/gate', rateLimit({ windowMs: 60_000, max: 6000 }), wrap(async (req, res) => {
  const secret = req.get('x-myseb-exam-secret');
  const service = req.get('x-myseb-service-key');
  const { key, client, device, userAgent, examId } = req.body || {};
  if (!key || (!secret && !service)) return res.status(400).json({ allowed: false, reason: 'missing' });
  let rows;
  if (service) {
    if (!safeEqual(service, config.teacherKey) || !isUuid(examId)) return res.status(401).json({ allowed: false, reason: 'unauthorized' });
    ({ rows } = await q(
      `SELECT s.id AS session_id, s.status, s.client_type, s.device_id, s.student_name, e.allow_extension, e.id AS exam_id
         FROM exam_sessions s JOIN exams e ON e.id=s.exam_id WHERE s.token_hash=$1 AND s.exam_id=$2`, [tokenHash(String(key)), examId]));
  } else {
    ({ rows } = await q(
      `SELECT s.id AS session_id, s.status, s.client_type, s.device_id, s.student_name, e.allow_extension, e.id AS exam_id
         FROM exam_sessions s JOIN exam_codes c ON c.id=s.code_id JOIN exams e ON e.id=s.exam_id
        WHERE s.token_hash=$1 AND c.secret_hash=$2`, [tokenHash(String(key)), secretHash(secret)]));
  }
  const s = rows[0];
  if (!s) return res.json({ allowed: false, reason: 'MySEB Needed' });
  const markerOk = s.client_type === 'extension' ? s.allow_extension && client === 'extension' : /MySEB\//.test(userAgent || '');
  if (client !== s.client_type || !markerOk || (s.client_type !== 'mobile' && device !== s.device_id)) return res.json({ allowed: false, reason: 'MySEB Needed' });
  if (s.status !== 'IN_EXAM') return res.json({ allowed: false, reason: s.status });
  res.json({ allowed: true, studentName: s.student_name, examId: s.exam_id, clientType: s.client_type, sessionId: s.session_id });
}));
