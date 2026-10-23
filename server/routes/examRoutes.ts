import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { FileStoreError } from '../services/ai/files/FileStore.js';
import { FileJobQueue, JobError } from '../services/ai/jobs/fileJobQueue.js';
import { fileJobQueue } from '../services/AiService.js';
import { examService } from '../services/educationRuntime.js';
import { ExamInputError, parseManifest, type CandidateMapping } from '../services/exams/service.js';
import logger from '../utils/logger.js';

/**
 * Examination marking API (mounted behind requireAuth). Every lookup is owner-scoped; other users'
 * exams, jobs and files answer 404. Long work is queued and answered with 202.
 */

const userIdOf = (req: Request): string => (req as any).user?.userId;
const rid = (req: Request) => (req as any).requestId;

function fail(req: Request, res: Response, err: unknown) {
  const requestId = rid(req);
  if (err instanceof z.ZodError) return res.status(400).json({ code: 'INVALID_REQUEST', error: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), requestId });
  if (err instanceof ExamInputError) return res.status(err.status).json({ code: err.code, error: err.message, details: err.details, requestId });
  if (err instanceof FileStoreError) return res.status(err.code === 'too_large' ? 413 : 404).json({ code: err.code === 'too_large' ? 'TOO_LARGE' : 'NOT_FOUND', error: err.code === 'too_large' ? err.message : 'Not found or expired.', requestId });
  if (err instanceof JobError) {
    const status = ({ TOO_MANY_JOBS: 429, VISION_MODEL_UNAVAILABLE: 503, UNKNOWN_ELEMENT: 404 } as Record<string, number>)[err.code] ?? (err.code.startsWith('AI_') ? 502 : 400);
    return res.status(status).json({ code: err.code, error: err.message, requestId });
  }
  logger.error('[exams] request failed', { requestId, path: req.path, errorType: (err as Error)?.name });
  return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'The request could not be completed.', requestId });
}

const MAX_FILES = Number(process.env.EXAM_MAX_FILES_PER_UPLOAD) > 0 ? Number(process.env.EXAM_MAX_FILES_PER_UPLOAD) : 30;
const examUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: MAX_FILES + 2, fields: 20, parts: MAX_FILES + 25, fieldSize: 1024 * 1024 } });

const withFiles = (fields: multer.Field[]) => (req: Request, res: Response, next: NextFunction) => {
  examUpload.fields(fields)(req, res, (err?: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ code: err.code === 'LIMIT_FILE_SIZE' ? 'TOO_LARGE' : 'INVALID_UPLOAD', error: err.message, requestId: rid(req) });
    return res.status(400).json({ code: 'INVALID_UPLOAD', error: 'Upload rejected.', requestId: rid(req) });
  });
};

const filesOf = (req: Request, field: string) => ((req.files as Record<string, Express.Multer.File[]> | undefined)?.[field] ?? []).map((f) => ({ name: f.originalname, buffer: f.buffer, mime: f.mimetype }));

const examRef = async (req: Request) => examService.load(userIdOf(req), req.params.examId);

export const examsRouter = Router();

examsRouter.post('/', async (req, res) => {
  try {
    const body = z.object({ title: z.string().trim().min(1).max(200).optional(), passPercent: z.number().min(0).max(100).optional() }).strict().parse(req.body ?? {});
    const exam = await examService.createExam(userIdOf(req), body);
    res.status(201).json({ examId: exam.id, title: exam.title, passPercent: exam.passPercent, requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

examsRouter.get('/:examId', async (req, res) => {
  try {
    const e = await examRef(req);
    const sv = examService.latestScheme(e);
    res.json({
      examId: e.id, title: e.title, passPercent: e.passPercent, resultRevision: e.resultRevision, createdAt: e.createdAt, expiresAt: e.expiresAt,
      scheme: sv ? { version: sv.version, status: sv.status, errors: sv.errors, warnings: sv.warnings } : null,
      submissions: e.submissions.map((s) => ({ id: s.id, candidateId: s.candidateId, candidateName: s.candidateName ?? null, fileName: s.fileName, pages: s.pages, state: s.state, error: s.error ?? null, identity: s.identity })),
      progress: examService.progress(e), requestId: rid(req),
    });
  } catch (err) { fail(req, res, err); }
});

/** JSON body { scheme, confirm? } or multipart "scheme" (+ optional "questionPaper") files for extraction. */
examsRouter.post('/:examId/rubric', withFiles([{ name: 'scheme', maxCount: 5 }, { name: 'questionPaper', maxCount: 1 }]), async (req, res) => {
  try {
    const userId = userIdOf(req);
    const scheme = filesOf(req, 'scheme');
    if (scheme.length) {
      const job = await examService.submitSchemeDocuments(userId, req.params.examId, { scheme, questionPaper: filesOf(req, 'questionPaper')[0], autoMark: req.body?.autoMark === 'true' });
      return res.status(202).json({ job: FileJobQueue.publicView(job), links: { status: `/api/exams/${req.params.examId}/jobs/${job.id}` }, requestId: rid(req) });
    }
    const body = z.object({ scheme: z.unknown(), confirm: z.boolean().optional() }).strict().parse(req.body ?? {});
    const sv = await examService.setSchemeJson(userId, req.params.examId, body.scheme, { confirm: body.confirm });
    res.status(sv.status === 'invalid' ? 422 : 201).json({ version: sv.version, status: sv.status, errors: sv.errors, warnings: sv.warnings, changedQuestionIds: sv.changedQuestionIds ?? [], requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

examsRouter.get('/:examId/rubric', async (req, res) => {
  try {
    const e = await examRef(req);
    res.json({ versions: e.schemes.map((s) => ({ version: s.version, status: s.status, errors: s.errors, warnings: s.warnings, createdAt: s.createdAt, confirmedAt: s.confirmedAt ?? null, changedQuestionIds: s.changedQuestionIds ?? [], scheme: s.scheme })), requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

examsRouter.post('/:examId/rubric/confirm', async (req, res) => {
  try {
    const body = z.object({ version: z.number().int().positive().optional() }).strict().parse(req.body ?? {});
    const sv = await examService.confirmScheme(userIdOf(req), req.params.examId, body.version);
    res.json({ version: sv.version, status: sv.status, requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

/** Multipart "scripts" (PDFs/images), optional "manifest" file or "mapping" JSON field. */
examsRouter.post('/:examId/submissions', withFiles([{ name: 'scripts', maxCount: MAX_FILES }, { name: 'manifest', maxCount: 1 }]), async (req, res) => {
  try {
    const scripts = filesOf(req, 'scripts');
    if (!scripts.length) return res.status(400).json({ code: 'INVALID_REQUEST', error: 'Upload candidate scripts in the "scripts" field.', requestId: rid(req) });
    let mapping: CandidateMapping[] = [];
    const manifest = filesOf(req, 'manifest')[0];
    if (manifest) mapping = parseManifest(manifest.buffer.toString('utf8'));
    if (typeof req.body?.mapping === 'string') {
      mapping = mapping.concat(z.array(z.object({ fileName: z.string().min(1).max(200), candidateId: z.string().min(1).max(40), candidateName: z.string().max(120).optional() }).strict()).max(500).parse(JSON.parse(req.body.mapping)) as CandidateMapping[]);
    }
    const out = await examService.addSubmissions(userIdOf(req), req.params.examId, scripts, mapping);
    res.status(out.accepted.length ? 201 : 422).json({ accepted: out.accepted.map((s) => ({ id: s.id, candidateId: s.candidateId, fileName: s.fileName, identity: s.identity, pages: s.pages })), rejected: out.rejected, requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

examsRouter.post('/:examId/mark', async (req, res) => {
  try {
    const body = z.object({ submissionIds: z.array(z.string().uuid()).max(500).optional(), remarkAll: z.boolean().optional() }).strict().parse(req.body ?? {});
    const out = await examService.startMarking(userIdOf(req), req.params.examId, body);
    res.status(202).json({ ...out, links: { status: `/api/exams/${req.params.examId}/jobs/${out.jobId}` }, requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

examsRouter.get('/:examId/jobs/:jobId', async (req, res) => {
  try {
    const e = await examRef(req);
    const job = await fileJobQueue.get(req.params.jobId, userIdOf(req));
    if (!job || (job.payload as { examId?: string })?.examId !== e.id) return res.status(404).json({ code: 'NOT_FOUND', error: 'Not found or expired.', requestId: rid(req) });
    res.json({ job: FileJobQueue.publicView(job), progress: examService.progress(e), requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

examsRouter.get('/:examId/results', async (req, res) => {
  try {
    const e = await examRef(req);
    const { list, stats, failed } = examService.summaries(e);
    res.json({ resultRevision: e.resultRevision, statistics: stats, candidates: list, failed: failed.map((s) => ({ candidateId: s.candidateId, fileName: s.fileName, error: s.error ?? null })), requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

examsRouter.get('/:examId/submissions/:submissionId', async (req, res) => {
  try {
    res.json({ ...(await examService.candidateView(userIdOf(req), req.params.examId, req.params.submissionId)), requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

examsRouter.patch('/:examId/submissions/:submissionId/marks/:questionId', async (req, res) => {
  try {
    const body = z.object({ marks: z.number().min(0).max(1000), reason: z.string().trim().min(1).max(1000) }).strict().parse(req.body ?? {});
    const out = await examService.overrideMark(userIdOf(req), req.params.examId, { submission: req.params.submissionId, question: req.params.questionId }, body as { marks: number; reason: string });
    res.json({ candidateId: out.candidateId, question: out.question, before: out.before, after: out.after, rubricConflict: out.rubricConflict, resultRevision: out.exam.resultRevision, requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

examsRouter.post('/:examId/submissions/:submissionId/corrections', async (req, res) => {
  try {
    const body = z.object({ elementId: z.string().max(60).optional(), page: z.number().int().positive().optional(), from: z.string().max(2000).optional(), to: z.string().max(5000), remark: z.boolean().optional() }).strict()
      .refine((b) => b.elementId || b.from, 'Give elementId or the text to replace ("from").').parse(req.body ?? {});
    const out = await examService.correctTranscription(userIdOf(req), req.params.examId, { submission: req.params.submissionId }, body as { to: string });
    res.status(out.jobId ? 202 : 200).json({ ...out, links: out.jobId ? { status: `/api/exams/${req.params.examId}/jobs/${out.jobId}` } : undefined, requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

examsRouter.post('/:examId/exports', async (req, res) => {
  try {
    const out = await examService.requestExport(userIdOf(req), req.params.examId);
    if (!out.job) return res.json({ fresh: true, artifact: out.artifact ? examService.artifactRefs(out.artifact) : null, requestId: rid(req) });
    res.status(202).json({ job: FileJobQueue.publicView(out.job), links: { status: `/api/exams/${req.params.examId}/jobs/${out.job.id}`, artifacts: `/api/exams/${req.params.examId}/artifacts` }, requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

examsRouter.get('/:examId/artifacts', async (req, res) => {
  try {
    res.json({ artifacts: await examService.artifacts(userIdOf(req), req.params.examId), requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

// ── Teacher review ───────────────────────────────────────────────────────────

examsRouter.get('/', async (req, res) => {
  try {
    res.json({ exams: await examService.listExams(userIdOf(req)), requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

examsRouter.get('/:examId/review', async (req, res) => {
  try {
    const e = await examRef(req);
    res.json({ exam: { examId: e.id, title: e.title, resultRevision: e.resultRevision }, candidates: examService.reviewList(e), requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

examsRouter.get('/:examId/review/:submissionId', async (req, res) => {
  try {
    res.json({ ...(await examService.reviewCandidate(userIdOf(req), req.params.examId, req.params.submissionId)), requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

/** The candidate's page as displayed, for the review screen (owner only, never cached by shared caches). */
examsRouter.get('/:examId/submissions/:submissionId/pages/:page', async (req, res) => {
  try {
    const page = z.coerce.number().int().min(1).max(500).parse(req.params.page);
    const jpg = await examService.pageImage(userIdOf(req), req.params.examId, req.params.submissionId, page);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(jpg);
  } catch (err) { fail(req, res, err); }
});

examsRouter.put('/:examId/submissions/:submissionId/layout/:itemId', async (req, res) => {
  try {
    const body = z.union([
      z.object({ page: z.number().int().min(1).max(500), fx: z.number().min(0).max(1), fy: z.number().min(0).max(1) }).strict(),
      z.object({ hidden: z.literal(true) }).strict(),
      z.object({ reset: z.literal(true) }).strict(),
    ]).parse(req.body ?? {});
    const itemId = z.string().max(120).regex(/^(total|[\w.-]+:(mark|correction))$/).parse(req.params.itemId);
    await examService.setLayout(userIdOf(req), req.params.examId, req.params.submissionId, itemId, body);
    res.json({ ...(await examService.reviewCandidate(userIdOf(req), req.params.examId, req.params.submissionId)), requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

examsRouter.post('/:examId/release', async (req, res) => {
  try {
    const body = z.object({ submissionIds: z.array(z.string().min(1).max(60)).min(1).max(500).optional(), all: z.literal(true).optional() }).strict()
      .refine((b) => b.all || b.submissionIds, 'Give submissionIds or all: true.').parse(req.body ?? {});
    const out = await examService.release(userIdOf(req), req.params.examId, body.all ? 'all' : body.submissionIds!);
    // Regenerate the marked PDFs without the draft label.
    const exp = out.released.length ? await examService.requestExport(userIdOf(req), req.params.examId) : null;
    res.json({ released: out.released, skipped: out.skipped, resultRevision: out.exam.resultRevision, exportJobId: exp?.job?.id ?? null, requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});
