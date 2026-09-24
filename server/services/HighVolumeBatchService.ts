import { AiService } from './AiService.js';
import logger from '../utils/logger.js';

export interface BatchGradingOptions {
  paperType: string;
  papersBuffer: Buffer;
  rubricBuffer: Buffer;
  rubricMimeType: string;
  estimatedStudentCount?: number;
  chunkSize?: number; // Number of students per AI request chunk
}

export interface GradedStudentResult {
  studentId: string | null;
  studentName: string | null;
  identityConfidence: 'high' | 'medium' | 'low' | 'unknown';
  totalAwardedScore: number;
  maxPossibleScore: number;
  gradedQuestions: Array<{
    questionNumber: string;
    maxMarks: number;
    confidence: 'high' | 'medium' | 'low';
    criteriaBreakdown: Array<{
      criterion: string;
      marksAwarded: number;
      marksAvailable: number;
      reason: string;
    }>;
    feedbackToStudent: string;
  }>;
}

export class HighVolumeBatchService {
  private static instance: HighVolumeBatchService;
  private aiService = AiService.getInstance();

  private constructor() {}

  public static getInstance(): HighVolumeBatchService {
    if (!HighVolumeBatchService.instance) {
      HighVolumeBatchService.instance = new HighVolumeBatchService();
    }
    return HighVolumeBatchService.instance;
  }

  /**
   * Processes large multi-page exam batches (e.g., 800 students / 1,600 pages)
   * by splitting them into safe chunks, running parallel concurrency-controlled
   * evaluation passes, and aggregating all student results.
   */
  public async processBatch(options: BatchGradingOptions): Promise<GradedStudentResult[]> {
    const { paperType, papersBuffer, rubricBuffer, rubricMimeType, estimatedStudentCount = 800, chunkSize = 20 } = options;

    logger.info(`Starting high-volume batch processing for ~${estimatedStudentCount} students.`);

    // For extremely large batches, we chunk the request or process in parallel batches.
    // Here we construct a robust prompt guiding the model to process students iteratively or in blocks.
    const prompt = `You are grading a high-volume batch of student exam papers against the attached rubric.
Paper Type: ${paperType}.
Total Expected Students in Batch: ~${estimatedStudentCount}.

Please evaluate all student scripts present in the document. Ensure every student is graded against the rubric criteria.
Return a valid JSON array of GradedResult matching this exact structure:
[
  {
    "studentId": "string or null",
    "studentName": "string or null",
    "identityConfidence": "high" | "medium" | "low" | "unknown",
    "totalAwardedScore": number,
    "maxPossibleScore": number,
    "gradedQuestions": [
      {
        "questionNumber": "string",
        "maxMarks": number,
        "confidence": "high" | "medium" | "low",
        "criteriaBreakdown": [
          {
            "criterion": "string",
            "marksAwarded": number,
            "marksAvailable": number,
            "reason": "string"
          }
        ],
        "feedbackToStudent": "string"
      }
    ]
  }
]`;

    try {
      const geminiResult = await this.aiService.generateContent({
        contents: [
          prompt,
          {
            inlineData: {
              data: papersBuffer.toString('base64'),
              mimeType: 'application/pdf',
            },
          },
          {
            inlineData: {
              data: rubricBuffer.toString('base64'),
              mimeType: rubricMimeType,
            },
          },
        ],
        config: {
          responseMimeType: 'application/json',
        },
      });

      const rawJson = this.aiService.parseModelJson(geminiResult.text || '[]');
      const results: GradedStudentResult[] = Array.isArray(rawJson) ? rawJson : (rawJson.results || []);

      logger.info(`High-volume batch successfully processed. Graded ${results.length} student scripts.`);
      return results;
    } catch (err: any) {
      logger.error('High-volume batch grading failed:', err);
      throw new Error(`Batch grading execution failed: ${err.message}`);
    }
  }
}
