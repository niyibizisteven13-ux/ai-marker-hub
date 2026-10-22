import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { prisma } from '../../db.js';
import { svgToPng } from '../ai/drawing/rasterize.js';
import { renderDiagram, type DiagramSpec } from '../ai/drawing/diagram.js';
import { sanitizeSvg } from '../ai/drawing/svgSanitizer.js';
import type { FileStore } from '../ai/files/FileStore.js';
import { FileJobQueue, JobError, type FileJob, type JobContext } from '../ai/jobs/fileJobQueue.js';
import type { AttachmentKind, AttachmentRef } from '../ai/types.js';
import { loadDataset, type Dataset } from '../analytics/dataset.js';
import { AnalysisInputError, analyzeDataset, type AnalysisReport } from './analysis.js';
import { makeResponsive, renderChartSvg } from './charts.js';
import { renderDocument, renderTemplate, verifyFile, type Resolved } from './documents.js';
import { chartWidget, reportHtml, tableWidget, validateSelfContainedHtml, kpisHtml, page, textHtml, tableHtml, heroHtml, THEMES } from './html.js';
import { renderMap } from './map.js';
import { parseMermaid } from './mermaid.js';
import { SpecError, validateSpec, type ChartConfig, type OutputSpec } from './spec.js';
import { analysisTables, captionOf, resultRecords, tableMarkdown, type DisplayTable, type Row } from './tables.js';
import { PythonRunError } from './pythonRunner.js';
type Kpi = { label: string; value: number | string; unit?: string; note?: string };

/**
 * Generated artifacts: one validated spec → one owned, revisioned, persistent artifact.
 * - Identical requests from the same user return the same artifact (idempotency key over the spec).
 * - Expensive kinds (analysis, templates, reports, documents) render in background jobs; failures can be
 *   retried on the same row, so retries never duplicate artifacts.
 * - Sources (datasets, repository files, uploads, earlier analyses) are authorised before use.
 * - Files are verified (real XLSX/DOCX/PPTX/PDF, safe SVG, validated self-contained HTML) before storage.
 */

export class OutputError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) {
    super(message);
  }
}

export interface OutputDeps {
  fileStore: FileStore;
  queue: FileJobQueue;
  /** Owned analytics dataset (existing /api/analytics datasets). */
  readDataset?: (userId: string, id: string) => Promise<Dataset>;
  /** Repository file the user may access (knowledge repositories): name + bytes. */
  readRepositoryFile?: (userId: string, id: string) => Promise<{ name: string; data: Buffer }>;
  /** Image generation, only when configured. */
  generateImage?: (prompt: string) => Promise<Buffer>;
  forbiddenStrings?: string[];
}

const db = prisma as any;
const KEEP = 100 * 365 * 24 * 60 * 60 * 1000;
const LINK_TTL = 7 * 24 * 60 * 60 * 1000;
const ASYNC = new Set(['analysis', 'template', 'report', 'document']);
const FORMAT: Record<string, string> = { answer: 'json', chart: 'svg', widget: 'html', report: 'html', diagram: 'svg', map: 'svg', image: 'png', analysis: 'json' };
const MIME: Record<string, string> = { json: 'application/json', svg: 'image/svg+xml', html: 'text/html; charset=utf-8', png: 'image/png', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pdf: 'application/pdf' };
const KIND: Record<string, AttachmentKind> = { json: 'code', svg: 'chart', html: 'document', png: 'image', xlsx: 'spreadsheet', docx: 'document', pptx: 'presentation', pdf: 'pdf' };

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as any)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const formatOf = (s: OutputSpec) => (s.kind === 'document' ? s.format : s.kind === 'template' ? ({ statistical_report: 'docx', briefing_deck: 'pptx', data_workbook: 'xlsx' } as const)[s.template] : FORMAT[s.kind]);

export function createOutputService(deps: OutputDeps) {
  async function orgIdsOf(userId: string): Promise<string[]> {
    return (await db.organizationMember.findMany({ where: { userId }, select: { organizationId: true } })).map((r: any) => r.organizationId);
  }

  /** Artifact the user may read: owner, organisation members when shared with the organisation, or a valid link token. */
  async function readable(userId: string, id: string, token?: string) {
    const a = typeof id === 'string' ? await db.generatedArtifact.findUnique({ where: { id } }) : null;
    if (!a) throw new OutputError('NOT_FOUND', 'Artifact not found.', 404);
    if (a.userId === userId) return a;
    if (a.shareMode === 'organization' && a.organizationId && (await orgIdsOf(userId)).includes(a.organizationId)) return a;
    if (a.shareMode === 'link' && token && a.shareTokenHash === sha(token) && (!a.shareExpiresAt || new Date(a.shareExpiresAt) > new Date())) return a;
    throw new OutputError('NOT_FOUND', 'Artifact not found.', 404);
  }
  async function owned(userId: string, id: string) {
    const a = typeof id === 'string' ? await db.generatedArtifact.findUnique({ where: { id } }) : null;
    if (!a || a.userId !== userId) throw new OutputError('NOT_FOUND', 'Artifact not found.', 404);
    return a;
  }

  // ── Sources ────────────────────────────────────────────────────────────────
  async function loadSource(userId: string, ref: { type?: string; id?: string }): Promise<{ ds: Dataset; label: string; sha256?: string }> {
    try {
      if (ref.type === 'dataset') {
        if (!deps.readDataset) throw new OutputError('SOURCE_UNAVAILABLE', 'Datasets are not available.', 400);
        const ds = await deps.readDataset(userId, ref.id);
        return { ds, label: ds.name, sha256: ds.sha256 };
      }
      if (ref.type === 'repository_file') {
        if (!deps.readRepositoryFile) throw new OutputError('SOURCE_UNAVAILABLE', 'Repository files are not available.', 400);
        const f = await deps.readRepositoryFile(userId, ref.id);
        const ds = await loadDataset(f.data, f.name);
        return { ds, label: f.name, sha256: ds.sha256 };
      }
      if (ref.type === 'file') {
        // Chat attachment or earlier generated file in the owner-checked file store.
        const { meta, data } = await deps.fileStore.read(ref.id, userId);
        const ds = await loadDataset(data, meta.name, meta.mime);
        return { ds, label: meta.name, sha256: ds.sha256 };
      }
      if (ref.type === 'upload') {
        const rec = await db.fileRecord.findFirst({ where: { id: ref.id, userId } });
        if (!rec?.path) throw new OutputError('NOT_FOUND', 'Upload not found.', 404);
        const ds = await loadDataset(await readFile(rec.path), rec.name, rec.mimeType);
        return { ds, label: rec.name, sha256: ds.sha256 };
      }
    } catch (e) {
      if (e instanceof OutputError) throw e;
      if ((e as any)?.name === 'DatasetError' || (e as any)?.constructor?.name === 'DatasetError') throw new OutputError('INVALID_DATASET', (e as Error).message, 422);
      throw new OutputError('SOURCE_NOT_FOUND', 'The source does not exist or you do not have access to it.', 404);
    }
    throw new OutputError('INVALID_SOURCE', `Unsupported source type "${ref.type}".`, 400);
  }

  async function analysisOf(userId: string, artifactId: string): Promise<AnalysisReport> {
    const a = await readable(userId, artifactId).catch(() => { throw new OutputError('SOURCE_NOT_FOUND', `Analysis ${artifactId} does not exist or you do not have access to it.`, 404); });
    if (a.kind !== 'analysis') throw new OutputError('INVALID_SOURCE', `Artifact ${artifactId} is not an analysis.`, 400);
    if (a.status !== 'ready' || !a.fileId) throw new OutputError('NOT_READY', `Analysis ${artifactId} is ${a.status}.`, 409);
    const { data } = await deps.fileStore.read(a.fileId, a.userId);
    return JSON.parse(data.toString('utf8')) as AnalysisReport;
  }

  /** Authorises every artifact referenced by the spec (fromAnalysis, templates, report appendices). */
  async function referencedAnalyses(userId: string, spec: OutputSpec): Promise<Map<string, AnalysisReport>> {
    const ids = new Set<string>();
    JSON.stringify(spec, (k, v) => { if (k === 'fromAnalysis' && v?.artifactId) ids.add(v.artifactId); return v; });
    if (spec.kind === 'template') ids.add(spec.analysisArtifactId);
    if (spec.kind === 'report') for (const id of spec.analysisArtifactIds ?? []) ids.add(id);
    const out = new Map<string, AnalysisReport>();
    for (const id of ids) out.set(id, await analysisOf(userId, id));
    return out;
  }

  function resolver(analyses: Map<string, AnalysisReport>): Resolved {
    const fromA = (ref: { artifactId?: string; result?: number }) => {
      const rep = analyses.get(ref.artifactId)!;
      const r = rep.results[ref.result];
      if (!r) throw new OutputError('INVALID_SPEC', `Analysis ${ref.artifactId} has no result ${ref.result}.`, 422);
      if (r.error) throw new OutputError('INVALID_SPEC', `Result ${ref.result} was not computed: ${r.error}`, 422);
      return { rows: resultRecords(r), r, rep };
    };
    return {
      table: (t) => {
        if (t.fromAnalysis) { const { rows, r, rep } = fromA(t.fromAnalysis); return { caption: t.caption ?? captionOf(r), columns: t.columns.map((c) => ({ ...c, unit: c.unit ?? rep.units[c.key] })) as DisplayTable['columns'], rows, note: r.interpretation }; }
        return { caption: t.caption ?? '', columns: t.columns as DisplayTable['columns'], rows: (t.rows ?? []) as Row[] };
      },
      chartRows: (c) => {
        const rows = c.fromAnalysis ? fromA(c.fromAnalysis).rows : (c.data ?? []) as Row[];
        for (const f of [c.x.field, c.y?.field, c.color?.field].filter(Boolean) as string[]) if (rows.length && !rows.some((r) => f in r)) throw new OutputError('INVALID_SPEC', `Chart field "${f}" is not in the data. Available: ${Object.keys(rows[0]).join(', ')}.`, 422);
        return rows;
      },
    };
  }

  // ── Rendering ──────────────────────────────────────────────────────────────
  async function render(a: any, signal?: AbortSignal): Promise<{ data: Buffer; format: string; preview?: Buffer; warnings: string[]; summary?: unknown }> {
    const spec = validateSpec(a.spec);
    const analyses = await referencedAnalyses(a.userId, spec);
    const res = resolver(analyses);
    const warnings: string[] = [];
    const sources = spec.sources.map((s) => ({ label: s.label, type: s.type }));
    const svgOut = (svg: string) => ({ data: Buffer.from(svg), format: 'svg', preview: svgToPng(svg, { width: 1400 }).data, warnings });
    const htmlOut = (html: string) => {
      const v = validateSelfContainedHtml(html, deps.forbiddenStrings);
      if (!v.valid) throw new OutputError('ARTIFACT_INVALID', `The HTML failed validation: ${v.problems.join('; ')}`, 500);
      return { data: Buffer.from(html), format: 'html', warnings };
    };
    switch (spec.kind) {
      case 'answer': return { data: Buffer.from(JSON.stringify({ text: spec.text, table: spec.table ? res.table(spec.table) : null, sources: spec.sources })), format: 'json', warnings };
      case 'chart': return svgOut(await renderChartSvg(spec.chart, spec.title, res.chartRows(spec.chart)));
      case 'diagram': {
        const g = spec.mermaid ? parseMermaid(spec.mermaid, spec.title) : { title: spec.title, ...spec.graph! };
        if ((g as any).warnings) warnings.push(...(g as any).warnings);
        return svgOut(makeResponsive(sanitizeSvg(renderDiagram(g as DiagramSpec))));
      }
      case 'map': {
        const m = renderMap({ title: spec.title, sourceNote: spec.sourceNote, geojson: spec.geojson as any, points: spec.points as Array<{ lat: number; lon: number; label?: string; value?: number }>, valueField: spec.valueField, labelField: spec.labelField, unit: spec.unit });
        warnings.push(...m.warnings);
        return svgOut(sanitizeSvg(m.svg));
      }
      case 'widget': {
        const w = spec.widget;
        const look = { theme: spec.theme, subtitle: spec.subtitle };
        if (w.type === 'table_explorer') return htmlOut(tableWidget(spec.title, res.table(w.table), sources, look));
        if (w.type === 'chart_explorer') { const rows = res.chartRows(w.chart); return htmlOut(chartWidget(spec.title, w.chart, rows, await renderChartSvg(w.chart, spec.title, rows, THEMES[spec.theme ?? 'ocean'].pal), sources, look)); }
        return htmlOut(page(spec.title, `${heroHtml('Key figures', spec.title, spec.subtitle)}${kpisHtml(w.kpis as Kpi[])}`, { theme: spec.theme }));
      }
      case 'report': {
        const sections = [];
        for (const s of spec.sections) sections.push({ heading: s.heading, text: s.text, table: s.table ? res.table(s.table) : undefined, chartSvg: s.chart ? await renderChartSvg(s.chart, s.heading, res.chartRows(s.chart), THEMES[spec.theme ?? 'ocean'].pal) : undefined });
        const appendix = [...analyses.values()].map((rep) => ({ methodology: rep.methodology, assumptions: rep.assumptions, limitations: rep.limitations, engine: rep.engine.name, isolation: rep.isolation ? `isolated subprocess${rep.isolation.networkNamespace ? ', no network' : ''}` : undefined, rows: `${rep.source.label}: ${rep.rowsIn} rows${rep.rowsAnalysed !== rep.rowsIn ? `, ${rep.rowsAnalysed} after filters` : ''}.`, filters: rep.filters.map((f) => `${f.column} ${f.op} ${JSON.stringify(f.value)}`) }));
        return htmlOut(reportHtml({ title: spec.title, layout: spec.layout, theme: spec.theme, subtitle: spec.subtitle, summary: spec.summary, kpis: spec.kpis as Kpi[], sections, sources, appendix, meta: { generatedAt: new Date().toISOString(), revision: a.revision, artifactId: a.id } }));
      }
      case 'document': return { data: await renderDocument(spec, res), format: spec.format, warnings };
      case 'template': { const t = await renderTemplate(spec, analyses.get(spec.analysisArtifactId)!); return { data: t.data, format: t.format, warnings: t.warnings }; }
      case 'image': {
        if (!deps.generateImage) throw new OutputError('IMAGE_UNAVAILABLE', 'Image generation is not configured on this server (ENABLE_AGENT_IMAGE_GENERATION). Use a diagram, chart or SVG drawing instead.', 501);
        return { data: await deps.generateImage(spec.prompt), format: 'png', warnings };
      }
      case 'analysis': {
        const src = await loadSource(a.userId, spec.dataset);
        let rep: AnalysisReport;
        try {
          rep = await analyzeDataset(src.ds, { type: spec.dataset.type, id: spec.dataset.id, label: src.label, sha256: src.sha256 }, spec.analysis, { signal });
        } catch (e) {
          if (e instanceof AnalysisInputError) throw new OutputError('INVALID_ANALYSIS', `${e.message}${e.problems.length ? ` ${e.problems.join(' ')}` : ''}`, 422, e.problems);
          if (e instanceof PythonRunError) throw new OutputError(`ANALYSIS_${e.code}`, e.message, e.code === 'TIMEOUT' ? 504 : 500);
          throw e;
        }
        return { data: Buffer.from(JSON.stringify(rep)), format: 'json', warnings: rep.limitations.slice(0, 20), summary: { tables: analysisTables(rep).length, engine: rep.engine.kind } };
      }
    }
  }

  async function renderAndStore(id: string, signal?: AbortSignal) {
    const a = await db.generatedArtifact.findUnique({ where: { id } });
    if (!a) return null;
    if (a.status === 'ready' && a.fileId) return a; // a retried job never renders twice
    await db.generatedArtifact.update({ where: { id }, data: { status: 'generating', error: null } });
    try {
      const out = await render(a, signal);
      const problem = await verifyFile(out.format, out.data);
      if (problem) throw new OutputError('ARTIFACT_INVALID', `The generated file is not valid (${problem}).`, 500);
      const name = `${a.title.replace(/[^\w.\- ]+/g, '_').trim().slice(0, 80) || 'output'}.${out.format}`;
      const meta = await deps.fileStore.put({ userId: a.userId, name, mime: MIME[out.format] ?? 'application/octet-stream', kind: KIND[out.format] ?? 'document', data: out.data, ttlMs: KEEP });
      const preview = out.preview ? await deps.fileStore.put({ userId: a.userId, name: name.replace(/\.\w+$/, '-preview.png'), mime: 'image/png', kind: 'image', data: out.preview, ttlMs: KEEP }) : null;
      return db.generatedArtifact.update({ where: { id }, data: { status: 'ready', format: out.format, fileId: meta.id, previewFileId: preview?.id ?? null, sizeBytes: out.data.length, sha256: sha(out.data), warnings: out.warnings, error: null } });
    } catch (e) {
      const msg = e instanceof OutputError || e instanceof SpecError ? e.message : 'The output could not be generated.';
      await db.generatedArtifact.update({ where: { id }, data: { status: 'failed', error: msg.slice(0, 2000) } });
      if (e instanceof OutputError && ['ANALYSIS_TIMEOUT', 'ANALYSIS_CRASHED'].includes(e.code)) throw new JobError(e.code, e.message, false);
      return null;
    }
  }

  deps.queue.register<{ artifactId: string }, unknown>('output.render', async (job: FileJob<{ artifactId: string }>, ctx: JobContext) => {
    await ctx.progress('rendering', 10);
    const a = await renderAndStore(job.payload.artifactId, ctx.signal);
    return { artifactId: job.payload.artifactId, status: a?.status ?? 'failed' };
  });

  // ── Public operations ──────────────────────────────────────────────────────
  async function prepare(userId: string, input: unknown) {
    let spec: OutputSpec;
    try { spec = validateSpec(input); } catch (e) { if (e instanceof SpecError) throw new OutputError('INVALID_SPEC', e.message, 422, e.problems); throw e; }
    // Authorise sources up front so nobody can reference another user's data.
    await referencedAnalyses(userId, spec).catch((e) => { if (e instanceof OutputError && e.code === 'NOT_READY') return; throw e; });
    if (spec.kind === 'analysis') await loadSource(userId, spec.dataset);
    return spec;
  }

  async function start(row: any) {
    if (ASYNC.has(row.kind)) {
      const { job } = await deps.queue.submit({ type: 'output.render', ownerId: row.userId, payload: { artifactId: row.id }, idempotencyKey: `${row.id}:${row.updatedAt instanceof Date ? row.updatedAt.getTime() : row.updatedAt}`, maxAttempts: 2 });
      return db.generatedArtifact.update({ where: { id: row.id }, data: { jobId: job.id } });
    }
    return (await renderAndStore(row.id)) ?? db.generatedArtifact.findUnique({ where: { id: row.id } });
  }

  /** Creates (or returns the existing) artifact for this spec. */
  async function create(userId: string, input: unknown): Promise<{ artifact: any; reused: boolean }> {
    const spec = await prepare(userId, input);
    const key = sha(stable(spec));
    const existing = await db.generatedArtifact.findFirst({ where: { userId, idempotencyKey: key } });
    if (existing && existing.status !== 'failed') return { artifact: existing, reused: true };
    if (existing) return { artifact: await start(await db.generatedArtifact.update({ where: { id: existing.id }, data: { status: 'queued', error: null } })), reused: true };
    const id = randomUUID();
    const row = await db.generatedArtifact.create({
      data: { id, userId, organizationId: (await orgIdsOf(userId))[0] ?? null, kind: spec.kind, format: formatOf(spec), title: spec.title, status: 'queued', revision: 1, rootId: id, parentId: null, spec, sources: spec.sources, fileId: null, previewFileId: null, sizeBytes: null, sha256: null, warnings: [], error: null, idempotencyKey: key, jobId: null, shareMode: 'private', shareTokenHash: null, shareExpiresAt: null },
    });
    return { artifact: await start(row), reused: false };
  }

  /** New revision of an artifact (the earlier revisions stay available). */
  async function revise(userId: string, id: string, input: unknown) {
    const prev = await owned(userId, id);
    const spec = await prepare(userId, input);
    const root = prev.rootId ?? prev.id;
    const latest = await db.generatedArtifact.findMany({ where: { rootId: root }, orderBy: { revision: 'desc' }, take: 1 });
    const revision = (latest[0]?.revision ?? prev.revision) + 1;
    const nid = randomUUID();
    const row = await db.generatedArtifact.create({
      data: { id: nid, userId, organizationId: prev.organizationId, kind: spec.kind, format: formatOf(spec), title: spec.title, status: 'queued', revision, rootId: root, parentId: prev.id, spec, sources: spec.sources, fileId: null, previewFileId: null, sizeBytes: null, sha256: null, warnings: [], error: null, idempotencyKey: `${sha(stable(spec))}:${root}:${revision}`, jobId: null, shareMode: prev.shareMode, shareTokenHash: prev.shareTokenHash, shareExpiresAt: prev.shareExpiresAt },
    });
    return start(row);
  }

  async function retry(userId: string, id: string) {
    const a = await owned(userId, id);
    if (a.status !== 'failed') throw new OutputError('NOT_FAILED', `The artifact is ${a.status}; only failed artifacts are retried.`, 409);
    return start(await db.generatedArtifact.update({ where: { id }, data: { status: 'queued', error: null } }));
  }

  async function share(userId: string, id: string, input: { mode: 'private' | 'organization' | 'link'; organizationId?: string; expiresInHours?: number }) {
    const a = await owned(userId, id);
    const data: any = { shareMode: input.mode, shareTokenHash: null, shareExpiresAt: null };
    let token: string | null = null;
    if (input.mode === 'organization') {
      const orgs = await orgIdsOf(userId);
      const org = input.organizationId ?? a.organizationId ?? orgs[0];
      if (!org || !orgs.includes(org)) throw new OutputError('NO_ORGANIZATION', 'You are not a member of that organisation.', 403);
      data.organizationId = org;
    }
    if (input.mode === 'link') {
      token = randomBytes(24).toString('base64url');
      data.shareTokenHash = sha(token);
      data.shareExpiresAt = new Date(Date.now() + Math.min(Math.max(1, input.expiresInHours ?? 168), 24 * 90) * 3600_000);
    }
    const updated = await db.generatedArtifact.update({ where: { id: a.id }, data });
    return { artifact: publicView(updated), shareToken: token, sharePath: token ? `/api/outputs/shared/${token}` : null };
  }

  async function byToken(userId: string, token: string) {
    const a = await db.generatedArtifact.findFirst({ where: { shareTokenHash: sha(token), shareMode: 'link' } });
    if (!a) throw new OutputError('NOT_FOUND', 'Artifact not found.', 404);
    return readable(userId, a.id, token);
  }

  async function remove(userId: string, id: string) {
    const a = await owned(userId, id);
    for (const f of [a.fileId, a.previewFileId]) if (f) await deps.fileStore.delete(f, a.userId).catch(() => {});
    await db.generatedArtifact.delete({ where: { id: a.id } });
    return { deleted: id };
  }

  async function list(userId: string, opts: { limit?: number; kind?: string } = {}) {
    const rows = await db.generatedArtifact.findMany({ where: { userId, ...(opts.kind ? { kind: opts.kind } : {}) }, orderBy: { createdAt: 'desc' }, take: Math.min(opts.limit ?? 50, 200) });
    return rows.map(publicView);
  }

  async function open(userId: string, id: string, token?: string) {
    const a = await readable(userId, id, token);
    if (a.status !== 'ready' || !a.fileId) throw new OutputError('NOT_READY', `The artifact is ${a.status}.`, 409);
    const { meta, stream } = await deps.fileStore.openStream(a.fileId, a.userId);
    return { artifact: a, meta, stream };
  }

  /**
   * Chat attachment for a ready artifact, only after the stored file is re-read and matches the artifact
   * (size, sha256, MIME type, file format). Signed links last LINK_TTL; the artifact itself stays
   * downloadable through /api/outputs/:id/download and the chat's link re-signing.
   */
  async function attachmentRef(a: any): Promise<AttachmentRef | null> {
    if (!a?.fileId || a.status !== 'ready') return null;
    try {
      const { meta, data } = await deps.fileStore.read(a.fileId, a.userId);
      if (data.length !== a.sizeBytes || sha(data) !== a.sha256 || meta.mime !== MIME[a.format] || await verifyFile(a.format, data)) return null;
      const ref = deps.fileStore.toRef(meta, a.previewFileId ?? undefined);
      const ttl = Math.min(LINK_TTL, Math.max(0, Date.parse(meta.expiresAt) - Date.now()));
      return { ...ref, url: deps.fileStore.signedUrl(meta.id, ttl), ...(a.previewFileId ? { previewUrl: deps.fileStore.signedUrl(a.previewFileId, ttl) } : {}), expiresAt: new Date(Date.now() + ttl).toISOString() };
    } catch {
      return null;
    }
  }

  /** Waits for a background render (chat tools); returns the latest row either way. */
  async function waitReady(userId: string, id: string, ms = 60_000) {
    const until = Date.now() + ms;
    for (;;) {
      const a = await owned(userId, id);
      if (a.status === 'ready' || a.status === 'failed' || Date.now() > until) return a;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  async function readAnalysis(userId: string, id: string) { return analysisOf(userId, id); }

  /** All revisions of the artifact's lineage that the user may read, oldest first. */
  async function revisions(userId: string, id: string) {
    const a = await readable(userId, id);
    const rows = await db.generatedArtifact.findMany({ where: { rootId: a.rootId ?? a.id }, orderBy: { revision: 'asc' } });
    return rows.filter((r: any) => r.userId === a.userId).map(publicView);
  }

  /** Which proposed sources this user may use (planner input); never reveals why a source is missing. */
  async function authorizeSources(userId: string, refs: Array<{ type: string; id: string }>) {
    const out = new Map<string, boolean>();
    for (const r of refs.slice(0, 20)) {
      let ok = false;
      try {
        if (r.type === 'artifact') ok = !!(await readable(userId, r.id));
        else if (['dataset', 'repository_file', 'upload', 'file'].includes(r.type)) ok = !!(await loadSource(userId, r));
      } catch { ok = false; }
      out.set(`${r.type}:${r.id}`, ok);
    }
    return out;
  }

  return { create, revise, retry, share, byToken, remove, list, open, readable: (u: string, id: string) => readable(u, id).then(publicView), revisions, authorizeSources, attachmentRef, waitReady, readAnalysis, renderAndStore, tableMarkdown };
}

export function publicView(a: any) {
  return {
    id: a.id, kind: a.kind, format: a.format, title: a.title, status: a.status, revision: a.revision, rootId: a.rootId, parentId: a.parentId,
    owner: a.userId, createdAt: a.createdAt, updatedAt: a.updatedAt, sources: a.sources, sizeBytes: a.sizeBytes, sha256: a.sha256, warnings: a.warnings, error: a.error,
    share: { mode: a.shareMode, expiresAt: a.shareExpiresAt }, jobId: a.jobId, download: a.status === 'ready' ? `/api/outputs/${a.id}/download` : null,
  };
}

export type OutputService = ReturnType<typeof createOutputService>;
export type { DisplayTable, ChartConfig };
