import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface OwnedRecord { id: string; ownerId: string; createdAt: string; updatedAt: string; expiresAt: string }

/**
 * Small disk-backed JSON store where every record belongs to one user.
 * get/update return null for other users' records, so ids cannot be probed.
 */
export class OwnedRecordStore<T extends OwnedRecord> {
  private dir: string;

  constructor(dir: string, private ttlMs = 90 * 24 * 60 * 60 * 1000) {
    this.dir = path.resolve(dir);
  }

  private file(id: string) {
    if (!ID_RE.test(id)) throw new Error('invalid id');
    return path.join(this.dir, `${id}.json`);
  }

  private async write(rec: T) {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const f = this.file(rec.id);
    const tmp = `${f}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(rec), { mode: 0o600 });
    await fs.rename(tmp, f);
  }

  async create(ownerId: string, data: Omit<T, keyof OwnedRecord>): Promise<T> {
    const now = new Date();
    const rec = { ...data, id: randomUUID(), ownerId, createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + this.ttlMs).toISOString() } as T;
    await this.write(rec);
    return rec;
  }

  /**
   * Creates or replaces the record with a caller-chosen id (e.g. the job id), so a job handler that is
   * re-run after a crash overwrites its own record instead of creating a duplicate. Refuses another owner's id.
   */
  async put(id: string, ownerId: string, data: Omit<T, keyof OwnedRecord>): Promise<T> {
    if (!ID_RE.test(id)) throw new Error('invalid id');
    let createdAt = new Date().toISOString();
    try {
      const existing = JSON.parse(await fs.readFile(this.file(id), 'utf8')) as T;
      if (existing.ownerId !== ownerId) throw new Error('record belongs to another user');
      createdAt = existing.createdAt;
    } catch (e) {
      if ((e as Error).message === 'record belongs to another user') throw e;
    }
    const now = new Date();
    const rec = { ...data, id, ownerId, createdAt, updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + this.ttlMs).toISOString() } as T;
    await this.write(rec);
    return rec;
  }

  async get(id: string, ownerId: string): Promise<T | null> {
    if (!ID_RE.test(id)) return null;
    try {
      const rec = JSON.parse(await fs.readFile(this.file(id), 'utf8')) as T;
      if (rec.ownerId !== ownerId || Date.parse(rec.expiresAt) < Date.now()) return null;
      return rec;
    } catch {
      return null;
    }
  }

  async update(id: string, ownerId: string, patch: (rec: T) => T | void): Promise<T | null> {
    const rec = await this.get(id, ownerId);
    if (!rec) return null;
    const next = (patch(rec) ?? rec) as T;
    next.updatedAt = new Date().toISOString();
    await this.write(next);
    return next;
  }

  async delete(id: string, ownerId: string): Promise<boolean> {
    if (!(await this.get(id, ownerId))) return false;
    await fs.rm(this.file(id), { force: true });
    return true;
  }

  async purgeExpired(): Promise<number> {
    let removed = 0;
    let names: string[] = [];
    try { names = await fs.readdir(this.dir); } catch { return 0; }
    for (const n of names.filter((x) => x.endsWith('.json'))) {
      try {
        const rec = JSON.parse(await fs.readFile(path.join(this.dir, n), 'utf8')) as OwnedRecord;
        if (Date.parse(rec.expiresAt) < Date.now()) { await fs.rm(path.join(this.dir, n), { force: true }); removed++; }
      } catch { /* skip unreadable */ }
    }
    return removed;
  }
}
