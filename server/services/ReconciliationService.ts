import { PrismaClient } from '@prisma/client';
import { Queue, Worker, Job } from 'bullmq';
import { PaymentService } from './PaymentService.js';
import { PaywallService } from './PaywallService.js';
import { writeAuditLog } from '../../production/auth.js';
import logger from '../utils/logger.js';
import net from 'net';

const prisma = new PrismaClient();
const paymentService = PaymentService.getInstance();
const paywallService = PaywallService.getInstance();

export class ReconciliationService {
  private static instance: ReconciliationService;
  private reconciliationQueue: Queue | null = null;
  private worker: Worker | null = null;
  private isRedisAvailable: boolean = false;

  private redisConnection = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
  };

  private constructor() {}

  public static getInstance(): ReconciliationService {
    if (!ReconciliationService.instance) {
      ReconciliationService.instance = new ReconciliationService();
    }
    return ReconciliationService.instance;
  }

  public async initialize() {
    this.isRedisAvailable = await this.checkRedisAvailability();

    if (!this.isRedisAvailable) {
      logger.warn('Redis is not available. Reconciliation Service background tasks are disabled.');
      return;
    }

    try {
      this.reconciliationQueue = new Queue('payment-reconciliation', { connection: this.redisConnection });

      this.worker = new Worker('payment-reconciliation', async (job) => {
        if (job.name === 'expire-subscriptions') {
          await this.expireSubscriptions();
        } else {
          await this.reconcilePendingPayments();
        }
      }, { connection: this.redisConnection });

      logger.info('Reconciliation Service Initialized');
      await this.startScheduledJobs();
    } catch (error) {
      this.isRedisAvailable = false;
      logger.error('Failed to initialize Reconciliation Service:', error);
    }
  }

  private async checkRedisAvailability(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection(this.redisConnection);
      socket.setTimeout(1000);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('timeout', () => { socket.destroy(); resolve(false); });
      socket.once('error', () => { socket.destroy(); resolve(false); });
    });
  }

  public async startScheduledJobs() {
    if (!this.reconciliationQueue) return;

    // Run payment reconciliation every 10 minutes
    await this.reconciliationQueue.add('reconcile', {}, {
      repeat: { pattern: '*/10 * * * *' },
      removeOnComplete: true,
    });

    // Run subscription expiry once every 24 hours (at midnight)
    await this.reconciliationQueue.add('expire-subscriptions', {}, {
      repeat: { pattern: '0 0 * * *' },
      removeOnComplete: true,
    });
  }

  /**
   * Scans for ACTIVE subscriptions that have reached their endDate
   */
  private async expireSubscriptions() {
    logger.info('Starting subscription expiry check...');

    const now = new Date();
    const expiredSubCount = await prisma.subscription.updateMany({
      where: {
        status: 'ACTIVE',
        endDate: { lt: now }
      },
      data: { status: 'EXPIRED' }
    });

    if (expiredSubCount.count > 0) {
      logger.info(`Expired ${expiredSubCount.count} subscriptions`);
      await writeAuditLog('system', 'EXPIRE_SUBSCRIPTIONS', 'Subscription', null, {
        count: expiredSubCount.count
      });
    }
  }

  /**
   * Main logic: Find pending payments and verify their status with the provider
   */
  private async reconcilePendingPayments() {
    logger.info('Starting payment reconciliation loop...');

    // Find payments in PENDING status older than 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const pendingPayments = await prisma.payment.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: fiveMinutesAgo }
      }
    });

    logger.info(`Found ${pendingPayments.length} pending payments for reconciliation`);

    for (const payment of pendingPayments) {
      if (!payment.externalRef) continue;

      try {
        const { status } = await paymentService.verifyPaymentStatus(payment.externalRef);

        if (status === 'SUCCESSFUL') {
          await this.handleSuccessfulPayment(payment);
        } else if (status === 'FAILED' || status === 'REJECTED') {
          await prisma.payment.update({
            where: { id: payment.id },
            data: { status: 'FAILED' }
          });
          logger.info(`Payment ${payment.id} marked as FAILED via reconciliation`);
        }
      } catch (err) {
        logger.error(`Failed to reconcile payment ${payment.id}`, err);
      }
    }
  }

  private async handleSuccessfulPayment(payment: any) {
    const [userId, jobId, service] = payment.externalRef.split(':');
    const RWF_PER_USD = 1470;
    const paidUsd = payment.amountRwf / RWF_PER_USD;

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'SUCCESS' }
      });

      if (jobId === 'PLAN') {
        await tx.subscription.upsert({
          where: { userId },
          update: {
            planType: service,
            status: 'ACTIVE',
            endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          },
          create: {
            userId,
            planType: service,
            status: 'ACTIVE',
            endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          }
        });
      } else {
        await paywallService.unlockResult(userId, jobId, service, paidUsd);
      }
    });

    logger.info(`Payment ${payment.id} successfully reconciled and unlocked`);
  }
}
