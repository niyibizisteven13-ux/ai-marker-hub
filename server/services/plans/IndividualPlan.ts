import { PrismaClient } from '@prisma/client';
import { PlanPolicy, AccessResult } from './types.js';

const prisma = new PrismaClient();
const FREE_RESULTS_ALLOWED = 1;

export class IndividualPlanPolicy implements PlanPolicy {
  async checkAccess(userId: string, service: string, jobId: string): Promise<AccessResult> {
    const quota = await prisma.usageQuota.upsert({
      where: { userId_service: { userId, service } },
      update: {},
      create: { userId, service, freeUsed: 0 },
    });

    if (quota.freeUsed < FREE_RESULTS_ALLOWED) {
      await prisma.usageQuota.update({
        where: { userId_service: { userId, service } },
        data: { freeUsed: { increment: 1 } },
      });
      return { allowed: true, paidFrom: 'free_trial', wasFreeTrial: true };
    }

    return {
      allowed: false,
      reason: 'payment_required',
      message: `Your free result is used. Unlock this and future results with a one-time payment.`,
    };
  }
}
