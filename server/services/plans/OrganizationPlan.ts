import { PrismaClient } from '@prisma/client';
import { PlanPolicy, AccessResult } from './types.js';
import { PaymentService } from '../PaymentService.js';

const prisma = new PrismaClient();

export class OrganizationPlanPolicy implements PlanPolicy {
  constructor(private orgId: string) {}

  async checkAccess(userId: string, service: string, jobId: string): Promise<AccessResult> {
    const paymentService = PaymentService.getInstance();
    const price = await paymentService.getPriceForJob(jobId, service);

    const org = await prisma.organization.findUnique({
      where: { id: this.orgId }
    });

    if (!org || org.creditBalanceUsd < price) {
      return {
        allowed: false,
        reason: 'org_balance_exhausted',
        message: `Your institution's balance is low ($${org?.creditBalanceUsd.toFixed(2) || '0.00'}). Ask your admin to top up.`,
      };
    }

    if (org.perWorkerCapUsd != null) {
      const usedThisMonth = await this.getWorkerSpendThisMonth(userId);
      if (usedThisMonth + price > org.perWorkerCapUsd) {
        return {
          allowed: false,
          reason: 'worker_cap_exceeded',
          needsAdminApproval: true,
          message: `You've used your allocated credits this month ($${usedThisMonth.toFixed(2)}/$${org.perWorkerCapUsd.toFixed(2)}). Ask your admin to raise your limit.`,
        };
      }
    }

    // Atomically decrement balance and record unlock
    await prisma.$transaction([
      prisma.organization.update({
        where: { id: this.orgId },
        data: { creditBalanceUsd: { decrement: price } },
      }),
      prisma.unlockedResult.create({
        data: { userId, jobId, service, paidUsd: price },
      })
    ]);

    return { allowed: true, paidFrom: 'org_balance' };
  }

  private async getWorkerSpendThisMonth(userId: string): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const results = await prisma.unlockedResult.findMany({
      where: { userId, createdAt: { gte: startOfMonth } },
    });
    return results.reduce((sum, r) => sum + r.paidUsd, 0);
  }
}
