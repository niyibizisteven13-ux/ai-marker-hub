import { PrismaClient } from '@prisma/client';
import { resolvePlanPolicy } from './plans/resolvePlan.js';
import { AccessResult } from './plans/types.js';
import logger from '../utils/logger.js';

const prisma = new PrismaClient();

// FIX: widened from 'grading' | 'scoring' to the actual set of intent/service
// names produced by classifyIntent() in server.ts. Previously 'scoring' didn't
// match the real value 'selection_scoring' ever passed at runtime (masked by
// server.ts's `service as any` cast), and 'farming_advice' wasn't included at
// all — both would silently create their own untyped quota/plan lookups instead
// of hitting the intended, tracked service bucket.
export type ServiceName = 'grading' | 'selection_scoring' | 'farming_advice';

export class PaywallService {
  private static instance: PaywallService;

  private constructor() {}

  public static getInstance(): PaywallService {
    if (!PaywallService.instance) {
      PaywallService.instance = new PaywallService();
    }
    return PaywallService.instance;
  }

  /**
   * Deterministic gate for service access using pluggable policies.
   */
  public async checkAccess(userId: string, service: ServiceName, jobId: string): Promise<AccessResult> {
    // 1. Check if specific job is already unlocked (Global check)
    const unlocked = await prisma.unlockedResult.findFirst({
      where: { userId, jobId, service }
    });

    if (unlocked) {
      logger.info('Access allowed: Result already unlocked', { userId, jobId, service });
      return { allowed: true };
    }

    // 2. Resolve plan and delegate access check
    const policy = await resolvePlanPolicy(userId);
    const result = await policy.checkAccess(userId, service, jobId);

    if (result.allowed) {
      logger.info('Access allowed by policy', { userId, service, paidFrom: result.paidFrom });
    } else {
      logger.info('Access denied by policy', { userId, service, reason: result.reason });
    }

    return result;
  }

  public async unlockResult(userId: string, jobId: string, service: ServiceName, paidUsd: number) {
    logger.info('Unlocking result for user', { userId, jobId, service, paidUsd });
    return prisma.unlockedResult.create({
      data: { userId, jobId, service, paidUsd }
    });
  }

  // FIX: added the missing 'farming_advice' label so the upgrade message
  // reads correctly for all three paywalled services, not just the two
  // originally handled (grading fell through to the else branch as
  // "application scoring", which was wrong for farming_advice too).
  public buildUpgradeMessage(service: ServiceName, upgradeLink: string, customMessage?: string) {
    const labels: Record<ServiceName, string> = {
      grading: 'grading',
      selection_scoring: 'application scoring',
      farming_advice: 'farming advice',
    };
    const label = labels[service] || 'this feature';
    const mainText = customMessage || `You've used your free result for this feature. To unlock this result and keep using ${label}, upgrade below:`;

    return `Your free ${label} result is ready! 🎉

${mainText}

**[Unlock this result →](${upgradeLink})**

Payment is quick via Mobile Money — you'll see your result immediately after.`;
  }
}