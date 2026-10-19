import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../production/auth.js';
import { prisma } from '../db.js';

const router = Router();

router.use(requireAuth);

const feedbackSchema = z.object({
  messageId: z.string().trim().min(1).max(120),
  rating: z.enum(['up', 'down']),
  question: z.string().max(6_000).optional().default(''),
  response: z.string().trim().min(1).max(20_000),
  reasons: z.array(z.string().trim().min(1).max(80)).max(5).default([]),
  details: z.string().trim().max(1_000).optional().default(''),
  consentForImprovement: z.boolean().optional(),
});

router.post('/', async (req, res) => {
  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'Feedback details are invalid.' });
  }

  const userId = req.user?.userId;
  if (typeof userId !== 'string' || !userId) {
    return res.status(401).json({ success: false, error: 'Authentication required.' });
  }

  try {
    const feedback = await prisma.$transaction(async (tx) => {
      const key = { userId_messageId: { userId, messageId: parsed.data.messageId } };
      const existing = await tx.responseFeedback.findUnique({
        where: key,
        select: { datasetExampleId: true, consentForImprovement: true },
      });
      const consentForImprovement = parsed.data.consentForImprovement ?? existing?.consentForImprovement ?? false;
      const withdrewConsent = Boolean(existing?.datasetExampleId && parsed.data.consentForImprovement === false);
      if (withdrewConsent && existing?.datasetExampleId) {
        await tx.datasetExample.updateMany({
          where: { id: existing.datasetExampleId },
          data: { consentGiven: false, status: 'pending' },
        });
      }

      return tx.responseFeedback.upsert({
        where: key,
        create: {
          ...parsed.data,
          reasons: JSON.stringify(parsed.data.reasons),
          consentForImprovement,
          userId,
        },
        update: {
          ...parsed.data,
          reasons: JSON.stringify(parsed.data.reasons),
          consentForImprovement,
          status: existing?.datasetExampleId && consentForImprovement ? 'used' : 'new',
          ...(withdrewConsent ? { datasetExampleId: null } : {}),
        },
        select: { id: true, status: true },
      });
    });
    res.status(201).json({ success: true, data: feedback });
  } catch (error) {
    console.error('Could not save response feedback:', error);
    res.status(500).json({ success: false, error: 'Feedback could not be saved. Please try again.' });
  }
});

export default router;
