import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { agentTarget } from '../services/AiService.js';
import { LearnError, answerItem, archiveClass, classDashboard, createClass, joinClass, leaveClass, listSkills, myClasses, nextItem, revealHint, type AiTarget } from '../services/learning/practice.js';

/**
 * Adaptive practice and classes (mounted at /api/learn behind requireAuth).
 * Practice: GET /skills, POST /practice/next, POST /practice/:id/hint, POST /practice/:id/answer.
 * Classes: GET /classes, POST /classes, POST /classes/join, DELETE /classes/:id/membership, DELETE /classes/:id,
 * GET /classes/:id/dashboard (owner only, anonymised).
 */
export function createLearnRouter(ai: () => AiTarget = () => { const a = agentTarget(); return { adapter: a.adapter, model: a.model, fallbackModel: a.fallbackModel }; }) {
  const router = Router();
  const userIdOf = (req: Request) => (req as any).user?.userId as string;

  function fail(res: Response, e: any) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request.', code: 'INVALID' });
    if (e instanceof LearnError) {
      const status = { NOT_FOUND: 404, INVALID: 400, LIMIT: 429, FORBIDDEN: 403, DONE: 409 }[e.code];
      return res.status(status).json({ error: e.message, code: e.code, ...(e.extra ?? {}) });
    }
    return res.status(502).json({ error: 'Practice is unavailable right now. Try again in a moment.', code: 'ERROR' });
  }
  const run = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
    try { res.json({ success: true, ...((await fn(req)) as object ?? {}) }); } catch (e) { fail(res, e); }
  };

  router.get('/skills', run(async (req) => ({ skills: await listSkills(userIdOf(req)) })));
  router.post('/practice/next', run(async (req) => {
    const b = z.object({ topic: z.string().trim().min(1).max(120), language: z.string().max(40).optional() }).parse(req.body ?? {}) as { topic: string; language?: string };
    return nextItem(ai, userIdOf(req), b);
  }));
  router.post('/practice/:id/hint', run(async (req) => revealHint(userIdOf(req), String(req.params.id))));
  router.post('/practice/:id/answer', run(async (req) => {
    const b = z.object({ response: z.string().max(2000), confidence: z.number().int().min(1).max(5).nullable().optional() }).parse(req.body ?? {}) as { response: string; confidence?: number | null };
    return answerItem(ai, userIdOf(req), String(req.params.id), b);
  }));

  router.get('/classes', run(async (req) => myClasses(userIdOf(req))));
  router.post('/classes', run(async (req) => {
    const { name } = z.object({ name: z.string().max(80) }).parse(req.body ?? {});
    const c = await createClass(userIdOf(req), name);
    return { class: { id: c.id, name: c.name, code: c.code } };
  }));
  router.post('/classes/join', run(async (req) => {
    const { code } = z.object({ code: z.string().trim().min(4).max(12) }).parse(req.body ?? {});
    return { class: await joinClass(userIdOf(req), code) };
  }));
  router.delete('/classes/:id/membership', run(async (req) => { await leaveClass(userIdOf(req), String(req.params.id)); return {}; }));
  router.delete('/classes/:id', run(async (req) => { await archiveClass(userIdOf(req), String(req.params.id)); return {}; }));
  router.get('/classes/:id/dashboard', run(async (req) => classDashboard(userIdOf(req), String(req.params.id))));
  return router;
}

export default createLearnRouter();
