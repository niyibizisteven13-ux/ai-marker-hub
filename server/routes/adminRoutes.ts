import { Router } from 'express';
import { getRealizedMargin } from '../services/CostTrackingService.js';
import { CostCircuitBreakerService } from '../services/CostCircuitBreakerService.js';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// In a real app, this would have a strict isAdmin middleware
router.get('/margin-check', async (req, res) => {
  try {
    const grading = await getRealizedMargin('grading', 24);
    const scoring = await getRealizedMargin('scoring', 24);
    const hourlySpend = await CostCircuitBreakerService.getHourlySpend();
    const threshold = CostCircuitBreakerService.getThreshold();
    const isCircuitOpen = await CostCircuitBreakerService.isCircuitOpen();

    const failedJobsCount = await prisma.failedJob.count({
      where: { status: 'needs_review' }
    });

    res.json({
      success: true,
      data: {
        grading,
        scoring,
        failedJobsCount,
        hourlySpend,
        threshold,
        isCircuitOpen,
        targetMargin: 1.2,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/circuit-breaker/toggle', async (req, res) => {
  const { open } = req.body;
  CostCircuitBreakerService.forceOpen(!!open);
  res.json({ success: true, isCircuitOpen: !!open });
});

router.get('/failed-jobs', async (req, res) => {
  try {
    const jobs = await prisma.failedJob.findMany({
      where: { status: 'needs_review' },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json({ success: true, data: jobs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/audit-logs', async (req, res) => {
  try {
    const { actorId, action, resourceType, limit = '50' } = req.query;

    const where: any = {};
    if (actorId) where.actorId = actorId as string;
    if (action) where.action = action as string;
    if (resourceType) where.resourceType = resourceType as string;

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string, 10),
    });

    res.json({ success: true, data: logs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
