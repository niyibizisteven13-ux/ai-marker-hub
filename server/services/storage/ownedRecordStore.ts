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

  /**
   * Changes happen one at a time per record: a class handing in together would otherwise read the same version,
   * each add their own work, and the last write would erase the others. The lock works inside this process (a
   * queue) and between servers sharing the folder (an exclusive lock file that is cleared if its owner died).
   */
  private tails = new Map<string, Promise<unknown>>();
  private async locked<R>(id: string, fn: () => Promise<R>): Promise<R> {
    const before = this.tails.get(id) ?? Promise.resolve();
    let done!: () => void;
    const mine = new Promise<void>((r) => { done = r; });
    const tail = before.then(() => mine);
    this.tails.set(id, tail);
    await before.catch(() => undefined);
    const lock = `${this.file(id)}.lock`;
    try {
      await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
      const deadline = Date.now() + 20_000;
      for (;;) {
        try { await (await fs.open(lock, 'wx')).close(); break; } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
          const age = await fs.stat(lock).then((st) => Date.now() - st.mtimeMs).catch(() => 0);
          if (age > 15_000) { await fs.rm(lock, { force: true }); continue; }
          if (Date.now() > deadline) throw new Error('This record is busy. Try again.');
          await new Promise((r) => setTimeout(r, 10 + Math.random() * 30));
        }
      }
      try { return await fn(); } finally { await fs.rm(lock, { force: true }).catch(() => undefined); }
    } finally {
      done();
      if (this.tails.get(id) === tail) this.tails.delete(id);
    }
  }

  async update(id: string, ownerId: string, patch: (rec: T) => T | void): Promise<T | null> {
    if (!ID_RE.test(id)) return null;
    return this.locked(id, async () => {
      const rec = await this.get(id, ownerId);
      if (!rec) return null;
      const next = (patch(rec) ?? rec) as T;
      next.updatedAt = new Date().toISOString();
      await this.write(next);
      return next;
    });
  }

  async delete(id: string, ownerId: string): Promise<boolean> {
    if (!ID_RE.test(id)) return false;
    return this.locked(id, async () => {
      if (!(await this.get(id, ownerId))) return false;
      await fs.rm(this.file(id), { force: true });
      return true;
    });
  }

  /** The owner's unexpired records, newest first (scans the directory; fine for per-user lists of modest size). */
  async list(ownerId: string, limit = 50): Promise<T[]> {
    let names: string[] = [];
    try { names = await fs.readdir(this.dir); } catch { return []; }
    const out: T[] = [];
    for (const n of names.filter((x) => x.endsWith('.json'))) {
      try {
        const rec = JSON.parse(await fs.readFile(path.join(this.dir, n), 'utf8')) as T;
        if (rec.ownerId === ownerId && Date.parse(rec.expiresAt) >= Date.now()) out.push(rec);
      } catch { /* skip unreadable */ }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
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
