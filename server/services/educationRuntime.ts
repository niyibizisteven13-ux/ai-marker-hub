import path from 'node:path';
import { agentTarget, fileJobQueue, fileStore } from './AiService.js';
import { createAnalyticsService } from './analytics/service.js';
import { createAssessmentService, type AssessmentRecord } from './assessment/service.js';
import { OwnedRecordStore } from './storage/ownedRecordStore.js';
import logger from '../utils/logger.js';

/** Wires the statistics/report and assessment services to the shared file store, job queue and agent model. */

const forbiddenStrings = [process.cwd(), path.resolve(process.env.FILE_STORE_DIR ?? './data/generated'), path.resolve(process.env.JOBS_DIR ?? './data/jobs')];

export const analyticsService = createAnalyticsService({
  fileStore, queue: fileJobQueue, forbiddenStrings,
  agent: () => {
    const a = agentTarget();
    return { adapter: a.adapter, model: a.model, fallbackModel: a.fallbackModel };
  },
});

export const assessmentStore = new OwnedRecordStore<AssessmentRecord>(process.env.ASSESSMENTS_DIR ?? './data/assessments');

export const assessmentService = createAssessmentService({
  fileStore, queue: fileJobQueue, store: assessmentStore, forbiddenStrings,
  agent: () => {
    const a = agentTarget();
    return { adapter: a.adapter, model: a.model, fallbackModel: a.fallbackModel };
  },
});

let started = false;

/** Recovers persisted jobs and schedules cleanup of expired jobs, files and assessments. */
export async function startEducationRuntime(): Promise<void> {
  if (started) return;
  started = true;
  await fileJobQueue.init();
  const sweep = async () => {
    try {
      const [jobs, files, assessments] = await Promise.all([fileJobQueue.purgeExpired(), fileStore.purgeExpired(), assessmentStore.purgeExpired()]);
      if (jobs.length || files || assessments) logger.info('[cleanup] expired items removed', { jobs: jobs.length, files, assessments });
    } catch (err) {
      logger.warn('[cleanup] sweep failed', { errorType: (err as Error)?.name });
    }
  };
  void sweep();
  setInterval(sweep, 60 * 60 * 1000).unref();
}
