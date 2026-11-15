import { Router, type Request, type Response } from 'express';
import logger from '../utils/logger.js';
import { ExamError } from '../services/formExam/service.js';
import { formExamService } from '../services/formExam/runtime.js';

export { setFormExamService } from '../services/formExam/runtime.js';

/**
 * Timed tests.
 * - Public (a student with the form link): start a session with a registration number, ask for the state (the
 *   server's clock), report camera and page events, take a break. The session secret travels in `x-exam-token`.
 * - Owner (signed-in lecturer): who is sitting, who is paused and why, resume, pause, end, add time, let back in.
 */
const userIdOf = (req: Request): string => (req as any).user?.userId ?? (req as any).user?.id;
function fail(res: Response, err: unknown) {
  if (err instanceof ExamError) return res.status(err.status).json({ code: err.code, error: err.message });
  logger.error('[form-exams] request failed', { errorType: (err as Error)?.name });
  return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'The request could not be completed.' });
}
const run = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => { fn(req, res).catch((e) => fail(res, e)); };
const p = (req: Request, k: string) => String(req.params[k]);
const token = (req: Request) => req.get('x-exam-token');

export function createPublicFormExamRouter() {
  const r = Router();
  r.post('/:formId/start', run(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.status(201).json(await formExamService().start(p(req, 'formId'), req.body ?? {})); }));
  r.get('/session/:sid', run(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await formExamService().state(p(req, 'sid'), token(req))); }));
  r.post('/session/:sid/event', run(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await formExamService().event(p(req, 'sid'), token(req), req.body ?? {})); }));
  r.post('/session/:sid/break', run(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await formExamService().setBreak(p(req, 'sid'), token(req), req.body?.on)); }));
  return r;
}

export function createOwnerFormExamRouter() {
  const r = Router();
  r.get('/:formId/sessions', run(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ sessions: await formExamService().list(userIdOf(req), p(req, 'formId')) }); }));
  r.post('/:formId/resume-all', run(async (req, res) => res.json(await formExamService().resumeAll(userIdOf(req), p(req, 'formId')))));
  r.get('/session/:sid', run(async (req, res) => res.json(await formExamService().session(userIdOf(req), p(req, 'sid')))));
  r.post('/session/:sid/resume', run(async (req, res) => res.json(await formExamService().resume(userIdOf(req), p(req, 'sid')))));
  r.post('/session/:sid/pause', run(async (req, res) => res.json(await formExamService().pause(userIdOf(req), p(req, 'sid')))));
  r.post('/session/:sid/end', run(async (req, res) => res.json(await formExamService().end(userIdOf(req), p(req, 'sid')))));
  r.post('/session/:sid/extend', run(async (req, res) => res.json(await formExamService().extend(userIdOf(req), p(req, 'sid'), req.body?.minutes))));
  r.post('/session/:sid/reentry', run(async (req, res) => { await formExamService().allowReentry(userIdOf(req), p(req, 'sid')); res.json({ ok: true }); }));
  return r;
}
