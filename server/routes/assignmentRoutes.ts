import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import logger from '../utils/logger.js';
import { AssignmentError, LIMITS } from '../services/assignments/service.js';
import { assignmentService } from '../services/assignments/runtime.js';

export { setAssignmentService } from '../services/assignments/runtime.js';

/**
 * Assignments API.
 * - /api/assignments (signed-in teacher): create, list, open/close, dashboard, file previews, prepare marking.
 * - /api/assignments/public/:token (anyone with the link): the task, its files, and the student's hand-in.
 */

const upload = multer({ storage: multer.memoryStorage(), limits: { files: LIMITS.files, fileSize: LIMITS.fileBytes, fields: 20, fieldSize: LIMITS.text * 4 } });
const userIdOf = (req: Request): string => (req as any).user?.userId ?? (req as any).user?.id;
const filesOf = (req: Request) => ((req.files as Express.Multer.File[] | undefined) ?? []).map((f) => ({ name: Buffer.from(f.originalname, 'latin1').toString('utf8'), data: f.buffer }));

function fail(res: Response, err: unknown) {
  if (err instanceof AssignmentError) return res.status(err.status).json({ code: err.code, error: err.message });
  if ((err as any)?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ code: 'TOO_LARGE', error: `Each file can be at most ${LIMITS.fileBytes / 1048576} MB.` });
  if ((err as any)?.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ code: 'TOO_MANY_FILES', error: `At most ${LIMITS.files} files.` });
  logger.error('[assignments] request failed', { errorType: (err as Error)?.name });
  return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'The request could not be completed.' });
}
const run = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => { fn(req, res).catch((e) => fail(res, e)); };
const withFiles = (req: Request, res: Response, next: NextFunction) => upload.array('files', LIMITS.files)(req, res, (err?: unknown) => (err ? fail(res, err) : next()));

/** Images and PDFs open in the page (sandboxed); everything else downloads. */
function sendFile(res: Response, f: { data: Buffer; name: string; mime: string }, inline: boolean) {
  const show = inline && /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/.test(f.mime);
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Length', String(f.data.length));
  res.setHeader('Content-Disposition', `${show ? 'inline' : 'attachment'}; filename="${f.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  if (!/pdf/.test(f.mime)) res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.end(f.data);
}

export function createAssignmentsRouter() {
  const r = Router();
  r.get('/', run(async (req, res) => res.json({ assignments: await assignmentService().list(userIdOf(req)) })));
  r.post('/', withFiles, run(async (req, res) => res.status(201).json(await assignmentService().create(userIdOf(req), { ...req.body, files: filesOf(req) }))));
  r.get('/:id', run(async (req, res) => res.json(await assignmentService().get(userIdOf(req), String(req.params.id)))));
  r.patch('/:id', run(async (req, res) => res.json(await assignmentService().update(userIdOf(req), String(req.params.id), req.body ?? {}))));
  r.delete('/:id', run(async (req, res) => { await assignmentService().remove(userIdOf(req), String(req.params.id)); res.status(204).end(); }));
  r.delete('/:id/submissions/:sid', run(async (req, res) => res.json(await assignmentService().removeSubmission(userIdOf(req), String(req.params.id), String(req.params.sid)))));
  r.get('/:id/files/:fileId', run(async (req, res) => sendFile(res, await assignmentService().file(userIdOf(req), String(req.params.id), String(req.params.fileId)), req.query.download !== '1')));
  r.post('/:id/prepare-marking', run(async (req, res) => res.json(await assignmentService().prepareMarking(userIdOf(req), String(req.params.id), Array.isArray(req.body?.submissionIds) ? req.body.submissionIds.map(String) : undefined))));
  return r;
}

export function createPublicAssignmentsRouter() {
  const r = Router();
  r.get('/:token', run(async (req, res) => res.json(await assignmentService().publicView(String(req.params.token)))));
  r.get('/:token/files/:index', run(async (req, res) => sendFile(res, await assignmentService().publicTaskFile(String(req.params.token), Number(req.params.index)), req.query.download !== '1')));
  r.post('/:token/submit', withFiles, run(async (req, res) => res.status(201).json(await assignmentService().submit(String(req.params.token), { ...req.body, files: filesOf(req) }))));
  return r;
}
