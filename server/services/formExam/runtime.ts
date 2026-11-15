import { prisma } from '../../db.js';
import { normalizeExam } from '../../../shared/examRules.js';
import { courseService } from '../courses/runtime.js';
import { createFormExamService, type FormExamService } from './service.js';

const db = prisma as any;
let service: FormExamService | null = null;
export function formExamService(): FormExamService {
  service ??= createFormExamService({
    dir: process.env.FORM_EXAMS_DIR ?? './data/form-exams',
    forms: async (formId) => {
      const form = await db.applicationForm.findUnique({ where: { id: formId } }).catch(() => null);
      if (!form) return null;
      let schema: any = {};
      try { schema = JSON.parse(form.schema || '{}'); } catch { schema = {}; }
      return { ownerId: form.userId, title: String(schema.title || form.title || ''), exam: normalizeExam(schema.exam) };
    },
    accommodations: (ownerId, courseId, studentId) => courseService().accommodationsFor(ownerId, courseId, studentId),
  });
  return service;
}
export function setFormExamService(s: FormExamService | null) { service = s; }
