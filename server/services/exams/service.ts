import { createHash, randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import type { FileStore } from '../ai/files/FileStore.js';
import { extractText } from '../ai/files/extract.js';
import { FileJobQueue, JobError, type FileJob, type JobContext } from '../ai/jobs/fileJobQueue.js';
import { StructuredOutputError } from '../ai/llm/structuredJson.js';
import type { ProviderAdapter } from '../ai/providers/types.js';
import { documentText, finalText } from '../documents/pipeline.js';
import type { DocumentService } from '../documents/service.js';
import { OwnedRecordStore, type OwnedRecord } from '../storage/ownedRecordStore.js';
import { annotateScript } from './annotate.js';
import { buildBundle, safeName, type BundleFile } from './bundle.js';
import { markCandidate } from './marking.js';
import { matchAnswers } from './matching.js';
import { buildReportData, renderExamReport, validateExamReport } from './report.js';
import { classStatistics, currentSummaries, effectiveMarks, openFlags, schemeOf, summarizeCandidate, type CandidateSummary } from './results.js';
import { changedQuestions, extractScheme, questionKey, validateScheme, type MarkingScheme } from './scheme.js';
import type { ArtifactSet, AuditEvent, CandidateResult, CandidateState, ExamRecord, MarkingRun, QuestionResult, SchemeVersion, Submission } from './types.js';
import { buildWorkbook } from './workbook.js';

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
  store: OwnedRecordStore<ExamRecord>;
  documents: DocumentService;
  /** Text model for scheme extraction and marking. */
  agent: () => { adapter: ProviderAdapter; model: string; fallbackModel?: string | null };
  /** Whether handwriting recognition is available (a vision-capable model is configured). */
  visionAvailable: () => boolean;
  forbiddenStrings?: string[];
  maxPages?: number;
  maxCandidates?: number;
  candidateConcurrency?: number;
  /** Time a marking job works before handing over to a continuation job (stays under the queue deadline). */
  segmentBudgetMs?: number;
  retryDelayMs?: number;
}

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const now = () => new Date().toISOString();
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res) => { const t = setTimeout(res, ms); signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true }); });

interface MarkJobPayload { examId: string; runId: string; segment: number }
interface RemarkJobPayload { examId: string; submissionId: string; questionIds: string[]; reason: string; actor: string }
interface ExportJobPayload { examId: string; revision: number }
interface SchemeJobPayload { examId: string; schemeFileIds: Array<{ fileId: string; name: string }>; questionPaper?: { fileId: string; name: string }; autoMark: boolean; actor: string }

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
  const concurrency = Math.max(1, deps.candidateConcurrency ?? 2);
  const budget = deps.segmentBudgetMs ?? 8 * 60 * 1000;
  const maxCandidates = deps.maxCandidates ?? 100;

  // Serialises read-modify-write updates per exam (candidates are processed concurrently).
  const locks = new Map<string, Promise<unknown>>();
  async function mutate(userId: string, examId: string, fn: (e: ExamRecord) => void): Promise<ExamRecord> {
    const prev = locks.get(examId) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(async () => {
      const rec = await deps.store.update(examId, userId, (e) => { fn(e); });
      if (!rec) throw new ExamInputError('NOT_FOUND', 'Examination not found.', 404);
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
    if (!input.scheme.length) throw new ExamInputError('NO_SCHEME', 'Upload the official marking scheme.');
    await load(userId, examId);
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
    await ctx.progress('reading the marking scheme', 10);
    const texts: string[] = [];
    for (const f of p.schemeFileIds) texts.push((await documentTextOf(job.ownerId, f.fileId, f.name, ctx)).text);
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
      extracted = await extractScheme(agent.adapter, agent.model, texts.join('\n\n'), { questionPaperText: qpText, title: exam.title !== 'Examination' ? exam.title : undefined, signal: ctx.signal, fallbackModel: agent.fallbackModel });
    } catch (e) {
      if (e instanceof StructuredOutputError) throw new JobError('SCHEME_EXTRACTION_FAILED', 'The marking scheme could not be structured. Send it as text or JSON, or try again.');
      throw mapProvider(e);
    }
    let sv: SchemeVersion | undefined;
    await mutate(job.ownerId, p.examId, (e) => {
      sv = addSchemeVersion(e, p.actor, {
        scheme: extracted.validation.scheme, errors: extracted.validation.errors, warnings: [...extracted.validation.warnings, ...extracted.ambiguities],
        source: { kind: 'document', fileIds: p.schemeFileIds.map((f) => f.fileId), note: p.schemeFileIds.map((f) => f.name).join(', ') }, autoConfirm: true,
      });
      if (sv.scheme && e.title === 'Examination') e.title = sv.scheme.title;
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
      if (!m.format || !['jpeg', 'png', 'webp', 'tiff'].includes(m.format)) throw new Error('format');
      return { mime: `image/${m.format}`, pages: m.format === 'tiff' ? m.pages ?? 1 : 1 };
    } catch {
      throw new ExamInputError('UNSUPPORTED_FORMAT', `${f.name} is not a PDF or a supported image (JPEG, PNG, WebP, TIFF).`);
    }
  }

  /**
   * Registers candidate scripts. Identity comes from an explicit mapping/manifest, then a candidate id in
   * the file name, otherwise a new sequential id (reported back so the teacher can see the mapping).
   * Never reads identity from handwriting on the page.
   */
  async function addSubmissions(userId: string, examId: string, files: UploadFile[], mapping: CandidateMapping[] = []) {
    const exam = await load(userId, examId);
    if (!files.length) throw new ExamInputError('NO_FILES', 'Attach at least one candidate script.');
    if (exam.submissions.length + files.length > maxCandidates) throw new ExamInputError('TOO_MANY_CANDIDATES', `At most ${maxCandidates} candidates per examination.`, 413);
    const accepted: Submission[] = [];
    const rejected: Array<{ fileName: string; code: string; reason: string }> = [];
    const byFile = new Map(mapping.map((m) => [m.fileName.toLowerCase(), m]));
    const taken = new Set(exam.submissions.map((s) => s.candidateId.toLowerCase()));
    const hashes = new Map(exam.submissions.map((s) => [s.sha256, s.candidateId]));
    let seq = exam.submissions.length;
    // Explicit ids (mapping or file name) are reserved first so a newly assigned id never takes one of them.
    const explicit = new Map(files.map((f) => [f, byFile.get(f.name.toLowerCase())?.candidateId?.trim() || candidateIdFromFileName(f.name) || null]));
    const reserved = new Set([...explicit.values()].filter((x): x is string => !!x).map((x) => x.toLowerCase()));
    for (const f of files) {
      try {
        const info = await inspectFile(f);
        if (info.pages > (deps.maxPages ?? 20)) throw new ExamInputError('TOO_MANY_PAGES', `${f.name} has ${info.pages} pages; the limit is ${deps.maxPages ?? 20}.`, 413);
        const hash = sha256(f.buffer);
        if (hashes.has(hash)) throw new ExamInputError('DUPLICATE', `${f.name} is identical to the script of ${hashes.get(hash)}.`, 409);
        const m = byFile.get(f.name.toLowerCase());
        let candidateId = explicit.get(f) ?? undefined;
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
  async function startMarking(userId: string, examId: string, opts: { submissionIds?: string[]; remarkAll?: boolean } = {}) {
    const exam = await load(userId, examId);
    const sv = confirmedScheme(exam);
    if (!sv?.scheme) {
      const latest = latestScheme(exam);
      throw new ExamInputError(latest ? 'SCHEME_NOT_CONFIRMED' : 'NO_SCHEME', latest ? 'Confirm the marking scheme before marking starts.' : 'Upload the official marking scheme first.', 409, latest?.errors);
    }
    if (!deps.visionAvailable()) throw new ExamInputError('VISION_MODEL_UNAVAILABLE', 'Handwriting recognition needs a vision-capable model (set AI_AGENT_PROVIDER=anthropic).', 503);
    const ids = (opts.submissionIds?.length ? opts.submissionIds : exam.submissions.filter((s) => opts.remarkAll || s.state === 'queued' || s.state === 'failed' || !exam.results[s.id] || exam.results[s.id].schemeVersion !== sv.version).map((s) => s.id))
      .filter((id) => exam.submissions.some((s) => s.id === id));
    if (!ids.length) throw new ExamInputError('NOTHING_TO_MARK', 'Every script is already marked with the current scheme. Ask to re-mark if you want a fresh run.', 409);
    const active = exam.runs.find((r) => !['completed', 'completed_with_warnings', 'failed'].includes(r.state));
    if (active) throw new ExamInputError('RUN_IN_PROGRESS', 'A marking run is already in progress for this examination.', 409);
    const run: MarkingRun = { id: randomUUID(), schemeVersion: sv.version, submissionIds: ids, state: 'queued', createdAt: now(), createdBy: userId, jobIds: [] };
    const { job } = await deps.queue.submit<MarkJobPayload>({ type: 'exam.mark', ownerId: userId, payload: { examId, runId: run.id, segment: 0 }, idempotencyKey: `${run.id}:0`, maxAttempts: 3 });
    run.jobIds.push(job.id);
    await mutate(userId, examId, (e) => {
      e.runs.push(run);
      for (const s of e.submissions) if (ids.includes(s.id)) { s.state = 'queued'; s.stateAt = now(); delete s.error; }
    });
    return { runId: run.id, jobId: job.id, candidates: ids.length, schemeVersion: sv.version };
  }

  async function setState(userId: string, examId: string, submissionId: string, state: CandidateState, error?: { code: string; message: string }) {
    await mutate(userId, examId, (e) => {
      const s = e.submissions.find((x) => x.id === submissionId);
      if (s) { s.state = state; s.stateAt = now(); if (error) s.error = error; else delete s.error; }
    });
  }

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
    if (existing?.runId === runId && existing.questions.every((q) => q.ai)) return; // already done in an earlier attempt

    await setState(userId, examId, sub.id, 'validating');
    let original: Buffer;
    try { original = (await deps.fileStore.read(sub.fileId, userId)).data; } catch { throw new JobError('SOURCE_UNAVAILABLE', 'The uploaded script is no longer available.'); }

    await setState(userId, examId, sub.id, 'recognizing');
    const { record, cached, key } = await deps.documents.recognizeCached(userId, { buffer: original, name: sub.fileName, sourceFileId: sub.fileId }, { crossCheck: true }, { signal });
    await mutate(userId, examId, (e) => { const s = e.submissions.find((x) => x.id === sub.id)!; s.documentId = record.id; s.recognitionCached = cached; s.recognitionKey = key; });

    await setState(userId, examId, sub.id, 'matching_questions');
    const match = matchAnswers(record.result, record.corrections, scheme);

    await setState(userId, examId, sub.id, 'marking');
    exam = await load(userId, examId);
    const agent = deps.agent();
    let marked: Awaited<ReturnType<typeof markCandidate>>;
    try {
      marked = await markCandidate(agent.adapter, agent.model, { scheme, questionIds: scheme.questions.map((q) => q.id), match, questionPaperText: await questionPaperText(userId, exam), runId, schemeVersion: run.schemeVersion, signal, fallbackModel: agent.fallbackModel });
    } catch (e) {
      throw mapProvider(e);
    }

    await setState(userId, examId, sub.id, 'verifying');
    await mutate(userId, examId, (e) => {
      const prev = e.results[sub.id];
      e.resultRevision++;
      const questions: QuestionResult[] = scheme.questions.map((q) => {
        const old = prev?.questions.find((x) => x.questionId === q.id);
        const ai = marked.marks[q.id];
        const history = [...(old?.history ?? []), { revision: e.resultRevision, at: now(), actor: 'bwenge-ai', kind: 'ai_mark' as const, before: old ? effectiveMarks(old) : null, after: ai.awardedMarks, reason: `Marking run ${runId.slice(0, 8)} (scheme v${run.schemeVersion})` }];
        // An examiner override survives re-marking; the new AI proposal is kept alongside it.
        return { questionId: q.id, number: q.number, maxMarks: q.maxMarks, ai, override: old?.override ?? null, confirmed: null, mappedElementIds: match.questions[q.id]?.elementIds ?? [], mappingFlags: match.questions[q.id]?.flags ?? [], history };
      });
      e.results[sub.id] = { submissionId: sub.id, candidateId: sub.candidateId, runId, schemeVersion: run.schemeVersion, questions, updatedAt: now(), usage: marked.usage };
      audit(e, { actor: 'bwenge-ai', type: 'marked', submissionId: sub.id, candidateId: sub.candidateId, after: { total: questions.reduce((a, q) => a + (effectiveMarks(q) ?? 0), 0) } });
      const s = e.submissions.find((x) => x.id === sub.id)!;
      s.state = questions.some((q) => openFlags(q).length) ? 'completed_with_warnings' : 'completed';
      s.stateAt = now();
      delete s.error;
    });
  }

  async function runMarkJob(job: FileJob<MarkJobPayload>, ctx: JobContext) {
    const { examId, runId, segment } = job.payload;
    const userId = job.ownerId;
    const started = Date.now();
    await mutate(userId, examId, (e) => { const r = e.runs.find((x) => x.id === runId); if (r && r.state === 'queued') { r.state = 'recognizing'; r.startedAt = now(); } });
    const pending = async () => {
      const e = await load(userId, examId);
      const r = e.runs.find((x) => x.id === runId)!;
      return r.submissionIds.filter((id) => { const s = e.submissions.find((x) => x.id === id); return s && !['completed', 'completed_with_warnings', 'failed'].includes(s.state); });
    };
    let queue = await pending();
    const total = (await load(userId, examId)).runs.find((x) => x.id === runId)!.submissionIds.length;
    let continued = false;
    const worker = async () => {
      while (queue.length && !ctx.signal.aborted) {
        if (Date.now() - started > budget) { continued = true; return; }
        const id = queue.shift()!;
        for (let attempt = 1; ; attempt++) {
          try {
            await processCandidate(userId, examId, runId, id, ctx.signal);
            break;
          } catch (err) {
            const je = err instanceof JobError ? err : err instanceof ExamInputError ? new JobError(err.code, err.message) : null;
            if (ctx.signal.aborted) throw err;
            if (je?.retryable && attempt < 3) { await sleep((deps.retryDelayMs ?? 4000) * attempt * (0.75 + Math.random() * 0.5), ctx.signal); continue; }
            // One candidate's failure never stops the batch.
            await setState(userId, examId, id, 'failed', { code: je?.code ?? 'PROCESSING_FAILED', message: je?.message ?? 'The script could not be processed.' });
            break;
          }
        }
        const done = total - (await pending()).length;
        await ctx.progress(`marked ${done} of ${total} scripts`, Math.round((90 * done) / Math.max(1, total)));
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, worker));
    if (ctx.signal.aborted) throw new JobError('CANCELLED', 'Marking was interrupted.', true);
    queue = await pending();
    if (queue.length || continued) {
      const next = await deps.queue.submit<MarkJobPayload>({ type: 'exam.mark', ownerId: userId, payload: { examId, runId, segment: segment + 1 }, idempotencyKey: `${runId}:${segment + 1}`, maxAttempts: 3 });
      await mutate(userId, examId, (e) => { const r = e.runs.find((x) => x.id === runId); if (r && !r.jobIds.includes(next.job.id)) r.jobIds.push(next.job.id); });
      return { examId, runId, continuedIn: next.job.id };
    }
    await mutate(userId, examId, (e) => { const r = e.runs.find((x) => x.id === runId)!; r.state = 'generating_artifacts'; });
    await ctx.progress('generating annotated papers, report and workbook', 92);
    let artifactError: string | null = null;
    try { await generateArtifacts(userId, examId); } catch (err) { artifactError = err instanceof Error ? err.message : 'Artifact generation failed.'; }
    const e = await mutate(userId, examId, (x) => {
      const r = x.runs.find((y) => y.id === runId)!;
      const subs = x.submissions.filter((s) => r.submissionIds.includes(s.id));
      r.state = subs.every((s) => s.state === 'failed') ? 'failed' : subs.some((s) => s.state !== 'completed') || artifactError ? 'completed_with_warnings' : 'completed';
      r.finishedAt = now();
      if (artifactError) r.error = artifactError;
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
      audit(e, { actor: userId, type: 'transcription_correction', submissionId: sub.id, candidateId: sub.candidateId, before: target!.text.slice(0, 500), after: newText.slice(0, 500), reason: `element ${target!.el.id} on page ${target!.page}` });
    });
    let jobId: string | null = null;
    if (input.remark !== false && affected.length) {
      const { job } = await deps.queue.submit<RemarkJobPayload>({ type: 'exam.remark', ownerId: userId, payload: { examId, submissionId: sub.id, questionIds: affected, reason: `Transcription corrected: "${target.text.slice(0, 80)}" → "${newText.slice(0, 80)}"`, actor: userId } });
      jobId = job.id;
    }
    return { candidateId: sub.candidateId, elementId: target.el.id, page: target.page, before: target.text, after: newText, affectedQuestionIds: affected, jobId };
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
    try {
      marked = await markCandidate(agent.adapter, agent.model, { scheme, questionIds, match, questionPaperText: await questionPaperText(userId, exam), runId: res.runId, schemeVersion: res.schemeVersion, signal, fallbackModel: agent.fallbackModel });
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
    });
  }

  /** Queues re-marking of some questions for one candidate (e.g. after the teacher asks for it in chat). */
  async function requestRemark(userId: string, examId: string, submissionRef: string, questionIds: string[] | null, reason: string) {
    const exam = await load(userId, examId);
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
      total: s.total, maxTotal: s.maxTotal, percent: s.percent, complete: s.complete, status: s.status,
      questions: r.questions.map((q) => ({
        questionId: q.questionId, number: q.number, maxMarks: q.maxMarks, awardedMarks: effectiveMarks(q), status: s.questions.find((x) => x.questionId === q.questionId)?.status,
        source: q.override ? 'examiner_override' : q.ai?.basedOnCorrection ? 'ai_after_correction' : q.ai ? 'ai' : 'none',
        aiProposedMarks: q.ai?.awardedMarks ?? null, override: q.override, confirmed: q.confirmed,
        criterionResults: q.ai?.criterionResults ?? [], feedback: q.ai?.feedback ?? '', lostMarks: q.ai?.lostMarks ?? '',
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
      let name = `${safeName(s.candidateId)}_marked.pdf`;
      while (usedNames.has(name)) name = name.replace(/_marked\.pdf$/, '_x_marked.pdf');
      usedNames.add(name);
      let pdf: Buffer | null = null;
      // Reuse an unchanged candidate PDF from the previous export.
      if (prev?.candidatePdfs[s.submissionId] && prev.candidatePdfStamps?.[s.submissionId] === res.updatedAt) {
        try { pdf = (await deps.fileStore.read(prev.candidatePdfs[s.submissionId], userId)).data; set.candidatePdfs[s.submissionId] = prev.candidatePdfs[s.submissionId]; } catch { pdf = null; }
      }
      if (!pdf) {
        try {
          const doc = sub.documentId ? await deps.documents.get(userId, sub.documentId) : null;
          if (!doc) throw new Error('The recognised script is no longer available.');
          const original = (await deps.fileStore.read(sub.fileId, userId)).data;
          const out = await annotateScript({ original, fileName: sub.fileName, doc: doc.result, result: res, summary: s, scheme, meta: { examTitle: exam.title, examId: exam.id, runId: res.runId, resultRevision: exam.resultRevision, generatedAt }, maxPages: deps.maxPages });
          pdf = out.pdf;
          if (out.summaryOnly.length) set.problems.push(`${s.candidateId}: marks for ${out.summaryOnly.join(', ')} are on the summary page only (answer location uncertain).`);
          set.candidatePdfs[s.submissionId] = (await deps.fileStore.put({ userId, name, mime: 'application/pdf', kind: 'pdf', data: pdf, ttlMs: RETENTION_MS })).id;
        } catch (err) {
          set.problems.push(`${s.candidateId}: the marked PDF could not be generated (${err instanceof Error ? err.message.slice(0, 120) : 'error'}).`);
        }
      }
      set.candidatePdfStamps[s.submissionId] = res.updatedAt;
      if (pdf) { files.push({ path: `candidates/${name}`, data: pdf, kind: 'candidate_pdf' }); pdfPaths[s.submissionId] = `candidates/${name}`; }
      files.push({ path: `reports/${safeName(s.candidateId)}_marking.json`, data: Buffer.from(JSON.stringify(candidateReport(exam, s), null, 2)), kind: 'candidate_report' });
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
  deps.queue.register<RemarkJobPayload, unknown>('exam.remark', runRemarkJob);
  deps.queue.register<ExportJobPayload, unknown>('exam.export', runExportJob);
  deps.queue.register<SchemeJobPayload, unknown>('exam.scheme', runSchemeJob);

  function artifactRefs(set: ArtifactSet) {
    const ttl = 60 * 60 * 1000;
    const url = (id?: string) => (id ? deps.fileStore.signedUrl(id, ttl) : null);
    return { id: set.id, resultRevision: set.resultRevision, createdAt: set.createdAt, status: set.status, problems: set.problems, bundleUrl: url(set.bundleFileId), workbookUrl: url(set.workbookFileId), reportUrl: url(set.htmlFileId), summaryUrl: url(set.summaryFileId) };
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
      markedPdf: set ? { fileId: set.candidatePdfs[sub.id], url: deps.fileStore.signedUrl(set.candidatePdfs[sub.id], 60 * 60 * 1000), resultRevision: set.resultRevision, stale: set.candidatePdfStamps[sub.id] !== res?.updatedAt } : null,
    };
  }

  function progress(e: ExamRecord) {
    const run = e.runs[e.runs.length - 1] ?? null;
    const subs = run ? e.submissions.filter((s) => run.submissionIds.includes(s.id)) : e.submissions;
    const counts: Partial<Record<CandidateState, number>> = {};
    for (const s of subs) counts[s.state] = (counts[s.state] ?? 0) + 1;
    return { run: run ? { id: run.id, state: run.state, schemeVersion: run.schemeVersion, startedAt: run.startedAt ?? null, finishedAt: run.finishedAt ?? null, error: run.error ?? null } : null, counts, candidates: subs.map((s) => ({ submissionId: s.id, candidateId: s.candidateId, state: s.state, stateAt: s.stateAt, error: s.error ?? null })) };
  }

  return {
    createExam, load, mutate, setSchemeJson, confirmScheme, editSchemeQuestion, submitSchemeDocuments, addSubmissions, startMarking,
    summaries, overrideMark, confirmResults, correctTranscription, remarkQuestions, requestRemark, generateArtifacts, requestExport, artifacts, artifactRefs, candidateView, progress,
    latestScheme, confirmedScheme, findSub, findQuestion,
  };
}

export type ExamService = ReturnType<typeof createExamService>;
