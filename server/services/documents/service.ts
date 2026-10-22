import { createHash } from 'node:crypto';
import type { FileStore } from '../ai/files/FileStore.js';
import { FileJobQueue, JobError, type FileJob } from '../ai/jobs/fileJobQueue.js';
import { StructuredOutputError } from '../ai/llm/structuredJson.js';
import type { ProviderAdapter } from '../ai/providers/types.js';
import { renderReportHtml, validateHtmlArtifact, type ReportInput, type ReportSection } from '../analytics/htmlReport.js';
import { OwnedRecordStore, type OwnedRecord } from '../storage/ownedRecordStore.js';
import { answerFromDocument } from './ask.js';
import { DocumentInputError, loadPages } from './pages.js';
import { PIPELINE_VERSION, documentText, finalText, processDocument, type DocumentResult } from './pipeline.js';
import type { IndependentOcr } from './verify.js';

export interface DocumentCorrection { elementId: string; text: string; by: string; at: string }

export interface DocumentRecord extends OwnedRecord {
  result: DocumentResult;
  corrections: DocumentCorrection[];
  sourceFileId: string;
  reportFileId?: string;
}

export interface DocumentDeps {
  fileStore: FileStore;
  queue: FileJobQueue;
  store: OwnedRecordStore<DocumentRecord>;
  /** Vision-capable model for recognition, or null when none is configured. */
  vision: () => { adapter: ProviderAdapter; model: string; fallbackModel?: string | null } | null;
  /** Text model for questions (may be the same). */
  agent: () => { adapter: ProviderAdapter; model: string; fallbackModel?: string | null };
  ocr?: IndependentOcr;
  forbiddenStrings?: string[];
  maxPages?: number;
}

interface DocumentJobPayload { sourceFileId: string; name: string; languageHint?: string; forceRecognition?: boolean; crossCheck?: boolean; tiling?: 'auto' | 'always' | 'off'; notifyTelegramChatId?: string }

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function mapAiError(e: unknown): never {
  if (e instanceof DocumentInputError) throw new JobError(e.code, e.message);
  if (e instanceof StructuredOutputError) throw new JobError('RECOGNITION_INVALID_OUTPUT', 'The vision model did not return a valid transcription. Try again.', true);
  const cat = (e as { category?: string })?.category;
  if (cat === 'CONTENT_REFUSED') throw new JobError('CONTENT_REFUSED', 'The AI model declined to process this document.');
  if (cat) throw new JobError(`AI_${cat}`, 'The AI service could not process the document. Try again later.', ['PROVIDER_BUSY', 'RATE_LIMITED', 'PROVIDER_TIMEOUT', 'NETWORK_ERROR'].includes(cat));
  throw e;
}

export function createDocumentService(deps: DocumentDeps) {
  async function buildReport(rec: DocumentRecord): Promise<string> {
    const r = rec.result;
    const sections: ReportSection[] = [];
    for (const p of r.pages) {
      const byId = new Map(p.elements.map((e) => [e.id, e]));
      const ordered = p.readingOrder.length ? p.readingOrder.map((id) => byId.get(id)!).filter(Boolean) : p.elements;
      const images: ReportSection['images'] = [];
      for (const e of ordered.filter((x) => x.needsReview && x.cropFileId).slice(0, 30)) {
        try {
          const { data } = await deps.fileStore.read(e.cropFileId!, rec.ownerId);
          images.push({ dataUrl: `data:image/png;base64,${data.toString('base64')}`, alt: `Original region for ${e.id}`, caption: `${e.id}: read as “${finalText(e, rec.corrections).slice(0, 200)}”. ${e.flags.join(' ')}` });
        } catch { /* crop expired */ }
      }
      sections.push({
        heading: `Page ${p.page}${p.source === 'pdf_text_layer' ? ' (from PDF text layer)' : ''}`,
        paragraphs: [
          ...(p.notes.length ? [{ text: `Page notes: ${p.notes.join(' ')}` }] : []),
          ...ordered.filter((e) => e.type !== 'table').map((e) => ({
            text: `[${e.id} · ${e.type}${e.crossedOut ? ' · crossed out' : ''}${e.needsReview ? ' · CHECK' : ''}] ${finalText(e, rec.corrections)}${e.latex ? `   LaTeX: ${e.latex}${e.checks.latex && !e.checks.latex.valid ? ' (invalid)' : ''}` : ''}${rec.corrections.some((c) => c.elementId === e.id) ? ' (corrected by user)' : ''}`,
            kind: 'source' as const,
          })),
        ],
        tables: ordered.filter((e) => e.table?.length).map((e) => ({ caption: `${e.id} (table${e.needsReview ? ', check' : ''})`, columns: e.table![0].map((h, i) => h || `Column ${i + 1}`), rows: e.table!.slice(1) })),
        images,
      });
    }
    const flagged = r.pages.reduce((a, p) => a + p.elements.filter((e) => e.needsReview).length, 0);
    const report: ReportInput = {
      title: `Transcription: ${r.file.name}`,
      notice: 'AI transcription of a scanned document. Regions marked CHECK may be misread; compare them with the original crops shown.',
      summary: [{ text: `${r.pages.length} page(s), ${r.pages.reduce((a, p) => a + p.elements.length, 0)} elements, ${flagged} flagged for checking, ${rec.corrections.length} corrected by a user.`, kind: 'calculated' }],
      sections,
      limitations: r.limitations,
      reproducibility: {
        engineVersion: `${r.pipelineVersion}${r.model ? ` (model ${r.model})` : ''}`, datasetSha256: r.file.sha256, generatedAt: new Date().toISOString(),
        transformations: r.pages.flatMap((p) => p.transforms.map((t) => `Page ${p.page}: ${t}`)),
        methods: ['Skew estimated with a projection profile over Otsu-thresholded ink pixels.', 'LaTeX checked by parsing with KaTeX.', 'Independent OCR (Tesseract) cross-check on text regions; only confident readings count as evidence.'],
      },
    };
    const { html } = await renderReportHtml(report);
    const check = validateHtmlArtifact(html, { forbiddenStrings: deps.forbiddenStrings });
    if (!check.valid) throw new JobError('ARTIFACT_INVALID', `The transcription report failed validation: ${check.problems.join('; ')}`);
    const meta = await deps.fileStore.put({ userId: rec.ownerId, name: `transcription-${rec.id.slice(0, 8)}.html`, mime: 'text/html; charset=utf-8', kind: 'document', data: Buffer.from(html, 'utf8'), ttlMs: RETENTION_MS });
    return meta.id;
  }

  async function runJob(job: FileJob<DocumentJobPayload>, ctx: { progress: (s: string, p?: number | null) => Promise<void>; signal: AbortSignal }) {
    const p = job.payload;
    let data: Buffer;
    try {
      data = (await deps.fileStore.read(p.sourceFileId, job.ownerId)).data;
    } catch {
      throw new JobError('SOURCE_UNAVAILABLE', 'The uploaded document is no longer available. Upload it again.');
    }
    const vision = deps.vision();
    if (!vision) throw new JobError('VISION_MODEL_UNAVAILABLE', 'No vision-capable model is configured for handwriting recognition.');
    let result: DocumentResult;
    try {
      result = await processDocument(data, p.name, {
        adapter: vision.adapter, model: vision.model, fallbackModel: vision.fallbackModel, ocr: deps.ocr,
        storeCrop: async (png, name) => (await deps.fileStore.put({ userId: job.ownerId, name, mime: 'image/png', kind: 'image', data: png, ttlMs: RETENTION_MS })).id,
      }, { languageHint: p.languageHint, forceRecognition: p.forceRecognition, crossCheck: p.crossCheck, tiling: p.tiling, maxPages: deps.maxPages, signal: ctx.signal, progress: ctx.progress });
    } catch (e) {
      mapAiError(e);
    }
    await ctx.progress('saving', 95);
    // Keyed by job id: a re-run after a crash replaces this record instead of duplicating it.
    const rec = await deps.store.put(job.id, job.ownerId, { result: result!, corrections: [], sourceFileId: p.sourceFileId } as Omit<DocumentRecord, keyof OwnedRecord>);
    const reportFileId = await buildReport(rec);
    await deps.store.update(rec.id, job.ownerId, (r) => { r.reportFileId = reportFileId; });
    return { documentId: rec.id, reportFileId, pages: result!.pages.length, needsReview: result!.needsReview, usage: result!.usage };
  }

  deps.queue.register<DocumentJobPayload, unknown>('document.process', runJob);

  async function submit(userId: string, file: { originalname: string; mimetype?: string; buffer: Buffer }, opts: { languageHint?: string; forceRecognition?: boolean; crossCheck?: boolean; tiling?: 'auto' | 'always' | 'off'; notifyTelegramChatId?: string }) {
    if (!deps.vision()) throw new JobError('VISION_MODEL_UNAVAILABLE', 'Handwriting recognition needs a vision-capable model. Set AI_AGENT_PROVIDER=anthropic (Claude) or DOC_VISION_GONKA=true if your Gonka model accepts images.');
    // Validate format and page count before queueing.
    try {
      await loadPages(file.buffer, file.originalname, { maxPages: deps.maxPages });
    } catch (e) {
      if (e instanceof DocumentInputError) throw new JobError(e.code, e.message);
      throw e;
    }
    const sha = createHash('sha256').update(file.buffer).digest('hex');
    const isPdf = file.buffer.subarray(0, 5).toString('latin1') === '%PDF-';
    const meta = await deps.fileStore.put({ userId, name: file.originalname.replace(/[^\w.\- ]/g, '_').slice(0, 120) || 'upload', mime: isPdf ? 'application/pdf' : (file.mimetype || 'application/octet-stream'), kind: isPdf ? 'pdf' : 'image', data: file.buffer, ttlMs: RETENTION_MS });
    const res = await deps.queue.submit<DocumentJobPayload>({
      type: 'document.process', ownerId: userId,
      // Same owner + same content hash + same options = same job (the queue scopes keys to the owner).
      idempotencyKey: createHash('sha256').update(JSON.stringify({ sha, opts: { ...opts, notifyTelegramChatId: undefined } })).digest('hex').slice(0, 32),
      payload: { sourceFileId: meta.id, name: file.originalname, ...opts },
    });
    if (res.duplicate) await deps.fileStore.delete(meta.id, userId).catch(() => {});
    return res;
  }

  /**
   * Recognition for another workflow (exam marking), run inside that workflow's own job. The record id is
   * derived from owner + content hash + pipeline version + settings, so an unchanged script is never
   * recognised twice and a retried job overwrites its own record.
   */
  async function recognizeCached(userId: string, file: { buffer: Buffer; name: string; sourceFileId?: string }, opts: { languageHint?: string; tiling?: 'auto' | 'always' | 'off'; crossCheck?: boolean }, ctx: { signal?: AbortSignal; progress?: (stage: string, percent: number) => Promise<void> } = {}) {
    const sha = createHash('sha256').update(file.buffer).digest('hex');
    const key = createHash('sha256').update(JSON.stringify({ userId, sha, v: PIPELINE_VERSION, opts: { languageHint: opts.languageHint ?? null, tiling: opts.tiling ?? null, crossCheck: opts.crossCheck ?? null } })).digest('hex');
    const id = `${key.slice(0, 8)}-${key.slice(8, 12)}-4${key.slice(13, 16)}-8${key.slice(17, 20)}-${key.slice(20, 32)}`;
    const existing = await deps.store.get(id, userId);
    if (existing) return { record: existing, cached: true, key };
    const vision = deps.vision();
    if (!vision) throw new JobError('VISION_MODEL_UNAVAILABLE', 'No vision-capable model is configured for handwriting recognition.');
    let result: DocumentResult;
    try {
      result = await processDocument(file.buffer, file.name, {
        adapter: vision.adapter, model: vision.model, fallbackModel: vision.fallbackModel, ocr: deps.ocr,
        storeCrop: async (png, name) => (await deps.fileStore.put({ userId, name, mime: 'image/png', kind: 'image', data: png, ttlMs: RETENTION_MS })).id,
      }, { ...opts, maxPages: deps.maxPages, signal: ctx.signal, progress: ctx.progress });
    } catch (e) {
      mapAiError(e);
    }
    const sourceFileId = file.sourceFileId ?? (await deps.fileStore.put({ userId, name: file.name.replace(/[^\w.\- ]/g, '_').slice(0, 120) || 'upload', mime: 'application/octet-stream', kind: 'document', data: file.buffer, ttlMs: RETENTION_MS })).id;
    const record = await deps.store.put(id, userId, { result: result!, corrections: [], sourceFileId } as Omit<DocumentRecord, keyof OwnedRecord>);
    return { record, cached: false, key };
  }

  async function get(userId: string, id: string) {
    return deps.store.get(id, userId);
  }

  async function correct(userId: string, id: string, input: { elementId: string; text: string }) {
    const rec = await deps.store.get(id, userId);
    if (!rec) return null;
    if (!rec.result.pages.some((p) => p.elements.some((e) => e.id === input.elementId))) throw new JobError('UNKNOWN_ELEMENT', `No element "${input.elementId}" in this document.`);
    const updated = await deps.store.update(id, userId, (r) => { r.corrections.push({ elementId: input.elementId, text: input.text.slice(0, 5000), by: userId, at: new Date().toISOString() }); });
    const reportFileId = await buildReport(updated!);
    return deps.store.update(id, userId, (r) => { r.reportFileId = reportFileId; });
  }

  async function ask(userId: string, id: string, question: string, language?: string, signal?: AbortSignal, supportCheck = true) {
    const rec = await deps.store.get(id, userId);
    if (!rec) return null;
    const agent = deps.agent();
    try {
      return await answerFromDocument(agent.adapter, agent.model, rec.result, rec.corrections, question, { language, signal, fallbackModel: agent.fallbackModel, supportCheck });
    } catch (e) {
      mapAiError(e);
    }
  }

  async function text(userId: string, id: string) {
    const rec = await deps.store.get(id, userId);
    return rec ? documentText(rec.result, rec.corrections) : null;
  }

  return { submit, get, correct, ask, text, runJob, buildReport, recognizeCached };
}

export type DocumentService = ReturnType<typeof createDocumentService>;
