import { PrismaClient } from '@prisma/client';
import { AgentPillarBase } from './AgentPillars.js';
import logger from '../utils/logger.js';

const prisma = new PrismaClient();

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
    const systemPrompt = `You are a World-Class Form UI and Admissions Architect.
Convert the user's intent into a structured JSON form schema.
ALSO extract scoring rubric criteria (weights, max marks) and selection settings (e.g., "select top 20") from the description.

OUTPUT JSON:
{
  "thought": "Planning field structure and scoring logic...",
  "title": "String",
  "fields": [...],
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

    const { text } = await this.aiService.sendClaudeChat({
      system: systemPrompt,
      messages: [{ role: 'user', content: userIntent }]
    });

    return this.aiService.parseModelJson(text);
  }

  /**
   * Conversational form generation using Pillar loop.
   */
  public async generateFormSchema(userId: string, userIntent: string) {
    logger.info(`Orchestrator: Generating form schema for intent: "${userIntent}"`);

    const finalPlan = await this.act(userId, userIntent);
    const schemaJson = finalPlan; // The last step of the act loop

    const form = await prisma.applicationForm.create({
      data: {
        userId,
        title: schemaJson.title || 'Untitled Form',
        schema: JSON.stringify(schemaJson),
        rubric: schemaJson.rubric ? JSON.stringify(schemaJson.rubric) : null,
        selectionSettings: schemaJson.selectionSettings ? JSON.stringify(schemaJson.selectionSettings) : null,
      },
    });

    return form;
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

