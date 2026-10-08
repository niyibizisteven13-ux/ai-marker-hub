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

    let result: any = null;
    try {
      const text = await this.aiService.sendGonkaChat(intent, { system: systemPrompt });
      result = this.aiService.parseModelJson(text);
    } catch (err: any) {
      logger.warn('GonkaRouter form generation fallback triggered:', err?.message);
    }
    if (!result || typeof result !== 'object' || !result.title || !(Array.isArray(result.questions) || Array.isArray(result.fields))) {
      const cleanIntent = userIntent.trim() || 'Application & Evaluation Form';
      const titleLine = cleanIntent.split(/[.!?\n]/)[0].slice(0, 70).trim() || 'Application & Assessment Form';
      result = {
        title: titleLine,
        description: `Complete all required fields below. Responses are automatically evaluated and ranked by Bwenge AI.`,
        questions: [
          { id: 'q_name', type: 'SHORT_TEXT', title: 'Full Name', required: true },
          { id: 'q_email', type: 'EMAIL', title: 'Email Address', required: true },
          {
            id: 'q_role',
            type: 'MULTIPLE_CHOICE',
            title: 'Experience & Qualification Level',
            required: true,
            options: [
              { id: 'opt_1', label: 'Advanced / Senior (5+ years)' },
              { id: 'opt_2', label: 'Intermediate (2–4 years)' },
              { id: 'opt_3', label: 'Entry Level / Student (0–2 years)' },
            ],
            points: 20,
            correctAnswer: 'Advanced / Senior (5+ years)',
          },
          {
            id: 'q_statement',
            type: 'LONG_TEXT',
            title: `Why are you a strong fit for "${titleLine}"? Provide specific examples and achievements.`,
            required: true,
            points: 50,
          },
          {
            id: 'q_rating',
            type: 'LINEAR_SCALE',
            title: 'Rate your readiness to begin immediately (1 = Low, 5 = Immediate)',
            required: true,
            scaleMin: 1,
            scaleMax: 5,
            scaleMinLabel: 'Need notice',
            scaleMaxLabel: 'Immediate',
            points: 30,
          },
        ],
        rubric: {
          criteria: [
            { name: 'Relevance & Depth of Experience', weight: 0.5, maxMarks: 50 },
            { name: 'Qualification Alignment', weight: 0.3, maxMarks: 30 },
            { name: 'Clarity & Completeness', weight: 0.2, maxMarks: 20 },
          ],
        },
        selectionSettings: {
          maxSelections: 20,
          strategy: 'TOP_RANKED',
        },
        finished: true,
      };
    }
    return result;
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
      let parsed: any = null;
      try {
        const raw = await this.aiService.sendGonkaChat(prompt, { system: systemPrompt });
        parsed = this.aiService.parseModelJson(raw);
      } catch (err: any) {
        logger.warn('Form agent enhance_draft fallback triggered:', err?.message);
      }

      if (!parsed || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
        const fallbackSchema = await this.reason(instruction, {});
        parsed = {
          agentSummary: `Generated form structure for "${instruction.slice(0, 50)}"`,
          title: fallbackSchema.title || currentDraft.title || 'AI Agent Form',
          description: fallbackSchema.description || currentDraft.description || instruction,
          questions: fallbackSchema.questions,
          rubric: fallbackSchema.rubric,
        };
      }

      const normalizedQuestions = parsed.questions.map((q: any, i: number) => ({
        id: q.id || `q_${Date.now()}_${i}`,
        type: String(q.type || 'SHORT_TEXT').toUpperCase(),
        title: String(q.title || q.label || `Question ${i + 1}`),
        description: q.description ? String(q.description) : '',
        required: Boolean(q.required ?? true),
        points: Number.isFinite(Number(q.points)) ? Number(q.points) : undefined,
        correctAnswer: q.correctAnswer ? String(q.correctAnswer) : undefined,
        options: Array.isArray(q.options)
          ? q.options.map((opt: any, oi: number) => ({
              id: typeof opt === 'object' && opt?.id ? String(opt.id) : `opt_${Date.now()}_${i}_${oi}`,
              label: typeof opt === 'string' ? opt : String(opt?.label || `Option ${oi + 1}`),
            }))
          : undefined,
        scaleMin: q.scaleMin ?? 1,
        scaleMax: q.scaleMax ?? 5,
        maxRating: q.maxRating ?? 5,
      }));

      const draftResult = {
        agentSummary: parsed.agentSummary || `Updated form with ${normalizedQuestions.length} questions.`,
        title: parsed.title || currentDraft.title || 'AI Agent Form',
        description: parsed.description || currentDraft.description || '',
        questions: normalizedQuestions,
        rubric: parsed.rubric || currentDraft.rubric || null,
        requirements: instruction,
      };

      return {
        ...draftResult,
        draft: draftResult,
      };
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
      let simulatedList: any[] = [];
      try {
        const raw = await this.aiService.sendGonkaChat(
          `FORM TITLE: ${form.title}\nDESCRIPTION: ${schema.description || ''}\nQUESTIONS:\n${JSON.stringify(questionSpec, null, 2)}`,
          { system: systemPrompt }
        );
        const parsed = this.aiService.parseModelJson(raw);
        if (Array.isArray(parsed?.submissions)) {
          simulatedList = parsed.submissions;
        }
      } catch (err: any) {
        logger.warn('Simulation AI fallback triggered:', err?.message);
      }

      if (simulatedList.length === 0) {
        const sampleProfiles = [
          { name: 'Aline Uwase', email: 'aline.uwase@example.com', tier: 'high' },
          { name: 'Jean-Paul Habimana', email: 'jp.habimana@example.com', tier: 'medium' },
          { name: 'Eric Mugisha', email: 'eric.mugisha@example.com', tier: 'entry' },
        ];
        simulatedList = Array.from({ length: count }, (_, idx) => {
          const prof = sampleProfiles[idx % sampleProfiles.length];
          const answers: Record<string, any> = {};
          for (const q of questionSpec) {
            const lowerTitle = q.title.toLowerCase();
            if (q.type === 'EMAIL' || lowerTitle.includes('email')) {
              answers[q.key] = prof.email;
            } else if (lowerTitle.includes('name')) {
              answers[q.key] = prof.name;
            } else if (['MULTIPLE_CHOICE', 'DROPDOWN'].includes(q.type) && q.options.length > 0) {
              answers[q.key] = prof.tier === 'high' && q.correctAnswer && q.options.includes(q.correctAnswer)
                ? q.correctAnswer
                : q.options[idx % q.options.length];
            } else if (q.type === 'CHECKBOX' && q.options.length > 0) {
              answers[q.key] = prof.tier === 'high' ? q.options.slice(0, 2) : [q.options[0]];
            } else if (['RATING', 'LINEAR_SCALE', 'NUMBER'].includes(q.type)) {
              answers[q.key] = prof.tier === 'high' ? 5 : prof.tier === 'medium' ? 4 : 3;
            } else if (q.type === 'DATE') {
              answers[q.key] = new Date().toISOString().slice(0, 10);
            } else {
              answers[q.key] =
                prof.tier === 'high'
                  ? `Extensive hands-on experience in ${form.title}, having led multiple production initiatives with measurable outcomes and strong analytical rigor.`
                  : prof.tier === 'medium'
                  ? `Solid foundational background related to ${q.title} with practical project coursework and collaborative team delivery.`
                  : `Interested in learning and contributing to ${form.title}.`;
            }
          }
          return { answers };
        });
      }

      const { AnalyticsWorker } = await import('./AnalyticsWorker.js');
      const analyticsWorker = AnalyticsWorker.getInstance();
      const createdIds: string[] = [];

      for (const item of simulatedList.slice(0, count)) {
        const answers = item?.answers && typeof item.answers === 'object' ? item.answers : item;
        if (!answers || typeof answers !== 'object') continue;
        const sub = await prisma.formSubmission.create({
          data: {
            formId: form.id,
            data: JSON.stringify(answers),
          },
        });
        createdIds.push(sub.id);
        await analyticsWorker.extractInsights(sub.id);
      }

      const analysis = await analyticsWorker.runDeepAnalysis(form.id, payload?.requirements);
      return {
        simulatedCount: createdIds.length,
        analysis,
      };
    }

    throw new Error(`Unsupported form agent action: ${action}`);
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

