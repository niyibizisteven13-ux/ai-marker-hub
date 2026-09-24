import { PrismaClient } from '@prisma/client';
import { PlanPolicy, AccessResult } from './types.js';

const prisma = new PrismaClient();

export class BusinessPlanPolicy implements PlanPolicy {
  async checkAccess(userId: string, service: string, jobId: string): Promise<AccessResult> {
    const subscription = await prisma.subscription.findUnique({
      where: { userId }
    });

    if (subscription && subscription.status === 'ACTIVE') {
      // Business users get high or unlimited quota.
      // For now, allow all as long as subscription is active.
      return {
        allowed: true,
        paidFrom: 'individual_charge' // Or a new category like 'subscription'
      };
    }

    return {
      allowed: false,
      reason: 'payment_required',
      message: `Your Business subscription is inactive or expired. Please renew to continue.`,
    };
  }
}
