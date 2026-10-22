import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface FileJob {
  id: string;
  userId: string;
  filePath: string;
  status: JobStatus;
  progress: number; // 0-100
  result?: any;
  error?: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
}

export interface JobQueueOptions {
  storageDir?: string;
}

/**
 * Durable File Job Queue for background document extraction, indexing, and analysis
 * ensuring async processing past synchronous timeouts with state persistence.
 */
export class FileJobQueue {
  private jobs: Map<string, FileJob> = new Map();
  private storagePath: string;

  constructor(opts?: JobQueueOptions) {
    this.storagePath = opts?.storageDir ? path.join(opts.storageDir, 'jobs') : path.join(process.cwd(), 'data', 'jobs');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.storagePath, { recursive: true }).catch(() => {});
  }

  async createJob(userId: string, filePath: string): Promise<FileJob> {
    const id = randomUUID();
    const job: FileJob = {
      id,
      userId,
      filePath,
      status: 'queued',
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      attempts: 0,
    };
    this.jobs.set(id, job);
    await this.persist(job);
    return job;
  }

  async getJob(id: string): Promise<FileJob | null> {
    if (this.jobs.has(id)) {
      return this.jobs.get(id)!;
    }
    try {
      const file = path.join(this.storagePath, `${id}.json`);
      const data = await fs.readFile(file, 'utf-8');
      const job: FileJob = JSON.parse(data);
      this.jobs.set(id, job);
      return job;
    } catch {
      return null;
    }
  }

  async updateJob(id: string, update: Partial<FileJob>): Promise<FileJob | null> {
    const job = await this.getJob(id);
    if (!job) return null;
    Object.assign(job, update, { updatedAt: Date.now() });
    this.jobs.set(id, job);
    await this.persist(job);
    return job;
  }

  private async persist(job: FileJob): Promise<void> {
    await fs.mkdir(this.storagePath, { recursive: true }).catch(() => {});
    const file = path.join(this.storagePath, `${job.id}.json`);
    await fs.writeFile(file, JSON.stringify(job, null, 2), 'utf-8').catch(() => {});
  }
}
