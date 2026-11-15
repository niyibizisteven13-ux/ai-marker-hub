import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../production/auth.js';
import logger from '../utils/logger.js';
import { MySebError, downloadLinks, endAll, generateCode, monitor, mySebConfigured, sessionAction, violations } from '../services/mySeb.js';

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

/** Lecturer actions on one of their own forms. Mounted at /api/forms (before the generic form routes). */
export function createMySebOwnerRouter() {
  const r = Router();
  r.post('/:id/myseb/code', requireAuth, run(async (req, res) => { res.status(201).json(await generateCode(userIdOf(req), p(req, 'id'))); }));
  r.get('/:id/myseb/monitor', requireAuth, run(async (req, res) => { res.json(await monitor(userIdOf(req), p(req, 'id'))); }));
  r.get('/:id/myseb/sessions/:sid/violations', requireAuth, run(async (req, res) => { res.json(await violations(userIdOf(req), p(req, 'id'), p(req, 'sid'))); }));
  r.post('/:id/myseb/sessions/:sid/resume', requireAuth, run(async (req, res) => { res.json(await sessionAction(userIdOf(req), p(req, 'id'), p(req, 'sid'), 'resume')); }));
  r.post('/:id/myseb/sessions/:sid/end', requireAuth, run(async (req, res) => { res.json(await sessionAction(userIdOf(req), p(req, 'id'), p(req, 'sid'), 'end')); }));
  r.post('/:id/myseb/end', requireAuth, run(async (req, res) => { res.json(await endAll(userIdOf(req), p(req, 'id'))); }));
  return r;
}
