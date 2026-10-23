import { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { FileStoreError } from '../services/ai/files/FileStore.js';
import { JobError } from '../services/ai/jobs/fileJobQueue.js';
import { knowledgeService } from '../services/educationRuntime.js';
import { KnowledgeError, type ConflictPolicy, type UploadItem } from '../services/knowledge/service.js';
import { PathError } from '../services/knowledge/paths.js';
import logger from '../utils/logger.js';
import { SharedRateLimitStore } from '../services/cache/redis.js';

/**
 * Knowledge repository (file explorer) API. Mounted at /api/admin/knowledge behind requireAuth +
 * requireRole('ADMIN'); every repository, folder, file and job is additionally checked against the
 * signed-in admin's ownership or organisation. Responses follow the admin API shape { success, data }.
 */

const userIdOf = (req: Request): string => (req as any).user?.userId;

function fail(res: Response, err: unknown) {
  if (err instanceof z.ZodError) return res.status(400).json({ success: false, code: 'INVALID_REQUEST', error: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') });
  if (err instanceof KnowledgeError) return res.status(err.status).json({ success: false, code: err.code, error: err.message, details: err.details });
  if (err instanceof PathError) return res.status(400).json({ success: false, code: 'INVALID_PATH', error: err.message });
  if (err instanceof FileStoreError) return res.status(err.code === 'too_large' ? 413 : 404).json({ success: false, code: err.code === 'too_large' ? 'TOO_LARGE' : 'NOT_FOUND', error: err.code === 'too_large' ? err.message : 'The stored file is not available.' });
  if (err instanceof JobError) return res.status(err.code === 'TOO_MANY_JOBS' ? 429 : 400).json({ success: false, code: err.code, error: err.message });
  logger.error('[knowledge] request failed', { errorType: (err as Error)?.name });
  return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', error: 'The request could not be completed.' });
}

const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data });
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => { fn(req, res).catch((e) => fail(res, e)); };

const isDev = process.env.NODE_ENV !== 'production';
/** Expensive ingestion operations (uploads, re-index, archive extraction) per admin. */
const ingestLimiter = isDev ? (_req: Request, _res: Response, next: NextFunction) => next() : rateLimit({ store: new SharedRateLimitStore('knowledge-ingest'),
  windowMs: 15 * 60 * 1000, limit: Number(process.env.KNOWLEDGE_INGEST_RATE_LIMIT) > 0 ? Number(process.env.KNOWLEDGE_INGEST_RATE_LIMIT) : 60,
  keyGenerator: (req) => `knowledge:${(req as any).user?.userId ?? 'anonymous'}`, standardHeaders: true, legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMITED', error: 'Too many uploads or re-index requests. Try again later.' },
});

const UPLOAD_TMP = path.join(process.env.KNOWLEDGE_TMP_DIR || os.tmpdir(), 'bwenge-knowledge-uploads');
mkdirSync(UPLOAD_TMP, { recursive: true, mode: 0o700 });
const MAX_FILE = Number(process.env.KNOWLEDGE_MAX_FILE_BYTES) > 0 ? Number(process.env.KNOWLEDGE_MAX_FILE_BYTES) : 100 * 1024 * 1024;
const MAX_FILES = Number(process.env.KNOWLEDGE_MAX_FILES_PER_UPLOAD) > 0 ? Number(process.env.KNOWLEDGE_MAX_FILES_PER_UPLOAD) : 500;

// Files stream to disk under random names (never the client's name); relative paths are kept as metadata.
const diskUpload = multer({
  storage: multer.diskStorage({ destination: UPLOAD_TMP, filename: (_req, _file, cb) => cb(null, `${randomUUID()}.part`) }),
  preservePath: true,
  limits: { fileSize: MAX_FILE, files: MAX_FILES, fields: 20, fieldSize: 4 * 1024 * 1024, parts: MAX_FILES + 25 },
});

function withUploads(req: Request, res: Response, next: NextFunction) {
  diskUpload.array('files', MAX_FILES)(req, res, (err?: unknown) => {
    if (!err) return next();
    cleanup(req);
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT' ? 413 : 400;
      return res.status(status).json({ success: false, code: err.code === 'LIMIT_FILE_SIZE' ? 'TOO_LARGE' : err.code === 'LIMIT_FILE_COUNT' ? 'TOO_MANY_FILES' : 'INVALID_UPLOAD', error: err.code === 'LIMIT_FILE_SIZE' ? `Each file can be at most ${Math.round(MAX_FILE / 1048576)} MB.` : err.code === 'LIMIT_FILE_COUNT' ? `At most ${MAX_FILES} files per upload.` : err.message });
    }
    return res.status(400).json({ success: false, code: 'INVALID_UPLOAD', error: 'Upload rejected.' });
  });
}
function cleanup(req: Request) {
  for (const f of (req.files as Express.Multer.File[] | undefined) ?? []) void rm(f.path, { force: true });
}

const jsonField = <T>(v: unknown, schema: z.ZodType<T>, fallback: T): T => {
  if (v === undefined || v === '') return fallback;
  return schema.parse(typeof v === 'string' ? JSON.parse(v) : v);
};

const uploadBody = z.object({
  directoryId: z.string().uuid().optional().or(z.literal('')),
  onConflict: z.enum(['rename', 'replace', 'skip']).optional(),
  relativePaths: z.string().optional(),
  emptyFolders: z.string().optional(),
}).strict();

async function handleUpload(req: Request, res: Response, folder: boolean) {
  try {
    const body = uploadBody.parse(req.body ?? {});
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const relativePaths = jsonField(body.relativePaths, z.array(z.string().max(2048)).max(MAX_FILES), [] as string[]);
    const emptyFolders = jsonField(body.emptyFolders, z.array(z.string().max(2048)).max(2000), [] as string[]);
    if (!files.length && !emptyFolders.length) return res.status(400).json({ success: false, code: 'INVALID_REQUEST', error: 'Attach files in the "files" field.' });
    if (relativePaths.length && relativePaths.length !== files.length) return res.status(400).json({ success: false, code: 'INVALID_REQUEST', error: 'relativePaths must list one path per uploaded file, in the same order.' });
    const items: UploadItem[] = files.map((f, i) => {
      const rel = relativePaths[i] || f.originalname;
      return { tempPath: f.path, name: rel.split(/[\\/]/).pop() || f.originalname, relativePath: folder || rel.includes('/') || rel.includes('\\') ? rel : undefined, size: f.size };
    });
    const out = await knowledgeService.ingest(userIdOf(req), req.params.id, { directoryId: body.directoryId || null, items, onConflict: body.onConflict as ConflictPolicy | undefined, emptyFolders });
    ok(res, out, out.results.some((r) => r.status !== 'rejected') || emptyFolders.length ? 201 : 422);
  } catch (e) {
    fail(res, e);
  } finally {
    cleanup(req);
  }
}

export const knowledgeAdminRouter = Router();

knowledgeAdminRouter.get('/repositories', wrap(async (req, res) => ok(res, await knowledgeService.listRepositories(userIdOf(req)))));

knowledgeAdminRouter.post('/repositories', wrap(async (req, res) => {
  const body = z.object({
    name: z.string().min(1).max(200), description: z.string().max(2000).optional(), organizationId: z.string().nullable().optional(), knowledgeBaseId: z.string().nullable().optional(),
    settings: z.object({ language: z.string().max(10).optional(), domain: z.string().max(40).optional(), ocr: z.boolean().optional(), autoIndex: z.boolean().optional(), assistant: z.boolean().optional() }).strict().optional(),
    quotaBytes: z.number().int().positive().nullable().optional(),
  }).strict().parse(req.body ?? {});
  ok(res, await knowledgeService.createRepository(userIdOf(req), body as any), 201);
}));

knowledgeAdminRouter.get('/repositories/:id', wrap(async (req, res) => {
  const repo = await knowledgeService.repoFor(userIdOf(req), req.params.id);
  ok(res, { ...repo, statistics: await knowledgeService.statistics(repo) });
}));

knowledgeAdminRouter.patch('/repositories/:id', wrap(async (req, res) => {
  const body = z.object({
    name: z.string().min(1).max(200).optional(), description: z.string().max(2000).nullable().optional(), knowledgeBaseId: z.string().optional(), quotaBytes: z.number().int().positive().nullable().optional(),
    settings: z.object({ language: z.string().max(10).optional(), domain: z.string().max(40).optional(), ocr: z.boolean().optional(), autoIndex: z.boolean().optional(), assistant: z.boolean().optional() }).strict().optional(),
  }).strict().parse(req.body ?? {});
  ok(res, await knowledgeService.updateRepository(userIdOf(req), req.params.id, body as any));
}));

knowledgeAdminRouter.delete('/repositories/:id', wrap(async (req, res) => {
  if (req.query.confirm !== 'true') return res.status(400).json({ success: false, code: 'CONFIRM_REQUIRED', error: 'Deleting a repository removes all its folders, files and indexed content. Repeat with ?confirm=true.' });
  ok(res, await knowledgeService.deleteRepository(userIdOf(req), req.params.id));
}));

knowledgeAdminRouter.get('/repositories/:id/tree', wrap(async (req, res) => ok(res, await knowledgeService.tree(userIdOf(req), req.params.id))));
knowledgeAdminRouter.get('/repositories/:id/statistics', wrap(async (req, res) => ok(res, await knowledgeService.statistics(userIdOf(req), req.params.id))));

const listQuery = z.object({
  directoryId: z.string().optional(), sort: z.enum(['name', 'type', 'size', 'modified', 'status']).optional(), order: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(), offset: z.coerce.number().int().min(0).optional(), extension: z.string().max(20).optional(), status: z.string().max(40).optional(),
}).strict();

knowledgeAdminRouter.get('/repositories/:id/contents', wrap(async (req, res) => {
  const q = listQuery.parse(req.query);
  ok(res, await knowledgeService.contents(userIdOf(req), req.params.id, q.directoryId || null, q));
}));
knowledgeAdminRouter.get('/repositories/:id/directories/:directoryId/contents', wrap(async (req, res) => {
  const q = listQuery.omit({ directoryId: true }).parse(req.query);
  ok(res, await knowledgeService.contents(userIdOf(req), req.params.id, req.params.directoryId === 'root' ? null : req.params.directoryId, q));
}));

knowledgeAdminRouter.post('/repositories/:id/directories', wrap(async (req, res) => {
  const body = z.object({ name: z.string().min(1).max(200), parentId: z.string().nullable().optional() }).strict().parse(req.body ?? {});
  ok(res, await knowledgeService.createDirectory(userIdOf(req), req.params.id, body.parentId ?? null, body.name), 201);
}));

knowledgeAdminRouter.post('/repositories/:id/uploads', ingestLimiter, withUploads, (req, res) => { void handleUpload(req, res, false); });
knowledgeAdminRouter.post('/repositories/:id/folder-uploads', ingestLimiter, withUploads, (req, res) => { void handleUpload(req, res, true); });

knowledgeAdminRouter.get('/repositories/:id/search', wrap(async (req, res) => {
  const q = z.object({ q: z.string().min(1).max(500), scope: z.enum(['all', 'names', 'content']).optional(), limit: z.coerce.number().int().min(1).max(100).optional(), directoryId: z.string().optional() }).strict().parse(req.query);
  ok(res, await knowledgeService.search(userIdOf(req), req.params.id, { query: q.q, scope: q.scope, limit: q.limit, directoryId: q.directoryId || null }));
}));

knowledgeAdminRouter.post('/repositories/:id/reindex', ingestLimiter, wrap(async (req, res) => {
  const body = z.object({ onlyFailed: z.boolean().optional(), force: z.boolean().optional() }).strict().parse(req.body ?? {});
  ok(res, await knowledgeService.reindexRepository(userIdOf(req), req.params.id, body), 202);
}));

knowledgeAdminRouter.post('/repositories/:id/files/bulk', wrap(async (req, res) => {
  const body = z.object({ action: z.enum(['move', 'copy', 'delete', 'reindex']), fileIds: z.array(z.string()).min(1).max(1000), targetDirectoryId: z.string().nullable().optional() }).strict().parse(req.body ?? {});
  ok(res, await knowledgeService.bulk(userIdOf(req), req.params.id, body as { action: "move" | "copy" | "delete" | "reindex"; fileIds: string[]; targetDirectoryId?: string | null }));
}));

knowledgeAdminRouter.patch('/directories/:id', wrap(async (req, res) => {
  const body = z.object({ name: z.string().min(1).max(200).optional(), parentId: z.string().nullable().optional(), knowledgeBaseId: z.string().nullable().optional(), aiEnabled: z.boolean().optional() }).strict().parse(req.body ?? {});
  ok(res, await knowledgeService.updateDirectory(userIdOf(req), req.params.id, body));
}));

knowledgeAdminRouter.delete('/directories/:id', wrap(async (req, res) => ok(res, await knowledgeService.deleteDirectory(userIdOf(req), req.params.id, req.query.recursive === 'true'))));

knowledgeAdminRouter.get('/files/:id', wrap(async (req, res) => ok(res, await knowledgeService.getFile(userIdOf(req), req.params.id))));

knowledgeAdminRouter.get('/files/:id/preview', wrap(async (req, res) => {
  const q = z.object({ page: z.coerce.number().int().min(1).optional(), sheet: z.string().max(200).optional(), offset: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().min(1).optional(), render: z.enum(['image']).optional() }).strict().parse(req.query);
  if (q.render === 'image') {
    const png = await knowledgeService.renderImage(userIdOf(req), req.params.id, q.page ?? 1);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(png);
  }
  ok(res, await knowledgeService.preview(userIdOf(req), req.params.id, q));
}));

const INLINE_SAFE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/plain', 'text/csv', 'text/markdown', 'application/json']);

/** Streams a stored file; Range requests supported. Unsafe types (HTML, SVG, …) always download. */
export async function sendStoredFile(req: Request, res: Response, open: (range?: { start: number; end: number }) => Promise<{ file: any; stream: NodeJS.ReadableStream }>, sizeOf: () => Promise<number>, allowRange = true) {
  const size = await sizeOf();
  let range: { start: number; end: number } | undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (allowRange && m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) { res.setHeader('Content-Range', `bytes */${size}`); return res.status(416).end(); }
    range = { start, end };
  }
  const { file, stream } = await open(range);
  const inline = req.query.inline === '1' && INLINE_SAFE.has(file.mimeType);
  res.setHeader('Content-Type', inline ? (file.mimeType.startsWith('text/') ? `${file.mimeType}; charset=utf-8` : file.mimeType) : 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${file.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Accept-Ranges', allowRange ? 'bytes' : 'none');
  res.setHeader('Cache-Control', 'private, no-store');
  if (range) { res.status(206); res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`); res.setHeader('Content-Length', String(range.end - range.start + 1)); }
  else res.setHeader('Content-Length', String(size));
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

knowledgeAdminRouter.get('/files/:id/download', wrap(async (req, res) => {
  const meta = await knowledgeService.getFile(userIdOf(req), req.params.id);
  await sendStoredFile(req, res, (range) => knowledgeService.openDownload(userIdOf(req), req.params.id, range), async () => meta.sizeBytes);
}));

knowledgeAdminRouter.patch('/files/:id', wrap(async (req, res) => {
  const body = z.object({ name: z.string().min(1).max(200).optional(), directoryId: z.string().nullable().optional(), knowledgeBaseId: z.string().nullable().optional(), aiEnabled: z.boolean().optional() }).strict().parse(req.body ?? {});
  ok(res, await knowledgeService.updateFile(userIdOf(req), req.params.id, body));
}));

knowledgeAdminRouter.post('/files/:id/copy', wrap(async (req, res) => {
  const body = z.object({ targetDirectoryId: z.string().nullable().optional(), name: z.string().min(1).max(200).optional() }).strict().parse(req.body ?? {});
  ok(res, await knowledgeService.copyFile(userIdOf(req), req.params.id, body.targetDirectoryId ?? null, body.name), 201);
}));

knowledgeAdminRouter.delete('/files/:id', wrap(async (req, res) => ok(res, await knowledgeService.deleteFile(userIdOf(req), req.params.id))));

knowledgeAdminRouter.post('/files/:id/index', ingestLimiter, wrap(async (req, res) => ok(res, await knowledgeService.reindexFile(userIdOf(req), req.params.id), 202)));

knowledgeAdminRouter.post('/files/:id/extract', ingestLimiter, wrap(async (req, res) => {
  const body = z.object({ targetDirectoryId: z.string().nullable().optional(), onConflict: z.enum(['rename', 'replace', 'skip']).optional() }).strict().parse(req.body ?? {});
  ok(res, await knowledgeService.extractArchive(userIdOf(req), req.params.id, body), 201);
}));

knowledgeAdminRouter.get('/jobs/:jobId', wrap(async (req, res) => ok(res, await knowledgeService.jobStatus(userIdOf(req), req.params.jobId))));

/** Mounted at /api/knowledge behind requireAuth: opens a cited source for users allowed to retrieve it. */
export const knowledgeSourcesRouter = Router();
knowledgeSourcesRouter.get('/sources/:fileId', wrap(async (req, res) => {
  const out = await knowledgeService.openSource(userIdOf(req), req.params.fileId);
  await sendStoredFile(req, res, async () => out, async () => out.file.sizeBytes, false);
}));
