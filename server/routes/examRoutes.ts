import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { markingLimits } from '../services/exams/limits.js';
import { z } from 'zod';
import { FileStoreError } from '../services/ai/files/FileStore.js';
import { FileJobQueue, JobError } from '../services/ai/jobs/fileJobQueue.js';
import { fileJobQueue } from '../services/AiService.js';
import { examService } from '../services/educationRuntime.js';
import { ExamInputError, parseManifest, type CandidateMapping } from '../services/exams/service.js';
import logger from '../utils/logger.js';
import { createHash } from 'node:crypto';
import { streamExam } from '../services/exams/live.js';
import { precheckFile } from '../services/exams/precheck.js';
import { prisma } from '../db.js';

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

const MAX_FILES = markingLimits.maxCandidates;
const uploadDir = path.join(os.tmpdir(), `bwenge-exams-${randomUUID()}`);
const examUpload = multer({ storage: multer.diskStorage({ destination: (_req, _file, cb) => { void fs.mkdir(uploadDir, { recursive: true, mode: 0o700 }).then(() => cb(null, uploadDir), error => cb(error as Error, uploadDir)); }, filename: (_req, _file, cb) => cb(null, `bwenge-exam-${randomUUID()}`) }), limits: { fileSize: markingLimits.maxFileBytes, files: MAX_FILES + 2, fields: 20, parts: MAX_FILES + 25, fieldSize: 1024 * 1024 } });

const withFiles = (fields: multer.Field[]) => (req: Request, res: Response, next: NextFunction) => {
  examUpload.fields(fields)(req, res, (err?: unknown) => {
    if (!err) {
      const files = Object.values((req.files || {}) as Record<string, Express.Multer.File[]>).flat();
      void (async () => {
        try {
          if (files.reduce((sum, file) => sum + file.size, 0) > markingLimits.maxUploadBytes) {
            res.status(413).json({ code: 'TOO_LARGE', error: 'This upload exceeds the batch size limit. Send a smaller batch.' }); return;
          }
          for (const file of files) file.buffer = await fs.readFile(file.path);
          next();
        } catch (error) { next(error); }
        finally { await Promise.allSettled(files.map(file => fs.unlink(file.path))); }
      })();
      return;
    }
    if (err instanceof multer.MulterError) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ code: err.code === 'LIMIT_FILE_SIZE' ? 'TOO_LARGE' : 'INVALID_UPLOAD', error: err.message, requestId: rid(req) });
    return res.status(400).json({ code: 'INVALID_UPLOAD', error: 'Upload rejected.', requestId: rid(req) });
  });
};

const filesOf = (req: Request, field: string) => ((req.files as Record<string, Express.Multer.File[]> | undefined)?.[field] ?? []).map((f) => ({ name: f.originalname, buffer: f.buffer, mime: f.mimetype }));

const examRef = async (req: Request) => examService.load(userIdOf(req), req.params.examId);

export const examsRouter = Router();
examsRouter.get('/limits', (_req, res) => res.json(markingLimits));

/**
 * Mark page summary before marking: pages, typed or handwritten, students in a ZIP and photos that will read
 * badly, for files the user already uploaded (/api/files/upload ids). No AI is used.
 */
examsRouter.post('/precheck', async (req, res) => {
  try {
    const body = z.object({ fileIds: z.array(z.string().min(1).max(100)).min(1).max(60) }).strict().parse(req.body ?? {});
    const recs = await prisma.fileRecord.findMany({ where: { id: { in: body.fileIds }, userId: userIdOf(req) }, select: { id: true, name: true, path: true, mimeType: true } });
    const files = [];
    for (const r of recs) {
      if (!r.path) continue;
      try { files.push({ fileId: r.id, ...(await precheckFile({ name: r.name, mime: r.mimeType ?? undefined, data: await fs.readFile(r.path) })) }); } catch { files.push({ fileId: r.id, name: r.name, kind: 'other', pages: 0, typedPages: 0, issues: [{ issue: 'unreadable' }] }); }
    }
    res.json({ files, requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

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

/**
 * Live marking activity (Server-Sent Events): the saved event log, unlike /events, which streams state snapshots. Replays everything after `?after=` or the Last-Event-ID header,
 * then streams new events as they are saved. Closing the page never stops the marking job. Events from a
 * job running in another server process are picked up by a short re-read of the stored record.
 */
examsRouter.get('/:examId/activity', async (req, res) => {
  const userId = userIdOf(req);
  const examId = req.params.examId;
  let last = Number(req.get('last-event-id') ?? req.query.after ?? 0);
  if (!Number.isFinite(last) || last < 0) last = 0;
  let first;
  try { first = await examService.eventsSince(userId, examId, last); } catch (err) { return fail(req, res, err); }
  res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  let closed = false;
  const send = (ev: { seq: number }) => {
    if (closed || ev.seq <= last) return; // duplicates (live push and re-read) are dropped by sequence
    last = ev.seq;
    res.write(`id: ${ev.seq}\nevent: exam\ndata: ${JSON.stringify(ev)}\n\n`);
  };
  if (first.gap) res.write(`event: gap\ndata: ${JSON.stringify({ lastSeq: first.lastSeq })}\n\n`);
  for (const ev of first.events) send(ev);
  const off = examService.subscribe(examId, (ev) => send(ev));
  const reread = setInterval(() => { examService.eventsSince(userId, examId, last).then((r) => r.events.forEach(send)).catch(() => undefined); }, 3000);
  const beat = setInterval(() => { if (!closed) res.write(': ping\n\n'); }, 15_000);
  req.on('close', () => { closed = true; off(); clearInterval(reread); clearInterval(beat); });
});

/** Stops the marking run in progress. Finished scripts keep their marks. */
examsRouter.post('/:examId/cancel', async (req, res) => {
  try { res.json({ ...(await examService.cancelRun(userIdOf(req), req.params.examId)), requestId: rid(req) }); } catch (err) { fail(req, res, err); }
});

examsRouter.get('/:examId/preferences', async (req, res) => {
  try { const e = await examRef(req); res.json({ preferences: e.preferences ?? { credit: 'partial', corrections: true, feedback: 'brief' }, requestId: rid(req) }); } catch (err) { fail(req, res, err); }
});

examsRouter.put('/:examId/preferences', async (req, res) => {
  try {
    const body = z.object({ credit: z.enum(['partial', 'strict']).optional(), corrections: z.boolean().optional(), feedback: z.enum(['brief', 'detailed']).optional(), instructions: z.string().max(2000).optional(), overnight: z.boolean().optional() }).strict().parse(req.body ?? {});
    res.json({ preferences: await examService.setPreferences(userIdOf(req), req.params.examId, body), requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

/** Bearer-authenticated SSE; the first owner-scoped snapshot also restores a refreshed workspace. */
examsRouter.get('/:examId/events', async (req, res) => {
  try {
    const query = z.object({ submissionId: z.string().uuid().optional(), jobs: z.string().max(300).optional() }).parse(req.query);
    const jobIds = query.jobs ? z.array(z.string().uuid()).max(4).parse(query.jobs.split(',')) : [];
    const userId = userIdOf(req);
    let cached: { id: string; data: unknown } | undefined;
    await streamExam(req, res, async () => {
      const exam = await examRef(req);
      const jobs = await Promise.all(jobIds.map(async id => {
        const job = await fileJobQueue.get(id, userId);
        // A job owned by the same user but belonging to a different exam is still excluded.
        return job && (job.payload as { examId?: string }).examId === exam.id ? FileJobQueue.publicView(job) : null;
      }));
      const id = createHash('sha256').update(JSON.stringify([exam.updatedAt, exam.resultRevision, exam.submissions.map(s => [s.id, s.state, s.stateAt, s.activity]), exam.schemes.map(s => [s.version, s.status]), exam.artifacts.map(a => [a.id, a.status]), jobs])).digest('hex');
      if (cached?.id === id) return cached;
      const scheme = examService.latestScheme(exam);
      const selected = query.submissionId || exam.submissions[0]?.id;
      const review = selected && exam.results[selected] ? await examService.reviewCandidate(userId, exam.id, selected) : null;
      const data = {
        exam: { examId: exam.id, title: exam.title, scheme: scheme ? { status: scheme.status, errors: scheme.errors, warnings: scheme.warnings } : null,
          submissions: exam.submissions.map(s => ({ id: s.id, candidateId: s.candidateId, candidateName: s.candidateName ?? null, pages: s.pages, state: s.state, error: s.error ?? null })),
          progress: examService.progress(exam) },
        candidates: examService.reviewList(exam), review, jobs: jobs.filter(Boolean),
        schemePreview: scheme?.status === 'needs_confirmation' ? scheme.scheme : null,
        artifacts: await examService.artifacts(userId, exam.id),
      };
      cached = { id, data }; return cached;
    });
  } catch (err) { if (!res.headersSent) fail(req, res, err); else res.end(); }
});

examsRouter.get('/:examId/submissions/:submissionId/evidence/:elementId', async (req, res) => {
  try {
    const elementId = z.string().min(1).max(120).parse(req.params.elementId);
    const jpg = await examService.evidenceCrop(userIdOf(req), req.params.examId, req.params.submissionId, elementId);
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).end(jpg);
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

// Draft from the visible questions or an optional question-paper upload; teacher confirms before use.
examsRouter.post('/:examId/rubric/draft', withFiles([{ name: 'questionPaper', maxCount: 1 }]), async (req, res) => {
  try {
    const job = await examService.draftScheme(userIdOf(req), req.params.examId, { questionPaper: filesOf(req, 'questionPaper')[0] });
    res.status(202).json({ job: FileJobQueue.publicView(job), requestId: rid(req) });
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
    const body = z.object({ submissionIds: z.array(z.string().uuid()).max(500).optional(), remarkAll: z.boolean().optional(), overnight: z.boolean().optional() }).strict().parse(req.body ?? {});
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

examsRouter.post('/:examId/stop', async (req, res) => {
  try { res.json(await examService.stopMarking(userIdOf(req), req.params.examId)); }
  catch (err) { fail(req, res, err); }
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

examsRouter.post('/:examId/submissions/:submissionId/confirm', async (req, res) => {
  try {
    const body = z.object({ question: z.string().max(100).optional() }).strict().parse(req.body ?? {});
    const exam = await examService.confirmResults(userIdOf(req), req.params.examId, { submission: req.params.submissionId, question: body.question });
    res.json({ resultRevision: exam.resultRevision, requestId: rid(req) });
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
    let jpg = await examService.pageImage(userIdOf(req), req.params.examId, req.params.submissionId, page);
    if (req.query.thumbnail === '1') jpg = await sharp(jpg).resize({ width: 140, withoutEnlargement: true }).jpeg({ quality: 65 }).toBuffer();
    else if (req.query.width !== undefined) {
      const width = Number(z.enum(['1000', '1600', '2200']).parse(req.query.width));
      jpg = await sharp(jpg).resize({ width, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(jpg);
  } catch (err) { fail(req, res, err); }
});

// The teacher's own pen marks on the script (tick, cross, circle, box, highlight, underline, note).
examsRouter.post('/:examId/submissions/:submissionId/pen', async (req, res) => {
  try {
    const f = z.number().min(0).max(1);
    const body = z.object({ page: z.number().int().min(1).max(500), kind: z.enum(['tick', 'cross', 'circle', 'box', 'highlight', 'underline', 'note']), x0: f, y0: f, x1: f.optional(), y1: f.optional(), text: z.string().max(200).optional() }).strict().parse(req.body ?? {});
    await examService.addPen(userIdOf(req), req.params.examId, req.params.submissionId, body);
    res.status(201).json({ ...(await examService.reviewCandidate(userIdOf(req), req.params.examId, req.params.submissionId)), requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

examsRouter.delete('/:examId/submissions/:submissionId/pen/:penId', async (req, res) => {
  try {
    await examService.removePen(userIdOf(req), req.params.examId, req.params.submissionId, z.string().regex(/^[\w-]{1,40}$/).parse(req.params.penId));
    res.json({ ...(await examService.reviewCandidate(userIdOf(req), req.params.examId, req.params.submissionId)), requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

examsRouter.put('/:examId/submissions/:submissionId/layout/:itemId', async (req, res) => {
  try {
    const body = z.union([
      z.object({ page: z.number().int().min(1).max(500), fx: z.number().min(0).max(1), fy: z.number().min(0).max(1) }).strict(),
      z.object({ hidden: z.literal(true) }).strict(),
      z.object({ reset: z.literal(true) }).strict(),
    ]).parse(req.body ?? {});
    const itemId = z.string().max(160).regex(/^(total|[\w.-]+:(mark|correction|criterion:[\w.-]+|note:[\w.-]+|pen:[\w.-]+:[\w.-]+))$/).parse(req.params.itemId);
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
