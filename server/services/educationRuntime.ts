import { FileJobQueue, JobError } from './ai/jobs/fileJobQueue.js';
import { isOvernight } from './ai/batchMode.js';
import path from 'node:path';
import { agentTarget, fileJobQueue, fileStore, markingTarget } from './AiService.js';
import { createAnalyticsService } from './analytics/service.js';
import { createAssessmentService, type AssessmentRecord } from './assessment/service.js';
import { OwnedRecordStore } from './storage/ownedRecordStore.js';
import { createDocumentService, type DocumentRecord } from './documents/service.js';
import { tesseractOcr } from './documents/ocr.js';
import { createTelegramTranscriber, type TelegramTransport } from './documents/telegramTranscribe.js';
import { createExamService } from './exams/service.js';
import { createExamChat, type ExamChatContext } from './exams/chat.js';
import type { ExamRecord } from './exams/types.js';
import { createKnowledgeService } from './knowledge/service.js';
import { EmbeddingService } from './EmbeddingService.js';
import { createOutputService } from './outputs/service.js';
import logger from '../utils/logger.js';
import { markingLimits } from './exams/limits.js';
import { recordUsage, checkUsage } from './billing/usage.js';
import { isPrimary } from '../utils/cluster.js';
import { canUseAutonomousMarking } from './billing/entitlements.js';

/** Wires the statistics/report and assessment services to the shared file store, job queue and agent model. */

const forbiddenStrings = [process.cwd(), path.resolve(process.env.FILE_STORE_DIR ?? './data/generated'), path.resolve(process.env.JOBS_DIR ?? './data/jobs'), path.resolve(process.env.DOCUMENTS_DIR ?? './data/documents'), path.resolve(process.env.EXAMS_DIR ?? './data/exams')];

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
  // Handwriting is read by the marking model (CLAUDE_MARKING_MODEL), the same one that marks it.
  const a = markingTarget();
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

const EXAM_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const examStore = new OwnedRecordStore<ExamRecord>(process.env.EXAMS_DIR ?? './data/exams', EXAM_RETENTION_MS);
export const examChatContexts = new OwnedRecordStore<ExamChatContext>(path.join(process.env.EXAMS_DIR ?? './data/exams', 'chat'), EXAM_RETENTION_MS);
const num = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d);

/**
 * Overnight marking runs: Claude requests sent as half-price batches that can take hours, so they run on their
 * own queue with a long deadline and never hold the slots of live jobs. Only with Claude as the marking model.
 */
export const overnightJobQueue = markingTarget().provider === 'anthropic' && process.env.OVERNIGHT_MARKING !== 'false'
  ? new FileJobQueue({
    storageDir: process.env.OVERNIGHT_JOBS_DIR ?? './data/jobs-overnight',
    concurrency: num(process.env.OVERNIGHT_JOBS_CONCURRENCY, 6),
    maxActivePerUser: 3,
    maxAttempts: 3,
    deadlineMs: 26 * 3600_000,
  })
  : undefined;

export const examService = createExamService({
  fileStore, queue: fileJobQueue, overnightQueue: overnightJobQueue, store: examStore, documents: documentService, forbiddenStrings,
  agent: () => {
    const a = markingTarget();
    return { adapter: a.adapter, model: a.model, fallbackModel: a.fallbackModel };
  },
  visionAvailable: () => visionTarget() !== null,
  // Upgraded plans only, counted against the plan's daily marking limit (see billing/entitlements.ts).
  entitlement: canUseAutonomousMarking,
  maxPages: markingLimits.maxPagesPerPaper,
  maxCandidates: markingLimits.maxCandidates,
  maxBatchPages: markingLimits.maxBatchPages,
  visualEvidence: visionTarget() !== null,
  beforeAi: async userId => {
    const gate = await checkUsage(userId, { kind: 'marking' });
    if (!gate.allowed) throw new JobError('MARKING_LIMIT', gate.message || 'Marking allowance exceeded.');
  },
  candidateConcurrency: num(process.env.EXAM_CANDIDATE_CONCURRENCY, 4),
  segmentBudgetMs: num(process.env.EXAM_SEGMENT_BUDGET_MS, 8 * 60 * 1000),
  // Every marked script is charged in credits (at least 2) and counted in the AI cost the profit guard watches.
  // Overnight scripts went through the batch API: half the cost, half the credits.
  onUsage: (userId, u) => { const batch = !!u.batch || isOvernight(); void recordUsage(userId, { kind: 'marking', model: u.model, inputTokens: u.input, outputTokens: u.output, minCredits: u.what === 'mark' && !batch ? 2 : 1, batch }); },
});

export const examChat = createExamChat({
  service: examService, fileStore, queue: fileJobQueue, contexts: examChatContexts,
  agent: () => {
    const a = markingTarget();
    return { adapter: a.adapter, model: a.model, fallbackModel: a.fallbackModel };
  },
  waitMs: num(process.env.EXAM_CHAT_WAIT_MS, 15 * 60_000),
});

/** Knowledge repositories: file explorer whose files are indexed into the existing knowledge bases. */
export const knowledgeService = createKnowledgeService({
  fileStore, queue: fileJobQueue,
  embedder: EmbeddingService.getInstance(),
  ocr: process.env.KNOWLEDGE_OCR === 'false' ? undefined : tesseractOcr,
});

/** Universal output engine: validated specs → charts, widgets, reports, documents, analyses (see docs/OUTPUT_ENGINE.md). */
export const outputService = createOutputService({
  fileStore, queue: fileJobQueue, forbiddenStrings,
  readDataset: (userId, id) => analyticsService.readDataset(userId, id),
  readRepositoryFile: async (userId, id) => {
    const limit = num(process.env.ANALYSIS_MAX_INPUT_BYTES, 50 * 1024 * 1024);
    // Published datasets are analysable by every user's assistant; private ones only by their owners.
    const { file, stream } = await knowledgeService.openForAnalysis(userId, id);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of stream as AsyncIterable<Buffer>) {
      size += c.length;
      if (size > limit) { (stream as any).destroy?.(); throw new Error(`The file is larger than ${Math.round(limit / 1048576)} MB.`); }
      chunks.push(c);
    }
    return { name: file.name, data: Buffer.concat(chunks) };
  },
});

let started = false;

/** Recovers persisted jobs and schedules cleanup of expired jobs, files and assessments. */
export async function startEducationRuntime(): Promise<void> {
  if (started) return;
  started = true;
  await fileJobQueue.init();
  await overnightJobQueue?.init();
  // Each server cleans its own job queue; the shared folders (files, exams, documents) are cleaned by the
  // primary server only, so several servers never delete the same files at once.
  const shared = isPrimary();
  const none = async () => 0 as any;
  const sweep = async () => {
    try {
      const [jobs, files, assessments, documents, exams, examContexts] = await Promise.all([Promise.all([fileJobQueue.purgeExpired(), overnightJobQueue?.purgeExpired() ?? []]).then(([a, b]) => [...a, ...b]), shared ? fileStore.purgeExpired() : none(), shared ? assessmentStore.purgeExpired() : none(), shared ? documentStore.purgeExpired() : none(), shared ? examStore.purgeExpired() : none(), shared ? examChatContexts.purgeExpired() : none()]);
      if (jobs.length || files || assessments || documents || exams || examContexts) logger.info('[cleanup] expired items removed', { jobs: jobs.length, files, assessments, documents, exams, examContexts });
    } catch (err) {
      logger.warn('[cleanup] sweep failed', { errorType: (err as Error)?.name });
    }
  };
  // Re-queue repository files left waiting (restart, job limit) and fill missing embeddings.
  const resume = () => knowledgeService.resumePending().then((r) => { if (r.queued) logger.info('[knowledge] resumed pending indexing', r); }).catch((err) => logger.warn('[knowledge] resume failed', { errorType: (err as Error)?.name }));
  void sweep();
  if (shared) void resume();
  setInterval(() => { void sweep(); if (shared) void resume(); }, 60 * 60 * 1000).unref();
}

let telegramTranscriber: ReturnType<typeof createTelegramTranscriber> | null = null;

/** Telegram front end for /api/documents; registers the completion notifier once. */
export function getTelegramTranscriber(bot: TelegramTransport) {
  if (!telegramTranscriber) {
    telegramTranscriber = createTelegramTranscriber({ bot, documents: documentService, queue: fileJobQueue, fileStore, baseUrl: process.env.APP_BASE_URL || process.env.APP_URL || 'https://www.bwenge.space' });
    telegramTranscriber.register();
  }
  return telegramTranscriber;
}
