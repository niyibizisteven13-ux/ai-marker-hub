import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../../production/auth.js';
import logger from '../utils/logger.js';
import { issueTelegramLink } from '../services/telegramLinkStore.js';

const router = Router();

// GET /api/billing
router.get('/billing', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const subscription = await prisma.subscription.findUnique({
      where: { userId },
    });
    const payments = await prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    res.json({
      success: true,
      subscription: subscription ? {
        planType: subscription.planType,
        status: subscription.status,
        renewalDate: subscription.endDate,
      } : {
        planType: 'INDIVIDUAL',
        status: 'FREE',
        renewalDate: null,
      },
      receipts: payments.map(p => ({
        id: p.id,
        date: p.createdAt,
        amount: `$${(p.amountRwf / 1470).toFixed(2)} (${p.amountRwf} RWF)`,
        status: p.status,
      })),
    });
  } catch (err: any) {
    logger.error('Failed to load billing info', err);
    res.status(500).json({ error: err.message || 'Failed to load billing info' });
  }
});

// POST /api/billing/cancel
router.post('/billing/cancel', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    await prisma.subscription.updateMany({
      where: { userId },
      data: { status: 'CANCELED' },
    });
    res.json({ success: true, message: 'Subscription canceled successfully.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to cancel subscription' });
  }
});

// GET /api/usage
router.get('/usage', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const [scriptsMarked, files, recentBatches, paidBatches] = await Promise.all([
      prisma.batchJobResult.count({ where: { job: { userId } } }),
      prisma.fileRecord.aggregate({ where: { userId }, _sum: { size: true } }),
      prisma.batchJob.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, status: true, createdAt: true, detectedCount: true } }),
      prisma.payment.count({ where: { userId, status: 'SUCCESS' } }),
    ]);

    res.json({
      success: true,
      meters: {
        scriptsMarked: { used: scriptsMarked, limit: 1000 },
        batchesPaid: { used: paidBatches, limit: 50 },
        dataStoreMb: { used: Math.ceil((files._sum.size || 0) / (1024 * 1024)), limit: 500 },
      },
      history: recentBatches.map((batch) => ({ date: batch.createdAt.toISOString().split('T')[0], action: `Marking batch · ${batch.status.toLowerCase()}${batch.detectedCount ? ` · ${batch.detectedCount} scripts` : ''}`, cost: '—' })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load usage' });
  }
});

// GET /api/connections
router.get('/connections', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const telegramSession = await prisma.telegramSession.findFirst({
      where: { userId },
    });
    res.json({
      success: true,
      telegram: {
        connected: !!telegramSession,
        chatId: telegramSession?.chatId || null,
        botUsername: `@${process.env.TELEGRAM_BOT_USERNAME || 'BwengeAI_Bot'}`,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load connections' });
  }
});

router.post('/connections/telegram/link', requireAuth, async (req, res) => {
  const userId = (req as any).user?.userId;
  const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'BwengeAI_Bot';
  const code = issueTelegramLink(userId);
  res.json({ success: true, expiresInSeconds: 600, link: `https://t.me/${botUsername.replace(/^@/, '')}?start=link_${code}` });
});

// POST /api/connections/telegram
router.post('/connections/telegram', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { action } = req.body;
    if (action === 'disconnect') {
      await prisma.telegramSession.updateMany({
        where: { userId },
        data: { userId: null },
      });
      return res.json({ success: true, connected: false });
    }
    return res.status(400).json({ error: 'Use the secure Telegram bot pairing flow to connect this account.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Connection update failed' });
  }
});

// POST /api/sales/organisation-request
router.post('/sales/organisation-request', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { organizationName, faculty, estimatedSeats, contactEmail, message } = req.body;
    if (!organizationName || !contactEmail) {
      return res.status(400).json({ error: 'Organization name and contact email are required.' });
    }
    logger.info('Organisation request received', { userId, organizationName, faculty, estimatedSeats, contactEmail });
    res.json({
      success: true,
      message: 'Thank you. Our institutional partnerships team will contact you within 24 hours with a custom quote.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Organisation request failed' });
  }
});

export default router;
