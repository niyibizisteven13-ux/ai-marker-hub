import logger from '../../utils/logger.js';
import type { AssignmentRecord, AssignmentSubmission } from './service.js';

/**
 * Marking a task's hand-ins as they arrive. Each task with automatic marking gets one examination (its marking
 * scheme read once); every hand-in is added to it and marked straight away by the same engine as the Mark page.
 * Students see their result through a private link once the teacher releases it.
 */

export interface MarkStatus {
  state: 'queued' | 'marking' | 'marked' | 'needs_review' | 'failed' | 'waiting_scheme';
  total: number | null;
  maxTotal: number | null;
  percent: number | null;
  released: boolean;
  error?: string;
}

export interface StudentResult {
  state: 'not_marked' | 'marking' | 'waiting' | 'released';
  title: string;
  studentName: string;
  total?: number | null;
  maxTotal?: number | null;
  percent?: number | null;
  questions?: Array<{ number: string; awardedMarks: number | null; maxMarks: number; feedback: string; lostMarks: string; correction: string | null }>;
  markedPdfUrl?: string | null;
  releasedAt?: string | null;
}

export interface MarkContext {
  ownerId: string;
  assignment: AssignmentRecord;
  submission: AssignmentSubmission;
  /** The student's hand-in as one PDF. */
  pdf: () => Promise<Buffer>;
  /** The marking scheme the teacher attached to the task. */
  scheme: () => Promise<Array<{ name: string; buffer: Buffer; mime: string }>>;
  /** Saves marking references on the task record. */
  save: (patch: { examId?: string; examSubmissionId?: string; markError?: string | null }) => Promise<void>;
  /** The task as saved now (another hand-in may have created its examination a moment ago). */
  reload: () => Promise<AssignmentRecord | null>;
}

export interface TaskMarker {
  mark(ctx: MarkContext): Promise<void>;
  statuses(ownerId: string, a: AssignmentRecord): Promise<Record<string, MarkStatus>>;
  release(ownerId: string, a: AssignmentRecord, submissionIds: string[] | 'all'): Promise<{ released: number; skipped: Array<{ studentName: string; reason: string }> }>;
  result(ownerId: string, a: AssignmentRecord, s: AssignmentSubmission): Promise<StudentResult>;
}

/** The subset of the examination service used here. */
type Exams = {
  createExam(userId: string, input: { title?: string }): Promise<{ id: string }>;
  load(userId: string, examId: string): Promise<any>;
  addSubmissions(userId: string, examId: string, files: Array<{ name: string; buffer: Buffer; mime: string }>, mapping?: Array<{ fileName: string; candidateId: string; candidateName?: string }>): Promise<{ accepted: Array<{ id: string }>; rejected: Array<{ fileName: string; reason: string }> }>;
  submitSchemeDocuments(userId: string, examId: string, input: { scheme: Array<{ name: string; buffer: Buffer; mime: string }>; autoMark?: boolean }): Promise<unknown>;
  startMarking(userId: string, examId: string): Promise<unknown>;
  reviewList(e: any): Array<{ submissionId: string; total: number; maxTotal: number; percent: number; released: boolean; releasedAt: string | null; openFlags: number }>;
  release(userId: string, examId: string, refs: string[] | 'all'): Promise<{ released: string[]; skipped: Array<{ candidateId: string; reason: string }> } | any>;
  candidateView(userId: string, examId: string, ref: string): Promise<any>;
  latestScheme(e: any): { status: string } | null | undefined;
};

const ID_OK = /^[A-Za-z0-9][\w./-]{0,31}$/;

export function createTaskMarker(exams: () => Exams, opts: { retryMs?: number; maxRetries?: number } = {}): TaskMarker {
  const retryMs = opts.retryMs ?? 15_000;
  const maxRetries = opts.maxRetries ?? 120;
  // One hand-in at a time per task, so two students sending at once never create two examinations.
  const locks = new Map<string, Promise<unknown>>();
  const serial = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const prev = locks.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    locks.set(key, next.finally(() => { if (locks.get(key) === next) locks.delete(key); }));
    return next;
  };

  /** Starts marking what is waiting; if a run is busy, tries again shortly (the new script joins the next run). */
  const kick = (ownerId: string, examId: string, attempt = 0) => {
    void exams().startMarking(ownerId, examId).catch((e: any) => {
      const code = e?.code;
      if (code === 'NOTHING_TO_MARK') return;
      if ((code === 'RUN_IN_PROGRESS' || code === 'SCHEME_NOT_CONFIRMED' || code === 'NO_SCHEME') && attempt < maxRetries) { setTimeout(() => kick(ownerId, examId, attempt + 1), retryMs).unref?.(); return; }
      logger.warn('[tasks] automatic marking could not start', { code: code ?? (e as Error)?.name });
    });
  };

  return {
    async mark(ctx) {
      const { ownerId, submission: s } = ctx;
      await serial(ctx.assignment.id, async () => {
        const x = exams();
        const a = (await ctx.reload()) ?? ctx.assignment;
        let examId = a.examId;
        let first = false;
        if (!examId) {
          examId = (await x.createExam(ownerId, { title: a.title.slice(0, 120) })).id;
          first = true;
          await ctx.save({ examId });
        }
        const cid = s.studentId && ID_OK.test(s.studentId) ? s.studentId : `T${s.id.replace(/-/g, '').slice(0, 7).toUpperCase()}`;
        const name = `${cid}.pdf`;
        const pdf = await ctx.pdf();
        const { accepted, rejected } = await x.addSubmissions(ownerId, examId, [{ name, buffer: pdf, mime: 'application/pdf' }], [{ fileName: name, candidateId: cid, candidateName: s.studentName }]);
        if (!accepted.length) { await ctx.save({ markError: rejected[0]?.reason ?? 'The hand-in could not be read.' }); return; }
        await ctx.save({ examSubmissionId: accepted[0].id, markError: null });
        // The first hand-in brings the scheme; marking starts by itself once it is read and unambiguous.
        if (first) await x.submitSchemeDocuments(ownerId, examId, { scheme: await ctx.scheme(), autoMark: true });
        else kick(ownerId, examId);
      });
    },

    async statuses(ownerId, a) {
      if (!a.examId) return {};
      const x = exams();
      let e: any;
      try { e = await x.load(ownerId, a.examId); } catch { return {}; }
      const rows = new Map(x.reviewList(e).map((r) => [r.submissionId, r]));
      const scheme = x.latestScheme(e);
      const out: Record<string, MarkStatus> = {};
      for (const s of a.submissions) {
        if (!s.examSubmissionId) { if (s.markError) out[s.id] = { state: 'failed', total: null, maxTotal: null, percent: null, released: false, error: s.markError }; continue; }
        const sub = e.submissions.find((y: any) => y.id === s.examSubmissionId);
        const r = rows.get(s.examSubmissionId);
        if (r) { out[s.id] = { state: r.openFlags ? 'needs_review' : 'marked', total: r.total, maxTotal: r.maxTotal, percent: r.percent, released: r.released }; continue; }
        const st = sub?.state as string | undefined;
        out[s.id] = {
          state: st === 'failed' ? 'failed' : !scheme || scheme.status !== 'confirmed' ? 'waiting_scheme' : st === 'queued' ? 'queued' : 'marking',
          total: null, maxTotal: null, percent: null, released: false, ...(st === 'failed' ? { error: sub?.error?.message ?? 'Could not be marked.' } : {}),
        };
      }
      return out;
    },

    async release(ownerId, a, submissionIds) {
      if (!a.examId) return { released: 0, skipped: [] };
      const refs = submissionIds === 'all' ? 'all' as const : a.submissions.filter((s) => submissionIds.includes(s.id) && s.examSubmissionId).map((s) => s.examSubmissionId!);
      const out = await exams().release(ownerId, a.examId, refs);
      const e = await exams().load(ownerId, a.examId);
      const nameOf = (cid: string) => e.submissions.find((x: any) => x.candidateId === cid)?.candidateName ?? cid;
      return { released: (out.released ?? []).length, skipped: (out.skipped ?? []).map((k: any) => ({ studentName: nameOf(k.candidateId), reason: k.reason })) };
    },

    async result(ownerId, a, s) {
      const base = { title: a.title, studentName: s.studentName };
      if (!a.examId || !s.examSubmissionId) return { ...base, state: 'not_marked' };
      const x = exams();
      const e = await x.load(ownerId, a.examId);
      const row = x.reviewList(e).find((r) => r.submissionId === s.examSubmissionId);
      if (!row) return { ...base, state: 'marking' };
      if (!row.released) return { ...base, state: 'waiting' };
      const v = await x.candidateView(ownerId, a.examId, s.examSubmissionId);
      return {
        ...base, state: 'released', total: row.total, maxTotal: row.maxTotal, percent: row.percent, releasedAt: row.releasedAt,
        questions: (v.result?.questions ?? []).map((q: any) => ({ number: String(q.number), awardedMarks: q.awardedMarks, maxMarks: q.maxMarks, feedback: String(q.feedback ?? ''), lostMarks: String(q.lostMarks ?? ''), correction: q.correction ?? null })),
        markedPdfUrl: v.markedPdf?.url ?? null,
      };
    },
  };
}
