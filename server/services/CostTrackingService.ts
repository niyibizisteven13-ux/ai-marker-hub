import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Haiku 3.5 and Sonnet 3.5 pricing (Approximate USD per 1M tokens)
// Haiku 3.5: Input $0.25 / Output $1.25 (Batch is 50% of this usually, but let's use standard for now or adjust based on requirement)
// The user suggested Haiku 4.5 batch pricing: Input $0.5, Output $2.5 (Batch API = 50% of $1/$5)
const PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  'claude-3-5-haiku-20241022': { inputPerM: 0.5, outputPerM: 2.5 },
  'claude-3-5-sonnet-20241022': { inputPerM: 1.0, outputPerM: 5.0 },
};

export async function logJobCost(options: {
  jobId: string;
  jobType: 'grading' | 'scoring';
  model: string;
  inputTokens: number;
  outputTokens: number;
  chargedUsd: number;
}) {
  const rates = PRICING[options.model] || PRICING['claude-3-5-haiku-20241022'];
  const actualCostUsd =
    (options.inputTokens / 1_000_000) * rates.inputPerM +
    (options.outputTokens / 1_000_000) * rates.outputPerM;

  await prisma.jobCostLog.create({
    data: {
      jobId: options.jobId,
      jobType: options.jobType,
      model: options.model,
      inputTokens: options.inputTokens,
      outputTokens: options.outputTokens,
      actualCostUsd,
      chargedUsd: options.chargedUsd,
      marginRealized: options.chargedUsd - actualCostUsd,
    },
  });

  return actualCostUsd;
}

export async function getRealizedMargin(jobType: 'grading' | 'scoring', sinceHours = 24) {
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
  const logs = await prisma.jobCostLog.findMany({
    where: { jobType, createdAt: { gte: since } },
  });

  const totalCost = logs.reduce((sum, l) => sum + l.actualCostUsd, 0);
  const totalCharged = logs.reduce((sum, l) => sum + l.chargedUsd, 0);
  const avgMargin = totalCost > 0 ? totalCharged / totalCost : 0;

  return { jobCount: logs.length, totalCost, totalCharged, avgMargin };
}
