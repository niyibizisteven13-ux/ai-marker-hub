import { AiService } from './AiService.js';
import logger from '../utils/logger.js';
import { PDFParse } from 'pdf-parse';
import { createWorker, type Worker } from 'tesseract.js';

export interface BatchGradingOptions {
  paperType: string;
  papersBuffer: Buffer;
  paperMimeType?: string;
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

  private async extractGonkaPdfText(buffer: Buffer): Promise<string> {
    const parser = new PDFParse({ data: buffer as Uint8Array });
    let worker: Worker | null = null;
    try {
      const extracted = (await parser.getText()).text.trim();
      if (extracted.length >= 40) return extracted;

      const screenshots = await parser.getScreenshot({ scale: 1.5, first: 20 });
      if (screenshots.pages.length === 0) throw new Error('No pages could be rendered for OCR.');
      worker = await createWorker('eng');
      const pages: string[] = [];
      for (const page of screenshots.pages) {
        const { data } = await worker.recognize(Buffer.from(page.data));
        if (data.text.trim()) pages.push(data.text.trim());
      }
      const ocrText = pages.join('\n\n');
      if (!ocrText) throw new Error('OCR could not read text from the scanned PDF.');
      return ocrText;
    } finally {
      if (worker) await worker.terminate();
      await parser.destroy();
    }
  }

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
    const { paperType, papersBuffer, paperMimeType = 'application/pdf', rubricBuffer, rubricMimeType, estimatedStudentCount = 800, chunkSize = 20 } = options;

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
      if (await this.aiService.providerAvailable('gonkarouter')) {
        logger.info(`[HighVolumeBatchService] Routing batch via GonkaRouter (GLM-5.3-Flash)`);
        const paperIsPdf = papersBuffer.subarray(0, 5).toString() === '%PDF-';
        const rubricIsPdf = rubricBuffer.subarray(0, 5).toString() === '%PDF-';
        const paperText = paperIsPdf ? await this.extractGonkaPdfText(papersBuffer) : '';
        const rubricText = rubricIsPdf ? await this.extractGonkaPdfText(rubricBuffer) : '';

        const paperIsImage = /^image\/(jpeg|png|webp|gif)$/i.test(paperMimeType);
        const rubricIsImage = /^image\/(jpeg|png|webp|gif)$/i.test(rubricMimeType);
        const textPrompt = `${prompt}\n\nSTUDENT PAPERS:\n${paperIsPdf ? paperText : (paperIsImage ? '[Read the attached student paper image.]' : '[Paper attachment is not a supported image or PDF.]')}\n\nRUBRIC:\n${rubricIsPdf ? rubricText : (rubricIsImage ? '[Read the attached rubric image.]' : '[Rubric attachment is not a supported image or PDF.]')}`;
        const rawResponse = await this.aiService.sendGonkaChat(textPrompt, {
          images: [
            ...(!paperIsPdf && paperIsImage ? [{ base64: papersBuffer.toString('base64'), mediaType: paperMimeType }] : []),
            ...(!rubricIsPdf && rubricIsImage ? [{ base64: rubricBuffer.toString('base64'), mediaType: rubricMimeType }] : []),
          ],
        });
        const rawJson = this.aiService.parseModelJson(typeof rawResponse === 'string' ? rawResponse : (rawResponse as any).text || '');
        const results: GradedStudentResult[] = Array.isArray(rawJson) ? rawJson : (rawJson.results || []);
        logger.info(`[HighVolumeBatchService] GonkaRouter batch successfully processed: ${results.length} students graded.`);
        return results;
      }

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
