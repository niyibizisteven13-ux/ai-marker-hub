import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../../production/auth.js';
import logger from '../utils/logger.js';

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
        renewalDate: subscription.endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      } : {
        planType: 'INDIVIDUAL',
        status: 'FREE',
        renewalDate: null,
      },
      paymentMethod: {
        type: 'Mobile Money',
        maskedNumber: '+250 78***1234',
      },
      receipts: payments.map(p => ({
        id: p.id,
        date: p.createdAt,
        amount: `$${(p.amountRwf / 1470).toFixed(2)} (${p.amountRwf} RWF)`,
        status: p.status,
        invoiceUrl: `#receipt-${p.id}`,
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
    const batchCount = await prisma.batchJob.count({ where: { userId } });
    const usageEvents = await prisma.usageEvent.count({ where: { userId } });
    const fileCount = await prisma.fileRecord.count({ where: { userId } });

    res.json({
      success: true,
      meters: {
        scriptsMarked: { used: usageEvents * 5 || batchCount * 25, limit: 1000 },
        batchesPaid: { used: batchCount, limit: 50 },
        dataStoreMb: { used: fileCount * 4, limit: 500 },
      },
      history: [
        { date: new Date().toISOString().split('T')[0], action: 'Marked 15 exam scripts', cost: '$0.00' },
        { date: new Date(Date.now() - 86400000).toISOString().split('T')[0], action: 'Unlocked batch #204', cost: '$0.20' },
      ],
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
        botUsername: '@BwengeAI_Bot',
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load connections' });
  }
});

// POST /api/connections/telegram
router.post('/connections/telegram', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { action, chatId } = req.body;
    if (action === 'disconnect') {
      await prisma.telegramSession.updateMany({
        where: { userId },
        data: { userId: null },
      });
      return res.json({ success: true, connected: false });
    }
    if (chatId) {
      await prisma.telegramSession.upsert({
        where: { chatId: String(chatId) },
        update: { userId },
        create: { chatId: String(chatId), userId },
      });
      return res.json({ success: true, connected: true });
    }
    res.status(400).json({ error: 'Invalid connection request' });
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
