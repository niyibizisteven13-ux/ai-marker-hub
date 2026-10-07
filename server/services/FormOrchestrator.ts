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

    const text = await this.aiService.sendGonkaChat(intent, { system: systemPrompt });
    const result = this.aiService.parseModelJson(text);
    if (!result || typeof result !== 'object' || !result.title || !(Array.isArray(result.questions) || Array.isArray(result.fields))) {
      throw new Error('AI could not generate a complete form schema. Please add the questions and requirements explicitly.');
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

