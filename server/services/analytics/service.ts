import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { FileStore } from '../ai/files/FileStore.js';
import { FileJobQueue, JobError, type FileJob } from '../ai/jobs/fileJobQueue.js';
import type { ProviderAdapter } from '../ai/providers/types.js';
import { analysisRequestSchema, runAnalysis, type AnalysisRequest } from './analyze.js';
import { chartsForAnalysis } from './charts.js';
import { DatasetError, detectFormat, loadDataset, preview, qualityReport, type Dataset } from './dataset.js';
import { renderReportHtml, validateHtmlArtifact, type ReportCitation } from './htmlReport.js';
import { interpretReport } from './narrative.js';
import { buildAnalysisReport } from './reportBuilder.js';

export interface AnalyticsDeps {
  fileStore: FileStore;
  queue: FileJobQueue;
  /** Model used for optional report interpretation; null = deterministic text only. */
  agent?: () => { adapter: ProviderAdapter; model: string; fallbackModel?: string | null } | null;
  /** Strings that must never appear in an artifact (server paths). */
  forbiddenStrings?: string[];
  datasetTtlMs?: number;
  artifactTtlMs?: number;
  syncMaxRows?: number;
}

export const reportRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  researchQuestion: z.string().trim().max(1000).optional(),
  analysis: analysisRequestSchema.optional(),
  interpretation: z.enum(['deterministic', 'ai']).default('deterministic'),
  language: z.enum(['English', 'Kinyarwanda', 'French']).optional(),
  citations: z.array(z.object({
    title: z.string().trim().min(1).max(300), publisher: z.string().trim().max(200).optional(), year: z.union([z.string().max(20), z.number()]).optional(),
    url: z.string().url().max(1000).optional(), locator: z.string().max(200).optional(),
  }).strict()).max(30).optional(),
}).strict();
export type ReportRequest = z.infer<typeof reportRequestSchema>;

interface ReportJobPayload { datasetId: string; request: ReportRequest }

export interface ReportJobResult {
  artifact: { fileId: string; name: string; bytes: number; sha256: string; expiresAt: string };
  analyses: Array<{ id: string; title: string; ok: boolean; error?: string }>;
  charts: Array<{ id: string; ok: boolean; problem?: string }>;
  interpretation: 'ai' | 'deterministic';
  warnings: string[];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'report';

export function createAnalyticsService(deps: AnalyticsDeps) {
  const syncMaxRows = deps.syncMaxRows ?? 50_000;

  async function readDataset(userId: string, datasetId: string, missingValues?: string[]): Promise<Dataset> {
    const { meta, data } = await deps.fileStore.read(datasetId, userId);
    return loadDataset(data, meta.name, meta.mime, { missingValues });
  }

  function profile(datasetId: string, ds: Dataset) {
    return {
      datasetId, name: ds.name, format: ds.format, sha256: ds.sha256, bytes: ds.bytes, rows: ds.rows.length,
      columns: ds.columns, quality: qualityReport(ds), preview: preview(ds),
    };
  }

  async function uploadDataset(userId: string, file: { originalname: string; mimetype?: string; buffer: Buffer }) {
    if (!detectFormat(file.originalname, file.mimetype)) throw new DatasetError('UNSUPPORTED_FORMAT', 'Supported formats: CSV, TSV, XLSX, JSON.');
    const ds = await loadDataset(file.buffer, file.originalname, file.mimetype); // validates before storing
    const meta = await deps.fileStore.put({
      userId, name: ds.name, mime: file.mimetype || 'application/octet-stream', kind: 'spreadsheet', data: file.buffer,
      ttlMs: deps.datasetTtlMs ?? 7 * 24 * 60 * 60 * 1000,
    });
    return { ...profile(meta.id, ds), expiresAt: meta.expiresAt };
  }

  async function analyze(userId: string, datasetId: string, request: AnalysisRequest) {
    const ds = await readDataset(userId, datasetId, request.missingValues);
    if (ds.rows.length > syncMaxRows) throw new JobError('USE_REPORT_JOB', `This dataset has ${ds.rows.length} rows; analyses over ${syncMaxRows} rows run as a background report job.`);
    const analysis = runAnalysis(ds, request);
    const charts = chartsForAnalysis(ds, analysis);
    return { analysis, charts };
  }

  async function runReportJob(job: FileJob<ReportJobPayload>, ctx: { progress: (s: string, p?: number | null) => Promise<void>; signal: AbortSignal }): Promise<ReportJobResult> {
    const { datasetId, request } = job.payload;
    await ctx.progress('loading dataset', 5);
    let ds: Dataset;
    try {
      ds = await readDataset(job.ownerId, datasetId, request.analysis?.missingValues);
    } catch (e) {
      if (e instanceof DatasetError) throw new JobError(e.code, e.message);
      throw new JobError('DATASET_UNAVAILABLE', 'The dataset is no longer available (it may have expired). Upload it again.');
    }
    await ctx.progress('computing statistics', 20);
    const analysis = runAnalysis(ds, request.analysis ?? {});
    const charts = chartsForAnalysis(ds, analysis);
    const report = buildAnalysisReport(analysis, charts, { title: request.title, researchQuestion: request.researchQuestion, citations: request.citations as ReportCitation[] });
    const warnings = [...analysis.warnings];

    let interpretation: ReportJobResult['interpretation'] = 'deterministic';
    if (request.interpretation === 'ai') {
      const agent = deps.agent?.();
      if (!agent) warnings.push('AI interpretation was requested but no agent model is configured; the report uses calculated text only.');
      else {
        await ctx.progress('writing interpretation', 55);
        try {
          const r = await interpretReport(agent.adapter, agent.model, report, { researchQuestion: request.researchQuestion, language: request.language, signal: ctx.signal, fallbackModel: agent.fallbackModel });
          if (r.interpretation) {
            interpretation = 'ai';
            report.summary.push({ text: r.interpretation.summary, kind: 'interpretation' });
            report.conclusion = [{ text: r.interpretation.conclusion, kind: 'interpretation' }];
            report.recommendations = r.interpretation.recommendations;
          } else warnings.push(`AI interpretation was discarded because it contained figures not found in the calculations (${r.rejected.slice(0, 5).join(', ')}).`);
        } catch (e) {
          warnings.push('AI interpretation could not be generated; the report uses calculated text only.');
        }
      }
    }

    await ctx.progress('rendering charts and report', 70);
    const rendered = await renderReportHtml(report);
    const check = validateHtmlArtifact(rendered.html, { forbiddenStrings: deps.forbiddenStrings });
    if (!check.valid) throw new JobError('ARTIFACT_INVALID', `The generated report failed validation: ${check.problems.join('; ')}`);
    await ctx.progress('saving report', 90);
    const name = `${slug(request.title)}.html`;
    const meta = await deps.fileStore.put({
      userId: job.ownerId, name, mime: 'text/html; charset=utf-8', kind: 'document', data: Buffer.from(rendered.html, 'utf8'),
      ttlMs: deps.artifactTtlMs ?? 7 * 24 * 60 * 60 * 1000,
    });
    for (const c of rendered.charts.filter((c) => !c.ok)) warnings.push(`Chart ${c.id} was left out: ${c.problem}`);
    return {
      artifact: { fileId: meta.id, name, bytes: meta.size, sha256: meta.sha256, expiresAt: meta.expiresAt },
      analyses: analysis.results.map((r) => ({ id: r.id, title: r.title, ok: r.ok, error: r.error })),
      charts: rendered.charts, interpretation, warnings,
    };
  }

  deps.queue.register<ReportJobPayload, ReportJobResult>('analytics.report', runReportJob);

  async function submitReport(userId: string, datasetId: string, request: ReportRequest, idempotencyKey?: string) {
    // Fail fast on ownership/availability rather than inside the job.
    await deps.fileStore.read(datasetId, userId);
    const key = idempotencyKey ?? createHash('sha256').update(JSON.stringify({ datasetId, request })).digest('hex').slice(0, 32);
    return deps.queue.submit<ReportJobPayload>({ type: 'analytics.report', ownerId: userId, payload: { datasetId, request }, idempotencyKey: key });
  }

  return { uploadDataset, readDataset, profile, analyze, submitReport, runReportJob };
}

export type AnalyticsService = ReturnType<typeof createAnalyticsService>;
