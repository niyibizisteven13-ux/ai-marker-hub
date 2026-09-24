import { Router } from 'express';
import { FormOrchestrator } from '../services/FormOrchestrator.js';
import { ResultsPdfService } from '../services/ResultsPdfService.js';
import { GradingService } from '../services/GradingService.js';
import { requireAuth } from '../../production/auth.js';
import logger from '../utils/logger.js';

const router = Router();
const formOrchestrator = FormOrchestrator.getInstance();
const pdfService = ResultsPdfService.getInstance();
const gradingService = GradingService.getInstance();

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
