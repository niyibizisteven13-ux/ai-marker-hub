import { CHOICE_KINDS, normalizeFields } from './model.js';
import { gradeQuiz } from './quiz.js';
import { applyPool } from '../../../shared/formPool.js';
import type { ReviewQuestion, ReviewResponse } from './classReview.js';

/** Turns a form and its saved responses into what `classReview` reads (shared by the class-review page and the live-room review queue). */
export function reviewInputs(schema: any, rows: Array<{ id: string; data: string; createdAt: Date | string }>): { questions: ReviewQuestion[]; responses: Array<ReviewResponse & { name: string }> } {
  const fields = normalizeFields(schema);
  const questions: ReviewQuestion[] = fields.map((f) => ({ id: f.id, label: f.label, kind: f.kind === 'text' || f.kind === 'long_text' ? f.kind : CHOICE_KINDS.has(f.kind) ? 'choice' : 'other' }));
  const nameField = fields.find((f) => /\b(name|nom|izina)\b/i.test(f.label) && !/\b(id|number|reg|matric|numero|numéro)\b/i.test(f.label));
  const responses = rows.map((row, i) => {
    let data: any = {};
    try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
    const seed = String(data._exam?.sessionId || data._pool?.seed || '');
    const given = schema.poolPicks && Object.keys(schema.poolPicks).length && seed ? applyPool(schema, seed) : schema;
    const wrong = new Set<string>(schema.isQuiz ? (gradeQuiz(given, data)?.items ?? []).filter((x) => !x.correct).map((x) => x.id) : []);
    const typed = String((nameField && data[nameField.id]) || '').trim();
    const who = String(data._exam?.studentId || typed || data._respondentEmail || `Response ${i + 1}`);
    return { id: row.id, who, name: typed, submittedAt: new Date(row.createdAt).getTime(), answers: data, wrong, device: data._device?.id, network: data._device?.net };
  });
  return { questions, responses };
}
