import { prisma } from '../db.js';
import logger from '../utils/logger.js';

export interface GradeCorrectionInput {
  resultId: string;
  reviewerId: string;
  updatedScore?: number;
  updatedGradedQuestions?: string; // JSON stringified
  flaggedForReview?: boolean;
}

export class CorrectionCaptureService {
  private static instance: CorrectionCaptureService;

  private constructor() {}

  public static getInstance(): CorrectionCaptureService {
    if (!CorrectionCaptureService.instance) {
      CorrectionCaptureService.instance = new CorrectionCaptureService();
    }
    return CorrectionCaptureService.instance;
  }

  public async captureCorrection(input: GradeCorrectionInput) {
    logger.info(`[CorrectionCaptureService] Capturing teacher correction for resultId: ${input.resultId} by reviewer: ${input.reviewerId}`);

    const existingResult = await prisma.batchJobResult.findUnique({
      where: { id: input.resultId },
    });

    if (!existingResult) {
      throw new Error(`BatchJobResult not found for id: ${input.resultId}`);
    }

    const updated = await prisma.batchJobResult.update({
      where: { id: input.resultId },
      data: {
        totalScore: input.updatedScore !== undefined ? input.updatedScore : existingResult.totalScore,
        gradedQuestions: input.updatedGradedQuestions !== undefined ? input.updatedGradedQuestions : existingResult.gradedQuestions,
        flaggedForReview: input.flaggedForReview !== undefined ? input.flaggedForReview : false,
        reviewedBy: input.reviewerId,
        reviewedAt: new Date(),
      },
    });

    // Also write an audit log
    await prisma.auditLog.create({
      data: {
        actorId: input.reviewerId,
        action: 'GRADE_CORRECTION',
        resourceType: 'BatchJobResult',
        resourceId: input.resultId,
        details: JSON.stringify({
          oldScore: existingResult.totalScore,
          newScore: updated.totalScore,
          flaggedForReview: updated.flaggedForReview,
        }),
      },
    });

    logger.info(`[CorrectionCaptureService] Successfully recorded correction & audit log for resultId: ${input.resultId}`);
    return updated;
  }
}
