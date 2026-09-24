import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger.js';

const prisma = new PrismaClient();

// Hourly spend threshold in USD
const DEFAULT_HOURLY_THRESHOLD = Number(process.env.COST_HOURLY_THRESHOLD || 50);

export class CostCircuitBreakerService {
  private static isForcedOpen = false;

  /**
   * Checks if the circuit breaker should be open (blocked).
   * Returns true if blocked.
   */
  public static async isCircuitOpen(): Promise<boolean> {
    if (this.isForcedOpen) return true;

    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      const aggregation = await prisma.jobCostLog.aggregate({
        _sum: {
          actualCostUsd: true
        },
        where: {
          createdAt: { gte: oneHourAgo }
        }
      });

      const hourlySpend = aggregation._sum.actualCostUsd || 0;

      if (hourlySpend > DEFAULT_HOURLY_THRESHOLD) {
        logger.error(`COST CIRCUIT BREAKER TRIPPED! Hourly spend ($${hourlySpend.toFixed(2)}) exceeded threshold ($${DEFAULT_HOURLY_THRESHOLD})`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error checking cost circuit breaker:', error);
      // Fail safe: if we can't check costs, don't block unless forced
      return false;
    }
  }

  public static forceOpen(state: boolean) {
    this.isForcedOpen = state;
    logger.warn(`Cost Circuit Breaker forced to ${state ? 'OPEN (BLOCKED)' : 'CLOSED (ALLOW)'}`);
  }

  public static async getHourlySpend(): Promise<number> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const aggregation = await prisma.jobCostLog.aggregate({
      _sum: {
        actualCostUsd: true
      },
      where: {
        createdAt: { gte: oneHourAgo }
      }
    });
    return aggregation._sum.actualCostUsd || 0;
  }

  public static getThreshold(): number {
    return DEFAULT_HOURLY_THRESHOLD;
  }
}

export class CostCircuitBreakerError extends Error {
  constructor(message = 'Cost limit reached. AI services temporarily paused.') {
    super(message);
    this.name = 'CostCircuitBreakerError';
  }
}
