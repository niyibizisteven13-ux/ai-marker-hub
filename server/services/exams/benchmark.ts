import { z } from 'zod';

export const benchmarkSchema = z.array(z.object({
  paperId: z.string().min(1), questionId: z.string().min(1),
  category: z.enum(['handwriting', 'maths', 'diagram', 'poor_scan', 'printed']),
  maxMarks: z.number().positive(), teacherMarks: z.number().nonnegative(),
  aiMarks: z.number().nonnegative().nullable(), flagged: z.boolean(),
}).strict().refine(r => r.teacherMarks <= r.maxMarks && (r.aiMarks === null || r.aiMarks <= r.maxMarks), 'Marks exceed the question maximum')).min(1)
  .refine(rows => new Set(rows.map(r => JSON.stringify([r.paperId, r.questionId]))).size === rows.length, 'Duplicate paper/question');

/** Offline evaluation: explicit abstentions stay visible and never count as zero marks. */
export function evaluateMarking(input: unknown) {
  const rows = benchmarkSchema.parse(input);
  const summarize = (list: typeof rows) => {
    const marked = list.filter(r => r.aiMarks !== null);
    const wrong = marked.filter(r => r.aiMarks !== r.teacherMarks);
    return { questions: list.length, marked: marked.length, abstained: list.length - marked.length,
      coverage: marked.length / list.length,
      exactAgreement: marked.length ? (marked.length - wrong.length) / marked.length : null,
      meanAbsoluteError: marked.length ? marked.reduce((n, r) => n + Math.abs(r.aiMarks! - r.teacherMarks), 0) / marked.length : null,
      unflaggedErrors: wrong.filter(r => !r.flagged).length,
      reviewRate: list.filter(r => r.flagged || r.aiMarks === null).length / list.length };
  };
  return { overall: summarize(rows), categories: Object.fromEntries([...new Set(rows.map(r => r.category))].map(category => [category, summarize(rows.filter(r => r.category === category))])) };
}
