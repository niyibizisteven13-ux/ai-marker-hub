import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger.js';

const prisma = new PrismaClient();

export class PredictiveAnalyticsService {
  private static instance: PredictiveAnalyticsService;

  private constructor() {}

  public static getInstance(): PredictiveAnalyticsService {
    if (!PredictiveAnalyticsService.instance) {
      PredictiveAnalyticsService.instance = new PredictiveAnalyticsService();
    }
    return PredictiveAnalyticsService.instance;
  }

  /**
   * Analyzes all submissions for a form to find "At Risk" students.
   * Opus tier: Detects subtle behavioral patterns (logic gaps, sudden drops).
   */
  public async analyzeClassRisk(formId: string) {
    const submissions = await prisma.formSubmission.findMany({
      where: { formId },
      include: { extractedInsights: true }
    });

    const results = [];

    for (const s of submissions) {
      const insight = s.extractedInsights;
      if (!insight) continue;

      let riskReason = null;
      const studentData = JSON.parse(s.data);
      const studentName = studentData.name || studentData.email || 'Unknown';

      // Pattern 1: Sudden low score (< 40%)
      if (insight.score !== null && insight.score < 40) {
        riskReason = "Immediate performance failure (Score < 40%).";
      }

      // Pattern 2: Marked as high risk by AI markers
      if (insight.atRisk) {
        riskReason = insight.summary || "AI Marker flagged as high-risk behavior.";
      }

      // Pattern 3: Sudden Logic Gap (Opus tier)
      // Check historical average for this student
      if (!riskReason && studentName !== 'Unknown') {
        const history = await prisma.formSubmission.findMany({
          where: {
            data: { contains: studentName },
            NOT: { id: s.id }
          },
          include: { extractedInsights: true },
          take: 5
        });

        const pastScores = history
          .map(h => h.extractedInsights?.score)
          .filter((score): score is number => score !== null && score !== undefined);

        if (pastScores.length >= 2) {
          const avg = pastScores.reduce((a, b) => a + b, 0) / pastScores.length;
          if (insight.score !== null && insight.score < avg * 0.5) {
            riskReason = `Sudden Logic Gap: Score dropped ${Math.round((1 - (insight.score / avg)) * 100)}% compared to historical average (${Math.round(avg)}%).`;
          }
        }
      }

      if (riskReason) {
        results.push({
          submissionId: s.id,
          studentName,
          reason: riskReason
        });
      }
    }

    logger.info(`Predictive Analytics: Identified ${results.length} at-risk students for form ${formId}`);
    return results;
  }
}
