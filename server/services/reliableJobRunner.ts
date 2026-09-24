import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger.js';
import { CostCircuitBreakerService, CostCircuitBreakerError } from './CostCircuitBreakerService.js';

const prisma = new PrismaClient();
const MAX_RETRIES = 2;

export async function runWithRetry<T>(
  jobId: string,
  jobType: string,
  payload: any,
  fn: () => Promise<T>
): Promise<T | null> {
  // Check Cost Circuit Breaker
  if (await CostCircuitBreakerService.isCircuitOpen()) {
    const error = new CostCircuitBreakerError();
    logger.error(`Job ${jobId} rejected: ${error.message}`);

    await prisma.failedJob.create({
      data: {
        jobId,
        jobType,
        payload: JSON.stringify(payload),
        errorMessage: error.message,
        attempts: 0,
        status: 'circuit_breaker_open'
      },
    });

    throw error;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      logger.warn(`Job ${jobId} attempt ${attempt + 1} failed: ${err.message}`);

      // Optional: add a small delay between retries
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  // exhausted retries — park it in Dead Letter Queue
  await prisma.failedJob.create({
    data: {
      jobId,
      jobType,
      payload: JSON.stringify(payload),
      errorMessage: lastError?.message || 'Unknown error',
      attempts: MAX_RETRIES + 1,
    },
  });

  return null;
}
