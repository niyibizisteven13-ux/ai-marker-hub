import path from 'node:path';
import { agentTarget, fileJobQueue, fileStore } from './AiService.js';
import { createAnalyticsService } from './analytics/service.js';
import { createAssessmentService, type AssessmentRecord } from './assessment/service.js';
import { OwnedRecordStore } from './storage/ownedRecordStore.js';
import { createDocumentService, type DocumentRecord } from './documents/service.js';
import { tesseractOcr } from './documents/ocr.js';
import logger from '../utils/logger.js';

/** Wires the statistics/report and assessment services to the shared file store, job queue and agent model. */

const forbiddenStrings = [process.cwd(), path.resolve(process.env.FILE_STORE_DIR ?? './data/generated'), path.resolve(process.env.JOBS_DIR ?? './data/jobs'), path.resolve(process.env.DOCUMENTS_DIR ?? './data/documents')];

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

export const documentStore = new OwnedRecordStore<DocumentRecord>(process.env.DOCUMENTS_DIR ?? './data/documents');

/**
 * Handwriting recognition needs a vision model: Claude when AI_AGENT_PROVIDER=anthropic, or the Gonka
 * model only if DOC_VISION_GONKA=true says it accepts images. Image requests are only sent to a
 * fallback model that is known to accept images (GONKA_FALLBACK_SUPPORTS_VISION=true).
 */
function visionTarget() {
  const a = agentTarget();
  if (a.provider === 'anthropic') return { adapter: a.adapter, model: a.model, fallbackModel: process.env.GONKA_FALLBACK_SUPPORTS_VISION === 'true' ? undefined : null };
  if (process.env.DOC_VISION_GONKA === 'true') return { adapter: a.adapter, model: process.env.DOC_VISION_MODEL?.trim() || a.model, fallbackModel: null };
  return null;
}

export const documentService = createDocumentService({
  fileStore, queue: fileJobQueue, store: documentStore, forbiddenStrings,
  vision: visionTarget,
  agent: () => {
    const a = agentTarget();
    return { adapter: a.adapter, model: a.model, fallbackModel: a.fallbackModel };
  },
  ocr: process.env.DOC_OCR_CROSSCHECK === 'false' ? undefined : tesseractOcr,
  maxPages: Number(process.env.DOC_MAX_PAGES) > 0 ? Number(process.env.DOC_MAX_PAGES) : 20,
});

let started = false;

/** Recovers persisted jobs and schedules cleanup of expired jobs, files and assessments. */
export async function startEducationRuntime(): Promise<void> {
  if (started) return;
  started = true;
  await fileJobQueue.init();
  const sweep = async () => {
    try {
      const [jobs, files, assessments, documents] = await Promise.all([fileJobQueue.purgeExpired(), fileStore.purgeExpired(), assessmentStore.purgeExpired(), documentStore.purgeExpired()]);
      if (jobs.length || files || assessments || documents) logger.info('[cleanup] expired items removed', { jobs: jobs.length, files, assessments, documents });
    } catch (err) {
      logger.warn('[cleanup] sweep failed', { errorType: (err as Error)?.name });
    }
  };
  void sweep();
  setInterval(sweep, 60 * 60 * 1000).unref();
}
