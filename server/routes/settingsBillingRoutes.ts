import { Router } from 'express';
import { usageSummary } from '../services/billing/usage.js';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../../production/auth.js';
import logger from '../utils/logger.js';
import { issueTelegramLink } from '../services/telegramLinkStore.js';
import { getTelegramWebhookBaseUrl, TelegramBotService } from '../services/TelegramBotService.js';

const router = Router();
const telegramBotService = TelegramBotService.getInstance();

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
      // Plan, credits (day / week / month) and per-feature daily limits.
      ...(await usageSummary(userId)),
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
        botUsername: `@${(process.env.TELEGRAM_BOT_USERNAME || 'Bwengebot').replace(/^@/, '')}`,
        botConfigured: telegramBotService.isConfigured(),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load connections' });
  }
});

router.post('/connections/telegram/link', requireAuth, async (req, res) => {
  const userId = (req as any).user?.userId;
  if (!telegramBotService.isConfigured()) {
    return res.status(503).json({ error: 'Telegram is not configured on the server. Please contact the administrator.' });
  }

  const verifiedBotUsername = await telegramBotService.getBotUsername();
  if (!verifiedBotUsername) {
    return res.status(503).json({ error: 'The Telegram bot could not be verified. Please try again later.' });
  }

  const webhookBaseUrl = getTelegramWebhookBaseUrl();
  if (!webhookBaseUrl) {
    return res.status(503).json({ error: 'Telegram webhook URL is not configured. Set APP_BASE_URL to the public HTTPS application URL.' });
  }
  const webhookConfigured = await telegramBotService.setWebhook(webhookBaseUrl);
  if (!webhookConfigured) {
    return res.status(503).json({ error: 'Telegram could not connect to this application. Check the public HTTPS URL and webhook settings.' });
  }

  const code = issueTelegramLink(userId);
  return res.json({
    success: true,
    expiresInSeconds: 600,
    botUsername: `@${verifiedBotUsername}`,
    link: `https://t.me/${encodeURIComponent(verifiedBotUsername)}?start=link_${code}`,
  });
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
    const parsed = z.object({
      organizationName: z.string().trim().min(1).max(160),
      faculty: z.string().trim().max(160).optional().default(''),
      estimatedSeats: z.coerce.number().int().min(1).max(1_000_000).optional(),
      contactEmail: z.string().trim().email().max(254),
      message: z.string().trim().max(4_000).optional().default(''),
    }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Provide a valid organization name and contact email; optional details must also be valid.' });
    }

    const upgradeRequest = await prisma.organizationUpgradeRequest.create({
      data: {
        userId,
        organizationName: parsed.data.organizationName,
        faculty: parsed.data.faculty || null,
        estimatedSeats: parsed.data.estimatedSeats,
        contactEmail: parsed.data.contactEmail,
        message: parsed.data.message || null,
      },
      select: { id: true },
    });
    logger.info('Organisation upgrade request received.', { userId, requestId: upgradeRequest.id, estimatedSeats: parsed.data.estimatedSeats });
    res.json({
      success: true,
      message: 'Thank you. Our institutional partnerships team will contact you within 24 hours with a custom quote.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Organisation request failed' });
  }
});

export default router;
