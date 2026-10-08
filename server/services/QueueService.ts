import { GradingService } from './GradingService.js';
import fs from 'fs';
import path from 'path';

const JOBS_FILE = path.resolve(process.cwd(), 'exports', 'local-jobs.json');

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
      for (const [id, rec] of Object.entries(parsed)) {
        jobStore.set(id, hydrateJobMethods(rec));
      }
    }
  } catch {}
}

function saveJobsToDisk() {
  try {
    fs.mkdirSync(path.dirname(JOBS_FILE), { recursive: true });
    const serializable: Record<string, any> = {};
    for (const [id, rec] of jobStore.entries()) {
      const { getState, updateProgress, updateData, ...rest } = rec;
      serializable[id] = rest;
    }
    fs.writeFileSync(JOBS_FILE, JSON.stringify(serializable, null, 2), 'utf8');
  } catch {}
}

loadJobsFromDisk();

export class QueueService {
  private static instance: QueueService;
  private isRedisAvailable: boolean = true;

  private constructor() {}

  public static getInstance(): QueueService {
    if (!QueueService.instance) {
      QueueService.instance = new QueueService();
    }
    return QueueService.instance;
  }

  public async initialize() {
    this.isRedisAvailable = true;
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
              providerWarnings: evaluation.providerWarnings,
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
