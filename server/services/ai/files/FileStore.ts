import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AttachmentKind, AttachmentRef, StoredFileMeta } from '../types.js';

export interface FileStoreOptions {
  /** Directory for generated files (use a persistent volume in production). */
  dir: string;
  /** Secret for signed download URLs (set FILE_URL_SECRET). */
  secret: string;
  /** Public path prefix for downloads, e.g. "/api/files". */
  urlPrefix?: string;
  defaultTtlMs?: number;
  maxFileBytes?: number;
}

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class FileStoreError extends Error {
  constructor(public code: 'not_found' | 'forbidden' | 'too_large' | 'bad_signature' | 'expired', message?: string) {
    super(message ?? code);
  }
}

/**
 * Disk-backed store for files the AI creates. Files are private to a user, expire automatically,
 * and are downloaded through short-lived signed URLs. Swap the three disk calls for S3/GCS if needed.
 */
export class FileStore {
  private readonly dir: string;
  private readonly secret: string;
  private readonly urlPrefix: string;
  private readonly ttl: number;
  readonly maxFileBytes: number;

  constructor(opts: FileStoreOptions) {
    if (!opts.secret || opts.secret.length < 16) throw new Error('FileStore: secret must be at least 16 characters.');
    this.dir = path.resolve(opts.dir);
    this.secret = opts.secret;
    this.urlPrefix = (opts.urlPrefix ?? '/api/files').replace(/\/$/, '');
    this.ttl = opts.defaultTtlMs ?? 24 * 60 * 60 * 1000;
    this.maxFileBytes = opts.maxFileBytes ?? 25 * 1024 * 1024;
  }

  private filePath(id: string) {
    if (!ID_RE.test(id)) throw new FileStoreError('not_found');
    return path.join(this.dir, id);
  }

  async put(input: {
    userId: string;
    name: string;
    mime: string;
    kind: AttachmentKind;
    data: Buffer | Uint8Array;
    ttlMs?: number;
    previewOf?: string;
  }): Promise<StoredFileMeta> {
    const data = Buffer.from(input.data);
    if (data.length > this.maxFileBytes) throw new FileStoreError('too_large', `File is larger than ${Math.round(this.maxFileBytes / 1048576)} MB.`);
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const now = Date.now();
    const meta: StoredFileMeta = {
      id,
      userId: input.userId,
      name: input.name,
      mime: input.mime,
      size: data.length,
      kind: input.kind,
      sha256: createHash('sha256').update(data).digest('hex'),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + (input.ttlMs ?? this.ttl)).toISOString(),
    };
    await writeFile(this.filePath(id), data, { mode: 0o600 });
    await writeFile(this.filePath(id) + '.json', JSON.stringify(meta), { mode: 0o600 });
    return meta;
  }

  async meta(id: string): Promise<StoredFileMeta> {
    let raw: string;
    try {
      raw = await readFile(this.filePath(id) + '.json', 'utf8');
    } catch {
      throw new FileStoreError('not_found');
    }
    const meta = JSON.parse(raw) as StoredFileMeta;
    if (Date.parse(meta.expiresAt) < Date.now()) throw new FileStoreError('expired');
    return meta;
  }

  /** Read a file for its owner. */
  async read(id: string, userId: string): Promise<{ meta: StoredFileMeta; data: Buffer }> {
    const meta = await this.meta(id);
    if (meta.userId !== userId) throw new FileStoreError('forbidden');
    return { meta, data: await readFile(this.filePath(id)) };
  }

  /** Read after verifying a signed URL (no session needed, e.g. a plain <a href> download). */
  async readSigned(id: string, exp: string, sig: string): Promise<{ meta: StoredFileMeta; data: Buffer }> {
    if (!this.verify(id, exp, sig)) throw new FileStoreError('bad_signature');
    const meta = await this.meta(id);
    return { meta, data: await readFile(this.filePath(id)) };
  }

  private sign(id: string, exp: number): string {
    return createHmac('sha256', this.secret).update(`${id}.${exp}`).digest('base64url');
  }

  verify(id: string, exp: string, sig: string): boolean {
    const expNum = Number(exp);
    if (!Number.isFinite(expNum) || expNum < Date.now()) return false;
    const expected = Buffer.from(this.sign(id, expNum));
    const given = Buffer.from(sig || '');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  signedUrl(id: string, ttlMs = 60 * 60 * 1000): string {
    const exp = Date.now() + ttlMs;
    return `${this.urlPrefix}/${id}?exp=${exp}&sig=${this.sign(id, exp)}`;
  }

  toRef(meta: StoredFileMeta, previewId?: string): AttachmentRef {
    const remainingTtl = Math.max(0, Date.parse(meta.expiresAt) - Date.now());
    return {
      id: meta.id,
      name: meta.name,
      mime: meta.mime,
      size: meta.size,
      kind: meta.kind,
      url: this.signedUrl(meta.id, remainingTtl),
      ...(previewId ? { previewUrl: this.signedUrl(previewId, remainingTtl), previewId } : {}),
      expiresAt: meta.expiresAt,
    };
  }

  /**
   * Re-sign the download links of an attachment saved in chat history (signed links expire quickly).
   * Returns null if the file expired or does not belong to the user.
   */
  async refresh(ref: Pick<AttachmentRef, 'id' | 'previewId'>, userId: string): Promise<AttachmentRef | null> {
    try {
      const meta = await this.meta(ref.id);
      if (meta.userId !== userId) return null;
      return this.toRef(meta, ref.previewId);
    } catch {
      return null;
    }
  }

  async delete(id: string, userId: string): Promise<void> {
    const meta = await this.meta(id).catch(() => null);
    if (meta && meta.userId !== userId) throw new FileStoreError('forbidden');
    await rm(this.filePath(id), { force: true });
    await rm(this.filePath(id) + '.json', { force: true });
  }

  /** Call from a cron or on startup. Returns how many files were removed. */
  async purgeExpired(): Promise<number> {
    let removed = 0;
    let names: string[] = [];
    try {
      names = await readdir(this.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw error;
    }
    const failures: Error[] = [];
    for (const n of names.filter((x) => x.endsWith('.json'))) {
      try {
        const meta = JSON.parse(await readFile(path.join(this.dir, n), 'utf8')) as StoredFileMeta;
        if (Date.parse(meta.expiresAt) < Date.now()) {
          await rm(path.join(this.dir, meta.id), { force: true });
          await rm(path.join(this.dir, n), { force: true });
          removed++;
        }
      } catch (error) {
        failures.push(new Error(`Unable to inspect expired-file metadata entry ${n}.`, { cause: error }));
      }
    }
    if (failures.length) {
      throw new AggregateError(failures, `Expired-file purge failed for ${failures.length} metadata entr${failures.length === 1 ? 'y' : 'ies'}.`);
    }
    return removed;
  }

  async exists(): Promise<boolean> {
    return stat(this.dir).then(() => true, () => false);
  }
}
