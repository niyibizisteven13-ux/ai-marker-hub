import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { FileStore } from '../ai/files/FileStore.js';
import { extractText } from '../ai/files/extract.js';
import { FileJobQueue, JobError, type FileJob } from '../ai/jobs/fileJobQueue.js';
import { StructuredOutputError } from '../ai/llm/structuredJson.js';
import type { ProviderAdapter } from '../ai/providers/types.js';
import { renderReportHtml, validateHtmlArtifact } from '../analytics/htmlReport.js';
import { OwnedRecordStore, type OwnedRecord } from '../storage/ownedRecordStore.js';
import { applyReviews, assessSubmission, type AssessmentOutcome, type InstructorReview } from './assess.js';
import { buildAssessmentReport } from './report.js';
import { parseTextRubric, validateRubric, type Rubric } from './rubric.js';

export interface AssessmentRecord extends OwnedRecord {
  rubric: Rubric;
  rubricWarnings: string[];
  outcome: AssessmentOutcome;
  reviews: InstructorReview[];
  status: 'proposed' | 'instructor_confirmed';
  confirmedAt?: string;
  studentLabel?: string;
  submissionSha256: string;
  reportFileId?: string;
}

export interface AssessmentDeps {
  fileStore: FileStore;
  queue: FileJobQueue;
  store: OwnedRecordStore<AssessmentRecord>;
  agent: () => { adapter: ProviderAdapter; model: string; fallbackModel?: string | null };
  forbiddenStrings?: string[];
}

export const assessmentRequestSchema = z.object({
  rubric: z.unknown().optional(),
  rubricText: z.string().max(50_000).optional(),
  submissionText: z.string().max(400_000).optional(),
  modelAnswer: z.string().max(40_000).optional(),
  courseMaterial: z.string().max(60_000).optional(),
  highStakes: z.boolean().optional(),
  studentLabel: z.string().trim().max(120).optional(),
}).strict();
export type AssessmentRequest = z.infer<typeof assessmentRequestSchema>;

export class AssessmentInputError extends Error {
  constructor(public errors: string[], public warnings: string[] = [], public unparsed: string[] = []) {
    super(errors.join(' '));
  }
}

export function resolveRubric(body: { rubric?: unknown; rubricText?: string }) {
  if (body.rubric !== undefined) return { ...validateRubric(body.rubric), unparsed: [] as string[] };
  if (body.rubricText) {
    const p = parseTextRubric(body.rubricText);
    if (!p.input) return { rubric: null, errors: p.errors, warnings: [], unparsed: p.unparsed };
    const v = validateRubric(p.input);
    return { ...v, errors: [...p.errors, ...v.errors], warnings: [...v.warnings, ...(p.unparsed.length ? [`${p.unparsed.length} line(s) of the rubric text were not understood and were ignored; check them.`] : [])], unparsed: p.unparsed };
  }
  return { rubric: null, errors: ['Provide "rubric" (JSON) or "rubricText".'], warnings: [], unparsed: [] as string[] };
}

interface AssessmentJobPayload {
  rubric: Rubric; rubricWarnings: string[]; submissionFileId: string; submissionSha256: string;
  modelAnswer?: string; courseMaterial?: string; highStakes?: boolean; studentLabel?: string;
}

export function createAssessmentService(deps: AssessmentDeps) {
  async function renderAndStore(rec: AssessmentRecord): Promise<string> {
    const report = buildAssessmentReport({ rubric: rec.rubric, outcome: rec.outcome, reviews: rec.reviews, status: rec.status, studentLabel: rec.studentLabel, generatedAt: new Date().toISOString(), rubricWarnings: rec.rubricWarnings, submissionSha256: rec.submissionSha256 });
    const { html } = await renderReportHtml(report);
    const check = validateHtmlArtifact(html, { forbiddenStrings: deps.forbiddenStrings });
    if (!check.valid) throw new JobError('ARTIFACT_INVALID', `The assessment report failed validation: ${check.problems.join('; ')}`);
    const meta = await deps.fileStore.put({ userId: rec.ownerId, name: `assessment-${rec.id.slice(0, 8)}.html`, mime: 'text/html; charset=utf-8', kind: 'document', data: Buffer.from(html, 'utf8'), ttlMs: 30 * 24 * 60 * 60 * 1000 });
    return meta.id;
  }

  async function runJob(job: FileJob<AssessmentJobPayload>, ctx: { progress: (s: string, p?: number | null) => Promise<void>; signal: AbortSignal }) {
    const p = job.payload;
    await ctx.progress('reading submission', 5);
    let text: string;
    try {
      text = (await deps.fileStore.read(p.submissionFileId, job.ownerId)).data.toString('utf8');
    } catch {
      throw new JobError('SUBMISSION_UNAVAILABLE', 'The submission is no longer available. Submit it again.');
    }
    await ctx.progress('assessing against the rubric', 15);
    const agent = deps.agent();
    let outcome: AssessmentOutcome;
    try {
      outcome = await assessSubmission(agent.adapter, agent.model, { rubric: p.rubric, submissionText: text, modelAnswer: p.modelAnswer, courseMaterial: p.courseMaterial, highStakes: p.highStakes }, { signal: ctx.signal, fallbackModel: agent.fallbackModel });
    } catch (e) {
      if (e instanceof StructuredOutputError) throw new JobError('ASSESSMENT_INVALID_OUTPUT', 'The AI could not produce a valid assessment for this submission. Try again or mark it manually.', true);
      const cat = (e as { category?: string })?.category;
      if (cat === 'CONTENT_REFUSED') throw new JobError('CONTENT_REFUSED', 'The AI model declined to assess this submission.');
      if (cat) throw new JobError(`AI_${cat}`, 'The AI service could not complete the assessment. Try again later.', ['PROVIDER_BUSY', 'RATE_LIMITED', 'PROVIDER_TIMEOUT', 'NETWORK_ERROR'].includes(cat));
      throw e;
    }
    await ctx.progress('saving', 85);
    // Keyed by job id: a re-run after a crash replaces this record instead of duplicating it.
    const rec = await deps.store.put(job.id, job.ownerId, {
      rubric: p.rubric, rubricWarnings: p.rubricWarnings, outcome, reviews: [], status: 'proposed', studentLabel: p.studentLabel, submissionSha256: p.submissionSha256,
    } as Omit<AssessmentRecord, keyof OwnedRecord>);
    const reportFileId = await renderAndStore(rec);
    await deps.store.update(rec.id, job.ownerId, (r) => { r.reportFileId = reportFileId; });
    // Data minimisation: the full submission text is not kept after assessment (quotes and a checksum are).
    await deps.fileStore.delete(p.submissionFileId, job.ownerId).catch(() => {});
    return { assessmentId: rec.id, reportFileId, proposedTotal: outcome.proposedTotal, totalMarks: outcome.totalMarks, needsHumanReview: outcome.needsHumanReview };
  }

  deps.queue.register<AssessmentJobPayload, unknown>('assessment.run', runJob);

  async function submit(userId: string, body: AssessmentRequest, file?: { originalname: string; mimetype?: string; buffer: Buffer }) {
    const r = resolveRubric(body);
    if (!r.rubric) throw new AssessmentInputError(r.errors, r.warnings, r.unparsed);
    let text = body.submissionText ?? '';
    if (file) {
      const ex = await extractText({ name: file.originalname, mime: file.mimetype, data: file.buffer }, { maxChars: 400_000 });
      if (ex.kind !== 'text' || !ex.text?.trim()) throw new AssessmentInputError([`The submission file could not be read as text (${ex.note ?? ex.kind}). Upload TXT, DOCX or a text-based PDF.`]);
      text = ex.text;
    }
    if (!text.trim()) throw new AssessmentInputError(['Provide the submission as "submissionText" or an uploaded file.']);
    const sha = createHash('sha256').update(text).digest('hex');
    const meta = await deps.fileStore.put({ userId, name: 'submission.txt', mime: 'text/plain; charset=utf-8', kind: 'text', data: Buffer.from(text, 'utf8'), ttlMs: 2 * 24 * 60 * 60 * 1000 });
    const key = createHash('sha256').update(JSON.stringify({ rubric: r.rubric, sha, m: body.modelAnswer, c: body.courseMaterial, h: body.highStakes })).digest('hex').slice(0, 32);
    const res = await deps.queue.submit<AssessmentJobPayload>({
      type: 'assessment.run', ownerId: userId, idempotencyKey: key,
      payload: { rubric: r.rubric, rubricWarnings: r.warnings, submissionFileId: meta.id, submissionSha256: sha, modelAnswer: body.modelAnswer, courseMaterial: body.courseMaterial, highStakes: body.highStakes, studentLabel: body.studentLabel },
    });
    if (res.duplicate) await deps.fileStore.delete(meta.id, userId).catch(() => {});
    return { ...res, rubricWarnings: r.warnings };
  }

  function view(rec: AssessmentRecord) {
    const applied = applyReviews(rec.outcome, rec.reviews, rec.rubric);
    const { ownerId: _o, ...rest } = rec;
    return { ...rest, final: applied };
  }

  async function review(userId: string, id: string, input: { criterionId: string; marks: number; comment?: string }) {
    const rec = await deps.store.get(id, userId);
    if (!rec) return null;
    if (rec.status === 'instructor_confirmed') throw new AssessmentInputError(['This assessment is already confirmed. Reopen it before changing marks.']);
    const c = rec.rubric.criteria.find((x) => x.id === input.criterionId);
    if (!c) throw new AssessmentInputError([`Unknown criterion "${input.criterionId}".`]);
    if (!Number.isFinite(input.marks) || input.marks < 0 || input.marks > c.maxMarks) throw new AssessmentInputError([`Marks for "${c.name}" must be between 0 and ${c.maxMarks}.`]);
    if (!Number.isInteger(input.marks * (rec.rubric.allowHalfMarks ? 2 : 1))) throw new AssessmentInputError([rec.rubric.allowHalfMarks ? 'Marks must be in steps of 0.5.' : 'Marks must be whole numbers.']);
    const updated = await deps.store.update(id, userId, (r) => { r.reviews.push({ criterionId: c.id, marks: input.marks, comment: input.comment?.slice(0, 2000), reviewerId: userId, at: new Date().toISOString() }); });
    const fileId = await renderAndStore(updated!);
    return view((await deps.store.update(id, userId, (r) => { r.reportFileId = fileId; }))!);
  }

  async function setConfirmed(userId: string, id: string, confirmed: boolean) {
    const rec = await deps.store.get(id, userId);
    if (!rec) return null;
    if (confirmed) {
      const applied = applyReviews(rec.outcome, rec.reviews, rec.rubric);
      if (applied.unresolved.length) throw new AssessmentInputError([`Review these criteria before confirming: ${applied.unresolved.join(', ')}.`]);
    }
    const updated = await deps.store.update(id, userId, (r) => { r.status = confirmed ? 'instructor_confirmed' : 'proposed'; r.confirmedAt = confirmed ? new Date().toISOString() : undefined; });
    const fileId = await renderAndStore(updated!);
    return view((await deps.store.update(id, userId, (r) => { r.reportFileId = fileId; }))!);
  }

  async function get(userId: string, id: string) {
    const rec = await deps.store.get(id, userId);
    return rec ? view(rec) : null;
  }

  return { submit, get, review, setConfirmed, runJob };
}

export type AssessmentService = ReturnType<typeof createAssessmentService>;
