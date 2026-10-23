import { prisma } from '../db.js';
import { checkUsage } from './billing/usage.js';
import { AccessResult } from './plans/types.js';
import logger from '../utils/logger.js';

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

    // 2. The plan allowance and GO credits decide, the same as for every other AI action (one billing system).
    //    The old "one free result, then pay per result" policy ignored plans and GO credits and locked results
    //    for users who had already paid.
    const gate = await checkUsage(userId, { kind: service === 'farming_advice' ? 'chat' : 'marking' });
    const result: AccessResult = gate.allowed
      ? { allowed: true, paidFrom: gate.wallet ? 'individual_charge' : undefined }
      : { allowed: false, reason: 'payment_required', message: gate.message, upgradeUrl: gate.upgrade?.url ?? '/upgrade?reason=limit' };
    if (result.allowed) logger.info('Access allowed by plan', { userId, service, wallet: !!gate.wallet });
    else logger.info('Access denied by plan limits', { userId, service, code: gate.code });
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
  public buildUpgradeMessage(service: ServiceName, upgradeLink: string, customMessage?: string, resumable = true) {
    const labels: Record<ServiceName, string> = { grading: 'Marking', selection_scoring: 'Application scoring', farming_advice: 'This answer' };
    const what = labels[service] || 'This request';
    return `**Limit reached.** ${customMessage || `${what} needs more credits than you have left today.`}

**[See plans and buy credits →](${upgradeLink})**

Payment is by MTN Mobile Money.${resumable ? ' After paying, just say **"continue"** and I will finish this request: there is no need to upload the files again.' : ' After paying, send the request again.'}`;
  }

}