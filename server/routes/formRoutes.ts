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
    const { title, description = '', questions, blocks = [], themeColor = '#D97757' } = req.body || {};
    if (typeof title !== 'string' || !title.trim() || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'A title and at least one question are required.' });
    }
    if (questions.length > 100 || questions.some((q: any) => !q || typeof q.title !== 'string' || !q.title.trim())) {
      return res.status(400).json({ error: 'Each question needs a title; forms can contain up to 100 questions.' });
    }
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    const safeThemeColor = /^#[0-9a-fA-F]{6}$/.test(themeColor) ? themeColor : '#D97757';
    const schema = { title: title.trim(), description: String(description).trim(), questions, blocks: Array.isArray(blocks) ? blocks.slice(0, 100) : [], themeColor: safeThemeColor };
    const rubric = req.body?.rubric && typeof req.body.rubric === 'object' ? JSON.stringify(req.body.rubric) : null;
    const selectionSettings = req.body?.selectionSettings && typeof req.body.selectionSettings === 'object' ? JSON.stringify(req.body.selectionSettings) : null;
    const form = await prisma.applicationForm.create({
      data: { userId, title: schema.title, schema: JSON.stringify({ ...schema, ...(req.body.requirements ? { requirements: String(req.body.requirements).slice(0, 12000) } : {}) }), rubric, selectionSettings },
    });
    res.status(201).json({ success: true, form: { id: form.id, ...schema } });
  } catch (error: any) {
    logger.error('Failed to save manually created form', error);
    res.status(500).json({ error: 'Failed to save form.' });
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
    res.json({ success: true, forms: forms.map(({ schema, rubric, selectionSettings, ...form }) => ({ ...form, schema: JSON.parse(schema || '{}'), rubric: rubric ? JSON.parse(rubric) : null, selectionSettings: selectionSettings ? JSON.parse(selectionSettings) : null, responseCount: form._count.submissions })) });
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
    res.json({ success: true, submissions: submissions.map((submission) => ({ id: submission.id, submittedAt: submission.createdAt, answers: JSON.parse(submission.data), analysis: submission.extractedInsights ? { score: submission.extractedInsights.score, selected: submission.extractedInsights.selected, summary: submission.extractedInsights.summary, feedback: submission.extractedInsights.scoringFeedback, details: submission.extractedInsights.scoringDetails ? JSON.parse(submission.extractedInsights.scoringDetails) : null } : null })) });
  } catch (error: any) {
    logger.error('Failed to load form responses', error);
    res.status(500).json({ error: 'Failed to load responses.' });
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
      shareableLink: `/apply/${form.id}`
    });
  } catch (error: any) {
    logger.error('Failed to create form from chat', error);
    res.status(500).json({ error: error.message });
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
