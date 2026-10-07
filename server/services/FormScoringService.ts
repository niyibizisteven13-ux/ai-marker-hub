import { AiService } from './AiService.js';
import logger from '../utils/logger.js';
import { runWithRetry } from './reliableJobRunner.js';

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
    let rubric: any = null;
    try { rubric = form.rubric ? JSON.parse(form.rubric) : null; } catch { rubric = null; }
    if (!rubric) {
      try {
        const schema = JSON.parse(form.schema || '{}');
        rubric = schema.rubric || schema.selectionRequirements || schema.requirements || null;
      } catch { rubric = null; }
    }
    const criteria = Array.isArray(rubric?.criteria) ? rubric.criteria : [];
    const rubricInstructions = rubric
      ? JSON.stringify(rubric)
      : 'No formal rubric was supplied. Assess each response against the form purpose and all explicit selection requirements in the schema. If requirements are missing, score completeness, relevance, and evidence conservatively and identify that the score is provisional.';

    const systemPrompt = `You are an Expert Admissions Scorer.
Grade this application strictly against the provided rubric.
Calculate a total score (0-100) and provide brief feedback. Assess only evidence present in the application; do not invent qualifications. Explain uncertainty and missing evidence.

RUBRIC AND REQUIREMENTS: ${rubricInstructions}

OUTPUT JSON:
{
  "totalScore": number,
  "feedback": "string",
  "criterionBreakdown": [
    { "name": "string", "marksAwarded": number, "reason": "string" }
  ]
}`;

    const prompt = `FORM TITLE: ${form.title}\nFORM DEFINITION: ${form.schema}\nAPPLICATION DATA: ${JSON.stringify(submissionData)}`;
    const jobId = `score-${form.id}-${Date.now()}`;

    try {
      return await runWithRetry(jobId, 'scoring', submissionData, async () => {
        const raw = await this.aiService.sendGonkaChat(prompt, { system: systemPrompt });
        const parsed = this.aiService.parseModelJson(raw);
        if (!Number.isFinite(Number(parsed?.totalScore))) throw new Error('AI returned no valid total score.');
        const breakdown = Array.isArray(parsed.criterionBreakdown) ? parsed.criterionBreakdown : [];
        return {
          ...parsed,
          totalScore: Math.max(0, Math.min(100, Number(parsed.totalScore))),
          criterionBreakdown: breakdown,
        };
      });
    } catch (error: any) {
      logger.error('Form scoring failed', error);
      return null;
    }
  }
}
