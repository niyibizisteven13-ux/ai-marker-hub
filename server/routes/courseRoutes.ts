import { Router, type Request, type Response } from 'express';
import logger from '../utils/logger.js';
import { CourseError } from '../services/courses/service.js';
import { courseService } from '../services/courses/runtime.js';

export { setCourseService } from '../services/courses/runtime.js';

/** Courses API (signed-in lecturer only): roster, accommodations, linked tasks and quizzes, dashboard, Excel. */
const userIdOf = (req: Request): string => (req as any).user?.userId ?? (req as any).user?.id;

function fail(res: Response, err: unknown) {
  if (err instanceof CourseError) return res.status(err.status).json({ code: err.code, error: err.message });
  logger.error('[courses] request failed', { errorType: (err as Error)?.name });
  return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'The request could not be completed.' });
}
const run = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => { fn(req, res).catch((e) => fail(res, e)); };
const p = (req: Request, k: string) => String(req.params[k]);

export function createCoursesRouter() {
  const r = Router();
  r.get('/', run(async (req, res) => res.json({ courses: await courseService().list(userIdOf(req)) })));
  r.post('/', run(async (req, res) => res.status(201).json(await courseService().create(userIdOf(req), req.body ?? {}))));
  r.get('/:id', run(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await courseService().dashboard(userIdOf(req), p(req, 'id'))); }));
  r.patch('/:id', run(async (req, res) => res.json(await courseService().update(userIdOf(req), p(req, 'id'), req.body ?? {}))));
  r.delete('/:id', run(async (req, res) => { await courseService().remove(userIdOf(req), p(req, 'id')); res.status(204).end(); }));
  r.post('/:id/students', run(async (req, res) => res.json(await courseService().addStudents(userIdOf(req), p(req, 'id'), req.body?.text))));
  r.patch('/:id/students/:sid', run(async (req, res) => { await courseService().updateStudent(userIdOf(req), p(req, 'id'), p(req, 'sid'), req.body ?? {}); res.json({ ok: true }); }));
  r.delete('/:id/students/:sid', run(async (req, res) => { await courseService().removeStudent(userIdOf(req), p(req, 'id'), p(req, 'sid')); res.status(204).end(); }));
  r.put('/:id/items', run(async (req, res) => { await courseService().setItems(userIdOf(req), p(req, 'id'), req.body?.items); res.json({ ok: true }); }));
  r.get('/:id/export.xlsx', run(async (req, res) => {
    const f = await courseService().exportWorkbook(userIdOf(req), p(req, 'id'));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${f.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(f.data);
  }));
  return r;
}
