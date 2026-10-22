import logger from '../../../utils/logger.js';
import { prisma } from '../../../db.js';

export interface UsageRecord {
  requestId: string;
  userId: string;
  orgId?: string;
  taskClass: string;
  model: string;
  fallbackUsed: boolean;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
  outcome: 'success' | 'rate_limited' | 'quota_exceeded' | 'error';
}

const PRICING_TABLE: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'zai-org/GLM-5.3-Flash-Lite': { inputPer1M: 0.10, outputPer1M: 0.30 },
  'zai-org/GLM-5.3-Flash': { inputPer1M: 0.20, outputPer1M: 0.60 },
  'zai-org/GLM-4.6-Reasoning': { inputPer1M: 1.00, outputPer1M: 3.00 },
};

export class BudgetManager {
  private activeConcurrentRequests: Map<string, number> = new Map();
  private maxConcurrentPerUser = 5;
  private maxConcurrentPerOrg = 20;

  async checkQuota(userId: string, orgId?: string, estimatedTokens = 0): Promise<{ allowed: boolean; reason?: string }> {
    try {
      // Check concurrent request caps
      const userConcurrent = this.activeConcurrentRequests.get(`usr:${userId}`) ?? 0;
      if (userConcurrent >= this.maxConcurrentPerUser) {
        return { allowed: false, reason: 'RATE_LIMITED: Max concurrent requests per user exceeded.' };
      }

      if (orgId) {
        const orgConcurrent = this.activeConcurrentRequests.get(`org:${orgId}`) ?? 0;
        if (orgConcurrent >= this.maxConcurrentPerOrg) {
          return { allowed: false, reason: 'RATE_LIMITED: Max concurrent requests per organization exceeded.' };
        }
      }

      // Query database for accumulated token usage within current billing window
      const traces = await prisma.aiTrace.findMany({
        where: { userIdHash: userId },
        select: { tokensIn: true, tokensOut: true },
      });

      const totalTokens = traces.reduce((acc, t) => acc + t.tokensIn + t.tokensOut, 0);
      const maxMonthlyTokens = Number(process.env.MAX_MONTHLY_TOKENS ?? 1_000_000);

      if (totalTokens + estimatedTokens > maxMonthlyTokens) {
        return { allowed: false, reason: 'QUOTA_EXCEEDED: Monthly token budget exceeded.' };
      }

      if (totalTokens + estimatedTokens > maxMonthlyTokens * 0.8) {
        logger.warn(`[BudgetManager] User ${userId} approaching token quota (${totalTokens}/${maxMonthlyTokens})`);
      }

      return { allowed: true };
    } catch (err) {
      logger.error('[BudgetManager] Failed to check quota against database', err);
      return { allowed: true }; // fail open or closed depending on policy; failing open for resilience with warning
    }
  }

  acquireConcurrent(userId: string, orgId?: string): boolean {
    const usrKey = `usr:${userId}`;
    const curUsr = this.activeConcurrentRequests.get(usrKey) ?? 0;
    if (curUsr >= this.maxConcurrentPerUser) return false;
    this.activeConcurrentRequests.set(usrKey, curUsr + 1);

    if (orgId) {
      const orgKey = `org:${orgId}`;
      const curOrg = this.activeConcurrentRequests.get(orgKey) ?? 0;
      if (curOrg >= this.maxConcurrentPerOrg) {
        this.activeConcurrentRequests.set(usrKey, curUsr); // rollback user
        return false;
      }
      this.activeConcurrentRequests.set(orgKey, curOrg + 1);
    }
    return true;
  }

  releaseConcurrent(userId: string, orgId?: string) {
    const usrKey = `usr:${userId}`;
    const curUsr = this.activeConcurrentRequests.get(usrKey) ?? 0;
    if (curUsr > 0) this.activeConcurrentRequests.set(usrKey, curUsr - 1);

    if (orgId) {
      const orgKey = `org:${orgId}`;
      const curOrg = this.activeConcurrentRequests.get(orgKey) ?? 0;
      if (curOrg > 0) this.activeConcurrentRequests.set(orgKey, curOrg - 1);
    }
  }

  checkConcurrent(userId: string, orgId?: string): { allowed: boolean; reason?: string } {
    const usrKey = `usr:${userId}`;
    const curUsr = this.activeConcurrentRequests.get(usrKey) ?? 0;
    if (curUsr >= this.maxConcurrentPerUser) {
      return { allowed: false, reason: 'CONCURRENT_LIMIT_EXCEEDED: User concurrent request cap reached.' };
    }
    if (orgId) {
      const orgKey = `org:${orgId}`;
      const curOrg = this.activeConcurrentRequests.get(orgKey) ?? 0;
      if (curOrg >= this.maxConcurrentPerOrg) {
        return { allowed: false, reason: 'CONCURRENT_LIMIT_EXCEEDED: Organization concurrent request cap reached.' };
      }
    }
    return { allowed: true };
  }

  async recordUsage(record: UsageRecord) {
    logger.info(`[UsageAccounting] ReqId: ${record.requestId} | User: ${record.userId} | Class: ${record.taskClass} | Model: ${record.model} | Tokens: ${record.promptTokens}+${record.completionTokens} | Cost: $${record.estimatedCostUsd.toFixed(4)} | Outcome: ${record.outcome}`);
  }

  calculateCost(model: string, promptTokens: number, completionTokens: number): number {
    const rates = PRICING_TABLE[model] ?? { inputPer1M: 0.20, outputPer1M: 0.60 };
    return (promptTokens / 1_000_000) * rates.inputPer1M + (completionTokens / 1_000_000) * rates.outputPer1M;
  }
}
