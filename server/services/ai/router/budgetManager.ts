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
  estimatedCostUsd: number | null;
  outcome: 'success' | 'rate_limited' | 'quota_exceeded' | 'error';
}

export interface BudgetManagerOptions {
  /** Maps a raw user id to the value stored in AiTrace.userIdHash (traces store an HMAC, never the raw id). */
  hashUserId?: (userId: string) => string;
  maxConcurrentPerUser?: number;
  maxConcurrentPerOrg?: number;
  maxMonthlyTokens?: number;
  /** Per-model prices, USD per 1M tokens. Defaults to AI_MODEL_PRICING_JSON, e.g. {"model":{"inputPer1M":0.1,"outputPer1M":0.3}}. */
  pricing?: Record<string, { inputPer1M: number; outputPer1M: number }>;
}

function pricingFromEnv(): Record<string, { inputPer1M: number; outputPer1M: number }> {
  try {
    return process.env.AI_MODEL_PRICING_JSON ? JSON.parse(process.env.AI_MODEL_PRICING_JSON) : {};
  } catch {
    logger.warn('[BudgetManager] AI_MODEL_PRICING_JSON is not valid JSON; cost estimates disabled.');
    return {};
  }
}

/**
 * Per-user/org concurrency caps, monthly token quota checks against AiTrace, and usage accounting.
 * Not enforced on any route yet: callers opt in explicitly.
 */
export class BudgetManager {
  private active = new Map<string, number>();
  private opts: Required<Omit<BudgetManagerOptions, 'hashUserId'>> & Pick<BudgetManagerOptions, 'hashUserId'>;

  constructor(opts: BudgetManagerOptions = {}) {
    this.opts = {
      hashUserId: opts.hashUserId,
      maxConcurrentPerUser: opts.maxConcurrentPerUser ?? 5,
      maxConcurrentPerOrg: opts.maxConcurrentPerOrg ?? 20,
      maxMonthlyTokens: opts.maxMonthlyTokens ?? Number(process.env.MAX_MONTHLY_TOKENS ?? 1_000_000),
      pricing: opts.pricing ?? pricingFromEnv(),
    };
  }

  async checkQuota(userId: string, orgId?: string, estimatedTokens = 0): Promise<{ allowed: boolean; reason?: string }> {
    const concurrent = this.checkConcurrent(userId, orgId);
    if (!concurrent.allowed) return concurrent;
    if (!this.opts.hashUserId) return { allowed: true };
    try {
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const agg = await prisma.aiTrace.aggregate({
        where: { userIdHash: this.opts.hashUserId(userId), createdAt: { gte: monthStart } },
        _sum: { tokensIn: true, tokensOut: true },
      });
      const used = (agg._sum.tokensIn ?? 0) + (agg._sum.tokensOut ?? 0);
      if (used + estimatedTokens > this.opts.maxMonthlyTokens) {
        return { allowed: false, reason: 'QUOTA_EXCEEDED: Monthly token budget exceeded.' };
      }
      return { allowed: true };
    } catch (err) {
      // Fail open: a usage-store outage must not take chat down. Logged so it is visible.
      logger.error('[BudgetManager] Quota check failed; allowing request', { errorType: (err as Error)?.name });
      return { allowed: true };
    }
  }

  checkConcurrent(userId: string, orgId?: string): { allowed: boolean; reason?: string } {
    if ((this.active.get(`usr:${userId}`) ?? 0) >= this.opts.maxConcurrentPerUser) {
      return { allowed: false, reason: 'CONCURRENT_LIMIT_EXCEEDED: User concurrent request cap reached.' };
    }
    if (orgId && (this.active.get(`org:${orgId}`) ?? 0) >= this.opts.maxConcurrentPerOrg) {
      return { allowed: false, reason: 'CONCURRENT_LIMIT_EXCEEDED: Organization concurrent request cap reached.' };
    }
    return { allowed: true };
  }

  acquireConcurrent(userId: string, orgId?: string): boolean {
    if (!this.checkConcurrent(userId, orgId).allowed) return false;
    this.active.set(`usr:${userId}`, (this.active.get(`usr:${userId}`) ?? 0) + 1);
    if (orgId) this.active.set(`org:${orgId}`, (this.active.get(`org:${orgId}`) ?? 0) + 1);
    return true;
  }

  releaseConcurrent(userId: string, orgId?: string) {
    for (const key of [`usr:${userId}`, ...(orgId ? [`org:${orgId}`] : [])]) {
      const cur = this.active.get(key) ?? 0;
      if (cur <= 1) this.active.delete(key);
      else this.active.set(key, cur - 1);
    }
  }

  async recordUsage(record: UsageRecord) {
    logger.info('[UsageAccounting]', { ...record, userId: undefined });
  }

  /** Estimated cost in USD, or null when no price is configured for the model (never a guessed price). */
  calculateCost(model: string, promptTokens: number, completionTokens: number): number | null {
    const rates = this.opts.pricing[model];
    if (!rates) return null;
    return (promptTokens / 1_000_000) * rates.inputPer1M + (completionTokens / 1_000_000) * rates.outputPer1M;
  }
}
