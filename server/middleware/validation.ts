import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';

export const examSchema = z.object({
  subject: z.string().min(1),
  topic: z.string().min(1),
  gradeLevel: z.string().optional(),
  difficulty: z.string().optional(),
  questionTypes: z.array(z.string()).optional(),
  totalMarks: z.number().positive().optional(),
  durationMinutes: z.number().positive().optional(),
  additionalInstructions: z.string().optional(),
});

export const markScriptSchema = z.object({
  examPaper: z.object({
    id: z.string().optional(),
    title: z.string().optional(),
    questions: z.array(z.object({
      id: z.any(),
      text: z.string().optional(),
      maxMarks: z.number().positive(),
      rubric: z.any().optional(),
    })).min(1),
  }).passthrough(),
  studentScript: z.object({
    studentName: z.string().min(1),
    studentId: z.string().min(1),
    answers: z.array(z.object({
      questionId: z.any(),
      text: z.string().optional(),
    })).min(1),
  }).passthrough(),
});

export const batchGradeSchema = z.object({
  examPaper: z.object({
    questions: z.array(z.any()).min(1),
  }).passthrough(),
  studentScripts: z.array(z.object({
    studentName: z.string().min(1),
    studentId: z.string().min(1),
    answers: z.array(z.any()).min(1),
  }).passthrough()).min(1),
});

/** Validation schema for the main /api/ai/chat endpoint. */
const normalizeOptionalSentinel = (value: unknown) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '' || trimmed === 'undefined' || trimmed === 'null') {
      return undefined;
    }
  }
  return value;
};

export const chatSchema = z.object({
  query: z.string().max(32_000).optional(),
  fileContext: z.string().max(500_000).optional(),
  documentContext: z.string().max(500).optional(),
  attachmentText: z.string().max(500_000).optional(),
  attachmentName: z.string().max(500).optional(),
  attachmentMimeType: z.string().max(100).optional(),
  attachmentBase64: z.string().max(10_000_000).optional(), // ~7.5 MB base64
  examContext: z.any().optional(),
  pinnedSyllabus: z.string().max(200_000).optional(),
  selectedEvidence: z.any().optional(),
  replyTo: z.string().max(200).optional(),
  previousInteractionId: z.string().max(200).optional(),
  // history is JSON-stringified on the client, or a plain array
  history: z.union([z.string(), z.array(z.any())]).optional(),
  activeFormId: z.preprocess(normalizeOptionalSentinel, z.string().uuid().optional()),
  jobId: z.preprocess(normalizeOptionalSentinel, z.string().max(200).optional()),
  service: z.preprocess(normalizeOptionalSentinel, z.string().max(50).optional()),
  extractSchema: z.preprocess(normalizeOptionalSentinel, z.string().max(10_000).optional()),
  provider: z.preprocess(normalizeOptionalSentinel, z.string().max(50).optional()),
  attachmentIds: z.preprocess(normalizeOptionalSentinel, z.union([z.string(), z.array(z.string())]).optional()),
}).strict();

export const validate = (schema: z.ZodObject<any, any> | z.ZodEffects<any>) => (req: Request, res: Response, next: NextFunction) => {
  try {
    schema.parse(req.body);
    next();
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map(e => ({ path: e.path, message: e.message })),
      });
    }
    next(error);
  }
};
