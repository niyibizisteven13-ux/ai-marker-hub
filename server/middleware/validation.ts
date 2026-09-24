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

export const validate = (schema: z.ZodObject<any, any>) => (req: Request, res: Response, next: NextFunction) => {
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
