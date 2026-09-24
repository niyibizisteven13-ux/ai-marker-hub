import { Router } from 'express';
import { PaymentService } from '../services/PaymentService.js';
import { PaywallService } from '../services/PaywallService.js';
import { requireAuth } from '../../production/auth.js';
import { verifyMomoSignature, whitelistPaymentGateways } from '../middleware/webhookAuth.js';
import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger.js';

const router = Router();
const paymentService = PaymentService.getInstance();
const paywallService = PaywallService.getInstance();
const prisma = new PrismaClient();

router.get('/quote', requireAuth, async (req, res) => {
  try {
    const { jobId, service } = req.query;
    if (!jobId || !service) return res.status(400).json({ error: 'Missing jobId or service' });

    const priceUsd = await paymentService.getPriceForJob(jobId as string, service as string);
    res.json({ priceUsd });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/status', requireAuth, async (req, res) => {
  try {
    const { jobId, planType } = req.query;
    const userId = (req as any).user?.userId;

    if (jobId) {
      const payment = await prisma.payment.findFirst({
        where: { batchId: jobId as string },
        orderBy: { createdAt: 'desc' },
      });
      return res.json({ status: payment?.status || 'PENDING' });
    }

    if (planType && userId) {
      const subscription = await prisma.subscription.findUnique({
        where: { userId }
      });
      return res.json({ status: subscription?.status === 'ACTIVE' ? 'SUCCESS' : 'PENDING' });
    }

    res.status(400).json({ error: 'Missing jobId or planType' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/initiate', requireAuth, async (req, res) => {
  try {
    const { phoneNumber, batchId, service, planType, isSubscription } = req.body;
    const userId = (req as any).user?.userId || 'anonymous';

    let priceUsd = 0;
    if (isSubscription && planType === 'BUSINESS') {
      priceUsd = 9.00;
    } else if (batchId) {
      priceUsd = await paymentService.getPriceForJob(batchId, service);
    }

    const rwfAmount = await paymentService.convertUsdToRwf(priceUsd);

    // Reference format: userId:jobId:service or userId:PLAN:planType
    const referenceId = isSubscription
      ? `${userId}:PLAN:${planType}`
      : `${userId}:${batchId}:${service}`;

    await prisma.payment.upsert({
      where: { batchId: batchId || referenceId },
      update: {
        status: 'PENDING',
        externalRef: referenceId,
        amountRwf: rwfAmount
      },
      create: {
        userId,
        batchId: batchId || referenceId,
        amountRwf: rwfAmount,
        status: 'PENDING',
        provider: 'MTN_MOMO',
        externalRef: referenceId,
      },
    });

    const result = await paymentService.initiateMomoPayment({
      amount: priceUsd,
      phoneNumber,
      batchId: batchId || referenceId,
      userId,
      service,
      externalRef: referenceId
    });

    res.json(result);
  } catch (error: any) {
    logger.error('Payment initiation failed', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/stripe/create-checkout-session', requireAuth, async (req, res) => {
  try {
    const { plan } = req.body;
    const userId = (req as any).user?.userId || 'anonymous';

    const result = await paymentService.createStripeCheckoutSession(userId, plan);
    res.json(result);
  } catch (error: any) {
    logger.error('Stripe session creation failed', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/momo/callback', whitelistPaymentGateways, verifyMomoSignature, async (req, res) => {
  const { externalId, status, amount, referenceId } = req.body;
  const ref = referenceId || externalId;

  logger.info('MoMo Callback Received', { ref, status });

  if (!ref) return res.status(400).send('Missing reference');

  const [userId, jobId, service] = ref.split(':');

  try {
    const isSuccess = status === 'SUCCESSFUL' || status === 'SUCCESS';

    await prisma.payment.updateMany({
      where: { externalRef: ref },
      data: { status: isSuccess ? 'SUCCESS' : 'FAILED' },
    });

    if (isSuccess) {
      const payment = await prisma.payment.findFirst({ where: { externalRef: ref } });
      if (payment) {
        const RWF_PER_USD = 1470;
        const paidUsd = payment.amountRwf / RWF_PER_USD;

        if (jobId === 'PLAN') {
          // It's a subscription upgrade
          await prisma.subscription.upsert({
            where: { userId },
            update: {
              planType: service, // in this case 'service' is the planType from the ref
              status: 'ACTIVE',
              endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
            },
            create: {
              userId,
              planType: service,
              status: 'ACTIVE',
              endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            }
          });
        } else {
          // It's a job unlock
          await paywallService.unlockResult(userId, jobId, service, paidUsd);
        }
      }
    }

    res.status(200).send('OK');
  } catch (err: any) {
    logger.error('Callback processing failed', err);
    res.status(500).send('Internal Error');
  }
});

export default router;
