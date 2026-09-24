import { AiService } from './AiService.js';
import logger from '../utils/logger.js';
import { runWithRetry } from './reliableJobRunner.js';
import { logJobCost } from './CostTrackingService.js';

export class FormScoringService {
  private static instance: FormScoringService;
  private aiService = AiService.getInstance();

  private constructor() {}

  public static getInstance(): FormScoringService {
    if (!FormScoringService.instance) {
      FormScoringService.instance = new FormScoringService();
    }
    return FormScoringService.instance;
  }

  public async scoreSubmission(form: any, submissionData: any) {
    if (!form.rubric) {
      logger.info('No rubric found for form, skipping scoring.');
      return null;
    }

    const rubric = JSON.parse(form.rubric);

    const systemPrompt = `You are an Expert Admissions Scorer.
Grade this application strictly against the provided rubric.
Calculate a total score (0-100) and provide brief feedback.

RUBRIC: ${JSON.stringify(rubric)}

OUTPUT JSON:
{
  "totalScore": number,
  "feedback": "string",
  "criterionBreakdown": [
    { "name": "string", "marksAwarded": number, "reason": "string" }
  ]
}`;

    const prompt = `APPLICATION DATA: ${JSON.stringify(submissionData)}`;
    const jobId = `score-${form.id}-${Date.now()}`;

    try {
      return await runWithRetry(jobId, 'scoring', submissionData, async () => {
        const { text, usage, model } = await this.aiService.sendClaudeChat(prompt, {
          system: systemPrompt,
          model: 'claude-3-5-haiku-20241022'
        });

        await logJobCost({
          jobId,
          jobType: 'scoring',
          model,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          chargedUsd: 0.02 // Placeholder for scoring charge
        });

        return this.aiService.parseModelJson(text);
      });
    } catch (error: any) {
      logger.error('Form scoring failed', error);
      return null;
    }
  }
}
