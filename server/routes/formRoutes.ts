import { Router } from 'express';
import { FormOrchestrator } from '../services/FormOrchestrator.js';
import { ResultsPdfService } from '../services/ResultsPdfService.js';
import { GradingService } from '../services/GradingService.js';
import { requireAuth } from '../../production/auth.js';
import logger from '../utils/logger.js';
import { prisma } from '../db.js';

const router = Router();
const formOrchestrator = FormOrchestrator.getInstance();
const pdfService = ResultsPdfService.getInstance();
const gradingService = GradingService.getInstance();

router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      title,
      description = '',
      descriptionImageUrl,
      questions,
      blocks = [],
      themeColor = '#D97757',
      isQuiz = false,
      collectEmail = false,
      acceptingResponses = true,
      allowMultipleResponses = true,
      confirmationMessage = 'Your response has been recorded.',
    } = req.body || {};
    if (typeof title !== 'string' || !title.trim() || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'A title and at least one question are required.' });
    }
    if (questions.length > 100 || questions.some((q: any) => !q || typeof q.title !== 'string' || !q.title.trim())) {
      return res.status(400).json({ error: 'Each question needs a title; forms can contain up to 100 questions.' });
    }
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    const safeThemeColor = /^#[0-9a-fA-F]{6}$/.test(themeColor) ? themeColor : '#D97757';
    const schema = {
      title: title.trim(),
      description: String(description).trim(),
      ...(descriptionImageUrl ? { descriptionImageUrl: String(descriptionImageUrl) } : {}),
      questions,
      blocks: Array.isArray(blocks) ? blocks.slice(0, 100) : [],
      themeColor: safeThemeColor,
      isQuiz: Boolean(isQuiz),
      collectEmail: Boolean(collectEmail),
      acceptingResponses: acceptingResponses !== false,
      allowMultipleResponses: allowMultipleResponses !== false,
      confirmationMessage: String(confirmationMessage || 'Your response has been recorded.').slice(0, 1000),
      ...(req.body.requirements ? { requirements: String(req.body.requirements).slice(0, 12000) } : {}),
    };
    const rubric = req.body?.rubric && typeof req.body.rubric === 'object' ? JSON.stringify(req.body.rubric) : null;
    const selectionSettings = req.body?.selectionSettings && typeof req.body.selectionSettings === 'object'
      ? JSON.stringify(req.body.selectionSettings)
      : JSON.stringify({ requirements: schema.requirements || schema.description || '' });
    const form = await prisma.applicationForm.create({
      data: { userId, title: schema.title, schema: JSON.stringify(schema), rubric, selectionSettings },
    });
    res.status(201).json({
      success: true,
      form: {
        id: form.id,
        ...schema,
        schema,
        shareableLink: `/forms/${form.id}`,
        responseCount: 0,
        updatedAt: form.updatedAt,
      },
    });
  } catch (error: any) {
    logger.error('Failed to save manually created form', error);
    res.status(500).json({ error: 'Failed to save form.' });
  }
});

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.userId || (req as any).teacher?.teacherId;
    const existing = await prisma.applicationForm.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Form not found.' });
    if (!userId || existing.userId !== userId) return res.status(403).json({ error: 'You do not have access to this form.' });

    let prevSchema: any = {};
    try { prevSchema = JSON.parse(existing.schema || '{}'); } catch { prevSchema = {}; }

    const {
      title = existing.title,
      description = prevSchema.description || '',
      descriptionImageUrl = prevSchema.descriptionImageUrl,
      questions = prevSchema.questions || [],
      blocks = prevSchema.blocks || [],
      themeColor = prevSchema.themeColor || '#D97757',
      isQuiz = prevSchema.isQuiz ?? false,
      collectEmail = prevSchema.collectEmail ?? false,
      acceptingResponses = prevSchema.acceptingResponses ?? true,
      allowMultipleResponses = prevSchema.allowMultipleResponses ?? true,
      confirmationMessage = prevSchema.confirmationMessage || 'Your response has been recorded.',
      requirements = prevSchema.requirements || '',
    } = req.body || {};

    if (typeof title !== 'string' || !title.trim() || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'A title and at least one question are required.' });
    }

    const safeThemeColor = /^#[0-9a-fA-F]{6}$/.test(themeColor) ? themeColor : '#D97757';
    const nextSchema = {
      ...prevSchema,
      title: title.trim(),
      description: String(description).trim(),
      descriptionImageUrl: descriptionImageUrl || undefined,
      questions,
      blocks: Array.isArray(blocks) ? blocks.slice(0, 100) : [],
      themeColor: safeThemeColor,
      isQuiz: Boolean(isQuiz),
      collectEmail: Boolean(collectEmail),
      acceptingResponses: acceptingResponses !== false,
      allowMultipleResponses: allowMultipleResponses !== false,
      confirmationMessage: String(confirmationMessage || 'Your response has been recorded.').slice(0, 1000),
      requirements: String(requirements || '').slice(0, 12000),
    };

    const prevSelection = existing.selectionSettings ? JSON.parse(existing.selectionSettings) : {};
    const nextSelection = req.body?.selectionSettings
      ? { ...prevSelection, ...req.body.selectionSettings, requirements: nextSchema.requirements }
      : { ...prevSelection, requirements: nextSchema.requirements };

    const updated = await prisma.applicationForm.update({
      where: { id: existing.id },
      data: {
        title: nextSchema.title,
        schema: JSON.stringify(nextSchema),
        rubric: req.body?.rubric ? JSON.stringify(req.body.rubric) : existing.rubric,
        selectionSettings: JSON.stringify(nextSelection),
      },
      include: { _count: { select: { submissions: true } } },
    });

    res.json({
      success: true,
      form: {
        id: updated.id,
        ...nextSchema,
        schema: nextSchema,
        shareableLink: `/forms/${updated.id}`,
        responseCount: (updated as any)._count?.submissions ?? 0,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error: any) {
    logger.error('Failed to update form', error);
    res.status(500).json({ error: 'Failed to update form.' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.userId || (req as any).teacher?.teacherId;
    const existing = await prisma.applicationForm.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Form not found.' });
    if (!userId || existing.userId !== userId) return res.status(403).json({ error: 'You do not have access to this form.' });

    const subs = await prisma.formSubmission.findMany({ where: { formId: existing.id } });
    for (const s of subs) {
      await prisma.extractedInsight.deleteMany({ where: { submissionId: s.id } });
    }
    await prisma.formSubmission.deleteMany({ where: { formId: existing.id } });
    await prisma.applicationForm.delete({ where: { id: existing.id } });
    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to delete form', error);
    res.status(500).json({ error: 'Failed to delete form.' });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const forms = await prisma.applicationForm.findMany({
      where: userId ? { userId } : { userId: '__unauthenticated__' },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { submissions: true } } },
    });
    res.json({
      success: true,
      forms: forms.map(({ schema, rubric, selectionSettings, ...form }) => {
        let parsedSchema: any = {};
        try { parsedSchema = JSON.parse(schema || '{}'); } catch { parsedSchema = {}; }
        return {
          ...form,
          schema: parsedSchema,
          rubric: rubric ? JSON.parse(rubric) : null,
          selectionSettings: selectionSettings ? JSON.parse(selectionSettings) : null,
          shareableLink: `/forms/${form.id}`,
          responseCount: form._count.submissions,
        };
      }),
    });
  } catch (error: any) {
    logger.error('Failed to list application forms', error);
    res.status(500).json({ error: 'Failed to load forms.' });
  }
});

router.get('/:id/responses', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.userId || (req as any).teacher?.teacherId;
    const form = await prisma.applicationForm.findUnique({ where: { id: req.params.id } });
    if (!form) return res.status(404).json({ error: 'Form not found.' });
    if (!userId || form.userId !== userId) return res.status(403).json({ error: 'You do not have access to this form.' });
    const submissions = await prisma.formSubmission.findMany({ where: { formId: form.id }, include: { extractedInsights: true }, orderBy: { createdAt: 'desc' } });
    res.json({
      success: true,
      submissions: submissions.map((submission) => ({
        id: submission.id,
        submittedAt: submission.createdAt,
        answers: JSON.parse(submission.data),
        analysis: submission.extractedInsights
          ? {
              score: submission.extractedInsights.score,
              selected: submission.extractedInsights.selected,
              summary: submission.extractedInsights.summary,
              feedback: submission.extractedInsights.scoringFeedback,
              sentiment: submission.extractedInsights.sentiment,
              skills: (() => {
                try { return JSON.parse(submission.extractedInsights.skills || '[]'); } catch { return []; }
              })(),
              details: submission.extractedInsights.scoringDetails ? JSON.parse(submission.extractedInsights.scoringDetails) : null,
            }
          : null,
      })),
    });
  } catch (error: any) {
    logger.error('Failed to load form responses', error);
    res.status(500).json({ error: 'Failed to load responses.' });
  }
});

router.patch('/:id/responses/:submissionId', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.userId || (req as any).teacher?.teacherId;
    const form = await prisma.applicationForm.findUnique({ where: { id: req.params.id } });
    if (!form) return res.status(404).json({ error: 'Form not found.' });
    if (!userId || form.userId !== userId) return res.status(403).json({ error: 'You do not have access to this form.' });

    const { selected, score, feedback } = req.body || {};
    const updateData: Record<string, any> = {};
    if (typeof selected === 'boolean') updateData.selected = selected;
    if (score !== undefined && Number.isFinite(Number(score))) updateData.score = Math.max(0, Math.min(100, Number(score)));
    if (typeof feedback === 'string') updateData.scoringFeedback = feedback;

    const insight = await prisma.extractedInsight.upsert({
      where: { submissionId: req.params.submissionId },
      update: updateData,
      create: {
        submissionId: req.params.submissionId,
        selected: Boolean(selected),
        score: score !== undefined && Number.isFinite(Number(score)) ? Number(score) : 75,
        scoringFeedback: typeof feedback === 'string' ? feedback : 'Reviewed by form owner.',
        summary: typeof feedback === 'string' ? feedback : 'Reviewed by form owner.',
      },
    });
    res.json({ success: true, insight });
  } catch (error: any) {
    logger.error('Failed to update form response status', error);
    res.status(500).json({ error: 'Failed to update response.' });
  }
});

router.delete('/:id/responses/:submissionId', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.userId || (req as any).teacher?.teacherId;
    const form = await prisma.applicationForm.findUnique({ where: { id: req.params.id } });
    if (!form) return res.status(404).json({ error: 'Form not found.' });
    if (!userId || form.userId !== userId) return res.status(403).json({ error: 'You do not have access to this form.' });

    await prisma.extractedInsight.deleteMany({ where: { submissionId: req.params.submissionId } });
    await prisma.formSubmission.delete({ where: { id: req.params.submissionId } });
    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to delete form response', error);
    res.status(500).json({ error: 'Failed to delete response.' });
  }
});

router.patch('/:id/requirements', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.userId || (req as any).teacher?.teacherId;
    const form = await prisma.applicationForm.findUnique({ where: { id: req.params.id } });
    if (!form) return res.status(404).json({ error: 'Form not found.' });
    if (!userId || form.userId !== userId) return res.status(403).json({ error: 'You do not have access to this form.' });
    const requirements = typeof req.body?.requirements === 'string' ? req.body.requirements.trim().slice(0, 12000) : '';
    let schema: any = {};
    try { schema = JSON.parse(form.schema || '{}'); } catch { schema = {}; }
    const selectionSettings = { ...(form.selectionSettings ? JSON.parse(form.selectionSettings) : {}), requirements };
    await prisma.applicationForm.update({ where: { id: form.id }, data: { schema: JSON.stringify({ ...schema, requirements }), selectionSettings: JSON.stringify(selectionSettings) } });
    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to save form selection requirements', error);
    res.status(500).json({ error: 'Failed to save requirements.' });
  }
});

router.get('/:id/results/export.csv', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.userId || (req as any).teacher?.teacherId;
    const form = await prisma.applicationForm.findUnique({ where: { id: req.params.id } });
    if (!form) return res.status(404).json({ error: 'Form not found.' });
    if (!userId || form.userId !== userId) return res.status(403).json({ error: 'You do not have access to this form.' });
    const schema = JSON.parse(form.schema || '{}');
    const labels = [...(schema.questions || []), ...(schema.fields || [])].map((field: any, index: number) => ({ id: String(field.id ?? field.number ?? index + 1), label: String(field.title || field.label || `Question ${index + 1}`) }));
    const submissions = await prisma.formSubmission.findMany({ where: { formId: form.id }, include: { extractedInsights: true }, orderBy: { createdAt: 'asc' } });
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [["Submission ID", "Submitted At", ...labels.map((field: any) => field.label), "AI Score", "Selected", "AI Feedback"].map(escape).join(','), ...submissions.map((submission) => {
      const answers = JSON.parse(submission.data);
      return [submission.id, submission.createdAt.toISOString(), ...labels.map((field: any) => Array.isArray(answers[field.id]) ? answers[field.id].join('; ') : answers[field.id]), submission.extractedInsights?.score, submission.extractedInsights?.selected ? 'Yes' : 'No', submission.extractedInsights?.scoringFeedback || submission.extractedInsights?.summary].map(escape).join(',');
    })];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="form-responses-${form.id}.csv"`);
    res.send(`\uFEFF${lines.join('\r\n')}`);
  } catch (error: any) {
    logger.error('Failed to export form responses', error);
    res.status(500).json({ error: 'Failed to export responses.' });
  }
});

router.post('/create-from-chat', requireAuth, async (req, res) => {
  try {
    const { description } = req.body;
    const userId = (req as any).user?.userId || 'anonymous';

    const form = await formOrchestrator.generateFormSchema(userId, description);

    res.json({
      success: true,
      formId: form.id,
      title: form.title,
      shareableLink: `/apply/${form.id}`,
      form,
    });
  } catch (error: any) {
    logger.error('Failed to create form from chat', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/ai-agent', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.userId || 'anonymous';
    const { action, ...payload } = req.body || {};
    if (!action) return res.status(400).json({ error: 'Agent action is required.' });
    const result = await formOrchestrator.runFormAgent(userId, String(action), payload);
    res.json({ success: true, ...result });
  } catch (error: any) {
    logger.error('Form AI Agent action failed', error);
    res.status(500).json({ error: error?.message || 'Form AI Agent failed.' });
  }
});

router.get('/:id/results/pdf', requireAuth, async (req, res) => {
  try {
    const formId = req.params.id;
    const isAudit = req.query.audit === 'true';

    // Payment Check (Reusing grading service's payment logic pattern)
    const paid = await gradingService.isBatchPaid(formId);
    if (!paid) {
      return res.status(402).json({ error: 'Payment required to download final results report.' });
    }

    const pdfBuffer = await pdfService.generateResultsPdf(formId, isAudit);

    const filename = isAudit ? `audit-results-${formId}.pdf` : `results-${formId}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(pdfBuffer);
  } catch (error: any) {
    logger.error('PDF generation failed', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
