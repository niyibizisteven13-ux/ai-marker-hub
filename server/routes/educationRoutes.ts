import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { FileStoreError } from '../services/ai/files/FileStore.js';
import { FileJobQueue, JobError } from '../services/ai/jobs/fileJobQueue.js';
import { fileJobQueue, fileStore } from '../services/AiService.js';
import { AnalysisError, analysisRequestSchema } from '../services/analytics/analyze.js';
import { DatasetError } from '../services/analytics/dataset.js';
import { reportRequestSchema } from '../services/analytics/service.js';
import { AssessmentInputError, assessmentRequestSchema, resolveRubric } from '../services/assessment/service.js';
import { analyticsService, assessmentService } from '../services/educationRuntime.js';
import { upload } from '../middleware/upload.js';
import logger from '../utils/logger.js';

/**
 * Backend contracts for statistics, HTML reports, rubric assessment and the job lifecycle.
 * All routes are mounted behind requireAuth; every lookup is scoped to the signed-in user.
 * Other users' resources answer 404 (never 403) so ids cannot be probed.
 */

const userIdOf = (req: Request): string => (req as any).user?.userId;
const rid = (req: Request) => (req as any).requestId;

function fail(req: Request, res: Response, err: unknown) {
  const requestId = rid(req);
  if (err instanceof z.ZodError) return res.status(400).json({ code: 'INVALID_REQUEST', error: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), requestId });
  if (err instanceof DatasetError) return res.status(err.code === 'TOO_LARGE' ? 413 : 400).json({ code: err.code, error: err.message, requestId });
  if (err instanceof AnalysisError) return res.status(400).json({ code: 'INVALID_ANALYSIS', error: err.message, requestId });
  if (err instanceof AssessmentInputError) return res.status(422).json({ code: 'INVALID_ASSESSMENT_INPUT', errors: err.errors, warnings: err.warnings, unparsed: err.unparsed, requestId });
  if (err instanceof FileStoreError) {
    if (err.code === 'too_large') return res.status(413).json({ code: 'TOO_LARGE', error: err.message, requestId });
    return res.status(404).json({ code: 'NOT_FOUND', error: 'Not found or expired.', requestId });
  }
  if (err instanceof JobError) {
    const status = err.code === 'TOO_MANY_JOBS' ? 429 : err.code === 'USE_REPORT_JOB' ? 413 : 400;
    return res.status(status).json({ code: err.code, error: err.message, requestId });
  }
  logger.error('[education] request failed', { requestId, path: req.path, errorType: (err as Error)?.name });
  return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'The request could not be completed.', requestId });
}

/** Wraps the shared upload middleware so upload problems are client errors (400/413), not 500s. */
const uploadOne = (field: string) => (req: Request, res: Response, next: NextFunction) => {
  upload.single(field)(req, res, (err?: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ code: err.code === 'LIMIT_FILE_SIZE' ? 'TOO_LARGE' : 'INVALID_UPLOAD', error: err.message, requestId: rid(req) });
    }
    return res.status(400).json({ code: 'INVALID_UPLOAD', error: err instanceof Error ? err.message.slice(0, 200) : 'Upload rejected.', requestId: rid(req) });
  });
};

// ── Datasets, statistics, reports ─────────────────────────────────────────
export const analyticsRouter = Router();

analyticsRouter.post('/datasets', uploadOne('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ code: 'INVALID_REQUEST', error: 'Upload a CSV, TSV, XLSX or JSON file in the "file" field.', requestId: rid(req) });
    res.status(201).json({ ...(await analyticsService.uploadDataset(userIdOf(req), req.file)), requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

analyticsRouter.get('/datasets/:id', async (req, res) => {
  try {
    const ds = await analyticsService.readDataset(userIdOf(req), req.params.id);
    res.json({ ...analyticsService.profile(req.params.id, ds), requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

analyticsRouter.post('/datasets/:id/analyze', async (req, res) => {
  try {
    const body = analysisRequestSchema.parse(req.body ?? {});
    const { analysis, charts } = await analyticsService.analyze(userIdOf(req), req.params.id, body);
    res.json({ analysis, charts, requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

analyticsRouter.post('/datasets/:id/reports', async (req, res) => {
  try {
    const body = reportRequestSchema.parse(req.body ?? {});
    const key = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'].slice(0, 100) : undefined;
    const { job, duplicate } = await analyticsService.submitReport(userIdOf(req), req.params.id, body, key);
    res.status(duplicate ? 200 : 202).json({ job: FileJobQueue.publicView(job), duplicate, links: { status: `/api/jobs/${job.id}`, result: `/api/jobs/${job.id}/result` }, requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

// ── Rubric assessment ─────────────────────────────────────────────────────
export const assessmentRouter = Router();

assessmentRouter.post('/rubrics/validate', (req, res) => {
  const body = z.object({ rubric: z.unknown().optional(), rubricText: z.string().max(50_000).optional() }).strict().safeParse(req.body ?? {});
  if (!body.success) return fail(req, res, body.error);
  const r = resolveRubric(body.data);
  res.status(r.rubric ? 200 : 422).json({ valid: !!r.rubric, rubric: r.rubric, errors: r.errors, warnings: r.warnings, unparsed: r.unparsed, requestId: rid(req) });
});

assessmentRouter.post('/assessments', uploadOne('submission'), async (req, res) => {
  try {
    const raw = { ...(req.body ?? {}) };
    // Multipart sends everything as strings; accept JSON-encoded rubric and boolean flags.
    if (typeof raw.rubric === 'string') { try { raw.rubric = JSON.parse(raw.rubric); } catch { return res.status(400).json({ code: 'INVALID_REQUEST', error: 'rubric must be JSON.', requestId: rid(req) }); } }
    if (typeof raw.highStakes === 'string') raw.highStakes = raw.highStakes === 'true';
    const body = assessmentRequestSchema.parse(raw);
    const { job, duplicate, rubricWarnings } = await assessmentService.submit(userIdOf(req), body, req.file);
    res.status(duplicate ? 200 : 202).json({ job: FileJobQueue.publicView(job), duplicate, rubricWarnings, links: { status: `/api/jobs/${job.id}`, result: `/api/jobs/${job.id}/result` }, requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

async function withReportUrl<T extends { reportFileId?: string }>(view: T, userId: string) {
  const ref = view.reportFileId ? await fileStore.refresh({ id: view.reportFileId }, userId) : null;
  return { ...view, report: ref ? { url: ref.url, expiresAt: ref.expiresAt, name: ref.name } : null };
}

assessmentRouter.get('/assessments/:id', async (req, res) => {
  try {
    const v = await assessmentService.get(userIdOf(req), req.params.id);
    if (!v) return res.status(404).json({ code: 'NOT_FOUND', error: 'Not found or expired.', requestId: rid(req) });
    res.json({ ...(await withReportUrl(v, userIdOf(req))), requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

assessmentRouter.post('/assessments/:id/reviews', async (req, res) => {
  try {
    const body = z.object({ criterionId: z.string().min(1).max(40), marks: z.number(), comment: z.string().max(2000).optional() }).strict().parse(req.body ?? {});
    const v = await assessmentService.review(userIdOf(req), req.params.id, body as { criterionId: string; marks: number; comment?: string });
    if (!v) return res.status(404).json({ code: 'NOT_FOUND', error: 'Not found or expired.', requestId: rid(req) });
    res.json({ ...(await withReportUrl(v, userIdOf(req))), requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

assessmentRouter.post('/assessments/:id/confirm', async (req, res) => {
  try {
    const body = z.object({ confirmed: z.boolean().default(true) }).strict().parse(req.body ?? {});
    const v = await assessmentService.setConfirmed(userIdOf(req), req.params.id, body.confirmed);
    if (!v) return res.status(404).json({ code: 'NOT_FOUND', error: 'Not found or expired.', requestId: rid(req) });
    res.json({ ...(await withReportUrl(v, userIdOf(req))), requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

// ── Job lifecycle ─────────────────────────────────────────────────────────
export const jobsRouter = Router();

jobsRouter.get('/:id', async (req, res) => {
  const job = await fileJobQueue.get(req.params.id, userIdOf(req));
  if (!job) return res.status(404).json({ code: 'NOT_FOUND', error: 'Not found or expired.', requestId: rid(req) });
  res.json({ job: FileJobQueue.publicView(job), requestId: rid(req) });
});

jobsRouter.get('/:id/result', async (req, res) => {
  const userId = userIdOf(req);
  const job = await fileJobQueue.get(req.params.id, userId);
  if (!job) return res.status(404).json({ code: 'NOT_FOUND', error: 'Not found or expired.', requestId: rid(req) });
  if (job.status !== 'completed') return res.status(409).json({ code: 'NOT_READY', job: FileJobQueue.publicView(job), requestId: rid(req) });
  const result = job.result as Record<string, any>;
  let artifact: unknown = null;
  const fileId = result?.artifact?.fileId ?? result?.reportFileId;
  if (fileId) {
    const ref = await fileStore.refresh({ id: fileId }, userId);
    artifact = ref ? { fileId, name: ref.name, mime: ref.mime, bytes: ref.size, url: ref.url, expiresAt: ref.expiresAt } : { fileId, expired: true };
  }
  res.json({ job: FileJobQueue.publicView(job), result, artifact, requestId: rid(req) });
});

jobsRouter.delete('/:id', async (req, res) => {
  const job = await fileJobQueue.cancel(req.params.id, userIdOf(req));
  if (!job) return res.status(404).json({ code: 'NOT_FOUND', error: 'Not found or expired.', requestId: rid(req) });
  res.json({ job: FileJobQueue.publicView(job), requestId: rid(req) });
});
