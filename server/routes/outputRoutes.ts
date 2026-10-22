import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { FileStoreError } from '../services/ai/files/FileStore.js';
import { JobError } from '../services/ai/jobs/fileJobQueue.js';
import { outputService } from '../services/educationRuntime.js';
import { OutputError, publicView } from '../services/outputs/service.js';
import { planOutput, type PlanInput } from '../services/outputs/planner.js';
import logger from '../utils/logger.js';

/**
 * Universal output API (mounted behind requireAuth, except the share-link router). Artifacts are
 * owner-scoped; other users' artifacts answer 404. Background renders answer 202 with the artifact,
 * whose status moves queued → generating → ready | failed.
 */

const userIdOf = (req: Request): string => (req as any).user?.userId;
const rid = (req: Request) => (req as any).requestId;

function fail(req: Request, res: Response, err: unknown) {
  const requestId = rid(req);
  if (err instanceof z.ZodError) return res.status(400).json({ code: 'INVALID_REQUEST', error: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), requestId });
  if (err instanceof OutputError) return res.status(err.status).json({ code: err.code, error: err.message, details: err.details, requestId });
  if (err instanceof FileStoreError) return res.status(404).json({ code: 'NOT_FOUND', error: 'Not found or expired.', requestId });
  if (err instanceof JobError) return res.status(err.code === 'TOO_MANY_JOBS' ? 429 : 400).json({ code: err.code, error: err.message, requestId });
  logger.error('[outputs] request failed', { requestId, path: req.path, errorType: (err as Error)?.name });
  return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'The request could not be completed.', requestId });
}

const sourceRef = z.object({ type: z.string().max(40), id: z.string().max(100) }).strict();

/** HTML and SVG are served as sandboxed documents: their inline scripts may run, but they get an opaque origin and no network. */
async function send(req: Request, res: Response, opened: Awaited<ReturnType<typeof outputService.open>>) {
  const { artifact, meta, stream } = opened;
  const inline = req.query.view === '1' && ['html', 'svg', 'png', 'pdf', 'json'].includes(artifact.format);
  const name = meta.name;
  res.setHeader('Content-Type', inline ? meta.mime : 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('Content-Length', String(meta.size));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', artifact.format === 'html'
    ? "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-downloads"
    : "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Artifact-Revision', String(artifact.revision));
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

export const outputsRouter = Router();

/** Chooses the output for a request without generating anything. */
outputsRouter.post('/plan', async (req, res) => {
  try {
    const body = z.object({
      message: z.string().min(1).max(20000),
      attachments: z.array(z.object({ name: z.string().max(300), mime: z.string().max(200).optional() }).strict()).max(50).optional(),
      sources: z.array(sourceRef).max(20).optional(),
      hasDataset: z.boolean().optional(),
    }).strict().parse(req.body ?? {});
    const sources = (body.sources ?? []) as Array<{ type: string; id: string }>;
    const allowed = await outputService.authorizeSources(userIdOf(req), sources);
    const plan = planOutput({ ...body, message: body.message!, sources, attachments: body.attachments as PlanInput['attachments'], imageGenerationAvailable: false }, (s) => (allowed.get(`${s.type}:${s.id}`) ? { ok: true } : { ok: false, reason: 'not found or not accessible' }));
    res.json({ plan, requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

/** Body: an output spec (see docs/OUTPUT_ENGINE.md). 201 when ready, 202 while rendering in the background. */
outputsRouter.post('/', async (req, res) => {
  try {
    const { artifact, reused } = await outputService.create(userIdOf(req), req.body);
    res.status(artifact.status === 'ready' ? (reused ? 200 : 201) : artifact.status === 'failed' ? 422 : 202).json({ artifact: publicView(artifact), reused, requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

/** Shortcut for { kind: 'analysis', ... }: deterministic statistics on an owned dataset. */
outputsRouter.post('/analyze', async (req, res) => {
  try {
    const body = z.object({ title: z.string().max(200).optional(), dataset: z.unknown(), analysis: z.unknown() }).strict().parse(req.body ?? {});
    const spec = { kind: 'analysis', title: body.title ?? 'Data analysis', sources: [], dataset: body.dataset, analysis: body.analysis };
    const { artifact, reused } = await outputService.create(userIdOf(req), spec);
    res.status(artifact.status === 'ready' ? 200 : artifact.status === 'failed' ? 422 : 202).json({ artifact: publicView(artifact), reused, requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

outputsRouter.get('/', async (req, res) => {
  try {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).optional(), kind: z.string().max(20).optional() }).parse(req.query);
    res.json({ artifacts: await outputService.list(userIdOf(req), q), requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

outputsRouter.get('/:id', async (req, res) => {
  try { res.json({ artifact: await outputService.readable(userIdOf(req), req.params.id), requestId: rid(req) }); } catch (err) { fail(req, res, err); }
});

/** Computed analysis results (JSON) for an analysis artifact. */
outputsRouter.get('/:id/analysis', async (req, res) => {
  try { res.json({ analysis: await outputService.readAnalysis(userIdOf(req), req.params.id), requestId: rid(req) }); } catch (err) { fail(req, res, err); }
});

outputsRouter.get('/:id/revisions', async (req, res) => {
  try { res.json({ revisions: await outputService.revisions(userIdOf(req), req.params.id), requestId: rid(req) }); } catch (err) { fail(req, res, err); }
});

/** Body: the full new spec. Creates revision n+1; earlier revisions stay downloadable. */
outputsRouter.post('/:id/revisions', async (req, res) => {
  try {
    const a = await outputService.revise(userIdOf(req), req.params.id, req.body);
    res.status(a.status === 'ready' ? 201 : a.status === 'failed' ? 422 : 202).json({ artifact: publicView(a), requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

outputsRouter.post('/:id/retry', async (req, res) => {
  try {
    const a = await outputService.retry(userIdOf(req), req.params.id);
    res.status(a.status === 'ready' ? 200 : 202).json({ artifact: publicView(a), requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

outputsRouter.post('/:id/share', async (req, res) => {
  try {
    const body = z.object({ mode: z.enum(['private', 'organization', 'link']), organizationId: z.string().max(100).optional(), expiresInHours: z.number().int().min(1).max(24 * 90).optional() }).strict().parse(req.body ?? {});
    res.json({ ...(await outputService.share(userIdOf(req), req.params.id, body as Parameters<typeof outputService.share>[2])), requestId: rid(req) });
  } catch (err) { fail(req, res, err); }
});

outputsRouter.get('/:id/download', async (req, res) => {
  try { await send(req, res, await outputService.open(userIdOf(req), req.params.id)); } catch (err) { fail(req, res, err); }
});

outputsRouter.delete('/:id', async (req, res) => {
  try { res.json({ ...(await outputService.remove(userIdOf(req), req.params.id)), requestId: rid(req) }); } catch (err) { fail(req, res, err); }
});

/** Public, token-only access for link shares (no login). The token is the credential and expires. */
export const sharedOutputsRouter = Router();

sharedOutputsRouter.get('/:token', async (req, res) => {
  try {
    const token = z.string().min(20).max(100).regex(/^[A-Za-z0-9_-]+$/).parse(req.params.token);
    const a = await outputService.byToken('', token);
    if (req.query.meta === '1') return res.json({ artifact: { ...publicView(a), owner: undefined, share: undefined, download: null }, requestId: rid(req) });
    await send(req, res, await outputService.open('', a.id, token));
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(404).json({ code: 'NOT_FOUND', error: 'Artifact not found.', requestId: rid(req) });
    fail(req, res, err);
  }
});
