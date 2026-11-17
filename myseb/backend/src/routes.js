import express from 'express';
import QRCode from 'qrcode';
import { q } from './db.js';
import { config, safeEqual, sha } from './config.js';
import { newCode, parseCode, codeHash, secretHash, tokenHash, newToken, newSecret, rateLimit, failureGate } from './security.js';
import { authSession, isIosDevice, markAlive, recordViolation, VIOLATION_TYPES } from './sessions.js';
import { liveStats, cleanSignal, dropSignals, forgetAllLive, forgetLive, getAside, setAside, setIdPic, getIdPic, dropIdPic, getLive, liveChanged, picturesWanted, pullSignal, pushSignal, reportEverySeconds, saveLive, wantPictures } from './live.js';
import { notify, roomVersion, subscribe } from './events.js';
import { noticeFor, setNotice } from './notices.js';
import { evidenceCounts, evidenceOf } from './evidence.js';
import { getControls, overview as adminOverview, retentionDays, saveControls } from './admin.js';

export const api = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const isUuid = (s) => /^[0-9a-f-]{36}$/i.test(String(s));
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** After any change the lecturer makes (end, pause, resume, a new code), the live room is told at once. */
api.use((req, res, next) => {
  if (req.method === 'POST' || req.method === 'PATCH') {
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      examLive.clear();   // the lecturer changed something: the live reports read the settings fresh next time
      const m = /^\/(exams|sessions)\/([0-9a-f-]{36})\/?(.*)$/i.exec(req.path);
      if (!m) return;
      if (m[1] === 'exams') notify(m[2]);
      else if (m[3] === 'end' || m[3] === 'resume') examOf(m[2]).then((e) => e && notify(e)).catch(() => undefined);
    });
  }
  next();
});

/* ---------------------------------------------------------------- teacher */
function requireTeacher(req, res, next) {
  const key = (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.get('x-teacher-key') || '';
  if (!key || !safeEqual(key, config.teacherKey)) return res.status(401).json({ error: 'Teacher key required' });
  next();
}
const teacherLimiter = rateLimit({ windowMs: 60_000, max: 30, keyFn: (r) => 'tk:' + r.ip });
api.use('/teacher/login', teacherLimiter);
/* The platform administrator's view and switches (service key only; bwenge relays them from Admin → MySEB). */
api.get('/admin/overview', requireTeacher, wrap(async (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(await adminOverview()); }));
api.put('/admin/controls', requireTeacher, wrap(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (typeof b.enabled === 'boolean') patch.enabled = b.enabled;
  if (typeof b.browserMode === 'boolean') patch.browserMode = b.browserMode;
  if (b.retentionDays === null || (Number.isInteger(b.retentionDays) && b.retentionDays >= 7 && b.retentionDays <= 3650)) patch.retentionDays = b.retentionDays;
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing to change' });
  res.json(await saveControls(patch));
}));
api.post('/admin/purge', requireTeacher, wrap(async (_req, res) => { const { purgeOld } = await import('./sessions.js'); res.json({ ...(await purgeOld()), days: retentionDays() }); }));
api.post('/teacher/login', requireTeacher, (_req, res) => res.json({ ok: true }));

api.post('/exams', requireTeacher, wrap(async (req, res) => {
  const b = req.body || {};
  const title = str(b.title, 200);
  if (!title) return res.status(400).json({ error: 'title is required' });
  let examUrl = str(b.examUrl, 1000);
  if (examUrl && !/^https?:\/\//i.test(examUrl)) return res.status(400).json({ error: 'examUrl must start with http:// or https://' });
  const leave = ['record', 'pause', 'end', 'pause_then_end'].includes(b.leaveAction) ? b.leaveAction : 'pause';
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
  if (typeof b.allowWeb === 'boolean') add('allow_web', b.allowWeb);
  if (typeof b.webStrict === 'boolean') add('web_strict', b.webStrict);
  if (['any', 'ios'].includes(b.webDevices)) add('web_devices', b.webDevices);
  if (['off', 'warn', 'end'].includes(b.multiFace)) add('multi_face', b.multiFace);
  if (typeof b.idCheck === 'boolean') add('id_check', b.idCheck);
  if (['record', 'pause', 'end', 'pause_then_end'].includes(b.leaveAction)) add('leave_action', b.leaveAction);
  if (['camera', 'screen', 'both'].includes(b.liveSource)) add('live_source', b.liveSource);
  if (typeof b.liveFaces === 'boolean') { add('live_faces', b.liveFaces); add('live_mode', b.liveFaces ? 'pictures' : 'off'); }
  if (['off', 'pictures', 'live'].includes(b.liveMode)) { add('live_mode', b.liveMode); add('live_faces', b.liveMode !== 'off'); }
  if (typeof b.liveSound === 'boolean') add('live_sound', b.liveSound);
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
  dropSignals([`e:${req.params.id}`, ...ended.rows.map((r) => `s:${r.id}`)]);
  res.json({ ok: true });
}));

/** One copy of the student list is built and shared by every lecturer tab looking at the same test; it is rebuilt after any change. */
const monitorShared = new Map();
async function buildMonitor(id, withFrames) {
  const ex = (await q('SELECT id, title, status, live_faces, live_mode, live_sound, live_source, require_myseb, allow_web, web_strict, web_devices, multi_face, id_check, leave_action FROM exams WHERE id=$1', [id])).rows[0];
  if (!ex) return null;
  const { rows } = await q(
    `SELECT s.id, s.student_name, s.status, s.client_type, s.platform, s.violation_count, s.pause_reason, s.end_reason,
            s.started_at, s.deadline_at, s.id_status, s.reinstated_count, (s.partial_at IS NOT NULL) AS has_partial, EXTRACT(EPOCH FROM (now() - s.last_heartbeat))::int AS seen_ago,
            (SELECT type FROM violations v WHERE v.session_id=s.id ORDER BY v.id DESC LIMIT 1) AS last_violation
       FROM exam_sessions s WHERE s.exam_id=$1 ORDER BY s.started_at`, [id]);
  const counts = { IN_EXAM: 0, PAUSED: 0, LEFT: 0, ENDED: 0 };
  const students = rows.map((r) => {
    counts[r.status]++;
    const l = r.status === 'ENDED' ? null : getLive(r.id);
    return { ...r, aside_seconds: getAside(r.id), live: l ? { question: l.question, camera: l.camera, screen_state: l.screenState, frame: withFrames && ex.live_faces ? l.frame : null, frame_age: l.frameAt ? Math.round((Date.now() - l.frameAt) / 1000) : null, screen: withFrames && ex.live_faces ? l.screen : null, screen_age: l.screenAt ? Math.round((Date.now() - l.screenAt) / 1000) : null } : null };
  });
  return { exam: { id: ex.id, title: ex.title, status: ex.status, live_faces: ex.live_faces, live_mode: ex.live_mode, live_sound: ex.live_sound, live_source: ex.live_source, allow_web: ex.allow_web, web_strict: ex.web_strict, web_devices: ex.web_devices, multi_face: ex.multi_face, id_check: ex.id_check, leave_action: ex.leave_action }, counts, students };
}
api.get('/exams/:id/monitor', requireTeacher, wrap(async (req, res) => {
  const id = req.params.id;
  if (!isUuid(id)) return res.status(400).json({ error: 'bad id' });
  const withFrames = req.query.frames !== '0';   // a big room asks for pictures only for the tiles on screen (see /frames)
  const key = `${id}:${withFrames}`;
  let e = monitorShared.get(key);
  const v = roomVersion(id);
  if (!e || e.v !== v || Date.now() - e.at > 1500) {
    e = { v, at: Date.now(), promise: buildMonitor(id, withFrames) };
    monitorShared.set(key, e);
    if (monitorShared.size > 2000) monitorShared.clear();
  }
  const payload = await e.promise.catch((err) => { monitorShared.delete(key); throw err; });
  payload ? res.json(payload) : res.status(404).json({ error: 'not found' });
}));

/** The live room's instant-update stream (Server-Sent Events). Carries no student data: it only says "something changed, look again". */
api.get('/exams/:id/events', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  if (!subscribe(req.params.id, res)) return res.status(503).set('Retry-After', '10').json({ error: 'too many live rooms open' });
  res.flushHeaders();
  res.write('retry: 2000\n\n: connected\n\n');
}));

/** Everything that happened in an exam, for the lecturer's records and for appeals. Never contains pictures or video. */
api.get('/exams/:id/report', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const ex = (await q('SELECT id, title, status, leave_action, live_mode, created_at, ends_at FROM exams WHERE id=$1', [req.params.id])).rows[0];
  if (!ex) return res.status(404).json({ error: 'not found' });
  const students = (await q(
    `SELECT id, student_name, status, client_type, platform, started_at, deadline_at, ended_at, end_reason, violation_count, reinstated_count, id_status
       FROM exam_sessions WHERE exam_id=$1 ORDER BY student_name, started_at`, [req.params.id])).rows;
  const events = (await q(
    `SELECT v.session_id, v.type, v.detail, v.created_at FROM violations v WHERE v.exam_id=$1 ORDER BY v.created_at, v.id LIMIT 20000`, [req.params.id])).rows;
  // What disqualified students had typed (the lecturer's data; never pictures).
  const partial = (await q(
    `SELECT id AS session_id, student_name, partial_answers->'labels' AS labels, partial_answers->'answers' AS answers, partial_at
       FROM exam_sessions WHERE exam_id=$1 AND partial_answers IS NOT NULL AND status='ENDED' ORDER BY student_name`, [req.params.id])).rows;
  res.json({ exam: ex, students, events, partial });
}));

/** Camera pictures for some students only (the tiles on screen), so a big room does not send every picture every few seconds. */
api.get('/exams/:id/frames', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const ids = String(req.query.ids || '').split(',').filter(isUuid).slice(0, 60);
  const ex = (await q('SELECT live_faces FROM exams WHERE id=$1', [req.params.id])).rows[0];
  if (!ex || !ex.live_faces || !ids.length) return res.json({ frames: {} });
  const mine = (await q('SELECT id FROM exam_sessions WHERE exam_id=$1 AND id = ANY($2::uuid[])', [req.params.id, ids])).rows.map((r) => r.id);
  wantPictures(mine);   // these students are on the lecturer's screen: their next reports carry pictures
  const frames = {};
  for (const id of mine) { const l = getLive(id); if (l?.frame || l?.screen) frames[id] = { frame: l.frame, age: l.frameAt ? Math.round((Date.now() - l.frameAt) / 1000) : null, screen: l.screen, screen_age: l.screenAt ? Math.round((Date.now() - l.screenAt) / 1000) : null }; }
  res.json({ frames });
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

/** More time: for everyone still in the test, or for one student (1-60 minutes each time). */
api.post('/exams/:id/extend', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const minutes = Math.round(Number(req.body?.minutes));
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60) return res.status(400).json({ error: 'minutes must be 1 to 60' });
  const sid = req.body?.sessionId;
  if (sid !== undefined && !isUuid(sid)) return res.status(400).json({ error: 'bad session' });
  const r = sid
    ? await q(`UPDATE exam_sessions SET deadline_at = deadline_at + make_interval(mins => $3) WHERE id=$1 AND exam_id=$2 AND status <> 'ENDED'`, [sid, req.params.id, minutes])
    : await q(`UPDATE exam_sessions SET deadline_at = deadline_at + make_interval(mins => $2) WHERE exam_id=$1 AND status <> 'ENDED'`, [req.params.id, minutes]);
  // The test itself stays open as long as the longest student deadline (the code sweep must not close it early).
  if (!sid) await q(`UPDATE exams SET ends_at = ends_at + make_interval(mins => $2) WHERE id=$1 AND ends_at IS NOT NULL AND status='active'`, [req.params.id, minutes]);
  res.json({ ok: true, changed: r.rowCount, minutes });
}));
/** A short message shown on the students' screens (all of them, or one). */
api.post('/exams/:id/notice', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const sid = req.body?.sessionId;
  if (sid !== undefined && !isUuid(sid)) return res.status(400).json({ error: 'bad session' });
  const n = setNotice(req.params.id, req.body?.text, sid);
  if (!n) return res.status(400).json({ error: 'write a message (up to 300 characters)' });
  res.json({ ok: true, id: n.id });
}));
api.get('/sessions/:id/partial', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const r = (await q(`SELECT student_name, status, end_reason, partial_answers, partial_at FROM exam_sessions WHERE id=$1`, [req.params.id])).rows[0];
  if (!r) return res.status(404).json({ error: 'not found' });
  res.set('Cache-Control', 'no-store');
  res.json({ student: r.student_name, status: r.status, end_reason: r.end_reason, saved_at: r.partial_at, labels: r.partial_answers?.labels ?? {}, answers: r.partial_answers?.answers ?? {} });
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
  dropSignals([`s:${req.params.id}`]);
  res.json({ ok: true });
}));
/** Students waiting for the lecturer to look at their card. */
api.get('/exams/:id/id-checks', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const { rows } = await q(`SELECT id, student_name FROM exam_sessions WHERE exam_id=$1 AND id_status='pending' AND status<>'ENDED' ORDER BY started_at LIMIT 40`, [req.params.id]);
  const pending = []; const lost = [];
  for (const r of rows) { const image = getIdPic(r.id); if (image) pending.push({ ...r, image }); else lost.push(r.id); }
  // A picture that is no longer in memory (the server restarted) goes back to not-sent: the student page asks for it again.
  if (lost.length) await q(`UPDATE exam_sessions SET id_status='none' WHERE id = ANY($1::uuid[]) AND id_status='pending'`, [lost]);
  res.set('Cache-Control', 'no-store'); res.json({ pending });
}));
api.post('/sessions/:id/id-decision', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const allow = req.body?.allow === true;
  dropIdPic(req.params.id);
  const r = await q(`UPDATE exam_sessions SET id_status=$2,
      status = CASE WHEN $2='refused' THEN 'ENDED' ELSE status END,
      ended_at = CASE WHEN $2='refused' THEN now() ELSE ended_at END,
      end_reason = CASE WHEN $2='refused' THEN 'id_refused' ELSE end_reason END
    WHERE id=$1 AND id_status='pending' RETURNING exam_id`, [req.params.id, allow ? 'approved' : 'refused']);
  if (r.rows[0]) notify(r.rows[0].exam_id, 'status');
  res.json({ ok: !!r.rows[0] });
}));
/** The safety valve: a disqualified student is let back in (a false alarm: they looked down, the phone glitched). Recorded in their log. */
api.post('/sessions/:id/reinstate', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  // `minutes` (1-60): after a review, give the student that long from now even if their time ran out, while the test is still open.
  const minutes = req.body?.minutes === undefined ? null : Math.round(Number(req.body.minutes));
  if (minutes !== null && !(Number.isFinite(minutes) && minutes >= 1 && minutes <= 60)) return res.status(400).json({ error: 'minutes must be 1 to 60' });
  const r = await q(`UPDATE exam_sessions s SET status='IN_EXAM', ended_at=NULL, end_reason=NULL, pause_reason=NULL, last_heartbeat=now(), reinstated_count=reinstated_count+1,
        deadline_at = CASE WHEN $2::int IS NULL THEN s.deadline_at ELSE GREATEST(s.deadline_at, now()) + make_interval(mins => $2::int) END
      FROM exams e WHERE s.id=$1 AND e.id=s.exam_id AND s.status='ENDED' AND s.end_reason NOT IN ('teacher','time_up','exam_ended','student','student_exit')
        AND (s.deadline_at > now() OR ($2::int IS NOT NULL AND e.status='active')) RETURNING s.exam_id`, [req.params.id, minutes]);
  if (!r.rows[0]) return res.status(409).json({ error: 'This student cannot be let back in (their time is over and the test is closed, or you ended them yourself).' });
  await q(`INSERT INTO violations (session_id, exam_id, type, detail) VALUES ($1,$2,'reinstated',$3)`, [req.params.id, r.rows[0].exam_id, JSON.stringify(minutes ? { minutes } : {})]);
  notify(r.rows[0].exam_id, 'status');
  res.json({ ok: true });
}));
/** The pictures kept as evidence (memory only) for the lecturer: counts for the whole test, or the pictures of one student. */
api.get('/exams/:id/evidence', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  res.set('Cache-Control', 'no-store');
  const sid = req.query.sessionId;
  if (sid === undefined) return res.json({ counts: evidenceCounts(req.params.id) });
  if (!isUuid(String(sid))) return res.status(400).json({ error: 'bad session' });
  const owns = (await q('SELECT 1 FROM exam_sessions WHERE id=$1 AND exam_id=$2', [sid, req.params.id])).rows[0];
  if (!owns) return res.status(404).json({ error: 'not found' });
  res.json({ items: evidenceOf(String(sid)) });
}));

api.post('/sessions/:id/resume', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  await q(`UPDATE exam_sessions SET status='IN_EXAM', pause_reason=NULL, last_heartbeat=now() WHERE id=$1 AND status IN ('PAUSED','LEFT')`, [req.params.id]);
  res.json({ ok: true });
}));

/** The exam page (via bwenge) reports the question the student is on and, if the lecturer asked, a small camera picture. */
// No limit here: only bwenge (the service key) can call it, and bwenge already allows one report per student every 3 seconds.
const examLive = new Map();
api.post('/sessions/:id/live', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  // Every student reports every few seconds. The exam's live settings are the same for the whole class, so they are read once per
  // 3 s (not once per student); only the student's own status is looked up.
  const sess = (await q('SELECT status, exam_id FROM exam_sessions WHERE id=$1', [req.params.id])).rows[0];
  let cfg = sess && examLive.get(sess.exam_id);
  if (sess && (!cfg || Date.now() - cfg.at > 3000)) {
    const r = (await q('SELECT live_faces, live_mode, live_sound, live_source, leave_action FROM exams WHERE id=$1', [sess.exam_id])).rows[0];
    cfg = { at: Date.now(), row: r }; examLive.set(sess.exam_id, cfg); if (examLive.size > 5000) examLive.clear();
  }
  const rows = sess && cfg?.row ? [{ ...cfg.row, status: sess.status, exam_id: sess.exam_id }] : [];
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  if (rows[0].status === 'ENDED') return res.json({ faces: false, live: false, sound: false, source: 'camera', status: 'ENDED' });
  const before = getLive(req.params.id);
  const wasSharing = !['denied', 'partial'].includes(before?.screenState);
  saveLive(req.params.id, req.body || {}, rows[0].live_faces);
  if (liveChanged(before, getLive(req.params.id), liveStats().reports >= 300)) notify(rows[0].exam_id, 'live');   // a new question (small rooms), or the camera/screen state changed   // pictures are dropped on the spot when the lecturer has not asked for them
  // The screen must stay shared: stopping it counts as leaving the exam, and the exam's leave policy applies (once per stop).
  if (rows[0].live_faces && rows[0].live_source !== 'camera' && wasSharing && ['denied', 'partial'].includes(getLive(req.params.id)?.screenState) && ['IN_EXAM', 'LEFT'].includes(rows[0].status)) {
    await recordViolation({ id: req.params.id, exam_id: rows[0].exam_id, status: rows[0].status }, { leave_action: rows[0].leave_action }, 'screen_share_stopped', { state: getLive(req.params.id).screenState });
  }
  res.json({ faces: rows[0].live_faces, live: rows[0].live_mode === 'live', sound: rows[0].live_mode === 'live' && rows[0].live_sound && rows[0].live_source !== 'screen', source: rows[0].live_source, status: rows[0].status, pictures: picturesWanted(req.params.id), every: reportEverySeconds() });
}));

/* Live video set-up (WebRTC). Only short messages pass here, in memory. The video goes student -> lecturer directly. */
const examOfSession = new Map();
async function examOf(sid) {
  const hit = examOfSession.get(sid);
  if (hit) return hit;
  const r = (await q('SELECT exam_id FROM exam_sessions WHERE id=$1', [sid])).rows[0]?.exam_id ?? null;
  if (r) { examOfSession.set(sid, r); if (examOfSession.size > 20_000) examOfSession.clear(); }
  return r;
}
const waitOf = (req) => Math.max(0, Math.min(25_000, Number(req.query.wait) || 0));
const afterOf = (req) => Math.max(0, parseInt(req.query.after, 10) || 0);
const abortOnClose = (req) => { const ac = new AbortController(); req.on('close', () => ac.abort()); return ac.signal; };

api.post('/sessions/:id/to-student', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const msg = cleanSignal(req.body?.msg); if (!msg || !['watch', 'unwatch', 'listen', 'answer', 'ice', 'quality'].includes(msg.type)) return res.status(400).json({ error: 'bad message' });
  if (!(await examOf(req.params.id))) return res.status(404).json({ error: 'not found' });
  pushSignal('s:' + req.params.id, msg); res.json({ ok: true });
}));
api.get('/sessions/:id/from-lecturer', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  res.json(await pullSignal('s:' + req.params.id, afterOf(req), waitOf(req), abortOnClose(req)));
}));
api.post('/sessions/:id/to-lecturer', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const msg = cleanSignal(req.body?.msg); if (!msg || !['offer', 'ice', 'state'].includes(msg.type)) return res.status(400).json({ error: 'bad message' });
  const exam = await examOf(req.params.id); if (!exam) return res.status(404).json({ error: 'not found' });
  pushSignal('e:' + exam, { ...msg, sid: req.params.id }); res.json({ ok: true });
}));
api.get('/exams/:id/from-students', requireTeacher, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  res.json(await pullSignal('e:' + req.params.id, afterOf(req), waitOf(req), abortOnClose(req)));
}));

/* ---------------------------------------------------------------- student apps */
// 6-digit codes can be guessed, so wrong tries are limited: 20 a minute per address and 600 a minute overall. Right codes are
// NOT counted, so a class of hundreds (or a whole lab behind one school network) can all join at the same moment.
const perIp = failureGate({ windowMs: 60_000, max: Number(process.env.VERIFY_FAILS_PER_IP_PER_MIN || process.env.VERIFY_RATE_PER_MIN || 20) });
const overall = failureGate({ windowMs: 60_000, max: Number(process.env.VERIFY_FAILS_PER_MIN || 600), keyFn: () => 'all' });
api.post('/verify-code',
  wrap(async (req, res) => {
    const wait = Math.max(perIp.blocked(req), overall.blocked(req));
    if (wait) { res.set('Retry-After', String(wait)); return res.status(429).json({ error: 'Too many wrong codes. Wait a minute and try again.' }); }
    const bad = (status, error) => { perIp.fail(req); overall.fail(req); return res.status(status).json({ error }); };
    const b = req.body || {};
    const digits = parseCode(b.code);
    const name = str(b.studentName, 80);
    const deviceId = str(b.deviceId, 100);
    const clientType = ['desktop', 'mobile', 'extension', 'web'].includes(b.clientType) ? b.clientType : null;
    if (!digits) return bad(400, 'That code is not valid. Check it and try again.');
    if (!name) return res.status(400).json({ error: 'Enter your name' });
    if (!clientType || deviceId.length < 8) return res.status(400).json({ error: 'Unsupported client' });

    const { rows } = await q(
      `SELECT c.id AS code_id, c.expires_at, c.revoked_at, e.*
         FROM exam_codes c JOIN exams e ON e.id=c.exam_id WHERE c.code_hash=$1`, [codeHash(digits)]);
    const row = rows[0];
    if (!row || row.revoked_at || new Date(row.expires_at) < new Date() || row.status !== 'active')
      return bad(404, 'That code is not valid or has expired.');
    // The platform administrator can pause new sign-ins, or browser mode alone (students already inside a test are not affected).
    if (!getControls().enabled) return res.status(503).json({ error: 'MySEB is paused by the platform administrator. Try again later.' });
    if (clientType === 'web' && !getControls().browserMode) return res.status(403).json({ error: 'Browser mode is turned off for now. Use the MySEB app.' });
    if (clientType === 'web' && !row.allow_web)
      return res.status(403).json({ error: 'Your lecturer has not allowed the browser for this test. Use the MySEB app.' });
    if (clientType === 'web' && row.web_devices === 'ios' && !isIosDevice(req.get('user-agent') || '', b.touch === true))
      return res.status(403).json({ error: 'On this test the browser is only for iPhones and iPads. Use the MySEB app on your laptop or Android phone.' });
    if (row.require_myseb && clientType === 'extension' && !row.allow_extension)
      return res.status(403).json({ error: 'This exam needs the MySEB app (the browser extension is not allowed).' });

    // Same student coming back (app crash, restart): keep the state so a pause cannot be escaped by re-entering the code.
    const prev = (await q(
      `SELECT * FROM exam_sessions WHERE exam_id=$1 AND lower(student_name)=lower($2) ORDER BY started_at DESC LIMIT 1`, [row.id, name])).rows[0];
    // A browser takes the test once: the same browser cannot start again under another name (clearing its storage is the only way round,
    // and a lecturer who sees two sessions with the same look can tell). The app keeps its own device rule.
    if (clientType === 'web' && !prev) {
      const other = (await q(`SELECT 1 FROM exam_sessions WHERE exam_id=$1 AND device_id=$2 AND client_type='web' LIMIT 1`, [row.id, deviceId])).rows[0];
      if (other) return res.status(409).json({ error: 'This browser has already taken this test. Ask your lecturer.' });
    }
    const token = newToken();
    let session;
    if (prev) {
      if (prev.status === 'ENDED') return res.status(409).json({ error: 'Your exam has already ended.' });
      if (prev.device_id !== deviceId) return res.status(409).json({ error: 'You are already in this exam on another device. Ask your teacher.' });
      session = (await q(`UPDATE exam_sessions SET token_hash=$2, last_heartbeat=now(), client_type=$3, ua_hash=$4 WHERE id=$1 RETURNING *`,
        [prev.id, tokenHash(token), clientType, clientType === 'web' ? sha(req.get('user-agent') || '') : null])).rows[0];   // rotating the token kills the old one
    } else {
      session = (await q(
        `INSERT INTO exam_sessions (exam_id, code_id, student_name, token_hash, client_type, platform, device_id, deadline_at, ua_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7, LEAST(now() + make_interval(mins => $8), COALESCE($9::timestamptz, 'infinity')), $10) RETURNING *`,
        [row.id, row.code_id, name, tokenHash(token), clientType, str(b.platform, 60), deviceId, row.duration_minutes, row.ends_at, clientType === 'web' ? sha(req.get('user-agent') || '') : null])).rows[0];
    }
    notify(row.id, 'join');
    // A browser keeps its key in a secure cookie (the page's own script can never read it). Only for tests the lecturer opened to browsers.
    if (clientType === 'web') res.append('Set-Cookie', `myseb_s=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${config.publicUrl.startsWith('https') ? '; Secure' : ''}`);
    res.json({
      sessionId: session.id, token, title: row.title, examUrl: row.exam_url,
      status: session.status, requireMyseb: row.require_myseb, heartbeatSeconds: 5,
      remainingSeconds: Math.max(0, Math.floor((new Date(session.deadline_at) - Date.now()) / 1000)),
    });
  }));

async function studentAuth(req, res) {
  const a = await authSession(req, { allowCookie: true });
  if (a.error) { res.status(a.error === 'wrong_client' ? 403 : 401).json({ error: 'MySEB Needed' }); return null; }
  return a;
}

/** A browser asks "am I in a test?" (it cannot read its own cookie). Answers with the state, or 401. */
api.get('/web/me', wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const a = await authSession(req, { allowCookie: true });
  if (a.error || a.session.client_type !== 'web') return res.status(401).json({ active: false });
  res.json({ active: true, status: a.session.status, title: a.session.title, heartbeatSeconds: 5, strict: !!a.session.web_strict, restore: a.session.reinstated_count > 0 && a.session.partial_answers ? { key: a.session.partial_answers.key, answers: a.session.partial_answers.answers } : null, multi: a.session.multi_face ?? 'warn', idCheck: !!a.session.id_check, idStatus: a.session.id_status, reason: a.session.status === 'ENDED' ? a.session.end_reason : null,
    remainingSeconds: Math.max(0, Math.floor((new Date(a.session.deadline_at) - Date.now()) / 1000)) });
}));

/** The student card picture (browsers, when the lecturer turned the check on). One small JPEG, kept only until the lecturer decides. */
api.post('/id-check', wrap(async (req, res) => {
  const a = await studentAuth(req, res); if (!a) return;
  if (!a.exam.id_check || a.session.client_type !== 'web') return res.status(400).json({ error: 'No card check for this test.' });
  const image = typeof req.body?.image === 'string' ? req.body.image : '';
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 140_000) return res.status(400).json({ error: 'That picture could not be used.' });
  if (a.session.status === 'ENDED' || a.session.id_status === 'approved') return res.json({ idStatus: a.session.id_status });
  setIdPic(a.session.id, image);
  await q(`UPDATE exam_sessions SET id_status='pending' WHERE id=$1`, [a.session.id]);
  notify(a.session.exam_id, 'status');
  res.json({ idStatus: 'pending' });
}));

/**
 * The answers a browser student has typed so far, saved every few seconds (and once more when they are disqualified), so leaving or a crash
 * does not lose them. The lecturer reads them in the live room and the report; a student the lecturer lets back in gets them back.
 * A session that just ended may still save for 10 minutes (the last words before leaving), no longer.
 */
api.post('/partial', wrap(async (req, res) => {
  const a = await studentAuth(req, res); if (!a) return;
  const s = a.session;
  if (s.status === 'ENDED' && !(s.ended_at && Date.now() - new Date(s.ended_at).getTime() < 10 * 60_000)) return res.status(409).json({ error: 'This test has ended.' });
  const body = req.body ?? {};
  const answers = body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers) ? body.answers : null;
  const labels = body.labels && typeof body.labels === 'object' && !Array.isArray(body.labels) ? body.labels : {};
  if (!answers) return res.status(400).json({ error: 'No answers.' });
  const doc = { key: str(body.key, 200), answers, labels };
  const json = JSON.stringify(doc);
  if (json.length > 200_000) return res.status(413).json({ error: 'Too much to save.' });
  await q(`UPDATE exam_sessions SET partial_answers=$2::jsonb, partial_at=now() WHERE id=$1`, [s.id, json]);
  res.json({ ok: true });
}));

api.post('/heartbeat', wrap(async (req, res) => {
  const a = await studentAuth(req, res); if (!a) return;
  let { session } = a;
  if (typeof req.body?.aside === 'number') setAside(session.id, req.body.aside);
  if (session.status === 'ENDED') return res.json({ status: 'ENDED', reason: session.end_reason, remainingSeconds: 0 });
  if (new Date(session.deadline_at) < new Date() || session.exam_status === 'ended') {
    await q(`UPDATE exam_sessions SET status='ENDED', ended_at=now(), end_reason='time_up' WHERE id=$1`, [session.id]);
    notify(session.exam_id, 'status');
    return res.json({ status: 'ENDED', reason: 'time_up', remainingSeconds: 0 });
  }
  let status = session.status;
  if (status === 'LEFT') status = a.exam.leave_action === 'record' ? 'IN_EXAM' : 'PAUSED';   // back after a lost connection: teacher decides
  if (status !== session.status) {
    await q(`UPDATE exam_sessions SET last_heartbeat=now(), status=$2 WHERE id=$1`, [session.id, status]);   // a change is written at once
    notify(session.exam_id, 'status');
  } else markAlive(session.id);                                                                             // "still here" is written in a batch
  res.json({ status, idStatus: session.id_status, reason: status === 'IN_EXAM' ? null : session.pause_reason,
    remainingSeconds: Math.max(0, Math.floor((new Date(session.deadline_at) - Date.now()) / 1000)), notice: noticeFor(session.exam_id, session.id) });
}));

api.post('/violation', wrap(async (req, res) => {
  const a = await studentAuth(req, res); if (!a) return;
  const type = str(req.body?.type, 40);
  if (!VIOLATION_TYPES.has(type)) return res.status(400).json({ error: 'unknown violation type' });
  await recordViolation(a.session, a.exam, type, req.body?.detail && typeof req.body.detail === 'object' ? req.body.detail : {});
  notify(a.session.exam_id, 'violation');
  const { rows } = await q('SELECT status, pause_reason, end_reason FROM exam_sessions WHERE id=$1', [a.session.id]);
  res.json({ status: rows[0].status, reason: rows[0].status === 'ENDED' ? rows[0].end_reason : rows[0].pause_reason });
}));

/** The student's own "I'm finished" / "I confirmed leaving the exam". */
api.post('/finish', wrap(async (req, res) => {
  const a = await studentAuth(req, res); if (!a) return;
  await q(`UPDATE exam_sessions SET status='ENDED', ended_at=now(), end_reason=$2 WHERE id=$1 AND status<>'ENDED'`,
    [a.session.id, str(req.body?.reason, 40) || 'student']);
  notify(a.session.exam_id, 'status');
  res.json({ ok: true });
}));

/**
 * For exam sites that live elsewhere (e.g. bwenge.space): they cannot read our database, so they ask us.
 * Two ways to prove who they are:
 *   X-MySEB-Service-Key: the server-to-server key (same as TEACHER_KEY) + body.examId  -> any session of that exam
 *   X-MySEB-Exam-Secret: the secret generate-code showed the teacher                    -> sessions opened with that code
 */
// bwenge calls this for every student request, all from one address: no limit for the service key. The unauthenticated way in
// (a guessed exam secret) is limited per address so it cannot be brute-forced.
const gateSecretLimit = rateLimit({ windowMs: 60_000, max: 600 });
api.post('/gate', (req, res, next) => (req.get('x-myseb-service-key') ? next() : gateSecretLimit(req, res, next)), wrap(async (req, res) => {
  const secret = req.get('x-myseb-exam-secret');
  const service = req.get('x-myseb-service-key');
  const { key, client, device, userAgent, examId } = req.body || {};
  if (!key || (!secret && !service)) return res.status(400).json({ allowed: false, reason: 'missing' });
  let rows;
  if (service) {
    if (!safeEqual(service, config.teacherKey) || !isUuid(examId)) return res.status(401).json({ allowed: false, reason: 'unauthorized' });
    ({ rows } = await q(
      `SELECT s.id AS session_id, s.status, s.client_type, s.device_id, s.ua_hash, s.student_name, e.allow_extension, e.allow_web, e.id AS exam_id
         FROM exam_sessions s JOIN exams e ON e.id=s.exam_id WHERE s.token_hash=$1 AND s.exam_id=$2`, [tokenHash(String(key)), examId]));
  } else {
    ({ rows } = await q(
      `SELECT s.id AS session_id, s.status, s.client_type, s.device_id, s.ua_hash, s.student_name, e.allow_extension, e.allow_web, e.id AS exam_id
         FROM exam_sessions s JOIN exam_codes c ON c.id=s.code_id JOIN exams e ON e.id=s.exam_id
        WHERE s.token_hash=$1 AND c.secret_hash=$2`, [tokenHash(String(key)), secretHash(secret)]));
  }
  const s = rows[0];
  // Tells the exam site whether to offer "use your browser" on its "MySEB needed" page.
  let webAllowed = false;
  if (service && isUuid(examId)) { const ex = (await q('SELECT allow_web, web_devices FROM exams WHERE id=$1', [examId])).rows[0]; webAllowed = !!ex?.allow_web && (ex.web_devices !== 'ios' || isIosDevice(userAgent || '')); }
  if (!s) return res.json({ allowed: false, reason: 'MySEB Needed', webAllowed });
  // client "cookie": the exam site only saw a cookie, so the stored kind of session decides which rules apply.
  const kind = client === 'cookie' ? s.client_type : client;
  const markerOk = s.client_type === 'extension' ? s.allow_extension && kind === 'extension'
    : s.client_type === 'web' ? !!s.allow_web && client === 'cookie' && !!s.ua_hash && s.ua_hash === sha(userAgent || '')
    : /MySEB\//.test(userAgent || '');
  if (kind !== s.client_type || !markerOk || (s.client_type !== 'mobile' && s.client_type !== 'web' && device !== s.device_id)) return res.json({ allowed: false, reason: 'MySEB Needed', webAllowed });
  if (s.status !== 'IN_EXAM') return res.json({ allowed: false, reason: s.status });
  res.json({ allowed: true, studentName: s.student_name, examId: s.exam_id, clientType: s.client_type, sessionId: s.session_id });
}));
