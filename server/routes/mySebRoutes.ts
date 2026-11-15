import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../production/auth.js';
import logger from '../utils/logger.js';
import { MySebError, assignmentTarget, downloadLinks, endAll, formTarget, generateCode, monitor, mySebConfigured, pauseAll, relayLive, resumeAll, sessionAction, setLiveFaces, violations, type TargetLoader } from '../services/mySeb.js';

const userIdOf = (req: Request): string => (req as any).user?.userId;
const run = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  fn(req, res).catch((err) => {
    if (err instanceof MySebError) return res.status(err.status).json({ code: err.code, error: err.message });
    logger.error('[myseb] request failed', { errorType: (err as Error)?.name });
    res.status(500).json({ code: 'INTERNAL_ERROR', error: 'The request could not be completed.' });
  });
};
const p = (req: Request, k: string) => String(req.params[k]);

/** Public: what the "Use MySEB" screen and the downloads page need. Contains no secrets. */
export function createMySebPublicRouter() {
  const r = Router();
  r.get('/status', (_req, res) => res.json({ configured: mySebConfigured(), links: downloadLinks() }));
  return r;
}

/**
 * The exam page reports where the student is. Mounted behind the MySEB guard, so only a live MySEB student gets this far
 * (`req.myseb.sessionId`). A form or task that does not need MySEB just gets 204.
 */
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
  r.post('/:id/myseb/code', requireAuth, run(async (req, res) => { res.status(201).json(await generateCode(t(req))); }));
  r.get('/:id/myseb/monitor', requireAuth, run(async (req, res) => { res.json(await monitor(t(req))); }));
  r.get('/:id/myseb/sessions/:sid/violations', requireAuth, run(async (req, res) => { res.json(await violations(t(req), p(req, 'sid'))); }));
  r.post('/:id/myseb/sessions/:sid/resume', requireAuth, run(async (req, res) => { res.json(await sessionAction(t(req), p(req, 'sid'), 'resume')); }));
  r.post('/:id/myseb/sessions/:sid/end', requireAuth, run(async (req, res) => { res.json(await sessionAction(t(req), p(req, 'sid'), 'end')); }));
  r.post('/:id/myseb/pause-all', requireAuth, run(async (req, res) => { res.json(await pauseAll(t(req))); }));
  r.post('/:id/myseb/resume-all', requireAuth, run(async (req, res) => { res.json(await resumeAll(t(req))); }));
  r.post('/:id/myseb/settings', requireAuth, run(async (req, res) => { res.json(await setLiveFaces(t(req), req.body?.liveFaces === true)); }));
  r.post('/:id/myseb/end', requireAuth, run(async (req, res) => { res.json(await endAll(t(req))); }));
  return r;
}
export const createMySebOwnerRouter = () => createMySebOwnerRouterFor(formTarget);
export const createMySebAssignmentOwnerRouter = () => createMySebOwnerRouterFor(assignmentTarget);
