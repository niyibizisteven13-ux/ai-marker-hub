import { createHash, randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import type { FileStore } from '../ai/files/FileStore.js';
import { extractText } from '../ai/files/extract.js';
import { FileJobQueue, JobError, type FileJob, type JobContext } from '../ai/jobs/fileJobQueue.js';
import { isOvernight, runOvernight } from '../ai/batchMode.js';
import { StructuredOutputError } from '../ai/llm/structuredJson.js';
import type { ProviderAdapter } from '../ai/providers/types.js';
import { documentText, finalText } from '../documents/pipeline.js';
import type { DocumentService } from '../documents/service.js';
import { OwnedRecordStore, type OwnedRecord } from '../storage/ownedRecordStore.js';
import { annotateScript } from './annotate.js';
import { verifyMarkedPdf } from './verifyPdf.js';
import { computeLayout } from './layout.js';
import { processedToViewed } from './pdfGeometry.js';
import { expandArchives, InputError, isPdf, isTyped, typedToPdf } from './inputs.js';
import { splitClassPdf } from './classSplit.js';
import { loadPages } from '../documents/pages.js';
import { buildBundle, safeName, type BundleFile } from './bundle.js';
import { markCandidate } from './marking.js';
import { matchAnswers } from './matching.js';
import { buildReportData, renderExamReport, validateExamReport } from './report.js';
import { classStatistics, currentSummaries, effectiveMarks, openFlags, schemeOf, summarizeCandidate, type CandidateSummary } from './results.js';
import { changedQuestions, extractScheme, questionKey, validateScheme, type MarkingScheme } from './scheme.js';
import { DEFAULT_PREFERENCES, type ArtifactSet, type AuditEvent, type CandidateResult, type CandidateState, type ExamEvent, type ExamRecord, type LayoutOverride, type MarkingPreferences, type MarkingRun, type PenKind, type PenMark, type QuestionResult, type SchemeVersion, type Submission } from './types.js';
import { buildWorkbook } from './workbook.js';
import { identityFromPaper, isPlaceholderId } from './identity.js';

/**
 * Examination marking service: exams, versioned marking schemes, candidate uploads, background marking
 * runs (one job per batch, candidates processed with bounded concurrency and resumable after a restart),
 * examiner overrides, transcription corrections with targeted re-marking, revisions and artifact exports.
 */

export class ExamInputError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) {
    super(message);
  }
}

export interface ExamDeps {
  fileStore: FileStore;
  queue: FileJobQueue;
  /** Queue for overnight (half-price batch) marking runs, whose jobs may wait many hours. Absent = not offered. */
  overnightQueue?: FileJobQueue;
  store: OwnedRecordStore<ExamRecord>;
  documents: DocumentService;
  /** Text model for scheme extraction and marking. */
  agent: () => { adapter: ProviderAdapter; model: string; fallbackModel?: string | null };
  /** Whether handwriting recognition is available (a vision-capable model is configured). */
  visionAvailable: () => boolean;
  forbiddenStrings?: string[];
  maxPages?: number;
  maxCandidates?: number;
  maxBatchPages?: number;
  visualEvidence?: boolean;
  beforeAi?: (userId: string) => Promise<void>;
  candidateConcurrency?: number;
  /** Time a marking job works before handing over to a continuation job (stays under the queue deadline). */
  segmentBudgetMs?: number;
  retryDelayMs?: number;
  /**
   * Premium gate for new marking work (marking, re-marking, scheme reading or drafting, exports). Checked
   * here, inside the service, so chat, REST and any later route all go through it. Absent = allowed.
   */
  entitlement?: (userId: string) => Promise<{ allowed: boolean; code?: string; message?: string; upgradeUrl?: string }>;
  /** Called once per marked or re-marked script with the model tokens it used, for credits and cost tracking. */
  onUsage?: (userId: string, u: { model: string; input: number; output: number; what: 'mark' | 'remark' | 'read' | 'split'; batch?: boolean; extra?: Array<{ model: string; input: number; output: number }> }) => void;
  /** Credits an AI call costs (the billing formula), to show what a marking run used. */
  creditsFor?: (model: string, input: number, output: number, batch?: boolean, what?: 'mark' | 'remark' | 'read' | 'split', extra?: Array<{ model: string; input: number; output: number }>) => number;
}

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Released and unchanged since: any later change to marks or layout makes the PDF a draft again. */
export const isReleased = (r: CandidateResult | undefined) => !!r?.released && r.released.resultUpdatedAt === r.updatedAt;
/** Stamp of what a candidate PDF was drawn from (result version and release state). */
const pdfStamp = (r: CandidateResult, corrections = true) => `${r.updatedAt}|${isReleased(r) ? 'released' : 'draft'}${corrections ? '' : '|no-corrections'}`;
const STOPPED = 'Stopped by teacher';
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const now = () => new Date().toISOString();
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res) => { const t = setTimeout(res, ms); signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true }); });

interface MarkJobPayload { examId: string; runId: string; segment: number }
interface RemarkJobPayload { examId: string; submissionId: string; questionIds: string[]; reason: string; actor: string }
interface ExportJobPayload { examId: string; revision: number }
interface SchemeJobPayload { examId: string; schemeFileIds: Array<{ fileId: string; name: string }>; questionPaper?: { fileId: string; name: string }; autoMark: boolean; actor: string; /** No official scheme: the AI drafts one for the teacher to confirm. */ draft?: boolean }

export interface UploadFile { name: string; buffer: Buffer; mime?: string }
export interface CandidateMapping { fileName: string; candidateId: string; candidateName?: string }

const CANDIDATE_IN_NAME = /(?:^|[^a-z0-9])((?:cand(?:idate)?|c|s|std|student)[-_ ]?\d{1,6}|[a-z]{1,3}\d{2,6})(?:[^a-z0-9]|$)/i;

export function candidateIdFromFileName(name: string): string | null {
  const stem = name.replace(/\.[a-z0-9]{1,5}$/i, '');
  const m = CANDIDATE_IN_NAME.exec(stem);
  if (!m) return null;
  return m[1].toUpperCase().replace(/^(?:CANDIDATE|CAND)[-_ ]?/, 'C').replace(/[-_ ]/g, '');
}

/** Parses a candidate manifest (CSV/TSV or JSON): candidate id, file name, optional name. */
export function parseManifest(text: string): CandidateMapping[] {
  const t = text.trim();
  if (t.startsWith('[') || t.startsWith('{')) {
    const raw = JSON.parse(t);
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw.candidates) ? raw.candidates : [];
    return arr.map((r: any) => ({ fileName: String(r.fileName ?? r.file ?? ''), candidateId: String(r.candidateId ?? r.id ?? ''), candidateName: r.candidateName ?? r.name ? String(r.candidateName ?? r.name) : undefined }))
      .filter((r: CandidateMapping) => r.fileName && r.candidateId);
  }
  const lines = t.split(/\r?\n/).map((l) => l.split(/[,\t;]/).map((c) => c.trim().replace(/^"|"$/g, ''))).filter((c) => c.length >= 2);
  const header = lines[0]?.map((c) => c.toLowerCase()) ?? [];
  const hasHeader = header.some((h) => /file|candidate|id|name/.test(h));
  const idx = (re: RegExp, d: number) => { const i = header.findIndex((h) => re.test(h)); return hasHeader && i >= 0 ? i : d; };
  const iId = idx(/candidate|^id$/, 0), iFile = idx(/file/, 1), iName = idx(/^name|student|full/, 2);
  return (hasHeader ? lines.slice(1) : lines).map((c) => ({ candidateId: c[iId], fileName: c[iFile], candidateName: c[iName] || undefined })).filter((r) => r.candidateId && r.fileName);
}

export function createExamService(deps: ExamDeps) {
  const concurrency = Math.max(1, Math.min(8, Math.floor(deps.candidateConcurrency || 4)));
  const budget = deps.segmentBudgetMs ?? 8 * 60 * 1000;
  // Overnight: every script at once, so each step of all scripts shares one batch; one job runs the night.
  const OVERNIGHT_CONCURRENCY = 200;
  const OVERNIGHT_BUDGET_MS = 24 * 3600_000;
  const queueFor = (run: Pick<MarkingRun, 'mode'> | undefined) => (run?.mode === 'overnight' && deps.overnightQueue ? deps.overnightQueue : deps.queue);
  const maxCandidates = deps.maxCandidates ?? 100;

  // Live viewers of an exam's events (this process). Other processes replay from the stored record.
  const listeners = new Map<string, Set<(ev: ExamEvent) => void>>();
  function subscribe(examId: string, fn: (ev: ExamEvent) => void): () => void {
    const set = listeners.get(examId) ?? new Set();
    set.add(fn);
    listeners.set(examId, set);
    return () => { set.delete(fn); if (!set.size) listeners.delete(examId); };
  }
  /** Appends an event to the record inside an update, so the event and the state change are saved together. */
  const emit = (e: ExamRecord, ev: Omit<ExamEvent, 'v' | 'seq' | 'at'>) => {
    e.eventSeq = (e.eventSeq ?? 0) + 1;
    (e.events ??= []).push({ v: 1, seq: e.eventSeq, at: now(), ...ev, message: ev.message.slice(0, 300) });
    if (e.events.length > 2000) e.events.splice(0, e.events.length - 2000);
  };

  // Serialises read-modify-write updates per exam (candidates are processed concurrently).
  const locks = new Map<string, Promise<unknown>>();
  async function mutate(userId: string, examId: string, fn: (e: ExamRecord) => void): Promise<ExamRecord> {
    const prev = locks.get(examId) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(async () => {
      let before = 0;
      const rec = await deps.store.update(examId, userId, (e) => { before = e.eventSeq ?? 0; fn(e); });
      if (!rec) throw new ExamInputError('NOT_FOUND', 'Examination not found.', 404);
      const fresh = (rec.events ?? []).filter((ev) => ev.seq > before);
      if (fresh.length) for (const l of listeners.get(examId) ?? []) for (const ev of fresh) { try { l(ev); } catch { /* a viewer never breaks marking */ } }
      return rec;
    });
    locks.set(examId, run);
    try { return await run; } finally { if (locks.get(examId) === run) locks.delete(examId); }
  }

  async function load(userId: string, examId: string): Promise<ExamRecord> {
    const e = await deps.store.get(examId, userId);
    if (!e) throw new ExamInputError('NOT_FOUND', 'Examination not found.', 404);
    return e;
  }

  async function requirePremium(userId: string) {
    if (!deps.entitlement) return;
    const d = await deps.entitlement(userId);
    if (!d.allowed) throw new ExamInputError(d.code === 'UPGRADE_REQUIRED' ? 'UPGRADE_REQUIRED' : 'LIMIT_REACHED', d.message ?? 'Marking is not available on your plan.', d.code === 'UPGRADE_REQUIRED' ? 402 : 429, d.upgradeUrl ? { upgradeUrl: d.upgradeUrl } : undefined);
  }

  const audit = (e: ExamRecord, ev: Omit<AuditEvent, 'revision' | 'at'>) => { e.audit.push({ ...ev, revision: e.resultRevision, at: now() }); if (e.audit.length > 5000) e.audit.splice(0, e.audit.length - 5000); };
  const findSub = (e: ExamRecord, ref: string) => e.submissions.find((s) => s.id === ref) ?? e.submissions.find((s) => s.candidateId.toLowerCase() === ref.toLowerCase());
  const findQuestion = (scheme: MarkingScheme, ref: string) => scheme.questions.find((q) => q.id === ref) ?? scheme.questions.find((q) => questionKey(q.number) === questionKey(ref));
  const latestScheme = (e: ExamRecord) => e.schemes[e.schemes.length - 1] ?? null;
  const confirmedScheme = (e: ExamRecord) => [...e.schemes].reverse().find((s) => s.status === 'confirmed') ?? null;

  // ── Exams ───────────────────────────────────────────────────────────────
  async function createExam(userId: string, input: { title?: string; passPercent?: number } = {}): Promise<ExamRecord> {
    const passPercent = input.passPercent ?? 50;
    if (!(passPercent >= 0 && passPercent <= 100)) throw new ExamInputError('INVALID_REQUEST', 'passPercent must be between 0 and 100.');
    return deps.store.create(userId, {
      title: (input.title ?? 'Examination').trim().slice(0, 200) || 'Examination', passPercent, questionPaper: null, schemes: [], submissions: [], runs: [],
      results: {}, resultRevision: 0, audit: [], artifacts: [],
    } as Omit<ExamRecord, keyof OwnedRecord>);
  }

  // ── Marking scheme ──────────────────────────────────────────────────────
  function addSchemeVersion(e: ExamRecord, actor: string, v: { scheme: MarkingScheme | null; errors: string[]; warnings: string[]; source: SchemeVersion['source']; autoConfirm: boolean }): SchemeVersion {
    const prev = confirmedScheme(e)?.scheme ?? null;
    const status: SchemeVersion['status'] = v.errors.length || !v.scheme ? 'invalid' : v.autoConfirm && !v.warnings.length ? 'confirmed' : 'needs_confirmation';
    const sv: SchemeVersion = {
      version: (latestScheme(e)?.version ?? 0) + 1, status, scheme: v.scheme, errors: v.errors, warnings: v.warnings, source: v.source, createdAt: now(), createdBy: actor,
      ...(status === 'confirmed' ? { confirmedAt: now(), confirmedBy: actor } : {}), changedQuestionIds: v.scheme ? changedQuestions(prev, v.scheme) : [],
    };
    e.schemes.push(sv);
    if (status === 'confirmed' && v.scheme && prev) flagSchemeChange(e, sv);
    audit(e, { actor, type: 'scheme_version', after: { version: sv.version, status }, reason: v.source.note });
    return sv;
  }

  /** A changed scheme never silently rewrites existing marks: affected results are flagged instead. */
  function flagSchemeChange(e: ExamRecord, sv: SchemeVersion) {
    const changed = new Set(sv.changedQuestionIds ?? []);
    if (!changed.size) return;
    for (const r of Object.values(e.results)) for (const q of r.questions) {
      if (changed.has(q.questionId) && q.ai && !q.ai.reviewFlags.some((f) => f.code === 'scheme_changed')) {
        q.ai.reviewFlags.push({ code: 'scheme_changed', severity: 'high', detail: `The marking scheme changed (version ${sv.version}); re-mark this question or confirm the mark.` });
      }
    }
    e.resultRevision++;
  }

  async function setSchemeJson(userId: string, examId: string, input: unknown, opts: { confirm?: boolean } = {}) {
    const v = validateScheme(input);
    let sv: SchemeVersion | undefined;
    await mutate(userId, examId, (e) => { sv = addSchemeVersion(e, userId, { ...v, source: { kind: 'json', fileIds: [] }, autoConfirm: !!opts.confirm }); });
    return sv!;
  }

  async function confirmScheme(userId: string, examId: string, version?: number) {
    let out: SchemeVersion | undefined;
    await mutate(userId, examId, (e) => {
      const sv = version ? e.schemes.find((s) => s.version === version) : latestScheme(e);
      if (!sv) throw new ExamInputError('NO_SCHEME', 'No marking scheme has been uploaded for this examination.', 409);
      if (sv.status === 'invalid') throw new ExamInputError('SCHEME_INVALID', 'This scheme version has errors and cannot be confirmed.', 422, sv.errors);
      if (sv.status !== 'confirmed') {
        sv.status = 'confirmed'; sv.confirmedAt = now(); sv.confirmedBy = userId;
        audit(e, { actor: userId, type: 'scheme_confirmed', after: { version: sv.version } });
        flagSchemeChange(e, sv);
      }
      out = sv;
    });
    return out!;
  }

  /** Edits the marks of one question in the latest scheme, creating a new version. */
  async function editSchemeQuestion(userId: string, examId: string, questionRef: string, patch: { maxMarks?: number }) {
    const e = await load(userId, examId);
    const base = latestScheme(e)?.scheme ?? null;
    if (!base) throw new ExamInputError('NO_SCHEME', 'There is no structured scheme to edit yet.', 409);
    const q = findQuestion(base, questionRef);
    if (!q) throw new ExamInputError('UNKNOWN_QUESTION', `No question "${questionRef}" in the marking scheme.`, 404);
    const next = structuredClone(base);
    const nq = next.questions.find((x) => x.id === q.id)!;
    if (patch.maxMarks !== undefined) {
      if (nq.criteria.length === 1) nq.criteria[0].marks = patch.maxMarks;
      nq.maxMarks = patch.maxMarks;
      next.totalMarks = next.questions.reduce((a, x) => a + x.maxMarks, 0);
    }
    const v = validateScheme(next);
    let sv: SchemeVersion | undefined;
    await mutate(userId, examId, (r) => { sv = addSchemeVersion(r, userId, { ...v, source: { kind: 'edit', fileIds: [], note: `Question ${q.number}: ${JSON.stringify(patch)}` }, autoConfirm: false }); });
    return sv!;
  }

  async function storeUpload(userId: string, f: UploadFile, kind: 'pdf' | 'image' | 'document' | 'text') {
    return deps.fileStore.put({ userId, name: f.name.replace(/[^\w.\- ]/g, '_').slice(0, 120) || 'upload', mime: f.mime || 'application/octet-stream', kind, data: f.buffer, ttlMs: RETENTION_MS });
  }

  /** Stores the scheme (and optional question paper) and queues extraction. */
  async function submitSchemeDocuments(userId: string, examId: string, input: { scheme: UploadFile[]; questionPaper?: UploadFile; autoMark?: boolean }) {
    await deps.beforeAi?.(userId);
    if (!input.scheme.length) throw new ExamInputError('NO_SCHEME', 'Upload the official marking scheme.');
    await load(userId, examId);
    await requirePremium(userId);
    const schemeFileIds = [];
    for (const f of input.scheme) schemeFileIds.push({ fileId: (await storeUpload(userId, f, 'document')).id, name: f.name });
    let questionPaper: SchemeJobPayload['questionPaper'];
    if (input.questionPaper) {
      questionPaper = { fileId: (await storeUpload(userId, input.questionPaper, 'document')).id, name: input.questionPaper.name };
      await mutate(userId, examId, (e) => { e.questionPaper = { ...questionPaper!, documentId: undefined }; });
    }
    const { job } = await deps.queue.submit<SchemeJobPayload>({ type: 'exam.scheme', ownerId: userId, payload: { examId, schemeFileIds, questionPaper, autoMark: !!input.autoMark, actor: userId } });
    return job;
  }

  /**
   * No official marking scheme: queue an AI draft from the question paper (if given) or from the questions as
   * they appear on the candidates' scripts. A draft is never used until the teacher confirms it.
   */
  async function draftScheme(userId: string, examId: string, input: { questionPaper?: UploadFile } = {}) {
    await deps.beforeAi?.(userId);
    const exam = await load(userId, examId);
    await requirePremium(userId);
    let questionPaper: SchemeJobPayload['questionPaper'];
    if (input.questionPaper) {
      questionPaper = { fileId: (await storeUpload(userId, input.questionPaper, 'document')).id, name: input.questionPaper.name };
      await mutate(userId, examId, (e) => { e.questionPaper = { ...questionPaper!, documentId: undefined }; });
    } else if (exam.questionPaper) questionPaper = { fileId: exam.questionPaper.fileId, name: exam.questionPaper.name };
    if (!questionPaper && !exam.submissions.length) throw new ExamInputError('NO_SOURCE', 'Send the question paper or at least one candidate script so I can draft a marking scheme.');
    const { job } = await deps.queue.submit<SchemeJobPayload>({ type: 'exam.scheme', ownerId: userId, payload: { examId, schemeFileIds: [], questionPaper, autoMark: false, actor: userId, draft: true } });
    return job;
  }

  /** Recognition of a candidate's script, shared by marking and scheme drafting so it is done once. */
  async function recognizeSubmission(userId: string, sub: Submission, signal?: AbortSignal) {
    let original: Buffer;
    try { original = (await deps.fileStore.read(sub.fileId, userId)).data; } catch { throw new JobError('SOURCE_UNAVAILABLE', 'The uploaded script is no longer available.'); }
    return deps.documents.recognizeCached(userId, { buffer: original, name: sub.fileName.replace(/\.[a-z0-9]+$/i, sub.typed ? '.pdf' : '$&'), sourceFileId: sub.fileId }, { crossCheck: true, ...(sub.typed ? { forceRecognition: true } : {}) }, { signal });
  }

  /** Text of a teacher document: its own text when it has some, otherwise handwriting/scan recognition. */
  async function documentTextOf(userId: string, fileId: string, name: string, ctx?: JobContext): Promise<{ text: string; documentId?: string }> {
    const { data, meta } = await deps.fileStore.read(fileId, userId);
    const ex = await extractText({ name, mime: meta.mime, data }).catch(() => ({ kind: 'unsupported' as const, text: '' }));
    const txt = ex.kind === 'text' ? (ex.text ?? '').replace(/--\s*\d+\s+of\s+\d+\s*--/g, '').trim() : '';
    if (txt.length >= 40) return { text: txt };
    if (!deps.visionAvailable()) throw new JobError('VISION_MODEL_UNAVAILABLE', `"${name}" has no text layer and handwriting recognition needs a vision-capable model.`);
    const { record } = await deps.documents.recognizeCached(userId, { buffer: data, name, sourceFileId: fileId }, { crossCheck: true }, { signal: ctx?.signal });
    return { text: documentText(record.result, record.corrections), documentId: record.id };
  }

  async function runSchemeJob(job: FileJob<SchemeJobPayload>, ctx: JobContext) {
    const p = job.payload;
    await deps.beforeAi?.(job.ownerId);
    await ctx.progress(p.draft ? 'reading the questions' : 'reading the marking scheme', 10);
    await mutate(job.ownerId, p.examId, (e) => emit(e, { type: 'rubric_processing_started', jobId: job.id, message: p.draft ? 'Drafting a provisional marking scheme from the questions (no official scheme was given).' : `Reading the marking scheme (${p.schemeFileIds.map((f) => f.name).join(', ').slice(0, 120)}).`, data: { draft: !!p.draft } }));
    const texts: string[] = [];
    for (const f of p.schemeFileIds) texts.push((await documentTextOf(job.ownerId, f.fileId, f.name, ctx)).text);
    if (p.draft) {
      // A few scripts show the questions and how they are numbered; recognition is cached for marking later.
      const ex = await load(job.ownerId, p.examId);
      for (const sub of ex.submissions.slice(0, 3)) {
        try {
          const { record } = await recognizeSubmission(job.ownerId, sub, ctx.signal);
          await mutate(job.ownerId, p.examId, (e) => { const x = e.submissions.find((y) => y.id === sub.id); if (x) x.documentId = record.id; });
          texts.push(`--- Script ${sub.candidateId} ---\n${documentText(record.result, record.corrections)}`);
        } catch (err) { if (ctx.signal.aborted) throw err; }
      }
    }
    let qpText: string | undefined;
    if (p.questionPaper) {
      const r = await documentTextOf(job.ownerId, p.questionPaper.fileId, p.questionPaper.name, ctx);
      qpText = r.text;
      await mutate(job.ownerId, p.examId, (e) => { if (e.questionPaper) e.questionPaper.documentId = r.documentId; });
    }
    await ctx.progress('structuring the marking scheme', 50);
    const exam = await load(job.ownerId, p.examId);
    const agent = deps.agent();
    let extracted: Awaited<ReturnType<typeof extractScheme>>;
    try {
      if (p.draft && !qpText && !texts.join('').trim()) throw new JobError('NO_SOURCE', 'There is nothing to draft from: send the question paper or readable candidate scripts.');
      extracted = await extractScheme(agent.adapter, agent.model, texts.join('\n\n'), { questionPaperText: qpText, title: exam.title !== 'Examination' ? exam.title : undefined, signal: ctx.signal, fallbackModel: agent.fallbackModel, draft: p.draft });
    } catch (e) {
      if (e instanceof StructuredOutputError) throw new JobError('SCHEME_EXTRACTION_FAILED', p.draft ? 'A marking scheme could not be drafted. Send the question paper as text, or try again.' : 'The marking scheme could not be structured. Send it as text or JSON, or try again.');
      if (e instanceof JobError) throw e;
      throw mapProvider(e);
    }
    let sv: SchemeVersion | undefined;
    await mutate(job.ownerId, p.examId, (e) => {
      sv = addSchemeVersion(e, p.actor, {
        scheme: extracted.validation.scheme, errors: extracted.validation.errors, warnings: [...extracted.validation.warnings, ...extracted.ambiguities],
        source: { kind: 'document', fileIds: p.schemeFileIds.map((f) => f.fileId), note: p.draft ? 'Drafted by Bwenge AI (no official scheme)' : p.schemeFileIds.map((f) => f.name).join(', ') }, autoConfirm: !p.draft,
      });
      if (sv.scheme && e.title === 'Examination') e.title = sv.scheme.title;
      const qs = sv.scheme?.questions.length ?? 0;
      if (sv.status === 'confirmed') emit(e, { type: 'rubric_ready', jobId: job.id, message: `Marking scheme v${sv.version} ready: ${qs} question${qs === 1 ? '' : 's'}, ${sv.scheme?.totalMarks ?? 0} marks.`, data: { schemeVersion: sv.version, questions: qs, totalMarks: sv.scheme?.totalMarks ?? 0 } });
      else emit(e, { type: 'clarification_required', jobId: job.id, message: sv.status === 'invalid'
        ? `The marking scheme needs fixing before marking: ${sv.errors.slice(0, 2).join('; ').slice(0, 200)}`
        : p.draft ? `Draft marking scheme v${sv.version} (${qs} questions) is provisional, not the official scheme. Check it and say "confirm the marking scheme".` : `Marking scheme v${sv.version} needs your confirmation before marking.`,
        data: { schemeVersion: sv.version, status: sv.status, draft: !!p.draft } });
    });
    let markJobId: string | null = null;
    if (sv!.status === 'confirmed' && p.autoMark) {
      const e = await load(job.ownerId, p.examId);
      if (e.submissions.some((s) => s.state === 'queued')) markJobId = (await startMarking(job.ownerId, p.examId)).jobId;
    }
    return { examId: p.examId, schemeVersion: sv!.version, status: sv!.status, errors: sv!.errors, warnings: sv!.warnings, markJobId };
  }

  // ── Submissions ─────────────────────────────────────────────────────────
  async function inspectFile(f: UploadFile): Promise<{ mime: string; pages: number }> {
    const head = f.buffer.subarray(0, 5).toString('latin1');
    if (head === '%PDF-') {
      try {
        const doc = await PDFDocument.load(f.buffer, { ignoreEncryption: true, updateMetadata: false });
        return { mime: 'application/pdf', pages: doc.getPageCount() };
      } catch {
        throw new ExamInputError('UNREADABLE', `${f.name} could not be opened as a PDF (it may be damaged).`);
      }
    }
    try {
      const m = await sharp(f.buffer, { limitInputPixels: 80_000_000 }).metadata();
      if (!m.format || !['jpeg', 'png', 'webp', 'tiff', 'gif', 'heif', 'avif'].includes(m.format)) throw new Error('format');
      return { mime: `image/${m.format}`, pages: m.format === 'tiff' ? m.pages ?? 1 : 1 };
    } catch {
      throw new ExamInputError('UNSUPPORTED_FORMAT', `${f.name} is not a script I can read. Send PDFs, photos (JPEG, PNG, WebP, HEIC, TIFF), Word or text documents, or a ZIP folder of them.`);
    }
  }

  /**
   * Registers candidate scripts. Identity comes from an explicit mapping/manifest, then a candidate id in
   * the file name, otherwise a new sequential id (reported back so the teacher can see the mapping).
   * Never reads identity from handwriting on the page.
   */
  async function addSubmissions(userId: string, examId: string, files: UploadFile[], mapping: CandidateMapping[] = [], opts: { pagesPerStudent?: number; onSplit?: (fileName: string, students: number) => void } = {}) {
    const exam = await load(userId, examId);
    try { files = await expandArchives(files); } catch (e) { if (e instanceof InputError) throw new ExamInputError('UNREADABLE', e.message); throw e; }
    if (!files.length) throw new ExamInputError('NO_FILES', 'Attach at least one candidate script.');
    // One PDF with the whole class: cut into one script per student (every N pages when the teacher said so,
    // otherwise where the AI sees a new student start).
    const splitErrors: Array<{ fileName: string; code: string; reason: string }> = [];
    const expanded: UploadFile[] = [];
    for (const f of files) {
      let pages = 0;
      if (isPdf(f)) { try { pages = (await PDFDocument.load(f.buffer, { ignoreEncryption: true })).getPageCount(); } catch { pages = 0; } }
      const perStudent = opts.pagesPerStudent;
      if (!pages || (perStudent ? pages <= perStudent : pages <= (deps.maxPages ?? 20))) { expanded.push(f); continue; }
      try {
        const agent = deps.agent();
        const splitModel = process.env.EXAM_SPLIT_MODEL || agent.model;
        let used = { input: 0, output: 0 };
        const pieces = await splitClassPdf(f.buffer, f.name, { pagesPerStudent: perStudent, ai: { adapter: agent.adapter, model: splitModel }, onUsage: (u) => { used = { input: used.input + u.input, output: used.output + u.output }; } });
        if (used.input || used.output) await charge(userId, examId, null, { model: splitModel, ...used, what: 'split' });
        opts.onSplit?.(f.name, pieces.length);
        for (const piece of pieces) expanded.push({ name: piece.name, buffer: piece.buffer, mime: 'application/pdf' });
      } catch (e) {
        splitErrors.push({ fileName: f.name, code: 'SPLIT_FAILED', reason: `${f.name} has ${pages} pages and could not be split into students${e instanceof Error ? `: ${e.message}` : ''}. Say how many pages each student has, for example "4 pages per student".` });
      }
    }
    files = expanded;
    if (!files.length) return { accepted: [] as Submission[], rejected: splitErrors };
    if (exam.submissions.length + files.length > maxCandidates) throw new ExamInputError('TOO_MANY_CANDIDATES', `At most ${maxCandidates} candidates per examination.`, 413);
    const accepted: Submission[] = [];
    const rejected: Array<{ fileName: string; code: string; reason: string }> = [...splitErrors];
    const byFile = new Map(mapping.map((m) => [m.fileName.toLowerCase(), m]));
    const taken = new Set(exam.submissions.map((s) => s.candidateId.toLowerCase()));
    const hashes = new Map(exam.submissions.map((s) => [s.sha256, s.candidateId]));
    let seq = exam.submissions.length;
    // Explicit ids (mapping or file name) are reserved first so a newly assigned id never takes one of them.
    const explicit = new Map(files.map((f) => [f, byFile.get(f.name.toLowerCase())?.candidateId?.trim() || candidateIdFromFileName(f.name) || null]));
    const reserved = new Set([...explicit.values()].filter((x): x is string => !!x).map((x) => x.toLowerCase()));
    for (let f of files) {
      try {
        // Typed answers are printed to a PDF that is read like a scan; the teacher's file is kept as it is.
        let typedOriginal: UploadFile | null = null;
        if (isTyped(f) && !isPdf(f)) {
          typedOriginal = f;
          try { f = { name: f.name, buffer: await typedToPdf(f), mime: 'application/pdf' }; } catch (e) { throw new ExamInputError('UNREADABLE', e instanceof Error ? e.message : `${f.name} could not be read.`); }
        }
        const info = await inspectFile(f);
        if (exam.submissions.reduce((sum, sub) => sum + sub.pages, 0) + accepted.reduce((sum, sub) => sum + sub.pages, 0) + info.pages > (deps.maxBatchPages ?? 50)) throw new ExamInputError('BATCH_PAGE_LIMIT', 'This batch has too many pages. Start another assessment.', 413);
        if (info.pages > (deps.maxPages ?? 20)) throw new ExamInputError('TOO_MANY_PAGES', `${f.name} has ${info.pages} pages; the limit is ${deps.maxPages ?? 20}.`, 413);
        const hash = sha256((typedOriginal ?? f).buffer);
        if (hashes.has(hash)) throw new ExamInputError('DUPLICATE', `${f.name} is identical to the script of ${hashes.get(hash)}.`, 409);
        const m = byFile.get(f.name.toLowerCase());
        let candidateId = explicit.get(typedOriginal ?? f) ?? undefined;
        let identity: Submission['identity'] = m?.candidateId?.trim() ? 'manifest' : 'filename';
        if (!candidateId) {
          identity = 'assigned';
          do candidateId = `C${String(++seq).padStart(3, '0')}`; while (taken.has(candidateId.toLowerCase()) || reserved.has(candidateId.toLowerCase()));
        }
        if (!/^[\w.-]{1,40}$/.test(candidateId)) throw new ExamInputError('INVALID_CANDIDATE_ID', `Candidate id "${candidateId.slice(0, 40)}" may contain only letters, digits, dot, dash and underscore.`);
        if (taken.has(candidateId.toLowerCase())) throw new ExamInputError('DUPLICATE_CANDIDATE', `Candidate ${candidateId} already has a script in this examination; give ${f.name} a different candidate id.`, 409);
        const stored = await deps.fileStore.put({ userId, name: f.name.replace(/[^\w.\- ]/g, '_').slice(0, 120) || 'script.pdf', mime: info.mime, kind: info.mime === 'application/pdf' ? 'pdf' : 'image', data: f.buffer, ttlMs: RETENTION_MS });
        const sub: Submission = {
          id: randomUUID(), candidateId, candidateName: m?.candidateName?.slice(0, 120), identity, fileId: stored.id, fileName: f.name.slice(0, 200), mime: info.mime,
          sha256: hash, pages: info.pages, uploadedAt: now(), state: 'queued', stateAt: now(),
          ...(typedOriginal ? { typed: true, originalFileId: (await storeUpload(userId, typedOriginal, 'document')).id } : {}),
        };
        taken.add(candidateId.toLowerCase());
        hashes.set(hash, candidateId);
        accepted.push(sub);
      } catch (e) {
        if (e instanceof ExamInputError) rejected.push({ fileName: f.name, code: e.code, reason: e.message });
        else throw e;
      }
    }
    await mutate(userId, examId, (e) => {
      e.submissions.push(...accepted);
      for (const s of accepted) audit(e, { actor: userId, type: 'submission_added', submissionId: s.id, candidateId: s.candidateId, after: { fileName: s.fileName, identity: s.identity, sha256: s.sha256 } });
    });
    return { accepted, rejected };
  }

  // ── Marking runs ────────────────────────────────────────────────────────
  async function startMarking(userId: string, examId: string, opts: { submissionIds?: string[]; remarkAll?: boolean; overnight?: boolean } = {}) {
    await deps.beforeAi?.(userId);
    const exam = await load(userId, examId);
    // The exam's preference applies unless this request says otherwise (marking straight after the scheme is read).
    const overnight = (opts.overnight ?? exam.preferences?.overnight ?? false) && !!deps.overnightQueue;
    if (opts.overnight && !deps.overnightQueue) throw new ExamInputError('OVERNIGHT_UNAVAILABLE', 'Overnight marking is not available right now. Mark now instead.', 503);
    const sv = confirmedScheme(exam);
    if (!sv?.scheme) {
      const latest = latestScheme(exam);
      throw new ExamInputError(latest ? 'SCHEME_NOT_CONFIRMED' : 'NO_SCHEME', latest ? 'Confirm the marking scheme before marking starts.' : 'Upload the official marking scheme first.', 409, latest?.errors);
    }
    if (!deps.visionAvailable()) throw new ExamInputError('VISION_MODEL_UNAVAILABLE', 'Handwriting recognition needs a vision-capable model (set AI_AGENT_PROVIDER=anthropic).', 503);
    await requirePremium(userId);
    const ids = (opts.submissionIds?.length ? opts.submissionIds : exam.submissions.filter((s) => opts.remarkAll || s.state === 'queued' || s.state === 'failed' || !exam.results[s.id] || exam.results[s.id].schemeVersion !== sv.version).map((s) => s.id))
      .filter((id) => exam.submissions.some((s) => s.id === id));
    if (!ids.length) throw new ExamInputError('NOTHING_TO_MARK', 'Every script is already marked with the current scheme. Ask to re-mark if you want a fresh run.', 409);
    const active = exam.runs.find((r) => !['completed', 'completed_with_warnings', 'failed', 'cancelled'].includes(r.state));
    if (active) throw new ExamInputError('RUN_IN_PROGRESS', 'A marking run is already in progress for this examination.', 409);
    const run: MarkingRun = { id: randomUUID(), schemeVersion: sv.version, submissionIds: ids, state: 'queued', createdAt: now(), createdBy: userId, jobIds: [], ...(overnight ? { mode: 'overnight' as const } : {}) };
    // Save the run before its job is queued: the queue may start the job at once.
    await mutate(userId, examId, (e) => {
      e.runs.push(run);
      for (const s of e.submissions) if (ids.includes(s.id)) { s.state = 'queued'; s.stateAt = now(); delete s.error; }
    });
    const { job } = await queueFor(run).submit<MarkJobPayload>({ type: 'exam.mark', ownerId: userId, payload: { examId, runId: run.id, segment: 0 }, idempotencyKey: `${run.id}:0`, maxAttempts: 3 });
    await mutate(userId, examId, (e) => {
      const r = e.runs.find((x) => x.id === run.id);
      if (r && !r.jobIds.includes(job.id)) r.jobIds.push(job.id);
      const pref = e.preferences ?? DEFAULT_PREFERENCES;
      emit(e, { type: 'job_created', runId: run.id, jobId: job.id, progress: { done: 0, total: ids.length }, message: `Marking ${ids.length} script${ids.length === 1 ? '' : 's'} against marking scheme v${sv.version} (${pref.credit === 'strict' ? 'strict' : 'partial-credit'} marking)${run.mode === 'overnight' ? ' overnight at half price: results are ready by tomorrow morning, usually much sooner' : ''}.`, data: { schemeVersion: sv.version, candidates: ids.length, credit: pref.credit, overnight: run.mode === 'overnight' } });
    });
    return { runId: run.id, jobId: job.id, candidates: ids.length, schemeVersion: sv.version };
  }

  /** A run that was cancelled or stopped must not change anything: its work may still be finishing in the background. */
  const runLive = (e: ExamRecord, runId: string) => { const r = e.runs.find((x) => x.id === runId); return !!r && r.state !== 'cancelled' && !(r.state === 'failed' && r.error === STOPPED); };

  async function setState(userId: string, examId: string, runId: string, submissionId: string, state: CandidateState, error?: { code: string; message: string }, ...events: Array<Omit<ExamEvent, 'v' | 'seq' | 'at'>>) {
    await mutate(userId, examId, (e) => {
      if (!runLive(e, runId)) return;
      const s = e.submissions.find((x) => x.id === submissionId);
      if (s) { s.state = state; s.stateAt = now(); if (error) s.error = error; else delete s.error; if (state !== 'marking') delete s.activity; }
      for (const ev of events) emit(e, ev);
    });
  }

  /** Scripts of a run that are finished, for progress counts. */
  const runProgress = (e: ExamRecord, runId: string) => {
    const r = e.runs.find((x) => x.id === runId);
    const ids = r?.submissionIds ?? [];
    return { done: e.submissions.filter((s) => ids.includes(s.id) && ['completed', 'completed_with_warnings', 'failed'].includes(s.state)).length, total: ids.length };
  };

  function mapProvider(e: unknown): unknown {
    const cat = (e as { category?: string })?.category;
    if (cat === 'CONTENT_REFUSED') return new JobError('CONTENT_REFUSED', 'The AI model declined to process this script.');
    if (cat) return new JobError(`AI_${cat}`, 'The AI service could not process the script. Try again later.', ['PROVIDER_BUSY', 'RATE_LIMITED', 'PROVIDER_TIMEOUT', 'NETWORK_ERROR'].includes(cat));
    return e;
  }

  async function questionPaperText(userId: string, e: ExamRecord): Promise<string | undefined> {
    if (!e.questionPaper?.documentId) return undefined;
    const t = await deps.documents.text(userId, e.questionPaper.documentId);
    return t ?? undefined;
  }

  /** Recognise → match → mark → verify one candidate. Safe to re-run: results are keyed by submission. */
  async function processCandidate(userId: string, examId: string, runId: string, submissionId: string, signal: AbortSignal) {
    let exam = await load(userId, examId);
    const run = exam.runs.find((r) => r.id === runId)!;
    const scheme = schemeOf(exam, run.schemeVersion)!;
    const sub = exam.submissions.find((s) => s.id === submissionId)!;
    const existing = exam.results[sub.id];
    if (existing?.runId === runId && existing.questions.every((q) => q.ai)) {
      // Already marked by this run in an earlier attempt: make sure the script is shown as finished.
      await mutate(userId, examId, (e) => {
        const s = e.submissions.find((x) => x.id === sub.id);
        if (!runLive(e, runId) || !s || ['completed', 'completed_with_warnings', 'failed'].includes(s.state)) return;
        s.state = existing.questions.some((q) => openFlags(q).length) ? 'completed_with_warnings' : 'completed';
        s.stateAt = now();
      });
      return;
    }

    await deps.beforeAi?.(userId);
    const ref = { runId, submissionId: sub.id, candidateId: sub.candidateId };
    await setState(userId, examId, runId, sub.id, 'validating');
    await setState(userId, examId, runId, sub.id, 'recognizing', undefined, { ...ref, type: 'page_processing_started', message: `Reading ${sub.candidateId}'s script (${sub.pages} page${sub.pages === 1 ? '' : 's'}).`, data: { pages: sub.pages } });
    const { record, cached, key } = await recognizeSubmission(userId, sub, signal);
    // Reading the handwriting is AI work too: charged with this script's marking, as one action (a reading reused
    // from earlier is free).
    const readUsage = cached ? [] : [{ model: record.result.model ?? deps.agent().model, input: record.result.usage.input, output: record.result.usage.output }];
    const pages = record.result.pages;
    const elements = pages.flatMap((pg) => pg.elements);
    const unclear = pages.flatMap((pg) => pg.elements.filter((el) => el.uncertainty !== 'low').map(() => pg.page));
    const veryUnclear = elements.filter((el) => el.uncertainty === 'high').length;
    const tiled = pages.filter((pg) => pg.tiling);
    // The name and number written on the paper replace a made-up id (STUDENT1, C001) and a file-name label.
    const written = identityFromPaper(record.result);
    let identified = '';
    await mutate(userId, examId, (e) => {
      if (!runLive(e, runId)) return;
      const s = e.submissions.find((x) => x.id === sub.id)!; s.documentId = record.id; s.recognitionCached = cached; s.recognitionKey = key;
      const placeholder = isPlaceholderId(s.candidateId, s.identity);
      const stem = s.fileName.replace(/\.[a-z0-9]+$/i, '').slice(0, 60);
      if (written.name && (!s.candidateName || s.candidateName === stem || placeholder)) { s.candidateName = written.name.slice(0, 120); identified = written.name; }
      if (written.id && placeholder && written.id.toLowerCase() !== s.candidateId.toLowerCase() && !e.submissions.some((x) => x.id !== s.id && x.candidateId.toLowerCase() === written.id!.toLowerCase())) {
        const before = s.candidateId;
        s.candidateId = written.id;
        s.identity = 'paper';
        if (e.results[s.id]) e.results[s.id].candidateId = written.id;
        audit(e, { actor: 'bwenge-ai', type: 'submission_added', submissionId: s.id, candidateId: written.id, before: { candidateId: before }, after: { candidateId: written.id, identity: 'paper' } });
        identified = `${written.id}${s.candidateName ? ` (${s.candidateName})` : ''}`;
      } else if (identified && placeholder) s.identity = 'paper';
      sub.candidateId = s.candidateId; sub.candidateName = s.candidateName; ref.candidateId = s.candidateId;
      emit(e, { ...ref, type: 'document_inspected', message: `${sub.candidateId}: ${pages.length} page${pages.length === 1 ? '' : 's'} read${cached ? ' (reused an earlier reading)' : ''}, ${elements.length} passages${unclear.length ? `, ${unclear.length} unclear` : ', handwriting readable'}.${identified ? ` Name on the paper: ${identified}.` : ''}`, data: { pages: pages.length, passages: elements.length, unclear: unclear.length, cached } });
      if (tiled.length) {
        const t = tiled.reduce((a, pg) => ({ tiles: a.tiles + pg.tiling!.tiles, replaced: a.replaced + pg.tiling!.replaced, agreed: a.agreed + pg.tiling!.agreed, added: a.added + pg.tiling!.added }), { tiles: 0, replaced: 0, agreed: 0, added: 0 });
        emit(e, { ...ref, type: 'handwriting_recovery_completed', message: `${sub.candidateId}: small handwriting re-read close up on ${tiled.length} page${tiled.length === 1 ? '' : 's'}: ${t.replaced} reading${t.replaced === 1 ? '' : 's'} improved, ${t.added} passage${t.added === 1 ? '' : 's'} found, ${t.agreed} confirmed.`, data: t });
      }
      if (unclear.length) emit(e, { ...ref, type: 'uncertainty_detected', page: unclear[0], message: `${sub.candidateId}: ${unclear.length} passage${unclear.length === 1 ? '' : 's'} not fully clear on page${new Set(unclear).size === 1 ? '' : 's'} ${[...new Set(unclear)].join(', ')}. ${unclear.length === 1 ? 'It is' : 'They are'} marked on the most likely reading and flagged for you to check, not treated as mistakes.`, data: { unclear: unclear.length, veryUnclear } });
    });

    await setState(userId, examId, runId, sub.id, 'matching_questions');
    const match = matchAnswers(record.result, record.corrections, scheme);
    const found = scheme.questions.filter((q) => (match.questions[q.id]?.elementIds.length ?? 0) > 0);
    const missing = scheme.questions.filter((q) => !found.includes(q)).map((q) => q.number);

    await setState(userId, examId, runId, sub.id, 'marking', undefined, { ...ref, type: 'marking_started', progress: runProgress(await load(userId, examId), runId), message: `Marking ${sub.candidateId}.` }, { ...ref, type: 'question_detected', message: `${sub.candidateId}: answers found for ${found.length} of ${scheme.questions.length} questions${missing.length ? ` (not found: ${missing.slice(0, 8).join(', ')})` : ''}. Marking now.`, data: { found: found.length, questions: scheme.questions.length, missing: missing.join(', ').slice(0, 120) || null } });
    exam = await load(userId, examId);
    const agent = deps.agent();
    let marked: Awaited<ReturnType<typeof markCandidate>>;
    try {
      const pref = exam.preferences ?? DEFAULT_PREFERENCES;
      marked = await markCandidate(agent.adapter, agent.model, { scheme, questionIds: scheme.questions.map((q) => q.id), match, questionPaperText: await questionPaperText(userId, exam), runId, schemeVersion: run.schemeVersion, signal, fallbackModel: agent.fallbackModel,
        preferences: { credit: pref.credit, feedback: pref.feedback, instructions: pref.instructions },
        imagesForQuestions: deps.visualEvidence ? ids => markingImages(userId, examId, sub.id, match, ids) : undefined,
        checkpoints: existing?.runId === runId ? Object.fromEntries(existing.questions.filter(q => q.ai).map(q => [q.questionId, q.ai!])) : undefined,
        onStartQuestion: async questionId => {
          await mutate(userId, examId, e => {
            if (!runLive(e, runId)) return;
            const s = e.submissions.find(x => x.id === sub.id)!;
            s.activity = { questionId, at: now() };
            const number = scheme.questions.find((q) => q.id === questionId)?.number ?? questionId;
            emit(e, { ...ref, type: 'question_marking_started', questionId, message: `${sub.candidateId}: marking question ${number}.`, data: { questions: number } });
          });
        },
        onQuestion: async (questionId, ai) => {
          await mutate(userId, examId, (e) => {
            if (!runLive(e, runId)) return;
            const previous = e.results[sub.id];
            const questions: QuestionResult[] = scheme.questions.map((q) => {
              const old = previous?.questions.find((x) => x.questionId === q.id);
              return { questionId: q.id, number: q.number, maxMarks: q.maxMarks,
                ai: q.id === questionId ? ai : previous?.runId === runId ? old?.ai ?? null : null,
                override: old?.override ?? null, confirmed: null,
                mappedElementIds: match.questions[q.id]?.elementIds ?? [], mappingFlags: match.questions[q.id]?.flags ?? [], history: old?.history ?? [] };
            });
            e.resultRevision++;
            e.results[sub.id] = { submissionId: sub.id, candidateId: sub.candidateId, runId, schemeVersion: run.schemeVersion,
              questions, updatedAt: now(), usage: previous?.runId === runId ? previous.usage : { input: 0, output: 0 }, ...(previous?.pen ? { pen: previous.pen } : {}) };
          });
        },
      });
    } catch (e) {
      throw mapProvider(e);
    }

    if (signal.aborted) throw signal.reason;
    await setState(userId, examId, runId, sub.id, 'verifying');
    let chargeLater: Parameters<typeof charge>[3] | null = null;
    await mutate(userId, examId, (e) => {
      // Marks finished after the run was cancelled are dropped: the next run marks this script again.
      if (!runLive(e, runId)) return;
      const prev = e.results[sub.id];
      e.resultRevision++;
      const questions: QuestionResult[] = scheme.questions.map((q) => {
        const old = prev?.questions.find((x) => x.questionId === q.id);
        const ai = marked.marks[q.id];
        const history = [...(old?.history ?? []), { revision: e.resultRevision, at: now(), actor: 'bwenge-ai', kind: 'ai_mark' as const, before: old ? effectiveMarks(old) : null, after: ai.awardedMarks, reason: `Marking run ${runId.slice(0, 8)} (scheme v${run.schemeVersion})` }];
        // An examiner override survives re-marking; the new AI proposal is kept alongside it.
        return { questionId: q.id, number: q.number, maxMarks: q.maxMarks, ai, override: old?.override ?? null, confirmed: null, mappedElementIds: match.questions[q.id]?.elementIds ?? [], mappingFlags: match.questions[q.id]?.flags ?? [], history };
      });
      // The teacher's own pen marks survive re-marking (they are drawn on the page, not tied to the AI's marks).
      e.results[sub.id] = { submissionId: sub.id, candidateId: sub.candidateId, runId, schemeVersion: run.schemeVersion, questions, updatedAt: now(), usage: marked.usage, ...(prev?.pen ? { pen: prev.pen } : {}) };
      chargeLater = { model: deps.agent().model, input: marked.usage.input, output: marked.usage.output, what: 'mark', batch: run.mode === 'overnight', extra: readUsage, second: marked.secondUsage };
      audit(e, { actor: 'bwenge-ai', type: 'marked', submissionId: sub.id, candidateId: sub.candidateId, after: { total: questions.reduce((a, q) => a + (effectiveMarks(q) ?? 0), 0) } });
      const s = e.submissions.find((x) => x.id === sub.id)!;
      s.state = questions.some((q) => openFlags(q).length) ? 'completed_with_warnings' : 'completed';
      s.stateAt = now();
      delete s.error;
      for (const q of questions) {
        const m = effectiveMarks(q);
        const why = q.ai?.lostMarks && m !== null && m < q.maxMarks ? ` ${q.ai.lostMarks}` : '';
        emit(e, { ...ref, questionId: q.questionId, type: 'question_marked', message: `${sub.candidateId} · Q${q.number}: ${m === null ? 'no mark (needs a teacher)' : `${m}/${q.maxMarks}`}.${why}`.slice(0, 220), data: { number: q.number, marks: m, maxMarks: q.maxMarks, confidence: q.ai?.confidence?.level ?? null } });
        const serious = openFlags(q).filter((f) => f.severity === 'high');
        if (serious.length) emit(e, { ...ref, questionId: q.questionId, type: 'teacher_review_required', message: `${sub.candidateId} · Q${q.number} needs your review: ${serious[0].detail}`.slice(0, 220), data: { number: q.number, flags: serious.length } });
      }
      const total = questions.reduce((a, q) => a + (effectiveMarks(q) ?? 0), 0);
      const max = questions.reduce((a, q) => a + q.maxMarks, 0);
      emit(e, { ...ref, type: 'script_marked', message: `${sub.candidateId} marked: ${total}/${max} (provisional until you confirm).`, data: { total, maxTotal: max, provisional: true } });
    });
    if (chargeLater) await charge(userId, examId, runId, chargeLater);
  }

  /**
   * Charges one piece of AI work (never breaks marking) and adds its credits to the run, so the teacher sees
   * what a class cost: reading the handwriting, marking, second markings.
   */
  async function charge(userId: string, examId: string, runId: string | null, u: { model: string; input: number; output: number; what: 'mark' | 'remark' | 'read' | 'split'; batch?: boolean; extra?: Array<{ model: string; input: number; output: number }>; second?: { input: number; output: number } }) {
    const { second, ...usage } = u;
    try { deps.onUsage?.(userId, usage); } catch { /* metering never breaks marking */ }
    if (!runId || !deps.creditsFor) return;
    const credits = deps.creditsFor(u.model, u.input, u.output, u.batch, u.what, u.extra);
    // Split for the breakdown: the reading (extra) is priced on its own; second markings are part of the marking.
    const own = deps.creditsFor(u.model, u.input, u.output, u.batch, u.what);
    const read = credits - own;
    const secondCredits = second && (second.input || second.output) ? Math.min(own, deps.creditsFor(u.model, second.input, second.output, u.batch, 'remark')) : 0;
    await mutate(userId, examId, (e) => {
      const r = e.runs.find((x) => x.id === runId);
      if (!r) return;
      r.credits = (r.credits ?? 0) + credits;
      const by = (r.creditsBy ??= {});
      if (read > 0) by.read = (by.read ?? 0) + read;
      if (secondCredits > 0) by.second = (by.second ?? 0) + secondCredits;
      const key = u.what === 'read' ? 'read' : u.what;
      by[key] = (by[key] ?? 0) + own - secondCredits;
    }).catch(() => undefined);
  }

  /** "reading 120, marking 220, second marking 40" for the end-of-run message. */
  function breakdown(r: MarkingRun): string {
    const b = r.creditsBy;
    if (!b) return '';
    const parts = ([['read', 'reading the handwriting'], ['mark', 'marking'], ['second', 'second marking'], ['split', 'splitting the class PDF'], ['remark', 're-marking']] as const)
      .filter(([k]) => (b[k] ?? 0) > 0).map(([k, label]) => `${label} ${b[k]!.toLocaleString('en-US')}`);
    return parts.length > 1 ? ` (${parts.join(', ')})` : '';
  }

  /** " 42 pages in 6 min, 380 credits." for a live run; overnight runs wait for the batch, so only pages and credits. */
  function timing(subs: Submission[], r: MarkingRun): string {
    const pages = subs.filter((s) => s.state !== 'failed').reduce((a, s) => a + s.pages, 0);
    if (!pages || !r.startedAt || !r.finishedAt) return '';
    if (r.mode === 'overnight') return r.credits ? ` ${pages} page${pages === 1 ? '' : 's'}, ${r.credits.toLocaleString('en-US')} credits${breakdown(r)}, half price overnight.` : '';
    const sec = Math.max(1, Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000));
    return ` ${pages} page${pages === 1 ? '' : 's'} in ${sec < 90 ? `${sec} s` : `${Math.round(sec / 60)} min`}${r.credits ? `, ${r.credits.toLocaleString('en-US')} credits${breakdown(r)}` : ''}.`;
  }

  async function runMarkJob(job: FileJob<MarkJobPayload>, ctx: JobContext) {
    const { examId, runId, segment } = job.payload;
    const userId = job.ownerId;
    const started = Date.now();
    const own = (await load(userId, examId)).runs.find((x) => x.id === runId);
    if (!own) throw new JobError('RUN_NOT_FOUND', 'The marking run is not saved yet.', true);
    if (own.state === 'cancelled') return { examId, runId, state: 'cancelled' };
    const overnight = own.mode === 'overnight';
    // Model calls made by this job (and everything it awaits) are sent as half-price batches.
    if (overnight && !isOvernight()) return runOvernight(() => runMarkJob(job, ctx));
    const segmentBudget = overnight ? OVERNIGHT_BUDGET_MS : budget;
    await mutate(userId, examId, (e) => { const r = e.runs.find((x) => x.id === runId); if (r && r.state === 'queued') { r.state = 'recognizing'; r.startedAt = now(); } });
    const pending = async () => {
      const e = await load(userId, examId);
      const r = e.runs.find((x) => x.id === runId)!;
      return r.submissionIds.filter((id) => { const s = e.submissions.find((x) => x.id === id); return s && !['completed', 'completed_with_warnings', 'failed'].includes(s.state); });
    };
    let queue = await pending();
    const total = (await load(userId, examId)).runs.find((x) => x.id === runId)!.submissionIds.length;
    let continued = false;
    // Scripts marked at the same time. When the provider says it is busy, one fewer runs from then on (never
    // below one), so a big class slows down a little instead of failing scripts.
    let allowed = Math.min(overnight ? OVERNIGHT_CONCURRENCY : concurrency, queue.length || 1);
    const worker = async (slot: number) => {
      while (queue.length && !ctx.signal.aborted) {
        if (slot >= allowed) return;
        if (Date.now() - started > segmentBudget) { continued = true; return; }
        const id = queue.shift()!;
        for (let attempt = 1; ; attempt++) {
          try {
            await processCandidate(userId, examId, runId, id, ctx.signal);
            break;
          } catch (err) {
            const je = err instanceof JobError ? err : err instanceof ExamInputError ? new JobError(err.code, err.message) : null;
            if (ctx.signal.aborted) throw err;
            if (je?.retryable && /BUSY|RATE|OVERLOAD|429/i.test(je.code) && allowed > 1) allowed--;
            if (je?.retryable && attempt < 3) { await sleep((deps.retryDelayMs ?? 4000) * attempt * (0.75 + Math.random() * 0.5), ctx.signal); continue; }
            // One candidate's failure never stops the batch.
            const failed = (await load(userId, examId)).submissions.find((s) => s.id === id);
            const msg = je?.message ?? 'The script could not be processed.';
            await setState(userId, examId, runId, id, 'failed', { code: je?.code ?? 'PROCESSING_FAILED', message: msg }, { runId, submissionId: id, candidateId: failed?.candidateId, type: 'teacher_review_required', message: `${failed?.candidateId ?? 'A script'} could not be marked: ${msg} The other scripts continue.`, data: { code: je?.code ?? 'PROCESSING_FAILED' } });
            break;
          }
        }
        const done = total - (await pending()).length;
        await ctx.progress(`marked ${done} of ${total} scripts`, Math.round((90 * done) / Math.max(1, total)));
      }
    };
    await Promise.all(Array.from({ length: allowed }, (_, slot) => worker(slot)));
    if (ctx.signal.aborted) throw new JobError('CANCELLED', 'Marking was interrupted.', true);
    if (!runLive(await load(userId, examId), runId)) return { examId, runId, state: 'cancelled' };
    queue = await pending();
    if (queue.length && !continued) {
      // Every script of this segment was worked on; one still unfinished would otherwise be handed to
      // continuation jobs forever. Report it instead.
      for (const id of queue) {
        const sub = (await load(userId, examId)).submissions.find((s) => s.id === id);
        await setState(userId, examId, runId, id, 'failed', { code: 'PROCESSING_FAILED', message: 'The script did not finish processing. Ask to re-mark it.' }, { runId, submissionId: id, candidateId: sub?.candidateId, type: 'teacher_review_required', message: `${sub?.candidateId ?? 'A script'} did not finish processing. Ask to re-mark it.` });
      }
      queue = await pending();
    }
    if (queue.length || continued) {
      const next = await queueFor(own).submit<MarkJobPayload>({ type: 'exam.mark', ownerId: userId, payload: { examId, runId, segment: segment + 1 }, idempotencyKey: `${runId}:${segment + 1}`, maxAttempts: 3 });
      await mutate(userId, examId, (e) => { const r = e.runs.find((x) => x.id === runId); if (r && !r.jobIds.includes(next.job.id)) r.jobIds.push(next.job.id); });
      return { examId, runId, continuedIn: next.job.id };
    }
    await mutate(userId, examId, (e) => {
      if (!runLive(e, runId)) return;
      const r = e.runs.find((x) => x.id === runId)!; r.state = 'generating_artifacts';
      emit(e, { runId, jobId: job.id, type: 'pdf_generation_started', progress: runProgress(e, runId), message: 'Drawing red-pen marks on each script and building the report and workbook.' });
    });
    await ctx.progress('generating annotated papers, report and workbook', 92);
    let artifactError: string | null = null;
    let set: ArtifactSet | null = null;
    try { set = await generateArtifacts(userId, examId); } catch (err) { artifactError = err instanceof Error ? err.message : 'Artifact generation failed.'; }
    if (ctx.signal.aborted) throw ctx.signal.reason;
    const e = await mutate(userId, examId, (x) => {
      if (!runLive(x, runId)) return;
      const r = x.runs.find((y) => y.id === runId)!;
      const subs = x.submissions.filter((s) => r.submissionIds.includes(s.id));
      r.state = subs.every((s) => s.state === 'failed') ? 'failed' : subs.some((s) => s.state !== 'completed') || artifactError ? 'completed_with_warnings' : 'completed';
      r.finishedAt = now();
      if (artifactError) r.error = artifactError;
      const pdfs = set ? Object.keys(set.candidatePdfs).length : 0;
      if (set) emit(x, { runId, jobId: job.id, type: 'pdf_generation_completed', message: `${pdfs} marked PDF${pdfs === 1 ? '' : 's'} generated and checked${set.problems.length ? `; ${set.problems.length} note${set.problems.length === 1 ? '' : 's'} for you` : ''}.`, data: { pdfs, verified: set.verified ?? pdfs, problems: set.problems.length } });
      const failedN = subs.filter((s) => s.state === 'failed').length;
      const review = subs.filter((s) => s.state === 'completed_with_warnings').length;
      if (r.state === 'failed') emit(x, { runId, jobId: job.id, type: 'job_failed', progress: runProgress(x, runId), message: `Marking failed for every script${artifactError ? ` (${artifactError.slice(0, 120)})` : ''}. Nothing was lost: re-send or ask to re-mark.`, data: { failed: failedN } });
      else emit(x, { runId, jobId: job.id, type: 'job_completed', progress: runProgress(x, runId), message: `Marking finished: ${subs.length - failedN} of ${subs.length} scripts marked${review ? `, ${review} with items to review` : ''}${failedN ? `, ${failedN} could not be marked` : ''}.${timing(subs, r)} Marks stay provisional until you confirm them.`, data: { state: r.state, credits: r.credits ?? null, pages: subs.filter((s) => s.state !== 'failed').reduce((a, s) => a + s.pages, 0), seconds: r.startedAt ? Math.round((Date.parse(r.finishedAt!) - Date.parse(r.startedAt)) / 1000) : null, marked: subs.length - failedN, review, failed: failedN, artifactError: artifactError ? artifactError.slice(0, 160) : null } });
    });
    const r = e.runs.find((y) => y.id === runId)!;
    return { examId, runId, state: r.state, artifactError };
  }

  // ── Results, edits and corrections ──────────────────────────────────────
  function summaries(e: ExamRecord) {
    const { summaries: list, scheme, failed } = currentSummaries(e);
    return { list, scheme, failed, stats: scheme ? classStatistics(list, scheme, e.passPercent, failed.length) : null };
  }

  async function overrideMark(userId: string, examId: string, ref: { submission: string; question: string }, input: { marks: number; reason: string }) {
    const exam = await load(userId, examId);
    const sub = findSub(exam, ref.submission);
    const res = sub ? exam.results[sub.id] : undefined;
    if (!sub || !res) throw new ExamInputError('UNKNOWN_CANDIDATE', `No marked script for "${ref.submission}".`, 404);
    const scheme = schemeOf(exam, res.schemeVersion)!;
    const sq = findQuestion(scheme, ref.question);
    const q = sq && res.questions.find((x) => x.questionId === sq.id);
    if (!sq || !q) throw new ExamInputError('UNKNOWN_QUESTION', `No question "${ref.question}" in the marking scheme.`, 404);
    const step = scheme.allowHalfMarks ? Number.isInteger(input.marks * 2) : Number.isInteger(input.marks);
    if (!Number.isFinite(input.marks) || input.marks < 0 || input.marks > sq.maxMarks) throw new ExamInputError('MARK_OUT_OF_RANGE', `Question ${sq.number} is worth ${sq.maxMarks} marks; ${input.marks} is not possible.`, 422);
    if (!step) throw new ExamInputError('MARK_STEP', `The scheme allows ${scheme.allowHalfMarks ? 'half' : 'whole'} marks only.`, 422);
    const conflict = q.ai && !q.ai.answerFound && input.marks > 0 ? 'The marker found no answer for this question; the override keeps your mark and records this note.'
      : sq.workingRequired && q.ai?.criterionResults.length && input.marks >= sq.maxMarks && q.ai.criterionResults.some((c) => sq.criteria.find((x) => x.id === c.criterionId)?.kind === 'method' && c.awardedMarks === 0) ? 'The scheme requires working and the marker found none; full marks is an examiner decision recorded as an override.' : null;
    const before = effectiveMarks(q);
    const updated = await mutate(userId, examId, (e) => {
      const rq = e.results[sub.id].questions.find((x) => x.questionId === sq.id)!;
      e.resultRevision++;
      rq.override = { marks: input.marks, reason: input.reason.slice(0, 1000) || 'Examiner decision', by: userId, at: now(), rubricConflict: conflict };
      rq.confirmed = null;
      rq.history.push({ revision: e.resultRevision, at: now(), actor: userId, kind: 'override', before, after: input.marks, reason: rq.override.reason });
      e.results[sub.id].updatedAt = now();
      audit(e, { actor: userId, type: 'override', submissionId: sub.id, candidateId: sub.candidateId, questionId: sq.id, before, after: input.marks, reason: rq.override.reason });
    });
    return { exam: updated, candidateId: sub.candidateId, question: sq.number, before, after: input.marks, rubricConflict: conflict };
  }

  async function confirmResults(userId: string, examId: string, ref: { submission: string; question?: string }) {
    const exam = await load(userId, examId);
    const sub = findSub(exam, ref.submission);
    if (!sub || !exam.results[sub.id]) throw new ExamInputError('UNKNOWN_CANDIDATE', `No marked script for "${ref.submission}".`, 404);
    const scheme = schemeOf(exam, exam.results[sub.id].schemeVersion)!;
    const sq = ref.question ? findQuestion(scheme, ref.question) : null;
    if (ref.question && !sq) throw new ExamInputError('UNKNOWN_QUESTION', `No question "${ref.question}".`, 404);
    const unmarked = exam.results[sub.id].questions.filter((q) => (!sq || q.questionId === sq.id) && effectiveMarks(q) === null);
    if (unmarked.length) throw new ExamInputError('UNMARKED', `Question(s) ${unmarked.map((q) => q.number).join(', ')} have no mark yet; set a mark before confirming.`, 409);
    return mutate(userId, examId, (e) => {
      e.resultRevision++;
      for (const q of e.results[sub.id].questions) {
        if (sq && q.questionId !== sq.id) continue;
        q.confirmed = { by: userId, at: now() };
        q.history.push({ revision: e.resultRevision, at: now(), actor: userId, kind: 'confirm', before: effectiveMarks(q), after: effectiveMarks(q), reason: 'Confirmed by user' });
      }
      e.results[sub.id].updatedAt = now();
      audit(e, { actor: userId, type: 'confirm', submissionId: sub.id, candidateId: sub.candidateId, questionId: sq?.id });
    });
  }

  /**
   * Records a transcription correction on the candidate's document (original reading kept), then queues
   * re-marking of only the questions whose evidence or matched answer uses that element.
   */
  async function correctTranscription(userId: string, examId: string, ref: { submission: string }, input: { elementId?: string; page?: number; from?: string; to: string; remark?: boolean }) {
    const exam = await load(userId, examId);
    const sub = findSub(exam, ref.submission);
    if (!sub?.documentId) throw new ExamInputError('UNKNOWN_CANDIDATE', `No recognised script for "${ref.submission}".`, 404);
    const doc = await deps.documents.get(userId, sub.documentId);
    if (!doc) throw new ExamInputError('DOCUMENT_EXPIRED', 'The recognised script has expired; upload it again.', 410);
    const els = doc.result.pages.flatMap((p) => p.elements.map((e) => ({ page: p.page, el: e, text: finalText(e, doc.corrections) })));
    let target = input.elementId ? els.find((x) => x.el.id === input.elementId) : undefined;
    if (!target && input.from) {
      const hits = els.filter((x) => (!input.page || x.page === input.page) && x.text.includes(input.from!));
      if (hits.length > 1) throw new ExamInputError('AMBIGUOUS_CORRECTION', `"${input.from}" appears in ${hits.length} places${input.page ? ` on page ${input.page}` : ''}. Say which page or element (${hits.slice(0, 5).map((h) => `${h.el.id} on page ${h.page}`).join(', ')}).`, 409, hits.map((h) => ({ elementId: h.el.id, page: h.page, text: h.text.slice(0, 200) })));
      target = hits[0];
    }
    if (!target) throw new ExamInputError('UNKNOWN_ELEMENT', input.from ? `"${input.from}" was not found in ${sub.candidateId}'s script${input.page ? ` on page ${input.page}` : ''}.` : 'Say which text to correct.', 404);
    const newText = input.from && !input.elementId ? target.text.split(input.from).join(input.to) : input.to;
    await deps.documents.correct(userId, sub.documentId, { elementId: target.el.id, text: newText });
    const res = exam.results[sub.id];
    const affected = res ? res.questions.filter((q) => q.ai?.evidenceElementIds.includes(target!.el.id) || q.mappedElementIds.includes(target!.el.id)).map((q) => q.questionId) : [];
    await mutate(userId, examId, (e) => {
      e.resultRevision++;
      const result = e.results[sub.id];
      if (result) {
        result.updatedAt = now(); result.released = null;
        for (const q of result.questions.filter(q => affected.includes(q.questionId))) {
          q.confirmed = null;
          if (q.ai && !q.ai.reviewFlags.some(f => f.code === 'transcription_affects_mark'))
            q.ai.reviewFlags.push({ code: 'transcription_affects_mark', severity: 'high', detail: 'The reading was corrected. Re-mark or review this question before release.' });
        }
      }
      audit(e, { actor: userId, type: 'transcription_correction', submissionId: sub.id, candidateId: sub.candidateId, before: target!.text.slice(0, 500), after: newText.slice(0, 500), reason: `element ${target!.el.id} on page ${target!.page}` });
    });
    let jobId: string | null = null;
    // The correction is the teacher's own data and is always saved; re-marking with the AI needs the plan.
    const premium = deps.entitlement ? await deps.entitlement(userId) : { allowed: true as const, message: undefined };
    if (input.remark !== false && affected.length && premium.allowed) {
      const { job } = await deps.queue.submit<RemarkJobPayload>({ type: 'exam.remark', ownerId: userId, payload: { examId, submissionId: sub.id, questionIds: affected, reason: `Transcription corrected: "${target.text.slice(0, 80)}" → "${newText.slice(0, 80)}"`, actor: userId } });
      jobId = job.id;
    }
    return { candidateId: sub.candidateId, elementId: target.el.id, page: target.page, before: target.text, after: newText, affectedQuestionIds: affected, jobId, ...(input.remark !== false && affected.length && !premium.allowed ? { remarkSkipped: premium.message ?? 'Re-marking needs an upgraded plan.' } : {}) };
  }

  async function remarkQuestions(userId: string, examId: string, submissionId: string, questionIds: string[], reason: string, actor: string, signal?: AbortSignal) {
    const exam = await load(userId, examId);
    const sub = exam.submissions.find((s) => s.id === submissionId);
    const res = exam.results[submissionId];
    if (!sub?.documentId || !res) throw new JobError('NOT_MARKED', 'This script has not been marked yet.');
    const doc = await deps.documents.get(userId, sub.documentId);
    if (!doc) throw new JobError('DOCUMENT_EXPIRED', 'The recognised script has expired.');
    const scheme = schemeOf(exam, res.schemeVersion)!;
    const match = matchAnswers(doc.result, doc.corrections, scheme);
    const agent = deps.agent();
    let marked: Awaited<ReturnType<typeof markCandidate>>;
    await deps.beforeAi?.(userId);
    try {
      marked = await markCandidate(agent.adapter, agent.model, { imagesForQuestions: deps.visualEvidence ? ids => markingImages(userId, examId, sub.id, match, ids) : undefined, scheme, questionIds, match, questionPaperText: await questionPaperText(userId, exam), runId: res.runId, schemeVersion: res.schemeVersion, signal, fallbackModel: agent.fallbackModel });
    } catch (e) { throw mapProvider(e); }
    const correctedIds = new Set(doc.corrections.map((c) => c.elementId));
    await mutate(userId, examId, (e) => {
      e.resultRevision++;
      const r = e.results[submissionId];
      for (const qid of questionIds) {
        const q = r.questions.find((x) => x.questionId === qid);
        const ai = marked.marks[qid];
        if (!q || !ai) continue;
        ai.basedOnCorrection = ai.evidenceElementIds.some((id) => correctedIds.has(id)) || (match.questions[qid]?.elementIds ?? []).some((id) => correctedIds.has(id));
        const before = effectiveMarks(q);
        q.ai = ai;
        q.confirmed = null;
        q.mappedElementIds = match.questions[qid]?.elementIds ?? [];
        q.mappingFlags = match.questions[qid]?.flags ?? [];
        q.history.push({ revision: e.resultRevision, at: now(), actor: 'bwenge-ai', kind: 'ai_remark', before, after: effectiveMarks(q), reason });
        audit(e, { actor, type: 'remarked', submissionId, candidateId: sub.candidateId, questionId: qid, before, after: effectiveMarks(q), reason });
      }
      r.updatedAt = now();
      r.usage = { input: r.usage.input + marked.usage.input, output: r.usage.output + marked.usage.output };
      try { deps.onUsage?.(userId, { model: deps.agent().model, input: marked.usage.input, output: marked.usage.output, what: 'remark' }); } catch { /* metering never breaks marking */ }
    });
  }

  /** Queues re-marking of some questions for one candidate (e.g. after the teacher asks for it in chat). */
  async function requestRemark(userId: string, examId: string, submissionRef: string, questionIds: string[] | null, reason: string) {
    const exam = await load(userId, examId);
    await requirePremium(userId);
    const sub = findSub(exam, submissionRef);
    const res = sub ? exam.results[sub.id] : undefined;
    if (!sub || !res) throw new ExamInputError('UNKNOWN_CANDIDATE', `No marked script for "${submissionRef}".`, 404);
    const ids = questionIds?.length ? questionIds : res.questions.map((q) => q.questionId);
    const { job } = await deps.queue.submit<RemarkJobPayload>({ type: 'exam.remark', ownerId: userId, payload: { examId, submissionId: sub.id, questionIds: ids, reason, actor: userId } });
    return job;
  }

  async function runRemarkJob(job: FileJob<RemarkJobPayload>, ctx: JobContext) {
    const p = job.payload;
    await ctx.progress('re-marking the affected questions', 20);
    await remarkQuestions(job.ownerId, p.examId, p.submissionId, p.questionIds, p.reason, p.actor, ctx.signal);
    await ctx.progress('regenerating the report and workbook', 70);
    const set = await generateArtifacts(job.ownerId, p.examId);
    return { examId: p.examId, artifactId: set.id };
  }

  // ── Artifacts ───────────────────────────────────────────────────────────
  function candidateReport(e: ExamRecord, s: CandidateSummary) {
    const r = e.results[s.submissionId];
    return {
      candidateId: s.candidateId, candidateName: s.candidateName, script: s.fileName, examId: e.id, resultRevision: e.resultRevision, markingRunId: r.runId, schemeVersion: r.schemeVersion,
      total: s.total, maxTotal: s.maxTotal, percent: s.percent, complete: s.complete, status: s.status, released: isReleased(r) ? r.released : null,
      questions: r.questions.map((q) => ({
        questionId: q.questionId, number: q.number, maxMarks: q.maxMarks, awardedMarks: effectiveMarks(q), status: s.questions.find((x) => x.questionId === q.questionId)?.status,
        source: q.override ? 'examiner_override' : q.ai?.basedOnCorrection ? 'ai_after_correction' : q.ai ? 'ai' : 'none',
        aiProposedMarks: q.ai?.awardedMarks ?? null, override: q.override, confirmed: q.confirmed,
        criterionResults: q.ai?.criterionResults ?? [], feedback: q.ai?.feedback ?? '', lostMarks: q.ai?.lostMarks ?? '',
        answerAsRead: q.ai?.answerAsRead ?? null, correction: q.ai?.correction ?? null, confidence: q.ai?.confidence ?? null,
        evidenceElementIds: q.ai?.evidenceElementIds ?? [], evidenceQuotes: q.ai?.evidenceQuotes ?? [], openReviewFlags: openFlags(q), history: q.history,
      })),
    };
  }

  async function generateArtifacts(userId: string, examId: string): Promise<ArtifactSet> {
    const exam = await load(userId, examId);
    const { list, scheme, stats } = summaries(exam);
    if (!scheme || !stats) throw new ExamInputError('NOTHING_TO_EXPORT', 'No marked scripts to export yet.', 409);
    const generatedAt = now();
    const runId = exam.runs[exam.runs.length - 1]?.id ?? 'none';
    const schemeVersion = Object.values(exam.results)[0]?.schemeVersion ?? confirmedScheme(exam)?.version ?? 0;
    const prev = exam.artifacts.find((a) => a.status === 'ready');
    const set: ArtifactSet = { id: randomUUID(), resultRevision: exam.resultRevision, createdAt: generatedAt, status: 'generating', candidatePdfs: {}, candidatePdfStamps: {}, problems: [] };
    const files: BundleFile[] = [];
    const pdfPaths: Record<string, string> = {};
    const usedNames = new Set<string>();
    for (const s of list) {
      const sub = exam.submissions.find((x) => x.id === s.submissionId)!;
      const res = exam.results[s.submissionId];
      // A name read from the paper names the file (Uwase_Aline_marked.pdf) instead of a made-up id.
      let name = `${sub.identity === 'paper' && sub.candidateName ? safeName(sub.candidateName) : safeName(s.candidateId)}_marked.pdf`;
      while (usedNames.has(name)) name = name.replace(/_marked\.pdf$/, '_x_marked.pdf');
      usedNames.add(name);
      let pdf: Buffer | null = null;
      // Reuse an unchanged candidate PDF from the previous export.
      if (prev?.candidatePdfs[s.submissionId] && prev.candidatePdfStamps?.[s.submissionId] === pdfStamp(res, (exam.preferences ?? DEFAULT_PREFERENCES).corrections)) {
        try { pdf = (await deps.fileStore.read(prev.candidatePdfs[s.submissionId], userId)).data; set.candidatePdfs[s.submissionId] = prev.candidatePdfs[s.submissionId]; set.verified = (set.verified ?? 0) + 1; } catch { pdf = null; }
      }
      if (!pdf) {
        try {
          const doc = sub.documentId ? await deps.documents.get(userId, sub.documentId) : null;
          if (!doc) throw new Error('The recognised script is no longer available.');
          const original = (await deps.fileStore.read(sub.fileId, userId)).data;
          const draw = () => annotateScript({ original, fileName: sub.fileName, doc: doc.result, result: res, summary: s, scheme, meta: { examTitle: exam.title, examId: exam.id, runId: res.runId, resultRevision: exam.resultRevision, generatedAt }, maxPages: deps.maxPages, released: isReleased(res), corrections: (exam.preferences ?? DEFAULT_PREFERENCES).corrections });
          // Reopen, render and match the PDF to the stored marks before anyone can download it; one redraw on failure.
          let out = await draw();
          const expect = { candidateId: s.candidateId, revision: exam.resultRevision, sourcePages: out.sourcePages, total: s.total, maxTotal: s.maxTotal, placedMarks: out.placed };
          let check = await verifyMarkedPdf(out.pdf, expect);
          if (!check.ok) { out = await draw(); check = await verifyMarkedPdf(out.pdf, { ...expect, sourcePages: out.sourcePages, placedMarks: out.placed }); }
          if (!check.ok) throw new Error(`it failed its final check: ${check.problems.slice(0, 2).join('; ')}`);
          set.verified = (set.verified ?? 0) + 1;
          pdf = out.pdf;
          if (out.summaryOnly.length) set.problems.push(`${s.candidateId}: marks for ${out.summaryOnly.join(', ')} are on the summary page only (answer location uncertain).`);
          set.candidatePdfs[s.submissionId] = (await deps.fileStore.put({ userId, name, mime: 'application/pdf', kind: 'pdf', data: pdf, ttlMs: RETENTION_MS })).id;
        } catch (err) {
          set.problems.push(`${s.candidateId}: the marked PDF could not be generated (${err instanceof Error ? err.message.slice(0, 120) : 'error'}).`);
        }
      }
      set.candidatePdfStamps[s.submissionId] = pdfStamp(res, (exam.preferences ?? DEFAULT_PREFERENCES).corrections);
      if (pdf) { files.push({ path: `candidates/${name}`, data: pdf, kind: 'candidate_pdf' }); pdfPaths[s.submissionId] = `candidates/${name}`; }
      files.push({ path: `reports/${safeName(s.candidateId)}_marking.json`, data: Buffer.from(JSON.stringify(candidateReport(exam, s), null, 2)), kind: 'candidate_report' });
    }
    const pdfFiles = files.filter((f) => f.kind === 'candidate_pdf');
    if (pdfFiles.length) {
      try {
        const combined = await PDFDocument.create();
        for (const f of pdfFiles) {
          const source = await PDFDocument.load(f.data);
          for (const page of await combined.copyPages(source, source.getPageIndices())) combined.addPage(page);
        }
        set.classPdfFileId = (await deps.fileStore.put({ userId, name: 'class-marked-papers.pdf', mime: 'application/pdf', kind: 'pdf', data: Buffer.from(await combined.save()), ttlMs: RETENTION_MS })).id;
      } catch {
        set.problems.push('The combined class PDF could not be created. Download the individual marked PDFs or the class ZIP instead.');
      }
    }
    const meta = { runId, schemeVersion, generatedAt };
    const workbook = await buildWorkbook(exam, scheme, list, stats, meta);
    const data = buildReportData(exam, scheme, list, stats, pdfPaths, meta);
    const html = renderExamReport(data);
    const check = validateExamReport(html, deps.forbiddenStrings);
    if (!check.valid) throw new ExamInputError('ARTIFACT_INVALID', `The results report failed validation: ${check.problems.join('; ')}`, 500);
    const summary = { examId: exam.id, title: exam.title, resultRevision: exam.resultRevision, markingRunId: runId, schemeVersion, generatedAt, passPercent: exam.passPercent, statistics: stats, candidates: list, failed: data.failed, statusNote: 'Marks are AI-proposed unless marked user_confirmed; examiner overrides are recorded separately.' };
    files.push({ path: 'index.html', data: Buffer.from(html), kind: 'report' }, { path: 'results.xlsx', data: workbook, kind: 'workbook' }, { path: 'summary.json', data: Buffer.from(JSON.stringify(summary, null, 2)), kind: 'summary' });
    const { zip } = await buildBundle(files, { examId: exam.id, title: exam.title, resultRevision: exam.resultRevision, runId, schemeVersion, generatedAt, candidates: list.map((s) => ({ candidateId: s.candidateId, submissionId: s.submissionId, sourceSha256: exam.submissions.find((x) => x.id === s.submissionId)!.sha256, pdf: pdfPaths[s.submissionId] ?? null, report: `reports/${safeName(s.candidateId)}_marking.json` })) });
    const stem = safeName(exam.title).slice(0, 40) || 'examination';
    set.workbookFileId = (await deps.fileStore.put({ userId, name: `${stem}-results-r${exam.resultRevision}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'spreadsheet', data: workbook, ttlMs: RETENTION_MS })).id;
    set.summaryFileId = (await deps.fileStore.put({ userId, name: `${stem}-summary-r${exam.resultRevision}.json`, mime: 'application/json', kind: 'text', data: Buffer.from(JSON.stringify(summary, null, 2)), ttlMs: RETENTION_MS })).id;
    set.htmlFileId = (await deps.fileStore.put({ userId, name: `${stem}-report-r${exam.resultRevision}.html`, mime: 'text/html; charset=utf-8', kind: 'document', data: Buffer.from(html), ttlMs: RETENTION_MS })).id;
    set.bundleBytes = zip.length;
    try {
      set.bundleFileId = (await deps.fileStore.put({ userId, name: `${stem}-marking-package-r${exam.resultRevision}.zip`, mime: 'application/zip', kind: 'archive', data: zip, ttlMs: RETENTION_MS })).id;
    } catch (err) {
      set.problems.push(`The complete package (${Math.round(zip.length / 1048576)} MB) is larger than the file store allows; download the workbook, report and papers separately or raise FILE_STORE_MAX_BYTES.`);
    }
    set.status = 'ready';
    await mutate(userId, examId, (e) => {
      e.artifacts.unshift(set);
      e.artifacts = e.artifacts.slice(0, 10);
      audit(e, { actor: userId, type: 'export', after: { artifactId: set.id, resultRevision: set.resultRevision } });
    });
    return set;
  }

  async function requestExport(userId: string, examId: string) {
    const exam = await load(userId, examId);
    if (!Object.keys(exam.results).length) throw new ExamInputError('NOTHING_TO_EXPORT', 'No marked scripts to export yet.', 409);
    await requirePremium(userId);
    const latest = exam.artifacts.find((a) => a.status === 'ready');
    if (latest && latest.resultRevision === exam.resultRevision) return { job: null, artifact: latest, fresh: true };
    const { job } = await deps.queue.submit<ExportJobPayload>({ type: 'exam.export', ownerId: userId, payload: { examId, revision: exam.resultRevision }, idempotencyKey: `${examId}:export:${exam.resultRevision}` });
    return { job, artifact: latest ?? null, fresh: false };
  }

  async function runExportJob(job: FileJob<ExportJobPayload>, ctx: JobContext) {
    await ctx.progress('generating annotated papers, report and workbook', 10);
    const set = await generateArtifacts(job.ownerId, job.payload.examId);
    return { examId: job.payload.examId, artifactId: set.id, resultRevision: set.resultRevision };
  }

  deps.queue.register<MarkJobPayload, unknown>('exam.mark', runMarkJob);
  deps.overnightQueue?.register<MarkJobPayload, unknown>('exam.mark', runMarkJob);
  deps.queue.register<RemarkJobPayload, unknown>('exam.remark', runRemarkJob);
  deps.queue.register<ExportJobPayload, unknown>('exam.export', runExportJob);
  deps.queue.register<SchemeJobPayload, unknown>('exam.scheme', runSchemeJob);

  function artifactRefs(set: ArtifactSet) {
    const ttl = 60 * 60 * 1000;
    const url = (id?: string) => (id ? deps.fileStore.signedUrl(id, ttl) : null);
    return { id: set.id, resultRevision: set.resultRevision, createdAt: set.createdAt, status: set.status, problems: set.problems, classPdfUrl: url(set.classPdfFileId), candidatePdfs: Object.entries(set.candidatePdfs).map(([submissionId, id]) => ({ submissionId, name: `${submissionId}.pdf`, url: url(id) })), bundleUrl: url(set.bundleFileId), workbookUrl: url(set.workbookFileId), reportUrl: url(set.htmlFileId), summaryUrl: url(set.summaryFileId) };
  }

  async function artifacts(userId: string, examId: string) {
    const exam = await load(userId, examId);
    return exam.artifacts.map((a) => ({ ...artifactRefs(a), stale: a.resultRevision !== exam.resultRevision }));
  }

  async function candidateView(userId: string, examId: string, ref: string) {
    const exam = await load(userId, examId);
    const sub = findSub(exam, ref);
    if (!sub) throw new ExamInputError('UNKNOWN_CANDIDATE', `No candidate "${ref}" in this examination.`, 404);
    const res = exam.results[sub.id];
    const scheme = res ? schemeOf(exam, res.schemeVersion) : null;
    const summary = res && scheme ? summarizeCandidate(res, sub, scheme, exam.passPercent) : null;
    const set = exam.artifacts.find((a) => a.status === 'ready' && a.candidatePdfs[sub.id]);
    return {
      submission: { id: sub.id, candidateId: sub.candidateId, candidateName: sub.candidateName ?? null, fileName: sub.fileName, pages: sub.pages, state: sub.state, error: sub.error ?? null, identity: sub.identity },
      summary, result: res ? candidateReport(exam, summary!) : null,
      markedPdf: set ? { fileId: set.candidatePdfs[sub.id], url: deps.fileStore.signedUrl(set.candidatePdfs[sub.id], 60 * 60 * 1000), resultRevision: set.resultRevision, stale: !res || set.candidatePdfStamps[sub.id] !== pdfStamp(res, (exam.preferences ?? DEFAULT_PREFERENCES).corrections) } : null,
    };
  }


  // ── Teacher review: layout adjustments and release ──────────────────────
  async function listExams(userId: string) {
    const exams = await deps.store.list(userId, 50);
    return exams.map((e) => {
      const results = Object.values(e.results);
      return {
        examId: e.id, title: e.title, updatedAt: e.updatedAt, candidates: e.submissions.length, marked: results.length,
        released: results.filter((r) => isReleased(r)).length,
        needsReview: results.filter((r) => !isReleased(r) && r.questions.some((q) => openFlags(q).length || (q.ai?.confidence?.level === 'low'))).length,
      };
    });
  }

  function reviewList(e: ExamRecord) {
    const { summaries: list } = currentSummaries(e);
    return list.map((s) => {
      const r = e.results[s.submissionId];
      return {
        submissionId: s.submissionId, candidateId: s.candidateId, candidateName: s.candidateName, total: s.total, maxTotal: s.maxTotal, percent: s.percent, status: s.status, complete: s.complete,
        openFlags: s.questions.reduce((a, q) => a + q.flags.length, 0),
        lowConfidence: r.questions.filter((q) => q.ai?.confidence?.level === 'low').length,
        released: isReleased(r), releasedAt: isReleased(r) ? r.released!.at : null, changedSinceRelease: !!r.released && !isReleased(r),
      };
    });
  }

  /** Everything the review screen needs for one candidate: pages, where each red item goes, and the saved record. */
  async function reviewCandidate(userId: string, examId: string, ref: string) {
    const exam = await load(userId, examId);
    const sub = findSub(exam, ref);
    const res = sub ? exam.results[sub.id] : undefined;
    if (!sub || !res) throw new ExamInputError('UNKNOWN_CANDIDATE', `No marked script for "${ref}".`, 404);
    const scheme = schemeOf(exam, res.schemeVersion)!;
    const summary = summarizeCandidate(res, sub, scheme, exam.passPercent);
    const doc = sub.documentId ? await deps.documents.get(userId, sub.documentId) : null;
    if (!doc) throw new ExamInputError('DOCUMENT_EXPIRED', 'The recognised script has expired; upload it again.', 410);
    const layout = computeLayout(doc.result, res, summary);
    const view = await candidateView(userId, examId, sub.id);
    return {
      exam: { examId: exam.id, title: exam.title, resultRevision: exam.resultRevision, allowHalfMarks: scheme.allowHalfMarks },
      candidate: { submissionId: sub.id, candidateId: sub.candidateId, candidateName: sub.candidateName ?? null, fileName: sub.fileName },
      summary, layout, released: isReleased(res), releasedAt: isReleased(res) ? res.released!.at : null, changedSinceRelease: !!res.released && !isReleased(res),
      questions: view.result!.questions, markedPdf: view.markedPdf,
      evidence: doc.result.pages.flatMap(p => p.elements.map(el => ({
        id: el.id, page: p.page, text: finalText(el, doc.corrections), handwritten: el.handwritten,
        needsReview: el.needsReview && !doc.corrections.some(c => c.elementId === el.id),
        signals: doc.corrections.some(c => c.elementId === el.id) ? ['Reading corrected by the teacher.'] : el.signals.map(s => s.detail),
        questionIds: res.questions.filter(q => q.mappedElementIds.includes(el.id) || q.ai?.evidenceElementIds.includes(el.id)).map(q => q.questionId),
        cropUrl: `/api/exams/${exam.id}/submissions/${sub.id}/evidence/${encodeURIComponent(el.id)}`,
      }))),
      candidates: reviewList(exam),
    };
  }

  const pageCache = new Map<string, Buffer>();
  /** The candidate's page as displayed (JPEG), for the review screen. The original file is only read. */
  async function pageImage(userId: string, examId: string, ref: string, page: number): Promise<Buffer> {
    const exam = await load(userId, examId);
    const sub = findSub(exam, ref);
    if (!sub) throw new ExamInputError('UNKNOWN_CANDIDATE', `No candidate "${ref}".`, 404);
    const key = `${sub.fileId}:${page}`;
    const hit = pageCache.get(key);
    if (hit) return hit;
    const original = (await deps.fileStore.read(sub.fileId, userId)).data;
    const { pages } = await loadPages(original, sub.fileName, { maxPages: deps.maxPages ?? 50, pdfScale: 3 });
    const src = pages.find((p) => p.page === page);
    if (!src) throw new ExamInputError('UNKNOWN_PAGE', `Page ${page} does not exist.`, 404);
    const jpg = await sharp(src.image, { limitInputPixels: 80_000_000 }).rotate().flatten({ background: '#ffffff' }).resize({ width: 2200, withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    pageCache.set(key, jpg);
    if (pageCache.size > 60) pageCache.delete(pageCache.keys().next().value!);
    return jpg;
  }

  /** A source close-up in original displayed-page coordinates, never an AI-generated reconstruction. */
  async function evidenceCrop(userId: string, examId: string, ref: string, elementId: string) {
    const exam = await load(userId, examId);
    const sub = findSub(exam, ref);
    const doc = sub?.documentId ? await deps.documents.get(userId, sub.documentId) : null;
    const page = doc?.result.pages.find(p => p.elements.some(e => e.id === elementId));
    const el = page?.elements.find(e => e.id === elementId);
    if (!sub || !page || !el) throw new ExamInputError('UNKNOWN_ELEMENT', 'No source region for this answer.', 404);
    const jpg = await pageImage(userId, examId, sub.id, page.page);
    const meta = await sharp(jpg).metadata();
    const points = [
      processedToViewed(el.region.x0, el.region.y0, page), processedToViewed(el.region.x1, el.region.y0, page),
      processedToViewed(el.region.x0, el.region.y1, page), processedToViewed(el.region.x1, el.region.y1, page),
    ];
    const width = meta.width!, height = meta.height!;
    const left = Math.max(0, Math.floor(Math.min(...points.map(p => p.fx)) * width) - 16);
    const top = Math.max(0, Math.floor(Math.min(...points.map(p => p.fy)) * height) - 16);
    const right = Math.min(width, Math.ceil(Math.max(...points.map(p => p.fx)) * width) + 16);
    const bottom = Math.min(height, Math.ceil(Math.max(...points.map(p => p.fy)) * height) + 16);
    if (right <= left || bottom <= top) throw new ExamInputError('INVALID_REGION', 'The answer location is uncertain. Review the full page.', 422);
    return sharp(jpg).extract({ left, top, width: right - left, height: bottom - top }).jpeg({ quality: 95 }).toBuffer();
  }

  async function markingImages(userId: string, examId: string, submissionId: string, match: ReturnType<typeof matchAnswers>, questionIds: string[]) {
    const ids = [...new Set(questionIds.flatMap(id => match.questions[id]?.elementIds ?? []))];
    const pages = [...new Set(match.elements.filter(e => ids.includes(e.id)).map(e => e.page))].slice(0, 2);
    const images: string[] = [];
    for (const page of pages) images.push(`data:image/jpeg;base64,${(await pageImage(userId, examId, submissionId, page)).toString('base64')}`);
    for (const id of ids.slice(0, 3)) {
      try { images.push(`data:image/jpeg;base64,${(await evidenceCrop(userId, examId, submissionId, id)).toString('base64')}`); }
      catch { /* An invalid crop is not evidence; full source pages remain available. */ }
    }
    return images;
  }

  /** Stop active runs and retain validated partial results. Retry starts a new run. */
  async function stopMarking(userId: string, examId: string) {
    const exam = await load(userId, examId);
    const active = exam.runs.filter(r => !['completed', 'completed_with_warnings', 'failed', 'cancelled'].includes(r.state));
    for (const run of active) for (const id of run.jobIds) await queueFor(run).cancel(id, userId);
    await mutate(userId, examId, e => {
      for (const run of e.runs.filter(r => active.some(a => a.id === r.id))) { run.state = 'failed'; run.error = STOPPED; run.finishedAt = now(); }
      for (const sub of e.submissions.filter(s => active.some(r => r.submissionIds.includes(s.id)))) {
        if (!['completed', 'completed_with_warnings'].includes(sub.state)) { sub.state = 'failed'; sub.stateAt = now(); sub.error = { code: 'STOPPED', message: 'Stopped. Saved marks are retained; retry to finish this paper.' }; }
      }
    });
    return { stopped: active.length };
  }

  /** Moves or hides one red item (or resets it to the automatic place). Any change makes the PDF a draft again. */
  async function setLayout(userId: string, examId: string, ref: string, itemId: string, input: { page?: number; fx?: number; fy?: number; hidden?: boolean; reset?: boolean }) {
    const exam = await load(userId, examId);
    const sub = findSub(exam, ref);
    const res = sub ? exam.results[sub.id] : undefined;
    if (!sub || !res) throw new ExamInputError('UNKNOWN_CANDIDATE', `No marked script for "${ref}".`, 404);
    const valid = itemId === 'total' || res.questions.some((q) => itemId === `${q.questionId}:mark` || itemId === `${q.questionId}:correction`
      || q.ai?.criterionResults.some(c => itemId === `${q.questionId}:criterion:${c.criterionId}` || itemId === `${q.questionId}:note:${c.criterionId}` || itemId.startsWith(`${q.questionId}:pen:${c.criterionId}:`)));
    if (!valid) throw new ExamInputError('UNKNOWN_ITEM', `No item "${itemId}" on this script.`, 404);
    if (!input.reset && !input.hidden && (input.page === undefined || input.fx === undefined || input.fy === undefined)) throw new ExamInputError('INVALID_REQUEST', 'Give page, fx and fy, or hidden, or reset.', 400);
    if (input.page !== undefined && (input.page < 1 || input.page > sub.pages)) throw new ExamInputError('UNKNOWN_PAGE', `Page ${input.page} does not exist.`, 404);
    return mutate(userId, examId, (e) => {
      const r = e.results[sub.id];
      const before = r.layout?.[itemId] ?? null;
      r.layout = { ...(r.layout ?? {}) };
      if (input.reset) delete r.layout[itemId];
      else {
        const prev = r.layout[itemId];
        const o: LayoutOverride = input.hidden
          ? { page: prev?.page ?? 1, fx: prev?.fx ?? 0, fy: prev?.fy ?? 0, hidden: true, by: userId, at: now() }
          : { page: input.page!, fx: Math.min(1, Math.max(0, input.fx!)), fy: Math.min(1, Math.max(0, input.fy!)), by: userId, at: now() };
        r.layout[itemId] = o;
      }
      r.updatedAt = now();
      e.resultRevision++;
      audit(e, { actor: userId, type: 'layout', submissionId: sub.id, candidateId: sub.candidateId, before, after: r.layout[itemId] ?? 'automatic', reason: itemId });
    });
  }

  /**
   * The teacher's own pen marks on a page: tick, cross, circle, box, highlight, underline or a short note. They are
   * kept through re-marking and drawn on the marked PDF; any change makes the PDF a draft again.
   */
  async function addPen(userId: string, examId: string, ref: string, input: { page: number; kind: PenKind; x0: number; y0: number; x1?: number; y1?: number; text?: string }) {
    const exam = await load(userId, examId);
    const sub = findSub(exam, ref);
    if (!sub || !exam.results[sub.id]) throw new ExamInputError('UNKNOWN_CANDIDATE', `No marked script for "${ref}".`, 404);
    if (input.page < 1 || input.page > sub.pages) throw new ExamInputError('UNKNOWN_PAGE', `Page ${input.page} does not exist.`, 404);
    const text = typeof input.text === 'string' ? input.text.trim().replace(/\s+/g, ' ').slice(0, 80) : '';
    if (input.kind === 'note' && !text) throw new ExamInputError('INVALID_REQUEST', 'Write the note text.', 400);
    const c = (v: number | undefined, d: number) => Math.min(1, Math.max(0, v ?? d));
    const mark: PenMark = { id: randomUUID().slice(0, 8), page: input.page, kind: input.kind, x0: c(input.x0, 0), y0: c(input.y0, 0), x1: c(input.x1, input.x0), y1: c(input.y1, input.y0), ...(text ? { text } : {}), by: userId, at: now() };
    return mutate(userId, examId, (e) => {
      const r = e.results[sub.id];
      if ((r.pen ?? []).length >= 300) throw new ExamInputError('TOO_MANY_MARKS', 'This script already has 300 pen marks.', 409);
      r.pen = [...(r.pen ?? []), mark];
      r.updatedAt = now();
      e.resultRevision++;
      audit(e, { actor: userId, type: 'layout', submissionId: sub.id, candidateId: sub.candidateId, before: null, after: mark, reason: `pen:${mark.id}` });
    });
  }

  async function removePen(userId: string, examId: string, ref: string, penId: string) {
    const exam = await load(userId, examId);
    const sub = findSub(exam, ref);
    if (!sub || !exam.results[sub.id]?.pen?.some((m) => m.id === penId)) throw new ExamInputError('UNKNOWN_ITEM', `No pen mark "${penId}" on this script.`, 404);
    return mutate(userId, examId, (e) => {
      const r = e.results[sub.id];
      const before = r.pen?.find((m) => m.id === penId) ?? null;
      r.pen = (r.pen ?? []).filter((m) => m.id !== penId);
      r.updatedAt = now();
      e.resultRevision++;
      audit(e, { actor: userId, type: 'layout', submissionId: sub.id, candidateId: sub.candidateId, before, after: 'removed', reason: `pen:${penId}` });
    });
  }

  /**
   * Releases marked PDFs. A candidate is released only when every question has a mark; releasing confirms the
   * marks as the teacher's. The release stays valid until marks or layout change.
   */
  async function release(userId: string, examId: string, refs: string[] | 'all') {
    const exam = await load(userId, examId);
    const subs = refs === 'all' ? exam.submissions.filter((s) => exam.results[s.id]) : refs.map((r) => findSub(exam, r)).filter((s): s is Submission => !!s);
    const released: string[] = [];
    const skipped: Array<{ candidateId: string; reason: string }> = [];
    for (const s of subs) {
      const r = exam.results[s.id];
      if (!r) { skipped.push({ candidateId: s.candidateId, reason: 'not marked yet' }); continue; }
      const unmarked = r.questions.filter((q) => effectiveMarks(q) === null).map((q) => q.number);
      if (unmarked.length) { skipped.push({ candidateId: s.candidateId, reason: `question ${unmarked.join(', ')} has no mark` }); continue; }
      if (isReleased(r)) { released.push(s.candidateId); continue; }
      released.push(s.candidateId);
    }
    const ids = new Set(subs.filter((s) => released.includes(s.candidateId)).map((s) => s.id));
    const updated = await mutate(userId, examId, (e) => {
      for (const id of ids) {
        const r = e.results[id];
        if (isReleased(r)) continue;
        e.resultRevision++;
        const at = now();
        for (const q of r.questions) if (!q.confirmed) { q.confirmed = { by: userId, at }; q.history.push({ revision: e.resultRevision, at, actor: userId, kind: 'confirm', before: effectiveMarks(q), after: effectiveMarks(q), reason: 'Confirmed on release' }); }
        r.updatedAt = at;
        r.released = { at, by: userId, resultUpdatedAt: at };
        const sub = e.submissions.find((x) => x.id === id)!;
        audit(e, { actor: userId, type: 'release', submissionId: id, candidateId: sub.candidateId });
      }
    });
    return { exam: updated, released, skipped };
  }

  function progress(e: ExamRecord) {
    const run = e.runs[e.runs.length - 1] ?? null;
    const subs = run ? e.submissions.filter((s) => run.submissionIds.includes(s.id)) : e.submissions;
    const counts: Partial<Record<CandidateState, number>> = {};
    for (const s of subs) counts[s.state] = (counts[s.state] ?? 0) + 1;
    const scheme = run ? schemeOf(e, run.schemeVersion) : confirmedScheme(e)?.scheme;
    const totalQuestions = subs.length * (scheme?.questions.length ?? 0);
    const savedQuestions = subs.reduce((n, s) => n + ((!run || e.results[s.id]?.runId === run.id) && e.results[s.id]?.schemeVersion === (run?.schemeVersion ?? confirmedScheme(e)?.version)
      ? e.results[s.id].questions.filter(q => q.ai).length : 0), 0);
    const finished = subs.filter(s => ['completed', 'completed_with_warnings'].includes(s.state)).length;
    const failed = subs.filter(s => s.state === 'failed').length;
    const active = subs.filter(s => !['queued', 'completed', 'completed_with_warnings', 'failed'].includes(s.state)).map(s => ({
      submissionId: s.id, name: s.candidateName || s.candidateId, stage: s.state,
      question: scheme?.questions.find(q => q.id === s.activity?.questionId)?.number ?? null,
      since: s.activity?.at ?? s.stateAt,
    }));
    const work = { totalQuestions, savedQuestions, finished, failed, total: subs.length, active,
      percent: totalQuestions ? Math.min(100, Math.floor(savedQuestions / totalQuestions * 100)) : 0 };
    return { work, run: run ? { id: run.id, state: run.state, schemeVersion: run.schemeVersion, startedAt: run.startedAt ?? null, finishedAt: run.finishedAt ?? null, error: run.error ?? null } : null, counts, candidates: subs.map((s) => ({ submissionId: s.id, candidateId: s.candidateId, state: s.state, stateAt: s.stateAt, error: s.error ?? null })) };
  }

  // ── Live events, cancellation and preferences ──────────────────────────
  /** Events after a sequence number (replay for a viewer that connects or reconnects). */
  async function eventsSince(userId: string, examId: string, after = 0) {
    const e = await load(userId, examId);
    const events = (e.events ?? []).filter((ev) => ev.seq > after);
    const first = e.events?.[0]?.seq ?? 1;
    // When older events were trimmed the viewer missed some: it should refresh the full state.
    return { events, lastSeq: e.eventSeq ?? 0, gap: after > 0 && after < first - 1 };
  }

  /** Stops the active run. Finished scripts keep their marks; unfinished ones go back to the queue. */
  async function cancelRun(userId: string, examId: string) {
    const exam = await load(userId, examId);
    const run = [...exam.runs].reverse().find((r) => !['completed', 'completed_with_warnings', 'failed', 'cancelled'].includes(r.state));
    if (!run) throw new ExamInputError('NO_ACTIVE_RUN', 'There is no marking in progress to cancel.', 409);
    for (const id of run.jobIds) await queueFor(run).cancel(id, userId).catch(() => null);
    const e = await mutate(userId, examId, (x) => {
      const r = x.runs.find((y) => y.id === run.id)!;
      r.state = 'cancelled';
      r.finishedAt = now();
      for (const s of x.submissions) if (r.submissionIds.includes(s.id) && !['completed', 'completed_with_warnings', 'failed'].includes(s.state)) { s.state = 'queued'; s.stateAt = now(); }
      const p = runProgress(x, r.id);
      emit(x, { runId: r.id, type: 'job_cancelled', progress: p, message: `Marking cancelled. ${p.done} of ${p.total} scripts were finished and keep their marks; the rest are waiting. Say "mark" to continue.`, data: { done: p.done, total: p.total } });
    });
    return { runId: run.id, state: 'cancelled' as const, done: runProgress(e, run.id).done };
  }

  async function setPreferences(userId: string, examId: string, patch: Partial<Omit<MarkingPreferences, 'updatedAt'>>) {
    const clean: Partial<MarkingPreferences> = {};
    if (patch.credit === 'partial' || patch.credit === 'strict') clean.credit = patch.credit;
    if (typeof patch.corrections === 'boolean') clean.corrections = patch.corrections;
    if (patch.feedback === 'brief' || patch.feedback === 'detailed') clean.feedback = patch.feedback;
    if (typeof patch.instructions === 'string') clean.instructions = patch.instructions.replace(/\s+\n/g, '\n').trim().slice(0, 2000);
    if (typeof patch.overnight === 'boolean') {
      if (patch.overnight && !deps.overnightQueue) throw new ExamInputError('OVERNIGHT_UNAVAILABLE', 'Overnight marking is not available right now.', 503);
      clean.overnight = patch.overnight;
    }
    if (!Object.keys(clean).length) throw new ExamInputError('INVALID_PREFERENCES', 'Choose credit (partial or strict), corrections (true or false), feedback (brief or detailed) or marking instructions.');
    const e = await mutate(userId, examId, (x) => { x.preferences = { ...(x.preferences ?? DEFAULT_PREFERENCES), ...clean, updatedAt: now() }; });
    return e.preferences!;
  }

  return {
    /** Whether overnight (half-price batch) marking can be chosen. */
    overnightAvailable: () => !!deps.overnightQueue,
    eventsSince, subscribe, cancelRun, setPreferences,
    createExam, load, mutate, stopMarking, setSchemeJson, confirmScheme, editSchemeQuestion, submitSchemeDocuments, addSubmissions, startMarking,
    summaries, overrideMark, confirmResults, correctTranscription, remarkQuestions, requestRemark, generateArtifacts, requestExport, artifacts, artifactRefs, candidateView, progress,
    latestScheme, confirmedScheme, findSub, findQuestion,
    listExams, reviewList, reviewCandidate, pageImage, evidenceCrop, setLayout, addPen, removePen, release, draftScheme,
  };
}

export type ExamService = ReturnType<typeof createExamService>;
