import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import JSZip from 'jszip';
import { PDFParse } from 'pdf-parse';
import sharp from 'sharp';
import mammoth from 'mammoth';
import { prisma } from '../../db.js';
import type { FileStore } from '../ai/files/FileStore.js';
import { FileStoreError } from '../ai/files/FileStore.js';
import { FileJobQueue, JobError, type FileJob, type JobContext } from '../ai/jobs/fileJobQueue.js';
import { splitDocumentIntoChunks } from '../ExtractionQualityService.js';
import { rankHybridKnowledgeChunks } from '../KnowledgeRetrievalService.js';
import {
  ExtractionError, decodeText, extractForIndex, htmlToText, pptxSlides, readCsv, readXlsx, rtfToText, safePreviewHtml, type Extracted, type Ocr,
} from './extract.js';
import { PathError, baseName, extensionOf, joinPath, nextFreeName, normalizeRelativePath, parentPath, validateFileType, validateName } from './paths.js';

/**
 * Knowledge repositories: a persistent folder/file explorer whose files feed the existing knowledge base.
 *
 * - Metadata (repositories, folders with parent links, files) lives in Prisma tables.
 * - File bytes live in the FileStore under opaque ids; identical bytes are shared (reference-counted).
 * - Indexing runs as background jobs and writes Document + DocumentChunk rows in the linked
 *   KnowledgeBase, so the existing hybrid retrieval, access rules and chat citations apply unchanged.
 */

export class KnowledgeError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) {
    super(message);
  }
}

export interface Embedder { isAvailable(): boolean; getEmbeddings(texts: string[], task?: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'): Promise<number[][]> }

export interface KnowledgeDeps {
  fileStore: FileStore;
  queue: FileJobQueue;
  embedder: Embedder;
  ocr?: Ocr;
  tmpDir?: string;
  maxFileBytes?: number;
  defaultQuotaBytes?: number;
  indexConcurrency?: number;
  segmentBudgetMs?: number;
}

export type ConflictPolicy = 'rename' | 'replace' | 'skip';
export interface UploadItem { tempPath: string; name: string; relativePath?: string; size: number }
export interface UploadResult { path: string; status: 'created' | 'replaced' | 'renamed' | 'unchanged' | 'skipped' | 'rejected'; fileId?: string; reason?: string }

export const INDEX_STATES = ['uploaded', 'queued', 'extracting', 'chunking', 'embedding', 'indexing', 'indexed', 'pending_embeddings', 'partial_failure', 'failed', 'unsupported', 'excluded', 'duplicate'] as const;
const ACTIVE = new Set(['queued', 'extracting', 'chunking', 'embedding', 'indexing']);
const STORE_TTL = 100 * 365 * 24 * 60 * 60 * 1000; // repository files do not expire
const db = prisma as any;
const now = () => new Date();
const env = (k: string, d: number) => (Number(process.env[k]) > 0 ? Number(process.env[k]) : d);

interface Settings { language: string; domain: string; ocr: boolean; autoIndex: boolean }
const settingsOf = (repo: any): Settings => ({ language: 'en', domain: 'general', ocr: true, autoIndex: true, ...(repo.settings && typeof repo.settings === 'object' ? repo.settings : {}) });

interface IndexJobPayload { repositoryId: string; fileIds: string[]; force?: boolean; segment?: number }

export function createKnowledgeService(deps: KnowledgeDeps) {
  const tmpRoot = deps.tmpDir ?? path.join(os.tmpdir(), 'bwenge-knowledge');
  const maxFileBytes = deps.maxFileBytes ?? env('KNOWLEDGE_MAX_FILE_BYTES', 100 * 1024 * 1024);
  const defaultQuota = deps.defaultQuotaBytes ?? env('KNOWLEDGE_REPO_QUOTA_BYTES', 5 * 1024 * 1024 * 1024);
  const concurrency = Math.max(1, deps.indexConcurrency ?? env('KNOWLEDGE_INDEX_CONCURRENCY', 2));
  const budget = deps.segmentBudgetMs ?? env('KNOWLEDGE_SEGMENT_BUDGET_MS', 8 * 60 * 1000);

  // ── Access ──────────────────────────────────────────────────────────────
  async function orgIdsOf(userId: string): Promise<string[]> {
    const rows = await db.organizationMember.findMany({ where: { userId }, select: { organizationId: true } });
    return rows.map((r: any) => r.organizationId);
  }
  const canAccess = (repo: any, userId: string, orgs: string[]) => repo.userId === userId || (!!repo.organizationId && orgs.includes(repo.organizationId));

  /** Loads a repository the user may manage (owner or member of its organisation); 404 otherwise. */
  async function repoFor(userId: string, id: string) {
    const repo = typeof id === 'string' ? await db.knowledgeRepository.findUnique({ where: { id } }) : null;
    if (!repo || !canAccess(repo, userId, await orgIdsOf(userId))) throw new KnowledgeError('NOT_FOUND', 'Repository not found.', 404);
    return repo;
  }
  async function fileFor(userId: string, id: string) {
    const file = typeof id === 'string' ? await db.repositoryFile.findUnique({ where: { id } }) : null;
    if (!file) throw new KnowledgeError('NOT_FOUND', 'File not found.', 404);
    const repo = await repoFor(userId, file.repositoryId).catch(() => { throw new KnowledgeError('NOT_FOUND', 'File not found.', 404); });
    return { file, repo };
  }
  async function dirFor(userId: string, id: string) {
    const dir = typeof id === 'string' ? await db.repositoryDirectory.findUnique({ where: { id } }) : null;
    if (!dir) throw new KnowledgeError('NOT_FOUND', 'Folder not found.', 404);
    const repo = await repoFor(userId, dir.repositoryId).catch(() => { throw new KnowledgeError('NOT_FOUND', 'Folder not found.', 404); });
    return { dir, repo };
  }
  async function dirInRepo(repo: any, id: string | null | undefined) {
    if (!id) return null;
    const dir = await db.repositoryDirectory.findUnique({ where: { id } });
    if (!dir || dir.repositoryId !== repo.id) throw new KnowledgeError('NOT_FOUND', 'Folder not found in this repository.', 404);
    return dir;
  }

  // ── Repositories ────────────────────────────────────────────────────────
  async function createRepository(userId: string, input: { name: string; description?: string; organizationId?: string | null; knowledgeBaseId?: string | null; settings?: Partial<Settings>; quotaBytes?: number | null }) {
    const name = validateName(input.name);
    const orgs = await orgIdsOf(userId);
    if (input.organizationId && !orgs.includes(input.organizationId)) throw new KnowledgeError('FORBIDDEN_ORGANIZATION', 'You are not a member of that organisation.', 403);
    let kbId = input.knowledgeBaseId ?? null;
    if (kbId) {
      const kb = await db.knowledgeBase.findUnique({ where: { id: kbId } });
      if (!kb || !(kb.userId === userId || (kb.organizationId && orgs.includes(kb.organizationId)))) throw new KnowledgeError('NOT_FOUND', 'Knowledge base not found.', 404);
    } else {
      const kb = await db.knowledgeBase.create({ data: { id: randomUUID(), name, description: `Files from the "${name}" knowledge repository.`, state: 'active', userId, organizationId: input.organizationId ?? null, globalApproved: false } });
      kbId = kb.id;
    }
    return db.knowledgeRepository.create({
      data: { id: randomUUID(), name, description: input.description?.slice(0, 2000) ?? null, userId, organizationId: input.organizationId ?? null, knowledgeBaseId: kbId, settings: { ...settingsOf({}), ...(input.settings ?? {}) }, quotaBytes: input.quotaBytes ?? null },
    });
  }

  async function listRepositories(userId: string) {
    const orgs = await orgIdsOf(userId);
    const repos = await db.knowledgeRepository.findMany({ where: { OR: [{ userId }, ...(orgs.length ? [{ organizationId: { in: orgs } }] : [])] }, orderBy: { createdAt: 'desc' } });
    return Promise.all(repos.filter((r: any) => canAccess(r, userId, orgs)).map(async (r: any) => ({ ...r, statistics: await statistics(r) })));
  }

  async function updateRepository(userId: string, id: string, patch: { name?: string; description?: string | null; settings?: Partial<Settings>; knowledgeBaseId?: string; quotaBytes?: number | null }) {
    const repo = await repoFor(userId, id);
    const data: any = {};
    if (patch.name !== undefined) data.name = validateName(patch.name);
    if (patch.description !== undefined) data.description = patch.description?.slice(0, 2000) ?? null;
    if (patch.settings) data.settings = { ...settingsOf(repo), ...patch.settings };
    if (patch.quotaBytes !== undefined) data.quotaBytes = patch.quotaBytes;
    let requeue = false;
    if (patch.knowledgeBaseId && patch.knowledgeBaseId !== repo.knowledgeBaseId) {
      const orgs = await orgIdsOf(userId);
      const kb = await db.knowledgeBase.findUnique({ where: { id: patch.knowledgeBaseId } });
      if (!kb || !(kb.userId === userId || (kb.organizationId && orgs.includes(kb.organizationId)))) throw new KnowledgeError('NOT_FOUND', 'Knowledge base not found.', 404);
      data.knowledgeBaseId = kb.id;
      requeue = true;
    }
    const updated = await db.knowledgeRepository.update({ where: { id }, data });
    const jobId = requeue ? await queueIndex(updated, (await db.repositoryFile.findMany({ where: { repositoryId: id }, select: { id: true } })).map((f: any) => f.id), true) : null;
    return { repository: updated, indexJobId: jobId };
  }

  async function deleteRepository(userId: string, id: string) {
    const repo = await repoFor(userId, id);
    const files = await db.repositoryFile.findMany({ where: { repositoryId: id } });
    for (const f of files) await removeFile(f);
    await db.repositoryDirectory.deleteMany({ where: { repositoryId: id } });
    await db.knowledgeRepository.delete({ where: { id: repo.id } });
    return { deletedFiles: files.length };
  }

  // ── Folders ─────────────────────────────────────────────────────────────
  async function createDirectory(userId: string, repoId: string, parentId: string | null, name: string) {
    const repo = await repoFor(userId, repoId);
    const parent = await dirInRepo(repo, parentId);
    const n = validateName(name);
    const p = joinPath(parent?.path, n);
    if (await db.repositoryDirectory.findFirst({ where: { repositoryId: repo.id, path: p } })) throw new KnowledgeError('CONFLICT', `A folder named "${n}" already exists here.`, 409);
    if (await db.repositoryFile.findFirst({ where: { repositoryId: repo.id, path: p } })) throw new KnowledgeError('CONFLICT', `A file named "${n}" already exists here.`, 409);
    return db.repositoryDirectory.create({ data: { id: randomUUID(), repositoryId: repo.id, parentId: parent?.id ?? null, name: n, path: p, knowledgeBaseId: null, aiEnabled: true, createdById: userId } });
  }

  /** Creates any missing folders along a path and returns the deepest one. */
  async function ensureDirectoryPath(repo: any, base: any | null, segments: string[], userId: string) {
    let parent = base;
    for (const seg of segments) {
      const p = joinPath(parent?.path, seg);
      let d = await db.repositoryDirectory.findFirst({ where: { repositoryId: repo.id, path: p } });
      if (!d) {
        if (await db.repositoryFile.findFirst({ where: { repositoryId: repo.id, path: p } })) throw new PathError(`"${p}" is a file, so it cannot also be a folder.`);
        d = await db.repositoryDirectory.create({ data: { id: randomUUID(), repositoryId: repo.id, parentId: parent?.id ?? null, name: seg, path: p, knowledgeBaseId: null, aiEnabled: true, createdById: userId } });
      }
      parent = d;
    }
    return parent;
  }

  async function updateDirectory(userId: string, id: string, patch: { name?: string; parentId?: string | null; knowledgeBaseId?: string | null; aiEnabled?: boolean }) {
    const { dir, repo } = await dirFor(userId, id);
    const data: any = {};
    let newParent = dir.parentId ? await dirInRepo(repo, dir.parentId) : null;
    if (patch.parentId !== undefined) {
      newParent = await dirInRepo(repo, patch.parentId);
      if (newParent && (newParent.id === dir.id || newParent.path.startsWith(`${dir.path}/`))) throw new KnowledgeError('INVALID_MOVE', 'A folder cannot be moved into itself.', 400);
      data.parentId = newParent?.id ?? null;
    }
    const name = patch.name !== undefined ? validateName(patch.name) : dir.name;
    const newPath = joinPath(newParent?.path, name);
    if (newPath !== dir.path) {
      if (await db.repositoryDirectory.findFirst({ where: { repositoryId: repo.id, path: newPath } }) || await db.repositoryFile.findFirst({ where: { repositoryId: repo.id, path: newPath } })) {
        throw new KnowledgeError('CONFLICT', `"${newPath}" already exists.`, 409);
      }
      data.name = name;
      data.path = newPath;
      // Re-base every descendant folder and file path.
      const rebase = (p: string) => newPath + p.slice(dir.path.length);
      for (const d of await db.repositoryDirectory.findMany({ where: { repositoryId: repo.id, path: { startsWith: `${dir.path}/` } } })) await db.repositoryDirectory.update({ where: { id: d.id }, data: { path: rebase(d.path) } });
      for (const f of await db.repositoryFile.findMany({ where: { repositoryId: repo.id, path: { startsWith: `${dir.path}/` } } })) {
        await db.repositoryFile.update({ where: { id: f.id }, data: { path: rebase(f.path) } });
        if (f.documentId) await db.document.update({ where: { id: f.documentId }, data: { name: rebase(f.path) } }).catch(() => {});
      }
    }
    let requeue = false;
    if (patch.knowledgeBaseId !== undefined) {
      if (patch.knowledgeBaseId) await kbAccessible(userId, patch.knowledgeBaseId);
      data.knowledgeBaseId = patch.knowledgeBaseId;
      requeue = true;
    }
    if (patch.aiEnabled !== undefined) { data.aiEnabled = patch.aiEnabled; requeue = true; }
    const updated = await db.repositoryDirectory.update({ where: { id }, data });
    let jobId: string | null = null;
    if (requeue) {
      const files = await db.repositoryFile.findMany({ where: { repositoryId: repo.id, path: { startsWith: `${updated.path}/` } }, select: { id: true } });
      jobId = await queueIndex(repo, files.map((f: any) => f.id), true);
    }
    return { directory: updated, indexJobId: jobId };
  }

  async function deleteDirectory(userId: string, id: string, recursive: boolean) {
    const { dir, repo } = await dirFor(userId, id);
    const files = await db.repositoryFile.findMany({ where: { repositoryId: repo.id, path: { startsWith: `${dir.path}/` } } });
    const subdirs = await db.repositoryDirectory.findMany({ where: { repositoryId: repo.id, path: { startsWith: `${dir.path}/` } } });
    if ((files.length || subdirs.length) && !recursive) throw new KnowledgeError('NOT_EMPTY', `"${dir.path}" contains ${files.length} file(s) and ${subdirs.length} folder(s). Delete with recursive=true to remove everything inside.`, 409, { files: files.length, folders: subdirs.length });
    for (const f of files) await removeFile(f);
    for (const d of subdirs.sort((a: any, b: any) => b.path.length - a.path.length)) await db.repositoryDirectory.delete({ where: { id: d.id } });
    await db.repositoryDirectory.delete({ where: { id: dir.id } });
    return { deletedFiles: files.length, deletedFolders: subdirs.length + 1 };
  }

  async function kbAccessible(userId: string, kbId: string) {
    const orgs = await orgIdsOf(userId);
    const kb = await db.knowledgeBase.findUnique({ where: { id: kbId } });
    if (!kb || !(kb.userId === userId || (kb.organizationId && orgs.includes(kb.organizationId)))) throw new KnowledgeError('NOT_FOUND', 'Knowledge base not found.', 404);
    return kb;
  }

  // ── Browsing ────────────────────────────────────────────────────────────
  async function tree(userId: string, repoId: string) {
    const repo = await repoFor(userId, repoId);
    const dirs = await db.repositoryDirectory.findMany({ where: { repositoryId: repo.id }, orderBy: { path: 'asc' } });
    const files = await db.repositoryFile.findMany({ where: { repositoryId: repo.id }, select: { directoryId: true, sizeBytes: true } });
    const counts = new Map<string | null, { files: number; bytes: number }>();
    for (const f of files) { const c = counts.get(f.directoryId ?? null) ?? { files: 0, bytes: 0 }; c.files++; c.bytes += f.sizeBytes; counts.set(f.directoryId ?? null, c); }
    return {
      repository: { id: repo.id, name: repo.name },
      root: { files: counts.get(null)?.files ?? 0, bytes: counts.get(null)?.bytes ?? 0 },
      directories: dirs.map((d: any) => ({ id: d.id, parentId: d.parentId, name: d.name, path: d.path, files: counts.get(d.id)?.files ?? 0, bytes: counts.get(d.id)?.bytes ?? 0, aiEnabled: d.aiEnabled, knowledgeBaseId: d.knowledgeBaseId })),
    };
  }

  const SORT: Record<string, string> = { name: 'name', type: 'extension', size: 'sizeBytes', modified: 'updatedAt', status: 'indexStatus' };

  async function contents(userId: string, repoId: string, directoryId: string | null, q: { sort?: string; order?: 'asc' | 'desc'; limit?: number; offset?: number; extension?: string; status?: string } = {}) {
    const repo = await repoFor(userId, repoId);
    const dir = await dirInRepo(repo, directoryId);
    const where: any = { repositoryId: repo.id, directoryId: dir?.id ?? null };
    if (q.extension) where.extension = q.extension.toLowerCase().replace(/^\./, '');
    if (q.status) where.indexStatus = q.status;
    const limit = Math.min(Math.max(1, q.limit ?? 100), 500);
    const offset = Math.max(0, q.offset ?? 0);
    const orderBy = [{ [SORT[q.sort ?? 'name'] ?? 'name']: q.order === 'desc' ? 'desc' : 'asc' }, { id: 'asc' }];
    const [files, total, folders] = await Promise.all([
      db.repositoryFile.findMany({ where, orderBy, skip: offset, take: limit }),
      db.repositoryFile.count({ where }),
      db.repositoryDirectory.findMany({ where: { repositoryId: repo.id, parentId: dir?.id ?? null }, orderBy: { name: q.sort === 'name' && q.order === 'desc' ? 'desc' : 'asc' } }),
    ]);
    const breadcrumbs = [{ id: null, name: repo.name, path: '' }];
    if (dir) {
      const segs = dir.path.split('/');
      for (let i = 1; i <= segs.length; i++) {
        const p = segs.slice(0, i).join('/');
        const d = i === segs.length ? dir : await db.repositoryDirectory.findFirst({ where: { repositoryId: repo.id, path: p } });
        breadcrumbs.push({ id: d?.id ?? null, name: segs[i - 1], path: p });
      }
    }
    return { directory: dir ? publicDir(dir) : null, breadcrumbs, folders: folders.map(publicDir), files: files.map(publicFile), total, offset, limit, hasMore: offset + files.length < total };
  }

  const publicDir = (d: any) => ({ id: d.id, name: d.name, path: d.path, parentId: d.parentId, aiEnabled: d.aiEnabled, knowledgeBaseId: d.knowledgeBaseId, createdAt: d.createdAt, updatedAt: d.updatedAt });
  const publicFile = (f: any) => ({
    id: f.id, repositoryId: f.repositoryId, directoryId: f.directoryId, name: f.name, path: f.path, extension: f.extension, mimeType: f.mimeType, sizeBytes: f.sizeBytes,
    contentHash: f.contentHash, version: f.version, uploadedById: f.uploadedById, createdAt: f.createdAt, updatedAt: f.updatedAt, aiEnabled: f.aiEnabled, knowledgeBaseId: f.knowledgeBaseId,
    extraction: { status: f.extractionStatus, method: f.extractionMethod },
    indexing: { status: f.indexStatus, error: f.indexError, indexedAt: f.indexedAt, indexedHash: f.indexedHash, indexedVersion: f.indexedVersion, chunks: f.chunkCount, duplicateOf: f.duplicateOfId, jobId: f.indexJobId, searchable: ['indexed', 'pending_embeddings', 'partial_failure', 'duplicate'].includes(f.indexStatus) },
  });

  async function statistics(repoOrUserId: any, maybeRepoId?: string) {
    const repo = typeof repoOrUserId === 'string' ? await repoFor(repoOrUserId, maybeRepoId!) : repoOrUserId;
    const where = { repositoryId: repo.id };
    const [files, folders, sum] = await Promise.all([db.repositoryFile.count({ where }), db.repositoryDirectory.count({ where }), db.repositoryFile.aggregate({ where, _sum: { sizeBytes: true } })]);
    const byStatus: Record<string, number> = {};
    for (const s of INDEX_STATES) { const n = await db.repositoryFile.count({ where: { ...where, indexStatus: s } }); if (n) byStatus[s] = n; }
    const totalBytes = Number(sum?._sum?.sizeBytes ?? 0);
    return {
      files, folders, totalBytes, quotaBytes: repo.quotaBytes ?? defaultQuota, byStatus,
      awaitingIndexing: (byStatus.uploaded ?? 0) + (byStatus.queued ?? 0), indexing: ['extracting', 'chunking', 'embedding', 'indexing'].reduce((a, s) => a + (byStatus[s] ?? 0), 0),
      indexed: byStatus.indexed ?? 0, failed: (byStatus.failed ?? 0) + (byStatus.partial_failure ?? 0), embeddingsAvailable: deps.embedder.isAvailable(),
    };
  }

  // ── Uploads ─────────────────────────────────────────────────────────────
  async function readHead(p: string) {
    const fh = await open(p, 'r');
    try { const b = Buffer.alloc(8192); const { bytesRead } = await fh.read(b, 0, 8192, 0); return b.subarray(0, bytesRead); } finally { await fh.close(); }
  }

  /**
   * Stores uploaded files (already streamed to temp files) under the target folder, creating sub-folders
   * from their relative paths. Conflict policy for an existing path: rename (default) | replace | skip;
   * identical content at the same path is reported as unchanged and not re-indexed.
   */
  async function ingest(userId: string, repoId: string, input: { directoryId?: string | null; items: UploadItem[]; onConflict?: ConflictPolicy; emptyFolders?: string[] }) {
    const repo = await repoFor(userId, repoId);
    const base = await dirInRepo(repo, input.directoryId);
    const policy = input.onConflict ?? 'rename';
    const quota = repo.quotaBytes ?? defaultQuota;
    let used = Number((await db.repositoryFile.aggregate({ where: { repositoryId: repo.id }, _sum: { sizeBytes: true } }))?._sum?.sizeBytes ?? 0);
    const results: UploadResult[] = [];
    const toIndex: string[] = [];
    for (const folder of input.emptyFolders ?? []) {
      try { await ensureDirectoryPath(repo, base, normalizeRelativePath(folder), userId); } catch (e) { results.push({ path: folder, status: 'rejected', reason: (e as Error).message }); }
    }
    for (const item of input.items) {
      const rel = item.relativePath || item.name;
      try {
        const segs = normalizeRelativePath(rel);
        if (item.size > maxFileBytes) throw new PathError(`"${rel}" is larger than the ${Math.round(maxFileBytes / 1048576)} MB limit.`);
        if (used + item.size > quota) throw new KnowledgeError('QUOTA_EXCEEDED', `Storage quota reached (${Math.round(quota / 1048576)} MB).`, 413);
        const mime = validateFileType(segs[segs.length - 1], await readHead(item.tempPath));
        const dir = await ensureDirectoryPath(repo, base, segs.slice(0, -1), userId);
        let name = segs[segs.length - 1];
        let p = joinPath(dir?.path, name);
        if (await db.repositoryDirectory.findFirst({ where: { repositoryId: repo.id, path: p } })) throw new PathError(`"${p}" is a folder.`);
        const existing = await db.repositoryFile.findFirst({ where: { repositoryId: repo.id, path: p } });
        const hash = await hashFile(item.tempPath);
        if (existing && existing.contentHash === hash) { results.push({ path: p, status: 'unchanged', fileId: existing.id }); continue; }
        if (existing && policy === 'skip') { results.push({ path: p, status: 'skipped', fileId: existing.id, reason: 'A file with this name already exists.' }); continue; }
        let status: UploadResult['status'] = 'created';
        if (existing && policy === 'rename') {
          const siblings = new Set((await db.repositoryFile.findMany({ where: { repositoryId: repo.id, directoryId: dir?.id ?? null }, select: { name: true } })).map((f: any) => f.name.toLowerCase()));
          name = nextFreeName(name, (c) => siblings.has(c.toLowerCase()));
          p = joinPath(dir?.path, name);
          status = 'renamed';
        }
        const blob = await storeBlob(repo, item.tempPath, name, mime, hash);
        if (existing && policy === 'replace') {
          const oldKey = existing.storageKey;
          await db.repositoryFile.update({ where: { id: existing.id }, data: { storageKey: blob.id, storageOwnerId: blob.userId, contentHash: hash, sizeBytes: item.size, mimeType: mime, version: existing.version + 1, uploadedById: userId, extractionStatus: 'pending', indexStatus: 'uploaded', indexError: null, duplicateOfId: null } });
          await releaseBlob(oldKey, existing.storageOwnerId);
          used += item.size - existing.sizeBytes;
          results.push({ path: p, status: 'replaced', fileId: existing.id });
          toIndex.push(existing.id);
          continue;
        }
        const created = await db.repositoryFile.create({
          data: {
            id: randomUUID(), repositoryId: repo.id, directoryId: dir?.id ?? null, name, path: p, extension: extensionOf(name), mimeType: mime, sizeBytes: item.size, contentHash: hash,
            storageKey: blob.id, storageOwnerId: blob.userId, version: 1, uploadedById: userId, knowledgeBaseId: null, aiEnabled: true, extractionStatus: 'pending', extractionMethod: null,
            indexStatus: 'uploaded', indexError: null, indexedAt: null, indexedHash: null, indexedVersion: null, chunkCount: 0, duplicateOfId: null, documentId: null, indexJobId: null,
          },
        });
        used += item.size;
        results.push({ path: p, status, fileId: created.id });
        toIndex.push(created.id);
      } catch (e) {
        if (e instanceof PathError || e instanceof KnowledgeError) results.push({ path: rel, status: 'rejected', reason: e.message });
        else throw e;
      }
    }
    const jobId = toIndex.length && settingsOf(repo).autoIndex ? await queueIndex(repo, toIndex, false) : null;
    return { results, indexJobId: jobId, summary: Object.fromEntries(['created', 'replaced', 'renamed', 'unchanged', 'skipped', 'rejected'].map((k) => [k, results.filter((r) => r.status === k).length])) };
  }

  async function hashFile(p: string) {
    const { createReadStream } = await import('node:fs');
    const h = createHash('sha256');
    for await (const chunk of createReadStream(p)) h.update(chunk as Buffer);
    return h.digest('hex');
  }

  /** Content-addressed reuse: identical bytes in the same repository share one stored object. */
  async function storeBlob(repo: any, tempPath: string, name: string, mime: string, hash: string): Promise<{ id: string; userId: string }> {
    const same = await db.repositoryFile.findFirst({ where: { repositoryId: repo.id, contentHash: hash } });
    if (same) {
      const ok = await deps.fileStore.meta(same.storageKey).then(() => true, () => false);
      if (ok) return { id: same.storageKey, userId: same.storageOwnerId };
    }
    const meta = await deps.fileStore.putFile({ userId: repo.userId, name, mime, kind: 'document', sourcePath: tempPath, ttlMs: STORE_TTL, maxBytes: maxFileBytes });
    return { id: meta.id, userId: meta.userId };
  }

  async function releaseBlob(storageKey: string, ownerId: string) {
    const refs = await db.repositoryFile.count({ where: { storageKey } });
    if (!refs) await deps.fileStore.delete(storageKey, ownerId).catch(() => {});
  }

  // ── File operations ─────────────────────────────────────────────────────
  async function getFile(userId: string, id: string) {
    const { file, repo } = await fileFor(userId, id);
    return { ...publicFile(file), repository: { id: repo.id, name: repo.name } };
  }

  async function updateFile(userId: string, id: string, patch: { name?: string; directoryId?: string | null; knowledgeBaseId?: string | null; aiEnabled?: boolean }) {
    const { file, repo } = await fileFor(userId, id);
    const data: any = {};
    const dir = patch.directoryId !== undefined ? await dirInRepo(repo, patch.directoryId) : file.directoryId ? await dirInRepo(repo, file.directoryId) : null;
    const name = patch.name !== undefined ? validateName(patch.name) : file.name;
    const p = joinPath(dir?.path, name);
    if (p !== file.path) {
      if (await db.repositoryFile.findFirst({ where: { repositoryId: repo.id, path: p } }) || await db.repositoryDirectory.findFirst({ where: { repositoryId: repo.id, path: p } })) throw new KnowledgeError('CONFLICT', `"${p}" already exists.`, 409);
      Object.assign(data, { name, path: p, directoryId: dir?.id ?? null, extension: extensionOf(name) });
      if (file.documentId) {
        await db.document.update({ where: { id: file.documentId }, data: { name: p } }).catch(() => {});
        await db.documentChunk.updateMany({ where: { documentId: file.documentId }, data: { sourceFilename: name } });
      }
    }
    let requeue = false;
    if (patch.knowledgeBaseId !== undefined) { if (patch.knowledgeBaseId) await kbAccessible(userId, patch.knowledgeBaseId); data.knowledgeBaseId = patch.knowledgeBaseId; requeue = true; }
    if (patch.aiEnabled !== undefined) { data.aiEnabled = patch.aiEnabled; requeue = true; }
    const updated = await db.repositoryFile.update({ where: { id }, data });
    const jobId = requeue ? await queueIndex(repo, [id], true) : null;
    return { file: publicFile(updated), indexJobId: jobId };
  }

  async function copyFile(userId: string, id: string, targetDirectoryId: string | null, newName?: string) {
    const { file, repo } = await fileFor(userId, id);
    const dir = await dirInRepo(repo, targetDirectoryId);
    let name = newName ? validateName(newName) : file.name;
    const siblings = new Set((await db.repositoryFile.findMany({ where: { repositoryId: repo.id, directoryId: dir?.id ?? null }, select: { name: true } })).map((f: any) => f.name.toLowerCase()));
    if (siblings.has(name.toLowerCase())) name = nextFreeName(name, (c) => siblings.has(c.toLowerCase()));
    const created = await db.repositoryFile.create({
      data: {
        ...Object.fromEntries(Object.entries(file).filter(([k]) => !['id', 'createdAt', 'updatedAt'].includes(k))),
        id: randomUUID(), directoryId: dir?.id ?? null, name, path: joinPath(dir?.path, name), version: 1, documentId: null, indexStatus: 'uploaded', indexedAt: null, indexedHash: null, indexedVersion: null, chunkCount: 0, duplicateOfId: null, indexJobId: null, uploadedById: userId,
      },
    });
    const jobId = await queueIndex(repo, [created.id], false);
    return { file: publicFile(created), indexJobId: jobId };
  }

  /** Removes a file, its indexed content and (when no other file shares them) its stored bytes. */
  async function removeFile(file: any) {
    if (file.documentId) await removeDocument(file.documentId);
    await db.repositoryFile.delete({ where: { id: file.id } });
    await releaseBlob(file.storageKey, file.storageOwnerId);
    // Copies that pointed at this file for their index must be indexed themselves now.
    const dups = await db.repositoryFile.findMany({ where: { duplicateOfId: file.id } });
    if (dups.length) {
      for (const d of dups) await db.repositoryFile.update({ where: { id: d.id }, data: { duplicateOfId: null, indexStatus: 'queued' } });
      const repo = await db.knowledgeRepository.findUnique({ where: { id: dups[0].repositoryId } });
      if (repo) await queueIndex(repo, dups.map((d: any) => d.id), true);
    }
  }

  async function removeDocument(documentId: string) {
    const sheets = await db.spreadsheetSheet.findMany({ where: { documentId }, select: { id: true } });
    if (sheets.length) {
      const ids = sheets.map((s: any) => s.id);
      await db.spreadsheetRow.deleteMany({ where: { sheetId: { in: ids } } });
      await db.spreadsheetColumn.deleteMany({ where: { sheetId: { in: ids } } });
      await db.spreadsheetSheet.deleteMany({ where: { documentId } });
    }
    await db.documentChunk.deleteMany({ where: { documentId } });
    await db.processingJob.deleteMany({ where: { documentId } });
    await db.document.deleteMany({ where: { id: documentId } });
  }

  async function deleteFile(userId: string, id: string) {
    const { file } = await fileFor(userId, id);
    await removeFile(file);
    return { deleted: id };
  }

  async function bulk(userId: string, repoId: string, input: { action: 'move' | 'copy' | 'delete' | 'reindex'; fileIds: string[]; targetDirectoryId?: string | null }) {
    const repo = await repoFor(userId, repoId);
    const results: Array<{ fileId: string; ok: boolean; error?: string }> = [];
    const reindex: string[] = [];
    for (const fid of [...new Set(input.fileIds)].slice(0, 1000)) {
      try {
        const { file } = await fileFor(userId, fid);
        if (file.repositoryId !== repo.id) throw new KnowledgeError('NOT_FOUND', 'File not found in this repository.', 404);
        if (input.action === 'move') await updateFile(userId, fid, { directoryId: input.targetDirectoryId ?? null });
        else if (input.action === 'copy') await copyFile(userId, fid, input.targetDirectoryId ?? null);
        else if (input.action === 'delete') await removeFile(file);
        else reindex.push(fid);
        results.push({ fileId: fid, ok: true });
      } catch (e) {
        results.push({ fileId: fid, ok: false, error: e instanceof KnowledgeError || e instanceof PathError ? e.message : 'Operation failed.' });
      }
    }
    const jobId = reindex.length ? await queueIndex(repo, reindex, true) : null;
    return { results, indexJobId: jobId };
  }

  async function openDownload(userId: string, id: string, range?: { start: number; end: number }) {
    const { file } = await fileFor(userId, id);
    const { stream } = await deps.fileStore.openStream(file.storageKey, file.storageOwnerId, range);
    return { file, stream };
  }

  // ── Previews ────────────────────────────────────────────────────────────
  async function withTemp<T>(file: any, fn: (p: string) => Promise<T>): Promise<T> {
    await mkdir(tmpRoot, { recursive: true, mode: 0o700 });
    const p = path.join(tmpRoot, `${randomUUID()}.${file.extension || 'bin'}`);
    try {
      await deps.fileStore.copyTo(file.storageKey, file.storageOwnerId, p);
      return await fn(p);
    } finally {
      await rm(p, { force: true });
    }
  }

  /**
   * Bounded, read-only preview. Text is paged by byte offset; PDFs by page; spreadsheets by sheet and row
   * window; HTML is sanitised and returned as data, never rendered or executed by the server.
   */
  async function preview(userId: string, id: string, q: { page?: number; sheet?: string; offset?: number; limit?: number } = {}) {
    const { file } = await fileFor(userId, id);
    const ext = file.extension;
    const base = { file: publicFile(file) };
    const limit = Math.min(Math.max(1, q.limit ?? 64 * 1024), 512 * 1024);
    const maxParse = env('KNOWLEDGE_PREVIEW_MAX_BYTES', 50 * 1024 * 1024);
    try {
      if (['txt', 'md', 'markdown', 'log', 'yaml', 'yml', 'xml', 'json', 'rtf'].includes(ext)) {
        const offset = Math.max(0, q.offset ?? 0);
        const { data } = await deps.fileStore.readRange(file.storageKey, file.storageOwnerId, offset, limit);
        let text = decodeText(data);
        let formatted: unknown = undefined;
        if (ext === 'json' && offset === 0 && file.sizeBytes <= limit) { try { formatted = JSON.parse(text); text = JSON.stringify(formatted, null, 2); } catch { /* shown as text */ } }
        if (ext === 'rtf' && file.sizeBytes <= limit) text = rtfToText(text);
        return { ...base, kind: ext === 'json' ? 'json' : ext === 'md' || ext === 'markdown' ? 'markdown' : 'text', text, json: formatted, offset, nextOffset: offset + data.length < file.sizeBytes ? offset + data.length : null, totalBytes: file.sizeBytes };
      }
      if (file.sizeBytes > maxParse) return { ...base, kind: 'unavailable', reason: 'The file is too large to preview; download it instead.' };
      if (ext === 'csv' || ext === 'tsv') {
        const { data } = await deps.fileStore.readRange(file.storageKey, file.storageOwnerId, 0, Math.min(file.sizeBytes, 4 * 1024 * 1024));
        const text = decodeText(data);
        const sheet = readCsv(file.sizeBytes > data.length ? text.slice(0, text.lastIndexOf('\n')) : text, ext === 'tsv' ? '\t' : ',', 10_000);
        return { ...base, kind: 'table', sheets: [{ name: sheet.name }], ...rowWindow(sheet, q) };
      }
      if (ext === 'xlsx') return await withTemp(file, async (p) => {
        const { readFile } = await import('node:fs/promises');
        const sheets = await readXlsx(await readFile(p), 10_000);
        const sheet = sheets.find((s) => s.name === q.sheet) ?? sheets[0];
        return { ...base, kind: 'table', sheets: sheets.map((s) => ({ name: s.name, rows: s.totalRows })), ...(sheet ? rowWindow(sheet, q) : { columns: [], rows: [] }) };
      });
      if (ext === 'pdf') return await withTemp(file, async (p) => {
        const { readFile } = await import('node:fs/promises');
        const parser = new PDFParse({ data: new Uint8Array(await readFile(p)) });
        try {
          const page = Math.max(1, q.page ?? 1);
          const res = await parser.getText({ partial: [page] });
          return { ...base, kind: 'pdf', page, pages: res.total, text: res.pages[0]?.text ?? '', pageImage: `/api/admin/knowledge/files/${file.id}/preview?render=image&page=${page}`, hasTextLayer: (res.pages[0]?.text ?? '').trim().length > 25 };
        } catch (e) {
          if (/password|encrypt/i.test(String((e as Error)?.message))) return { ...base, kind: 'unavailable', reason: 'The PDF is password-protected.' };
          return { ...base, kind: 'unavailable', reason: 'The PDF could not be read.' };
        } finally { await parser.destroy().catch(() => {}); }
      });
      if (ext === 'docx') return await withTemp(file, async (p) => {
        const { readFile } = await import('node:fs/promises');
        const html = (await mammoth.convertToHtml({ buffer: await readFile(p) })).value;
        return { ...base, kind: 'document', html: safePreviewHtml(html), text: htmlToText(html).slice(0, 200_000) };
      });
      if (ext === 'pptx') return await withTemp(file, async (p) => {
        const { readFile } = await import('node:fs/promises');
        const slides = await pptxSlides(await readFile(p));
        return { ...base, kind: 'slides', slides };
      });
      if (ext === 'html' || ext === 'htm') {
        const { data } = await deps.fileStore.readRange(file.storageKey, file.storageOwnerId, 0, Math.min(file.sizeBytes, 2 * 1024 * 1024));
        const html = decodeText(data);
        return { ...base, kind: 'html', html: safePreviewHtml(html), text: htmlToText(html), note: 'Sanitised: scripts, styles, forms and frames were removed. Render it in a sandboxed frame.' };
      }
      if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'tif', 'tiff'].includes(ext)) {
        const ocrText = file.documentId ? (await db.documentChunk.findMany({ where: { documentId: file.documentId }, orderBy: { chunkId: 'asc' }, take: 20 })).map((c: any) => c.text).join('\n') : null;
        return { ...base, kind: 'image', image: `/api/admin/knowledge/files/${file.id}/preview?render=image`, ocrText };
      }
      if (ext === 'zip') return { ...base, kind: 'archive', ...(await archiveListing(file)) };
      return { ...base, kind: 'unavailable', reason: `Preview is not available for .${ext || 'unknown'} files; download the file instead.` };
    } catch (e) {
      if (e instanceof ExtractionError) return { ...base, kind: 'unavailable', reason: e.message };
      if (e instanceof FileStoreError) throw new KnowledgeError('STORAGE_MISSING', 'The stored file is missing.', 410);
      throw e;
    }
  }

  function rowWindow(sheet: { name: string; columns: string[]; rows: string[][]; totalRows: number }, q: { offset?: number; limit?: number }) {
    const offset = Math.max(0, q.offset ?? 0);
    const n = Math.min(Math.max(1, q.limit ?? 100), 1000);
    return { sheet: sheet.name, columns: sheet.columns, rows: sheet.rows.slice(offset, offset + n), offset, totalRows: sheet.totalRows, nextOffset: offset + n < sheet.rows.length ? offset + n : null };
  }

  /** PNG rendering of a PDF page or a resized image (never the raw upload). */
  async function renderImage(userId: string, id: string, page = 1): Promise<Buffer> {
    const { file } = await fileFor(userId, id);
    if (file.sizeBytes > env('KNOWLEDGE_PREVIEW_MAX_BYTES', 50 * 1024 * 1024)) throw new KnowledgeError('TOO_LARGE', 'The file is too large to render.', 413);
    return withTemp(file, async (p) => {
      if (file.extension === 'pdf') {
        const { readFile } = await import('node:fs/promises');
        const parser = new PDFParse({ data: new Uint8Array(await readFile(p)) });
        try {
          const shot = await parser.getScreenshot({ partial: [Math.max(1, page)], scale: 1.5, imageBuffer: true, imageDataUrl: false });
          const img = shot.pages[0]?.data;
          if (!img) throw new KnowledgeError('NOT_FOUND', 'That page does not exist.', 404);
          return sharp(Buffer.from(img)).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
        } catch (e) {
          if (e instanceof KnowledgeError) throw e;
          throw new KnowledgeError('UNRENDERABLE', 'The page could not be rendered.', 422);
        } finally { await parser.destroy().catch(() => {}); }
      }
      if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'tif', 'tiff'].includes(file.extension)) {
        return sharp(p, { limitInputPixels: 80_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
          .catch(() => { throw new KnowledgeError('UNRENDERABLE', 'The image could not be decoded.', 422); });
      }
      throw new KnowledgeError('UNRENDERABLE', 'Only PDF pages and images can be rendered.', 400);
    });
  }

  // ── Archives ────────────────────────────────────────────────────────────
  const ZIP_MAX_ENTRIES = () => env('KNOWLEDGE_ZIP_MAX_ENTRIES', 2000);
  const ZIP_MAX_BYTES = () => env('KNOWLEDGE_ZIP_MAX_BYTES', 500 * 1024 * 1024);
  const ZIP_MAX_RATIO = 100;

  async function loadZip(file: any) {
    if (file.sizeBytes > env('KNOWLEDGE_PREVIEW_MAX_BYTES', 50 * 1024 * 1024)) throw new KnowledgeError('TOO_LARGE', 'The archive is too large to open.', 413);
    const { data } = await deps.fileStore.readRange(file.storageKey, file.storageOwnerId, 0, file.sizeBytes);
    try { return await JSZip.loadAsync(data); } catch { throw new KnowledgeError('MALFORMED', 'The archive could not be opened.', 422); }
  }

  async function archiveListing(file: any) {
    const zip = await loadZip(file);
    const entries = Object.values(zip.files).slice(0, 5000).map((e: any) => {
      let problem: string | null = null;
      try { normalizeRelativePath(e.unsafeOriginalName ?? e.name); } catch (err) { problem = (err as Error).message; }
      return { path: e.unsafeOriginalName ?? e.name, directory: e.dir, sizeBytes: e._data?.uncompressedSize ?? null, compressedBytes: e._data?.compressedSize ?? null, problem };
    });
    return { entries, totalEntries: Object.keys(zip.files).length };
  }

  /**
   * Controlled extraction into a folder: entry count, total size, compression ratio and every path are
   * checked first, and the real size of each entry is enforced while streaming (headers can lie).
   */
  async function extractArchive(userId: string, id: string, opts: { targetDirectoryId?: string | null; onConflict?: ConflictPolicy }) {
    const { file, repo } = await fileFor(userId, id);
    if (file.extension !== 'zip') throw new KnowledgeError('NOT_ARCHIVE', 'Only .zip archives can be extracted.', 400);
    const zip = await loadZip(file);
    const entries = Object.values(zip.files) as any[];
    if (entries.length > ZIP_MAX_ENTRIES()) throw new KnowledgeError('ARCHIVE_TOO_LARGE', `The archive has ${entries.length} entries; the limit is ${ZIP_MAX_ENTRIES()}.`, 413);
    const declared = entries.reduce((a, e) => a + (e._data?.uncompressedSize ?? 0), 0);
    if (declared > ZIP_MAX_BYTES()) throw new KnowledgeError('ARCHIVE_TOO_LARGE', `The archive expands to ${Math.round(declared / 1048576)} MB; the limit is ${Math.round(ZIP_MAX_BYTES() / 1048576)} MB.`, 413);
    if (file.sizeBytes > 0 && declared / file.sizeBytes > ZIP_MAX_RATIO) throw new KnowledgeError('ARCHIVE_BOMB', 'The archive is compressed suspiciously well (possible zip bomb) and was not extracted.', 422);
    const rejected: UploadResult[] = [];
    const items: UploadItem[] = [];
    const folders: string[] = [];
    await mkdir(tmpRoot, { recursive: true, mode: 0o700 });
    let written = 0;
    try {
      for (const e of entries) {
        // JSZip silently rewrites "../x" to "x"; judge the name as written in the archive.
        const rawName: string = e.unsafeOriginalName ?? e.name;
        try { normalizeRelativePath(rawName); } catch (err) { rejected.push({ path: rawName, status: 'rejected', reason: (err as Error).message }); continue; }
        const unixMode = e.unixPermissions ?? 0;
        if ((unixMode & 0o170000) === 0o120000) { rejected.push({ path: e.name, status: 'rejected', reason: 'Symbolic links are not extracted.' }); continue; }
        if (e.dir) { folders.push(e.name); continue; }
        const tmp = path.join(tmpRoot, `${randomUUID()}.part`);
        let size = 0;
        const limit = maxFileBytes;
        await pipeline(e.nodeStream(), async function* (src: AsyncIterable<Buffer>) {
          for await (const chunk of src) {
            size += chunk.length;
            written += chunk.length;
            if (size > limit || written > ZIP_MAX_BYTES()) throw new KnowledgeError('ARCHIVE_TOO_LARGE', 'An archive entry is larger than allowed.', 413);
            yield chunk;
          }
        }, createWriteStream(tmp, { mode: 0o600 }));
        items.push({ tempPath: tmp, name: baseName(e.name.replace(/\/$/, '')), relativePath: e.name, size });
      }
      const out = await ingest(userId, repo.id, { directoryId: opts.targetDirectoryId ?? file.directoryId, items, onConflict: opts.onConflict, emptyFolders: folders });
      return { ...out, results: [...rejected, ...out.results], summary: { ...out.summary, rejected: out.summary.rejected + rejected.length } };
    } finally {
      await Promise.all(items.map((i) => rm(i.tempPath, { force: true })));
    }
  }

  // ── Search ──────────────────────────────────────────────────────────────
  async function search(userId: string, repoId: string, q: { query: string; scope?: 'all' | 'names' | 'content'; limit?: number; directoryId?: string | null }) {
    const repo = await repoFor(userId, repoId);
    const query = q.query.trim().slice(0, 500);
    if (!query) throw new KnowledgeError('INVALID_REQUEST', 'Enter something to search for.', 400);
    const limit = Math.min(Math.max(1, q.limit ?? 20), 100);
    const scope = q.scope ?? 'all';
    const dir = await dirInRepo(repo, q.directoryId);
    const under = dir ? { path: { startsWith: `${dir.path}/` } } : {};
    const out: any = { query };
    if (scope !== 'content') {
      out.folders = (await db.repositoryDirectory.findMany({ where: { repositoryId: repo.id, ...under, path: { contains: query, mode: 'insensitive', ...(dir ? { startsWith: `${dir.path}/` } : {}) } }, take: limit, orderBy: { path: 'asc' } })).map(publicDir);
      out.files = (await db.repositoryFile.findMany({ where: { repositoryId: repo.id, path: { contains: query, mode: 'insensitive', ...(dir ? { startsWith: `${dir.path}/` } : {}) } }, take: limit, orderBy: { path: 'asc' } })).map(publicFile);
    }
    if (scope !== 'names') {
      const files = await db.repositoryFile.findMany({ where: { repositoryId: repo.id, ...under, documentId: { not: null } }, select: { id: true, documentId: true, path: true, name: true } });
      const byDoc = new Map<string, any>(files.map((f: any) => [f.documentId, f]));
      const candidates = byDoc.size ? await db.documentChunk.findMany({ where: { documentId: { in: [...byDoc.keys()] } }, take: 20_000 }) : [];
      let qv: number[] | null = null;
      if (deps.embedder.isAvailable() && candidates.some((c: any) => c.embedding)) qv = await deps.embedder.getEmbeddings([query], 'RETRIEVAL_QUERY').then((v) => v[0]).catch(() => null);
      const ranked = rankHybridKnowledgeChunks(candidates, query, qv, { limit, threshold: 0.05 });
      out.content = ranked.map((r: any) => {
        const meta = safeJson(r.chunk.metadata);
        const f = byDoc.get(r.chunk.documentId);
        return { fileId: f?.id, path: f?.path, name: f?.name, page: r.chunk.pageNumber ?? meta.page ?? null, slide: meta.slide ?? null, sheet: meta.sheet ?? null, section: r.chunk.section ?? null, score: r.score, excerpt: excerpt(r.chunk.text, query) };
      });
      out.method = qv ? 'hybrid' : 'keyword';
    }
    return out;
  }

  // ── Indexing ────────────────────────────────────────────────────────────
  /** Queues one background job for a set of files; files keep a persisted status the whole time. */
  async function queueIndex(repo: any, fileIds: string[], force: boolean): Promise<string | null> {
    if (!fileIds.length) return null;
    const files = await db.repositoryFile.findMany({ where: { id: { in: fileIds } }, select: { id: true, contentHash: true, version: true } });
    const key = createHash('sha256').update(JSON.stringify({ r: repo.id, f: files.map((f: any) => `${f.id}:${f.contentHash}:${f.version}`).sort(), force: force ? Date.now() : 0 })).digest('hex').slice(0, 32);
    let jobId: string | null = null;
    try {
      let { job, duplicate } = await deps.queue.submit<IndexJobPayload>({ type: 'knowledge.index', ownerId: repo.userId, payload: { repositoryId: repo.id, fileIds, force }, idempotencyKey: key, maxAttempts: 3 });
      // The same request is only collapsed into a job that has not run yet; a finished one is not reused.
      if (duplicate && job.status !== 'queued' && job.status !== 'processing') {
        ({ job } = await deps.queue.submit<IndexJobPayload>({ type: 'knowledge.index', ownerId: repo.userId, payload: { repositoryId: repo.id, fileIds, force }, idempotencyKey: `${key}:${randomUUID()}`, maxAttempts: 3 }));
      }
      jobId = job.id;
    } catch (e) {
      // Too many active jobs: files stay "queued" and the periodic sweep (resumePending) picks them up.
      if (!(e instanceof JobError && e.code === 'TOO_MANY_JOBS')) throw e;
    }
    await db.repositoryFile.updateMany({ where: { id: { in: fileIds }, indexStatus: { notIn: [...ACTIVE] } }, data: { indexStatus: 'queued', indexJobId: jobId } });
    return jobId;
  }

  async function reindexFile(userId: string, id: string) {
    const { file, repo } = await fileFor(userId, id);
    return { jobId: await queueIndex(repo, [file.id], true) };
  }

  async function reindexRepository(userId: string, repoId: string, opts: { onlyFailed?: boolean; force?: boolean } = {}) {
    const repo = await repoFor(userId, repoId);
    const where: any = { repositoryId: repo.id };
    if (opts.onlyFailed) where.indexStatus = { in: ['failed', 'partial_failure', 'pending_embeddings', 'uploaded', 'queued'] };
    const files = await db.repositoryFile.findMany({ where, select: { id: true } });
    return { jobId: await queueIndex(repo, files.map((f: any) => f.id), !!opts.force), files: files.length };
  }

  async function setStatus(id: string, data: Record<string, unknown>) {
    await db.repositoryFile.update({ where: { id }, data });
  }

  /** Effective knowledge base and AI switch: file → nearest folder → repository. */
  async function effectiveTarget(repo: any, file: any, dirs: Map<string, any>) {
    let kb = file.knowledgeBaseId ?? null;
    let enabled = file.aiEnabled !== false;
    for (let d = file.directoryId ? dirs.get(file.directoryId) : null; d; d = d.parentId ? dirs.get(d.parentId) : null) {
      if (!kb && d.knowledgeBaseId) kb = d.knowledgeBaseId;
      if (d.aiEnabled === false) enabled = false;
    }
    return { knowledgeBaseId: kb ?? repo.knowledgeBaseId, enabled };
  }

  async function indexOne(repo: any, fileId: string, force: boolean, dirs: Map<string, any>, signal: AbortSignal) {
    const file = await db.repositoryFile.findUnique({ where: { id: fileId } });
    if (!file || file.repositoryId !== repo.id) return;
    const target = await effectiveTarget(repo, file, dirs);
    if (!target.enabled || !target.knowledgeBaseId) {
      if (file.documentId) await removeDocument(file.documentId);
      await setStatus(file.id, { indexStatus: 'excluded', documentId: null, chunkCount: 0, indexError: target.knowledgeBaseId ? null : 'No knowledge base is linked.' });
      return;
    }
    const sameContent = file.indexedHash === file.contentHash && file.indexedVersion === file.version;
    if (!force && sameContent && ['indexed', 'duplicate', 'unsupported'].includes(file.indexStatus)) return;

    // Identical content already indexed in the same knowledge base: reuse it instead of duplicating chunks.
    const twins = await db.repositoryFile.findMany({ where: { contentHash: file.contentHash, indexStatus: { in: ['indexed', 'pending_embeddings', 'partial_failure'] }, id: { not: file.id }, duplicateOfId: null, documentId: { not: null } }, take: 50 });
    for (const twin of twins) {
      const twinDoc = await db.document.findUnique({ where: { id: twin.documentId } });
      if (twinDoc?.knowledgeBaseId === target.knowledgeBaseId) {
        if (file.documentId) await removeDocument(file.documentId);
        await setStatus(file.id, { indexStatus: 'duplicate', duplicateOfId: twin.id, documentId: null, chunkCount: 0, indexedHash: file.contentHash, indexedVersion: file.version, indexedAt: now(), indexError: null, extractionStatus: 'extracted' });
        return;
      }
    }

    // Only embeddings are missing for unchanged content: fill them in without re-extracting.
    if (!force && sameContent && ['pending_embeddings', 'partial_failure'].includes(file.indexStatus) && file.documentId && deps.embedder.isAvailable()) {
      await setStatus(file.id, { indexStatus: 'embedding' });
      const missing = await db.documentChunk.findMany({ where: { documentId: file.documentId, embedding: null } });
      const { failed } = await embedInto(missing);
      await setStatus(file.id, { indexStatus: failed ? 'partial_failure' : 'indexed', indexError: failed ? `${failed} chunk(s) could not be embedded; retry later.` : null, indexedAt: now() });
      return;
    }

    await setStatus(file.id, { indexStatus: 'extracting', indexError: null });
    let extracted: Extracted;
    try {
      extracted = await withTemp(file, (p) => extractForIndex(p, file.name, { ocr: settingsOf(repo).ocr ? deps.ocr : undefined }));
    } catch (e) {
      const msg = e instanceof ExtractionError ? e.message : e instanceof FileStoreError ? 'The stored file is missing.' : 'Text extraction failed.';
      await setStatus(file.id, { indexStatus: 'failed', extractionStatus: 'failed', indexError: msg });
      return;
    }
    if (signal.aborted) throw new JobError('CANCELLED', 'Indexing was interrupted.', true);
    if (!extracted.supported || !extracted.segments.length) {
      if (file.documentId) await removeDocument(file.documentId);
      await setStatus(file.id, { indexStatus: 'unsupported', extractionStatus: extracted.supported ? 'extracted' : 'unsupported', extractionMethod: extracted.method, indexError: extracted.warnings.join(' ') || 'No text was found.', documentId: null, chunkCount: 0, indexedHash: file.contentHash, indexedVersion: file.version });
      return;
    }

    await setStatus(file.id, { indexStatus: 'chunking', extractionStatus: 'extracted', extractionMethod: extracted.method });
    const setting = await db.retrievalSetting.findUnique({ where: { environment: 'production' } });
    const chunkSize = setting?.chunkSize || 800, overlap = setting?.overlap || 120;
    const s = settingsOf(repo);
    const indexedAt = now();
    const pieces: Array<{ text: string; seg: (typeof extracted.segments)[number] }> = [];
    for (const seg of extracted.segments) for (const t of (extracted.method === 'spreadsheet' ? [seg.text] : splitDocumentIntoChunks(seg.text, chunkSize, overlap))) pieces.push({ text: t, seg });
    const maxChunks = env('KNOWLEDGE_MAX_CHUNKS_PER_FILE', 20_000);
    if (pieces.length > maxChunks) extracted.warnings.push(`Only the first ${maxChunks} chunks were indexed.`);

    // Replace the file's previous index (same Document row, new chunks) so retries never duplicate.
    let documentId = file.documentId;
    const docData = { knowledgeBaseId: target.knowledgeBaseId, userId: repo.userId, organizationId: repo.organizationId, globalApproved: false, name: file.path, type: (file.extension || 'BIN').toUpperCase(), size: humanSize(file.sizeBytes), sizeBytes: file.sizeBytes, units: `${Math.min(pieces.length, maxChunks)} chunk(s)${extracted.pages ? `, ${extracted.pages} pages` : ''}`, stage: 9, status: 'READY', filePath: null };
    if (documentId && !(await db.document.findUnique({ where: { id: documentId } }))) documentId = null;
    if (documentId) {
      await removeDocument(documentId);
    }
    documentId = documentId ?? randomUUID();
    await db.document.create({ data: { id: documentId, ...docData } });
    await setStatus(file.id, { indexStatus: 'indexing', documentId });
    const rows = pieces.slice(0, maxChunks).map((p, i) => ({
      id: randomUUID(), documentId, knowledgeBaseId: target.knowledgeBaseId, pageNumber: p.seg.page ?? p.seg.slide ?? null,
      section: p.seg.section ?? (p.seg.page ? `Page ${p.seg.page}` : null), chunkId: `${file.id}-v${file.version}-${i + 1}`, sourceFilename: file.name, text: p.text,
      embedding: null, language: s.language, domain: s.domain, region: 'rwanda', license: 'proprietary', consentGiven: false, status: 'approved', expiresAt: null,
      metadata: JSON.stringify({ repositoryId: repo.id, fileId: file.id, directoryId: file.directoryId, path: file.path, page: p.seg.page ?? null, slide: p.seg.slide ?? null, sheet: p.seg.sheet ?? null, section: p.seg.section ?? null, chunkIndex: i, version: file.version, contentHash: file.contentHash, extractionMethod: extracted.method, indexedAt: indexedAt.toISOString(), sourceUrl: `/api/knowledge/sources/${file.id}${p.seg.page ? `?page=${p.seg.page}` : ''}` }),
    }));
    for (let i = 0; i < rows.length; i += 500) await db.documentChunk.createMany({ data: rows.slice(i, i + 500) });
    await db.processingJob.create({ data: { id: randomUUID(), documentId, stage: 'READY', status: 'COMPLETED', progress: 100, attempts: 1, error: null } });
    for (const sh of extracted.sheets) {
      const sheetId = randomUUID();
      await db.spreadsheetSheet.create({ data: { id: sheetId, documentId, name: sh.name } });
      await db.spreadsheetColumn.createMany({ data: sh.columns.map((c, i) => ({ id: randomUUID(), sheetId, name: c.slice(0, 200), dataType: 'string', columnIndex: i })) });
      const tableRows = sh.rows.slice(0, env('KNOWLEDGE_MAX_TABLE_ROWS', 2000));
      for (let i = 0; i < tableRows.length; i += 500) await db.spreadsheetRow.createMany({ data: tableRows.slice(i, i + 500).map((r, k) => ({ id: randomUUID(), sheetId, rowIndex: i + k + 2, rowData: JSON.stringify(Object.fromEntries(sh.columns.map((c, ci) => [c, r[ci] ?? '']))) })) });
    }

    let status = 'pending_embeddings';
    let error: string | null = 'Searchable by keyword. Semantic embeddings are pending: no embedding provider is configured (set GEMINI_API_KEY), then re-index.';
    if (deps.embedder.isAvailable()) {
      await setStatus(file.id, { indexStatus: 'embedding' });
      const { failed } = await embedInto(rows);
      status = failed ? 'partial_failure' : 'indexed';
      error = failed ? `${failed} of ${rows.length} chunk(s) could not be embedded; they are searchable by keyword. Retry to complete.` : null;
    }
    if (extracted.warnings.length) error = [error, ...extracted.warnings].filter(Boolean).join(' ');
    await setStatus(file.id, { indexStatus: status, indexError: error, indexedAt, indexedHash: file.contentHash, indexedVersion: file.version, chunkCount: rows.length, duplicateOfId: null });
  }

  async function embedInto(rows: Array<{ id: string; text: string }>): Promise<{ failed: number }> {
    let failed = 0;
    for (let i = 0; i < rows.length; i += 32) {
      const batch = rows.slice(i, i + 32);
      try {
        const vectors = await deps.embedder.getEmbeddings(batch.map((r) => r.text), 'RETRIEVAL_DOCUMENT');
        for (let k = 0; k < batch.length; k++) {
          if (vectors[k]?.length) await db.documentChunk.update({ where: { id: batch[k].id }, data: { embedding: JSON.stringify(vectors[k]) } });
          else failed++;
        }
      } catch {
        failed += batch.length;
      }
    }
    return { failed };
  }

  async function runIndexJob(job: FileJob<IndexJobPayload>, ctx: JobContext) {
    const p = job.payload;
    const repo = await db.knowledgeRepository.findUnique({ where: { id: p.repositoryId } });
    if (!repo) return { skipped: 'repository deleted' };
    const dirs = new Map<string, any>((await db.repositoryDirectory.findMany({ where: { repositoryId: repo.id } })).map((d: any) => [d.id, d]));
    const started = Date.now();
    const queue = [...p.fileIds];
    const done: string[] = [];
    let continued = false;
    const worker = async () => {
      while (queue.length && !ctx.signal.aborted) {
        if (Date.now() - started > budget) { continued = true; return; }
        const id = queue.shift()!;
        try {
          await indexOne(repo, id, !!p.force, dirs, ctx.signal);
        } catch (e) {
          if (ctx.signal.aborted) throw e;
          await setStatus(id, { indexStatus: 'failed', indexError: 'Indexing failed unexpectedly; retry.' }).catch(() => {});
        }
        done.push(id);
        await ctx.progress(`indexed ${done.length} of ${p.fileIds.length} files`, Math.round((100 * done.length) / p.fileIds.length));
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, worker));
    if (ctx.signal.aborted) throw new JobError('CANCELLED', 'Indexing was interrupted.', true);
    if (continued && queue.length) {
      const next = await deps.queue.submit<IndexJobPayload>({ type: 'knowledge.index', ownerId: job.ownerId, payload: { repositoryId: p.repositoryId, fileIds: queue, force: p.force, segment: (p.segment ?? 0) + 1 }, idempotencyKey: `${job.id}:next`, maxAttempts: 3 });
      await db.repositoryFile.updateMany({ where: { id: { in: queue } }, data: { indexJobId: next.job.id } });
      return { processed: done.length, continuedIn: next.job.id };
    }
    return { processed: done.length };
  }

  deps.queue.register<IndexJobPayload, unknown>('knowledge.index', runIndexJob);

  /**
   * Recovers files left "uploaded"/"queued" (e.g. the per-user job limit was reached or the server
   * restarted) and fills in missing embeddings once a provider is configured. Safe to run repeatedly.
   */
  async function resumePending() {
    const states = ['uploaded', 'queued', ...(deps.embedder.isAvailable() ? ['pending_embeddings'] : [])];
    const files = await db.repositoryFile.findMany({ where: { indexStatus: { in: states } }, select: { id: true, repositoryId: true, indexJobId: true }, take: 5000 });
    const byRepo = new Map<string, string[]>();
    for (const f of files) {
      if (f.indexJobId) {
        const j = await deps.queue.getJob(f.indexJobId);
        if (j && (j.status === 'queued' || j.status === 'processing')) continue;
      }
      byRepo.set(f.repositoryId, [...(byRepo.get(f.repositoryId) ?? []), f.id]);
    }
    let queued = 0;
    for (const [repoId, ids] of byRepo) {
      const repo = await db.knowledgeRepository.findUnique({ where: { id: repoId } });
      if (repo && (await queueIndex(repo, ids, false))) queued += ids.length;
    }
    return { queued };
  }

  async function jobStatus(userId: string, jobId: string) {
    const job = await deps.queue.getJob(jobId);
    if (!job || job.type !== 'knowledge.index') throw new KnowledgeError('NOT_FOUND', 'Job not found.', 404);
    await repoFor(userId, (job.payload as IndexJobPayload).repositoryId).catch(() => { throw new KnowledgeError('NOT_FOUND', 'Job not found.', 404); });
    const ids = (job.payload as IndexJobPayload).fileIds;
    const files = await db.repositoryFile.findMany({ where: { id: { in: ids.slice(0, 1000) } }, select: { id: true, path: true, indexStatus: true, indexError: true } });
    const counts: Record<string, number> = {};
    for (const f of files) counts[f.indexStatus] = (counts[f.indexStatus] ?? 0) + 1;
    return { job: FileJobQueue.publicView(job), files: files.map((f: any) => ({ id: f.id, path: f.path, status: f.indexStatus, error: f.indexError })), counts };
  }

  /**
   * Opens a cited source for any signed-in user who may retrieve it: the repository owner, members of its
   * organisation, or anyone when both the document and its knowledge base are globally approved.
   */
  async function openSource(userId: string, fileId: string) {
    const file = typeof fileId === 'string' ? await db.repositoryFile.findUnique({ where: { id: fileId } }) : null;
    if (!file) throw new KnowledgeError('NOT_FOUND', 'Source not found.', 404);
    const repo = await db.knowledgeRepository.findUnique({ where: { id: file.repositoryId } });
    const orgs = await orgIdsOf(userId);
    let allowed = !!repo && canAccess(repo, userId, orgs);
    if (!allowed && file.documentId) {
      const doc = await db.document.findUnique({ where: { id: file.documentId } });
      const kb = doc ? await db.knowledgeBase.findUnique({ where: { id: doc.knowledgeBaseId } }) : null;
      allowed = !!doc && !!kb && ((doc.globalApproved && kb.globalApproved) || kb.userId === userId || (!!kb.organizationId && orgs.includes(kb.organizationId)));
    }
    if (!allowed) throw new KnowledgeError('NOT_FOUND', 'Source not found.', 404);
    const { stream } = await deps.fileStore.openStream(file.storageKey, file.storageOwnerId);
    return { file, stream };
  }

  return {
    createRepository, listRepositories, updateRepository, deleteRepository, repoFor, statistics,
    createDirectory, updateDirectory, deleteDirectory, tree, contents,
    ingest, getFile, updateFile, copyFile, deleteFile, bulk, openDownload, preview, renderImage, extractArchive, archiveListing,
    search, reindexFile, reindexRepository, resumePending, jobStatus, openSource, runIndexJob,
  };
}

export type KnowledgeService = ReturnType<typeof createKnowledgeService>;

function safeJson(s: unknown): any { if (!s || typeof s !== 'string') return {}; try { return JSON.parse(s); } catch { return {}; } }
function humanSize(b: number) { return b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`; }
function excerpt(text: string, query: string) {
  const t = String(text ?? '');
  const term = query.toLowerCase().split(/\s+/).find((w) => w.length > 2 && t.toLowerCase().includes(w));
  const at = term ? t.toLowerCase().indexOf(term) : 0;
  const start = Math.max(0, at - 120);
  return `${start ? '…' : ''}${t.slice(start, start + 320).trim()}${start + 320 < t.length ? '…' : ''}`;
}
export { parentPath };
