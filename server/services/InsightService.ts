import { prisma } from '../db.js';
import logger from '../utils/logger.js';

export class InsightService {
  private static instance: InsightService;

  private constructor() {}

  public static getInstance(): InsightService {
    if (!InsightService.instance) {
      InsightService.instance = new InsightService();
    }
    return InsightService.instance;
  }

  public async processBatchInsights(batchId: string, institutionId?: string, classId: string = 'general', subject: string = 'general') {
    logger.info(`[InsightService] Processing insights for batchId: ${batchId}, class: ${classId}, subject: ${subject}`);

    const batch = await prisma.batchJob.findUnique({
      where: { id: batchId },
      include: { results: true },
    });

    if (!batch || batch.results.length === 0) {
      logger.warn(`[InsightService] Batch ${batchId} not found or has no results.`);
      return null;
    }

    // Calculate aggregate score metrics
    const totalStudents = batch.results.length;
    const scores = batch.results.map(r => r.totalScore / (r.maxScore || 1));
    const avgPercentage = scores.reduce((a, b) => a + b, 0) / totalStudents * 100;

    const weakResults = batch.results.filter(r => (r.totalScore / (r.maxScore || 1)) < 0.5);

    const insightSummary = {
      batchId,
      totalStudents,
      averageScorePercentage: Number(avgPercentage.toFixed(1)),
      strugglingCount: weakResults.length,
      timestamp: new Date().toISOString(),
    };

    // Update or create ClassProfile
    const existingProfile = await prisma.classProfile.findUnique({
      where: {
        institutionId_classId_subject: {
          institutionId: institutionId || '',
          classId,
          subject,
        },
      },
    });

    let rollingMetrics: any = { history: [] };
    if (existingProfile && existingProfile.rollingMetrics) {
      try {
        rollingMetrics = JSON.parse(existingProfile.rollingMetrics);
      } catch (e) {
        rollingMetrics = { history: [] };
      }
    }

    rollingMetrics.history.push(insightSummary);
    // Keep last 10 batches rolling
    if (rollingMetrics.history.length > 10) {
      rollingMetrics.history = rollingMetrics.history.slice(-10);
    }

    const updatedProfile = await prisma.classProfile.upsert({
      where: {
        institutionId_classId_subject: {
          institutionId: institutionId || '',
          classId,
          subject,
        },
      },
      update: {
        rollingMetrics: JSON.stringify(rollingMetrics),
      },
      create: {
        institutionId: institutionId || null,
        classId,
        subject,
        rollingMetrics: JSON.stringify(rollingMetrics),
      },
    });

    logger.info(`[InsightService] Successfully updated ClassProfile for ${classId} / ${subject}`);
    return {
      insightSummary,
      classProfile: updatedProfile,
    };
  }
}
