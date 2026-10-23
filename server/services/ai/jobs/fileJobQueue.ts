import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Durable, disk-backed job queue for long-running work (reports, assessments, dataset processing).
 *
 * - Every state change is written atomically to <storageDir>/<id>.json, so jobs survive restarts.
 * - On startup, jobs left "processing" by a crash are re-queued (handlers must be idempotent) or failed
 *   once they have used all attempts.
 * - Jobs are owner-scoped: get/cancel/result return nothing for other users.
 * - Idempotency: a repeated submit with the same owner + key returns the existing job.
 * - Bounded retries for retryable errors, a per-job deadline, a per-user active-job cap, and expiry/cleanup.
 *
 * Runs workers in this process. That suits the current single-instance PM2 deployment; with several
 * instances, run the queue in one worker process or move it to Redis (bullmq is already a dependency).
 */

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface FileJob<P = unknown, R = unknown> {
  id: string;
  type: string;
  ownerId: string;
  status: JobStatus;
  progress: { stage: string; percent: number | null };
  payload: P;
  result?: R;
  error?: { code: string; message: string };
  attempts: number;
  maxAttempts: number;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  expiresAt: string;
  notBefore?: string;
}

/** Throw from a handler to control the public error code and whether a retry is allowed. */
export class JobError extends Error {
  constructor(public code: string, message: string, public retryable = false) {
    super(message);
  }
}

export interface JobContext {
  signal: AbortSignal;
  progress(stage: string, percent?: number | null): Promise<void>;
  attempt: number;
}

export type JobHandler<P = any, R = any> = (job: FileJob<P, R>, ctx: JobContext) => Promise<R>;

export interface JobQueueOptions {
  storageDir?: string;
  concurrency?: number;
  maxAttempts?: number;
  /** How long finished jobs (and their results) are kept. */
  ttlMs?: number;
  /** Queued + processing jobs allowed per user. */
  maxActivePerUser?: number;
  /** Per-attempt deadline. */
  deadlineMs?: number;
  retryDelayMs?: number;
  log?: (event: string, data: Record<string, unknown>) => void;
}

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class FileJobQueue {
  private jobs = new Map<string, FileJob>();
  private handlers = new Map<string, JobHandler>();
  private running = new Map<string, AbortController>();
  private storagePath: string;
  private o: Required<Omit<JobQueueOptions, 'storageDir' | 'log'>> & Pick<JobQueueOptions, 'log'>;
  private initialized: Promise<void> | null = null;
  private stopped = false;
  private timers = new Set<NodeJS.Timeout>();

  constructor(opts: JobQueueOptions = {}) {
    this.storagePath = path.resolve(opts.storageDir ?? path.join(process.cwd(), 'data', 'jobs'));
    this.o = {
      concurrency: opts.concurrency ?? 2,
      maxAttempts: opts.maxAttempts ?? 2,
      ttlMs: opts.ttlMs ?? 7 * 24 * 60 * 60 * 1000,
      maxActivePerUser: opts.maxActivePerUser ?? 5,
      deadlineMs: opts.deadlineMs ?? 10 * 60 * 1000,
      retryDelayMs: opts.retryDelayMs ?? 5_000,
      log: opts.log,
    };
  }

  private listeners: Array<(job: FileJob) => void | Promise<void>> = [];

  /** Called once whenever a job reaches completed, failed or cancelled (e.g. to notify a Telegram chat). */
  onSettled(listener: (job: FileJob) => void | Promise<void>): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter((l) => l !== listener); };
  }

  private emitSettled(job: FileJob) {
    for (const l of this.listeners) {
      Promise.resolve().then(() => l(job)).catch((err) => this.o.log?.('job_listener_failed', { id: job.id, errorType: (err as Error)?.name }));
    }
  }

  register<P, R>(type: string, handler: JobHandler<P, R>): this {
    this.handlers.set(type, handler as JobHandler);
    return this;
  }

  /** Loads persisted jobs and recovers jobs interrupted by a restart. Safe to call more than once. */
  init(): Promise<void> {
    this.initialized ??= (async () => {
      await fs.mkdir(this.storagePath, { recursive: true, mode: 0o700 });
      for (const name of await fs.readdir(this.storagePath)) {
        if (!name.endsWith('.json')) continue;
        try {
          const job = JSON.parse(await fs.readFile(path.join(this.storagePath, name), 'utf8')) as FileJob;
          if (!ID_RE.test(job.id)) continue;
          if (job.status === 'processing') {
            if (job.attempts < job.maxAttempts) {
              job.status = 'queued';
              job.progress = { stage: 'requeued after restart', percent: null };
            } else {
              job.status = 'failed';
              job.error = { code: 'WORKER_RESTARTED', message: 'The server restarted while this job was running and it has no attempts left. Submit it again.' };
              job.finishedAt = new Date().toISOString();
            }
            job.updatedAt = new Date().toISOString();
            await this.persist(job);
            this.o.log?.('job_recovered', { id: job.id, type: job.type, status: job.status });
          }
          this.jobs.set(job.id, job);
        } catch {
          this.o.log?.('job_file_unreadable', { file: name });
        }
      }
      this.pump();
    })();
    return this.initialized;
  }

  /** Stops starting new work and aborts running jobs (they are re-queued on the next start). */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    for (const c of this.running.values()) c.abort(new Error('queue stopping'));
  }

  static idempotencyKeyFor(type: string, payload: unknown): string {
    return createHash('sha256').update(`${type}:${JSON.stringify(payload)}`).digest('hex').slice(0, 32);
  }

  async submit<P>(input: { type: string; ownerId: string; payload: P; idempotencyKey?: string; maxAttempts?: number }): Promise<{ job: FileJob<P>; duplicate: boolean }> {
    await this.init();
    if (!this.handlers.has(input.type)) throw new JobError('UNKNOWN_JOB_TYPE', `No handler for job type "${input.type}".`);
    if (input.idempotencyKey) {
      const existing = [...this.jobs.values()].find((j) => j.ownerId === input.ownerId && j.type === input.type && j.idempotencyKey === input.idempotencyKey
        && j.status !== 'failed' && j.status !== 'cancelled' && Date.parse(j.expiresAt) > Date.now());
      if (existing) return { job: existing as FileJob<P>, duplicate: true };
    }
    const active = [...this.jobs.values()].filter((j) => j.ownerId === input.ownerId && (j.status === 'queued' || j.status === 'processing')).length;
    if (active >= this.o.maxActivePerUser) throw new JobError('TOO_MANY_JOBS', `You already have ${active} jobs running. Wait for one to finish.`);
    const now = new Date();
    const job: FileJob<P> = {
      id: randomUUID(), type: input.type, ownerId: input.ownerId, status: 'queued', progress: { stage: 'queued', percent: 0 },
      payload: input.payload, attempts: 0, maxAttempts: input.maxAttempts ?? this.o.maxAttempts, idempotencyKey: input.idempotencyKey,
      createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + this.o.ttlMs).toISOString(),
    };
    this.jobs.set(job.id, job);
    await this.persist(job);
    this.o.log?.('job_submitted', { id: job.id, type: job.type });
    this.pump();
    return { job, duplicate: false };
  }

  /** Owner-scoped read. Returns null for unknown, expired, or other users' jobs (no existence leak). */
  async get(id: string, ownerId: string): Promise<FileJob | null> {
    await this.init();
    const job = ID_RE.test(id) ? this.jobs.get(id) : undefined;
    if (!job || job.ownerId !== ownerId || Date.parse(job.expiresAt) < Date.now()) return null;
    return job;
  }

  /** Backward-compatible alias (no owner check): internal use only. */
  async getJob(id: string): Promise<FileJob | null> {
    await this.init();
    return this.jobs.get(id) ?? null;
  }

  async cancel(id: string, ownerId: string): Promise<FileJob | null> {
    const job = await this.get(id, ownerId);
    if (!job) return null;
    if (job.status === 'queued' || job.status === 'processing') {
      this.running.get(id)?.abort(new Error('cancelled'));
      await this.update(job, { status: 'cancelled', finishedAt: new Date().toISOString(), progress: { stage: 'cancelled', percent: null } });
      this.emitSettled(job);
    }
    return job;
  }

  /** Removes expired jobs. Returns their ids so callers can delete linked artifacts. */
  async purgeExpired(): Promise<string[]> {
    await this.init();
    const removed: string[] = [];
    for (const job of [...this.jobs.values()]) {
      if (Date.parse(job.expiresAt) < Date.now() && job.status !== 'processing') {
        this.jobs.delete(job.id);
        await fs.rm(path.join(this.storagePath, `${job.id}.json`), { force: true });
        removed.push(job.id);
      }
    }
    return removed;
  }

  /** Writes the new state to disk first, then shows it in memory: a reader never sees a state a crash could lose. */
  private async update(job: FileJob, patch: Partial<FileJob>) {
    const next = { ...job, ...patch, updatedAt: new Date().toISOString() };
    await this.persist(next);
    // A cancel (or another final state) recorded while this write was in flight wins over a non-final update.
    const final = (s: JobStatus) => s === 'completed' || s === 'failed' || s === 'cancelled';
    if (final(job.status) && patch.status !== undefined && !final(patch.status)) { await this.persist(job); return; }
    Object.assign(job, next);
  }

  private async persist(job: FileJob): Promise<void> {
    await fs.mkdir(this.storagePath, { recursive: true, mode: 0o700 });
    const file = path.join(this.storagePath, `${job.id}.json`);
    const tmp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(job), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tmp, file);
  }

  private pump() {
    if (this.stopped) return;
    const now = Date.now();
    const ready = [...this.jobs.values()]
      .filter((j) => j.status === 'queued' && !this.running.has(j.id) && (!j.notBefore || Date.parse(j.notBefore) <= now))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    while (this.running.size < this.o.concurrency && ready.length) {
      const job = ready.shift()!;
      void this.run(job);
    }
  }

  private async run(job: FileJob) {
    const handler = this.handlers.get(job.type);
    const controller = new AbortController();
    this.running.set(job.id, controller);
    const timer = setTimeout(() => controller.abort(new JobError('DEADLINE_EXCEEDED', 'The job took too long and was stopped.')), this.o.deadlineMs);
    try {
      if (!handler) throw new JobError('UNKNOWN_JOB_TYPE', `No handler for job type "${job.type}".`);
      await this.update(job, { status: 'processing', attempts: job.attempts + 1, startedAt: new Date().toISOString(), progress: { stage: 'started', percent: 0 }, error: undefined });
      // Cancelled (or stopped) between being picked up and starting: do not start the handler.
      if (controller.signal.aborted || job.status !== 'processing') throw controller.signal.reason ?? new Error('aborted');
      // The race enforces the deadline/cancellation even if a handler ignores its signal.
      const aborted = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
      });
      aborted.catch(() => {});
      const result = await Promise.race([aborted, handler(job, {
        signal: controller.signal,
        attempt: job.attempts,
        progress: async (stage, percent = null) => {
          if (job.status !== 'processing') return;
          await this.update(job, { progress: { stage, percent } });
        },
      })]);
      if (job.status !== 'processing') return; // cancelled while running
      await this.update(job, { status: 'completed', result, finishedAt: new Date().toISOString(), progress: { stage: 'completed', percent: 100 } });
      this.o.log?.('job_completed', { id: job.id, type: job.type, attempts: job.attempts });
      this.emitSettled(job);
    } catch (err) {
      if (job.status === 'cancelled') return;
      const reason = controller.signal.aborted ? controller.signal.reason : err;
      const je = reason instanceof JobError ? reason : null;
      const retryable = !!je?.retryable || (!je && (reason as { exhausted?: boolean })?.exhausted !== true && /timeout|ECONNRESET|fetch failed|busy|rate/i.test(String((reason as Error)?.message)));
      this.o.log?.('job_attempt_failed', { id: job.id, type: job.type, attempt: job.attempts, code: je?.code ?? 'INTERNAL_ERROR', retryable });
      if (this.stopped) {
        await this.update(job, { status: 'queued', progress: { stage: 'interrupted', percent: null } });
      } else if (retryable && job.attempts < job.maxAttempts) {
        await this.update(job, { status: 'queued', notBefore: new Date(Date.now() + this.o.retryDelayMs).toISOString(), progress: { stage: `retrying (attempt ${job.attempts + 1} of ${job.maxAttempts})`, percent: null } });
        const t = setTimeout(() => { this.timers.delete(t); this.pump(); }, this.o.retryDelayMs + 10);
        this.timers.add(t);
      } else {
        await this.update(job, {
          status: 'failed', finishedAt: new Date().toISOString(), progress: { stage: 'failed', percent: null },
          error: je ? { code: je.code, message: je.message } : { code: 'INTERNAL_ERROR', message: 'The job failed unexpectedly. Try again; if it keeps failing, contact support with the job id.' },
        });
        this.emitSettled(job);
      }
    } finally {
      clearTimeout(timer);
      this.running.delete(job.id);
      this.pump();
    }
  }

  /** Client-safe view: no payload internals or owner id. */
  static publicView(job: FileJob) {
    return {
      id: job.id, type: job.type, status: job.status, progress: job.progress, attempts: job.attempts, maxAttempts: job.maxAttempts,
      error: job.error, createdAt: job.createdAt, updatedAt: job.updatedAt, startedAt: job.startedAt, finishedAt: job.finishedAt, expiresAt: job.expiresAt,
    };
  }
}
