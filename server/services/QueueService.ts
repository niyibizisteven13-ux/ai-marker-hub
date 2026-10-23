import { GradingService } from './GradingService.js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { renameSync } from 'node:fs';

const JOBS_FILE = path.resolve(process.env.QUEUE_SNAPSHOT_FILE ?? path.join(process.cwd(), 'exports', 'local-jobs.json'));

// Persistent local job store — no external Redis or BullMQ connection required
const jobStore = new Map<string, any>();

function hydrateJobMethods(jobRecord: any) {
  jobRecord.getState = async () => jobRecord.state;
  jobRecord.updateProgress = async (p: number) => { jobRecord.progress = p; saveJobsToDisk(); };
  jobRecord.updateData = async (d: any) => { jobRecord.data = d; saveJobsToDisk(); };
  return jobRecord;
}

function loadJobsFromDisk() {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
      let recoveredInterruptedJob = false;
      for (const [id, rec] of Object.entries(parsed)) {
        if ((rec as any)?.state === 'active') {
          (rec as any).state = 'failed';
          (rec as any).failedReason = 'The server restarted while this job was running. Retry the job.';
          recoveredInterruptedJob = true;
        }
        jobStore.set(id, hydrateJobMethods(rec));
      }
      if (recoveredInterruptedJob) saveJobsToDisk();
    }
  } catch (error) {
    console.error('Could not restore local grading jobs from disk.', error instanceof Error ? error.name : 'Error');
  }
}

function saveJobsToDisk() {
  try {
    fs.mkdirSync(path.dirname(JOBS_FILE), { recursive: true });
    const serializable: Record<string, any> = {};
    for (const [id, rec] of jobStore.entries()) {
      const { getState, updateProgress, updateData, ...rest } = rec;
      serializable[id] = rest;
    }
    const temporaryFile = `${JOBS_FILE}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(serializable, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporaryFile, JOBS_FILE);
  } catch (error) {
    console.error('Could not persist local grading jobs.', error instanceof Error ? error.name : 'Error');
  }
}

loadJobsFromDisk();

export class QueueService {
  private static instance: QueueService;
  private isRedisAvailable: boolean = false;

  private constructor() {}

  public static getInstance(): QueueService {
    if (!QueueService.instance) {
      QueueService.instance = new QueueService();
    }
    return QueueService.instance;
  }

  public async initialize() {
    // Jobs are currently executed in this process and snapshotted to local disk.
    // Do not advertise a Redis connection until the queue actually uses Redis.
    this.isRedisAvailable = false;
  }

  public getQueue() {
    return {
      add: (name: string, data: any) => this.addJob(name, data),
      getJob: (jobId: string) => this.getJob(jobId),
      close: () => this.close(),
    };
  }

  public getIsRedisAvailable() {
    return this.isRedisAvailable;
  }

  public async addJob(name: string, data: any) {
    const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const jobRecord: any = {
      id,
      name,
      data,
      progress: 0,
      returnvalue: null,
      failedReason: null,
      state: 'active',
      getState: async () => jobRecord.state,
      updateProgress: async (p: number) => { jobRecord.progress = p; },
      updateData: async (d: any) => { jobRecord.data = d; },
    };
    hydrateJobMethods(jobRecord);
    jobStore.set(id, jobRecord);
    saveJobsToDisk();

    // Execute handler inline asynchronously
    (async () => {
      try {
        if (data?.examPaper && Array.isArray(data?.studentScripts)) {
          const gradingService = GradingService.getInstance();
          const total = data.studentScripts.length;
          const results: any[] = [];
          for (let i = 0; i < total; i++) {
            const script = data.studentScripts[i];
            const evaluation = await gradingService.evaluateStudentScriptWithAI(data.examPaper, script, id);
            results.push({
              studentId: script.studentId,
              markedScript: evaluation.markedScript,
              providers: evaluation.providers,
            });
            jobRecord.progress = Math.round(((i + 1) / total) * 100);
            saveJobsToDisk();
          }
          jobRecord.returnvalue = { success: true, results };
        }
        jobRecord.state = 'completed';
        saveJobsToDisk();
      } catch (err: any) {
        jobRecord.failedReason = err?.message || 'Job failed';
        jobRecord.state = 'failed';
        saveJobsToDisk();
      }
    })();

    return jobRecord;
  }

  public async getJob(jobId: string) {
    return jobStore.get(jobId) || null;
  }

  public async close() {
    jobStore.clear();
  }
}
