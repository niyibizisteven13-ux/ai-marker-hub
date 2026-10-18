import { prisma } from '../db.js';
import { AgentPillarBase } from './AgentPillars.js';
import logger from '../utils/logger.js';

export class FormOrchestrator extends AgentPillarBase {
  private static instance: FormOrchestrator;

  private constructor() {
    super();
  }

  public static getInstance(): FormOrchestrator {
    if (!FormOrchestrator.instance) {
      FormOrchestrator.instance = new FormOrchestrator();
    }
    return FormOrchestrator.instance;
  }

  /**
   * Pillar 1: Perceive
   */
  public async perceive(userId: string): Promise<any> {
    const userForms = await prisma.applicationForm.findMany({ where: { userId } });
    return { existingFormsCount: userForms.length };
  }

  /**
   * Pillar 2: Reason
   */
  public async reason(userIntent: string, observation: any): Promise<any> {
    const intent = `${userIntent}\n\nREQUIREMENT: Return a complete respondent schema with a title, description, and questions (each question has id, type, title, required; choice questions include options). Preserve any rubric criteria and selection settings in the final form schema.`;
    const systemPrompt = `You are a World-Class Form UI and Admissions Architect.
Convert the user's intent into a structured JSON form schema.
ALSO extract scoring rubric criteria (weights, max marks) and selection settings (e.g., "select top 20") from the description.

OUTPUT JSON:
{
  "thought": "Planning field structure and scoring logic...",
  "title": "String",
  "description": "String",
  "questions": [{ "id": "stable-question-id", "type": "SHORT_TEXT|LONG_TEXT|MULTIPLE_CHOICE|CHECKBOX|DROPDOWN|DATE|NUMBER|EMAIL|PHONE|URL|FILE_UPLOAD|RATING", "title": "String", "required": true, "options": [] }],
  "rubric": {
    "criteria": [
      { "name": "academic_merit", "weight": 0.4, "maxMarks": 100 },
      ...
    ]
  },
  "selectionSettings": {
    "maxSelections": 20,
    "strategy": "TOP_RANKED"
  },
  "finished": true
}`;

    try {
      const text = await this.aiService.sendGonkaChat(intent, { system: systemPrompt });
      const result = this.aiService.parseModelJson(text);
      if (
        !result ||
        typeof result !== 'object' ||
        typeof result.title !== 'string' ||
        !result.title.trim() ||
        !(Array.isArray(result.questions) || Array.isArray(result.fields)) ||
        (result.questions || result.fields).length === 0 ||
        (result.questions || result.fields).some((question: any) => typeof question?.title !== 'string' || !question.title.trim())
      ) {
        throw new Error('AI form generation returned an incomplete schema.');
      }
      return result;
    } catch (err: any) {
      logger.error('AI form generation failed; no substitute questions were created.', {
        errorType: err?.name || 'Error',
        status: typeof err?.status === 'number' ? err.status : undefined,
        timeout: err?.timeout === true,
        timeoutKind: err?.timeoutKind,
      });
      throw new Error('AI form generation could not be completed. Please retry.');
    }
  }

  /**
   * Conversational form generation using Pillar loop.
   */
  public async generateFormSchema(userId: string, userIntent: string) {
    logger.info(`Orchestrator: Generating form schema for intent: "${userIntent}"`);

    const schemaJson = await this.reason(userIntent, await this.perceive(userId));
    const requirements = userIntent.trim();
    schemaJson.requirements = schemaJson.requirements || requirements;

    const form = await prisma.applicationForm.create({
      data: {
        userId,
        title: schemaJson.title || 'Untitled Form',
        schema: JSON.stringify(schemaJson),
        rubric: schemaJson.rubric ? JSON.stringify(schemaJson.rubric) : null,
        selectionSettings: JSON.stringify({ ...(schemaJson.selectionSettings || {}), requirements }),
      },
    });

    return {
      ...schemaJson,
      id: form.id,
      userId: form.userId,
      title: form.title,
      schema: schemaJson,
      rubric: schemaJson.rubric || null,
      selectionSettings: { ...(schemaJson.selectionSettings || {}), requirements },
      shareableLink: `/forms/${form.id}`,
      createdAt: form.createdAt,
      updatedAt: form.updatedAt,
    };
  }

  /**
   * AI Form Co-Pilot Agent: enhances form drafts or simulates & scores candidate submissions.
   */
  public async runFormAgent(userId: string, action: string, payload: any) {
    if (action === 'enhance_draft') {
      const currentDraft = payload?.currentDraft || payload?.draft || {};
      const instruction = String(payload?.instruction || 'Add 4 high-signal assessment questions and a scoring rubric.');
      const systemPrompt = `You are Bwenge Form Architect Agent powered by GonkaRouter.
Given the current form draft and the user's instruction, enhance or generate the form schema.
Return valid JSON ONLY with this exact structure:
{
  "agentSummary": "1-sentence description of what you added or improved",
  "title": "Form Title",
  "description": "Clear respondent instructions and eligibility criteria",
  "questions": [
    {
      "id": "q_1",
      "type": "SHORT_TEXT|LONG_TEXT|MULTIPLE_CHOICE|CHECKBOX|DROPDOWN|DATE|NUMBER|EMAIL|PHONE|URL|RATING|LINEAR_SCALE",
      "title": "Question text",
      "description": "Optional helper text",
      "required": true,
      "points": 10,
      "correctAnswer": "Optional correct option for quiz grading",
      "options": [{"id": "opt_1", "label": "Option A"}, {"id": "opt_2", "label": "Option B"}]
    }
  ],
  "rubric": {
    "criteria": [
      { "name": "Criterion Name", "weight": 0.5, "maxMarks": 50 }
    ]
  }
}`;
      const prompt = `CURRENT FORM DRAFT:\n${JSON.stringify(currentDraft, null, 2)}\n\nUSER INSTRUCTION FOR AGENT:\n${instruction}`;
      try {
        const raw = await this.aiService.sendGonkaChat(prompt, { system: systemPrompt });
        const parsed = this.aiService.parseModelJson(raw);
        if (
          !parsed ||
          !Array.isArray(parsed.questions) ||
          parsed.questions.length === 0 ||
          parsed.questions.some((question: any) => typeof question?.title !== 'string' || !question.title.trim())
        ) {
          throw new Error('AI form enhancement returned an incomplete schema.');
        }
        const normalizedQuestions = parsed.questions.map((q: any, i: number) => ({
          id: q.id || `q_${Date.now()}_${i}`,
          type: String(q.type || 'SHORT_TEXT').toUpperCase(),
          title: String(q.title || q.label).trim(),
          description: q.description ? String(q.description) : '',
          required: Boolean(q.required ?? true),
          points: Number.isFinite(Number(q.points)) ? Number(q.points) : undefined,
          correctAnswer: q.correctAnswer ? String(q.correctAnswer) : undefined,
          options: Array.isArray(q.options)
            ? q.options.map((opt: any, oi: number) => ({
                id: typeof opt === 'object' && opt?.id ? String(opt.id) : `opt_${Date.now()}_${i}_${oi}`,
                label: typeof opt === 'string' ? opt : String(opt?.label || ''),
              }))
            : undefined,
          scaleMin: q.scaleMin ?? 1,
          scaleMax: q.scaleMax ?? 5,
          maxRating: q.maxRating ?? 5,
        }));
        const draftResult = {
          agentSummary: parsed.agentSummary || `Updated form with ${normalizedQuestions.length} questions.`,
          title: parsed.title || currentDraft.title || '',
          description: parsed.description || currentDraft.description || '',
          questions: normalizedQuestions,
          rubric: parsed.rubric || currentDraft.rubric || null,
          requirements: instruction,
        };
        if (!draftResult.title.trim()) throw new Error('AI form enhancement did not return a title.');
        return { ...draftResult, draft: draftResult };
      } catch (err: any) {
        logger.error('AI form enhancement failed; no substitute questions were created.', {
          errorType: err?.name || 'Error',
          status: typeof err?.status === 'number' ? err.status : undefined,
          timeout: err?.timeout === true,
          timeoutKind: err?.timeoutKind,
        });
        throw new Error('AI form enhancement could not be completed. Please retry.');
      }
    }

    if (action === 'simulate_submissions') {
      const formId = String(payload?.formId || '');
      const count = Math.min(5, Math.max(1, Number(payload?.count) || 3));
      const form = await prisma.applicationForm.findUnique({ where: { id: formId } });
      if (!form) throw new Error('Form not found.');

      let schema: any = {};
      try { schema = JSON.parse(form.schema || '{}'); } catch { schema = {}; }
      const questions = [...(Array.isArray(schema.questions) ? schema.questions : []), ...(Array.isArray(schema.fields) ? schema.fields : [])];
      if (!questions.length) throw new Error('This form has no questions to simulate.');

      const questionSpec = questions.map((q: any, idx: number) => ({
        key: String(q.id ?? q.number ?? idx + 1),
        title: String(q.title || q.label || `Question ${idx + 1}`),
        type: String(q.type || 'SHORT_TEXT').toUpperCase(),
        options: Array.isArray(q.options) ? q.options.map((o: any) => (typeof o === 'string' ? o : o.label)) : [],
        correctAnswer: q.correctAnswer || undefined,
      }));

      const systemPrompt = `You are an Autonomous Simulation & Testing Agent powered by GonkaRouter.
Generate ${count} realistic, diverse respondent submissions (ranging from exceptional to average to weak candidates) for the provided form schema.
Use the EXACT question "key" values as JSON property keys in each submission's "answers" object.
For MULTIPLE_CHOICE or DROPDOWN questions, pick one of the provided options. For CHECKBOX, provide an array of selected options.
Return valid JSON ONLY:
{
  "submissions": [
    {
      "answers": { "<question_key>": "Realistic answer..." }
    }
  ]
}`;
      let simulatedList: any[];
      try {
        const raw = await this.aiService.sendGonkaChat(
          `FORM TITLE: ${form.title}\nDESCRIPTION: ${schema.description || ''}\nQUESTIONS:\n${JSON.stringify(questionSpec, null, 2)}`,
          { system: systemPrompt }
        );
        const parsed = this.aiService.parseModelJson(raw);
        if (
          !Array.isArray(parsed?.submissions) ||
          parsed.submissions.length < count ||
          parsed.submissions.slice(0, count).some((item: any) => !item?.answers || typeof item.answers !== 'object' || Array.isArray(item.answers))
        ) {
          throw new Error('AI submission simulation returned incomplete data.');
        }
        simulatedList = parsed.submissions.slice(0, count);
      } catch (err: any) {
        logger.error('AI submission simulation failed; no sample submissions were created.', {
          errorType: err?.name || 'Error',
          status: typeof err?.status === 'number' ? err.status : undefined,
          timeout: err?.timeout === true,
          timeoutKind: err?.timeoutKind,
        });
        throw new Error('AI submission simulation could not be completed. Please retry.');
      }
      return this.persistSimulatedSubmissions(form, simulatedList, count, payload?.requirements);
    }

    throw new Error(`Unsupported form agent action: ${action}`);
  }

  private async persistSimulatedSubmissions(form: any, submissions: any[], count: number, requirements?: string) {
    const { AnalyticsWorker } = await import('./AnalyticsWorker.js');
    const analyticsWorker = AnalyticsWorker.getInstance();
    const createdIds: string[] = [];

    for (const item of submissions.slice(0, count)) {
      const sub = await prisma.formSubmission.create({
        data: {
          formId: form.id,
          data: JSON.stringify(item.answers),
        },
      });
      createdIds.push(sub.id);
      await analyticsWorker.extractInsights(sub.id);
    }

    const analysis = await analyticsWorker.runDeepAnalysis(form.id, requirements);
    return { simulatedCount: createdIds.length, analysis };
  }

  /**
   * Fetches all submissions for a form.
   */
  public async getSubmissionsForAnalysis(formId: string) {
    return prisma.formSubmission.findMany({
      where: { formId },
      include: { extractedInsights: true }
    });
  }
}
