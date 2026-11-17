import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../production/auth.js';
import { liveRoomLimiter } from '../../production/rateLimiter.js';
import { reportWorkbook } from '../services/mySebReport.js';
import logger from '../utils/logger.js';
import { decideReview, getEvidence, getReview } from '../services/mySebReview.js';
import { getAgent, roomAction, roomActionFrom, setAgent } from '../services/mySebAgent.js';
import { MySebError, assignmentTarget, downloadLinks, endAll, formTarget, frames, generateCode, iceServers, idChecks, idDecision, reinstate, savedAnswers, lecturerSignalPull, lecturerSignalPush, monitor, report, mySebConfigured, pauseAll, relayLive, resumeAll, sessionAction, setLiveMode, studentSignalPull, heldStudentSignalPull, streamRoomEvents, studentSignalPush, violations, type TargetLoader } from '../services/mySeb.js';

const userIdOf = (req: Request): string => (req as any).user?.userId;
const run = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  fn(req, res).catch((err) => {
    if (err instanceof MySebError) return res.status(err.status).json({ code: err.code, error: err.message, ...(err.data ? { payment: err.data } : {}) });
    logger.error('[myseb] request failed', { errorType: (err as Error)?.name });
    res.status(500).json({ code: 'INTERNAL_ERROR', error: 'The request could not be completed.' });
  });
};
const p = (req: Request, k: string) => String(req.params[k]);

/** Public: what the "Use MySEB" screen and the downloads page need. Contains no secrets. */
export function createMySebPublicRouter() {
  const r = Router();
  r.get('/status', (_req, res) => res.json({ configured: mySebConfigured(), links: downloadLinks(), webJoinPath: process.env.MYSEB_WEB_PATH || '' }));
  return r;
}

/**
 * The exam page reports where the student is. Mounted behind the MySEB guard, so only a live MySEB student gets this far
 * (`req.myseb.sessionId`). A form or task that does not need MySEB just gets 204.
 */
/** Live video set-up from the student's page (also behind the guard): wait for the lecturer's messages, and send offers/ICE. */
export const liveSignalPullHandler = (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const sid = (req as any).myseb?.sessionId;
  if (!sid) return res.status(204).end();
  const ac = new AbortController(); req.on('close', () => ac.abort());
  heldStudentSignalPull(String(sid), Number(req.query.after) || 0, ac.signal).then((r) => res.json(r)).catch((e) => { if (res.headersSent) return; if (e instanceof MySebError && e.status === 503) return res.status(503).set('Retry-After', '10').json({ error: 'busy' }); res.status(204).end(); });
};
export const liveSignalPushHandler = (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const sid = (req as any).myseb?.sessionId;
  if (!sid) return res.status(204).end();
  studentSignalPush(String(sid), req.body?.msg).then((r) => res.json(r)).catch((e) => res.status(e instanceof MySebError ? e.status : 502).json({ error: 'Not sent.' }));
};
export const liveIceHandler = (_req: Request, res: Response) => { res.setHeader('Cache-Control', 'no-store'); res.json(iceServers()); };

export const liveReportHandler = (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const sid = (req as any).myseb?.sessionId;
  if (!sid) return res.status(204).end();
  relayLive(String(sid), req.body).then((r) => res.json(r)).catch(() => res.status(204).end());
};

/** Lecturer actions on one of their own forms (`/api/forms/:id/myseb/...`) or hand-in tasks (`/api/assignments/:id/myseb/...`). */
function createMySebOwnerRouterFor(target: (userId: string, id: string) => TargetLoader) {
  const r = Router();
  const t = (req: Request) => target(userIdOf(req), p(req, 'id'));
  r.use('/:id/myseb', liveRoomLimiter);   // the live room has its own (generous) limit: hundreds of live students send thousands of small messages
  r.post('/:id/myseb/code', requireAuth, run(async (req, res) => { res.status(201).json(await generateCode(t(req))); }));
  // Instant updates (Server-Sent Events): one open stream per live room; it only says "something changed".
  r.get('/:id/myseb/events', requireAuth, run(async (req, res) => { await streamRoomEvents(t(req), res); }));
  r.get('/:id/myseb/monitor', requireAuth, run(async (req, res) => { res.json(await monitor(t(req), { frames: req.query.frames !== '0' })); }));
  r.get('/:id/myseb/frames', requireAuth, run(async (req, res) => { res.json(await frames(t(req), String(req.query.ids || '').split(',').filter(Boolean))); }));
  r.get('/:id/myseb/sessions/:sid/violations', requireAuth, run(async (req, res) => { res.json(await violations(t(req), p(req, 'sid'))); }));
  r.post('/:id/myseb/sessions/:sid/resume', requireAuth, run(async (req, res) => { res.json(await sessionAction(t(req), p(req, 'sid'), 'resume')); }));
  r.post('/:id/myseb/sessions/:sid/end', requireAuth, run(async (req, res) => { res.json(await sessionAction(t(req), p(req, 'sid'), 'end')); }));
  r.post('/:id/myseb/sessions/:sid/reinstate', requireAuth, run(async (req, res) => { res.json(await reinstate(t(req), p(req, 'sid'))); }));
  r.get('/:id/myseb/sessions/:sid/partial', requireAuth, run(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await savedAnswers(t(req), p(req, 'sid'))); }));
  r.get('/:id/myseb/id-checks', requireAuth, run(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await idChecks(t(req))); }));
  r.post('/:id/myseb/sessions/:sid/id-decision', requireAuth, run(async (req, res) => { res.json(await idDecision(t(req), p(req, 'sid'), req.body?.allow === true)); }));
  r.get('/:id/myseb/report.xlsx', requireAuth, run(async (req, res) => {
    const file = await reportWorkbook(await report(t(req)));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${file.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    res.end(file.data);
  }));
  r.post('/:id/myseb/pause-all', requireAuth, run(async (req, res) => { res.json(await pauseAll(t(req))); }));
  r.post('/:id/myseb/resume-all', requireAuth, run(async (req, res) => { res.json(await resumeAll(t(req))); }));
  r.post('/:id/myseb/settings', requireAuth, run(async (req, res) => {
    const mode = ['off', 'pictures', 'live'].includes(req.body?.liveMode) ? req.body.liveMode : req.body?.liveFaces === true ? 'pictures' : 'off';
    res.json(await setLiveMode(t(req), mode, req.body?.liveSound === true, { source: req.body?.liveSource, leaveAction: req.body?.leaveAction, allowWeb: req.body?.allowWeb, webStrict: req.body?.webStrict, multiFace: req.body?.multiFace, idCheck: req.body?.idCheck, webDevices: req.body?.webDevices }));
  }));
  // The room assistant: the lecturer's rules for routine moments, and what it did.
  r.get('/:id/myseb/agent', requireAuth, run(async (req, res) => { res.json({ success: true, data: await getAgent(t(req)) }); }));
  r.put('/:id/myseb/agent', requireAuth, run(async (req, res) => {
    const b = req.body ?? {};
    res.json({ success: true, data: await setAgent(t(req), { on: b.on, autoResume: b.autoResume, afterSeconds: b.afterSeconds, maxResumes: b.maxResumes, reasons: b.reasons, endAfterMax: b.endAfterMax, level: b.level, dryRun: b.dryRun, maxAddMinutes: b.maxAddMinutes, maxRoomPauses: b.maxRoomPauses, serious: b.serious, seriousStrikes: b.seriousStrikes, autoClose: b.autoClose, closeAfterMinutes: b.closeAfterMinutes, opensAt: b.opensAt, closesAt: b.closesAt }, userIdOf(req), { confirmedAutopilot: b.confirmAutopilot === true }) });
  }));
  // Review queue: everyone the room flagged, in order, with the pictures kept at those moments; the lecturer decides.
  r.get('/:id/myseb/review', requireAuth, run(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ success: true, data: await getReview(t(req), (await getAgent(t(req))).log) }); }));
  r.post('/:id/myseb/review/:sid', requireAuth, run(async (req, res) => {
    const b = req.body ?? {};
    res.json({ success: true, data: await decideReview(t(req), p(req, 'sid'), { decision: b.decision, note: b.note, giveMinutes: b.giveMinutes }, userIdOf(req)) });
  }));
  r.get('/:id/myseb/evidence/:sid', requireAuth, run(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ success: true, data: await getEvidence(t(req), p(req, 'sid')) }); }));
  // The lecturer acts in the room: pause or release everyone, more time, a message to the students.
  r.post('/:id/myseb/room-action', requireAuth, run(async (req, res) => {
    const b = req.body ?? {};
    const a = roomActionFrom(b);
    if (!a) return res.status(400).json({ success: false, error: 'Unknown action, or the minutes or the message are missing.' });
    const out = await roomAction(t(req), a, 'lecturer', userIdOf(req));
    res.status(out.ok ? 200 : 400).json({ success: out.ok, ...(out.ok ? { data: out } : { error: out.text }) });
  }));
  // Live video set-up: the lecturer's room listens for offers/ICE from students and sends watch/answer/ice back.
  r.get('/:id/myseb/ice', requireAuth, (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(iceServers()); });
  r.get('/:id/myseb/signal', requireAuth, run(async (req, res) => {
    const ac = new AbortController(); req.on('close', () => ac.abort());
    res.json(await lecturerSignalPull(t(req), Number(req.query.after) || 0, ac.signal));
  }));
  r.post('/:id/myseb/signal/:sid', requireAuth, run(async (req, res) => { res.json(await lecturerSignalPush(t(req), p(req, 'sid'), req.body?.msg)); }));
  r.post('/:id/myseb/end', requireAuth, run(async (req, res) => { res.json(await endAll(t(req))); }));
  return r;
}
export const createMySebOwnerRouter = () => createMySebOwnerRouterFor(formTarget);
export const createMySebAssignmentOwnerRouter = () => createMySebOwnerRouterFor(assignmentTarget);
