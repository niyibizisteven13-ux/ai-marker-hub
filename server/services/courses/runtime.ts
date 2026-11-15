import { prisma } from '../../db.js';
import { OwnedRecordStore } from '../storage/ownedRecordStore.js';
import { assignmentService } from '../assignments/runtime.js';
import { createCourseService, type CourseRecord, type CourseService, type CourseSources } from './service.js';

const db = prisma as any;
const ID_FIELD = /\b(student\s*id|reg(istration)?\s*(no|number)?|index\s*(no|number)|matricule|id)\b/i;
const NAME_ONLY = /\b(full\s*name|name|names|izina|amazina|nom)\b/i;

const parse = (s: string | null | undefined): any => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
const fieldsOf = (schema: any): any[] => (Array.isArray(schema.fields) ? schema.fields : Array.isArray(schema.questions) ? schema.questions : []);

/** The real tasks and quizzes of the lecturer, read the way the gradebook reads them. */
export const liveSources: CourseSources = {
  async task(ownerId, id) {
    const a = await assignmentService().get(ownerId, id);
    return { title: a.title, dueAt: a.dueAt, submissions: (a.submissions as any[]).map((s) => ({ studentId: s.studentId, submittedAt: s.submittedAt, late: !!s.late, marking: s.marking })) };
  },
  async quiz(ownerId, id) {
    const form = await db.applicationForm.findFirst({ where: { id, userId: ownerId } });
    if (!form) return null;
    const schema = parse(form.schema);
    if (!schema.isQuiz) return null;
    const idField = fieldsOf(schema).find((q) => ID_FIELD.test(String(q.label ?? q.title ?? '')) && !NAME_ONLY.test(String(q.label ?? q.title ?? '').replace(/student/i, '')));
    const subs = await db.formSubmission.findMany({ where: { formId: id }, orderBy: { createdAt: 'asc' } });
    return {
      title: String(schema.title || form.title || 'Quiz'),
      attempts: subs.map((sub: any) => {
        const data = parse(sub.data);
        const q = data._quiz;
        const flags = (Array.isArray(data._integrity?.flags) ? data._integrity.flags.filter((f: any) => f.level === 'review').length : 0)
          + (data._exam ? Number(data._exam.faceLost > 0) + Number(data._exam.multipleFaces > 0) + Number(data._exam.cameraProblems > 0) : 0);
        // A timed test knows who sat it (the registration number they started with); otherwise the question that asks for it.
        const sid = typeof data._exam?.studentId === 'string' ? data._exam.studentId : idField ? String(data[String(idField.id)] ?? '').trim().slice(0, 40) || null : null;
        return { studentId: sid, submittedAt: new Date(sub.createdAt).toISOString(), percent: q ? q.percent : null, score: q ? q.score : null, maxScore: q ? q.maxScore : null, flags };
      }),
    };
  },
  async available(ownerId) {
    const tasks = await assignmentService().list(ownerId).catch(() => [] as any[]);
    const forms = await db.applicationForm.findMany({ where: { userId: ownerId }, orderBy: { updatedAt: 'desc' }, take: 200 }).catch(() => []);
    return {
      tasks: tasks.map((t: any) => ({ id: t.id, title: t.title })),
      quizzes: forms.map((f: any) => ({ f, s: parse(f.schema) })).filter(({ s }: any) => s.isQuiz).map(({ f, s }: any) => ({ id: f.id, title: String(s.title || f.title || 'Quiz') })),
    };
  },
};

let service: CourseService | null = null;
export function courseService(): CourseService {
  service ??= createCourseService({ store: new OwnedRecordStore<CourseRecord>(process.env.COURSES_DIR ?? './data/courses', 5 * 365 * 24 * 60 * 60 * 1000), sources: liveSources });
  return service;
}
export function setCourseService(s: CourseService | null) { service = s; }
