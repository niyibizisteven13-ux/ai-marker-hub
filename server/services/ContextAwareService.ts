import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger.js';

const prisma = new PrismaClient();

export class ContextAwareService {
  private static instance: ContextAwareService;

  private constructor() {}

  public static getInstance(): ContextAwareService {
    if (!ContextAwareService.instance) {
      ContextAwareService.instance = new ContextAwareService();
    }
    return ContextAwareService.instance;
  }

  /**
   * Gathers multidimensional system states and builds a hydrated context block.
   */
  public async buildHydratedPrompt(userId: string, formId?: string) {
    // 1. Temporal Context
    const now = new Date();
    const temporalContext = {
      iso: now.toISOString(),
      human: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      time: now.toLocaleTimeString('en-US'),
    };

    // 2. Environmental Context
    let environmentalContext = 'No active form context.';
    if (formId) {
      const form = await prisma.applicationForm.findUnique({
        where: { id: formId },
        include: { _count: { select: { submissions: true } } }
      });

      if (form) {
        const schema = JSON.parse(form.schema);
        const fields = schema.fields?.map((f: any) => f.label) || [];
        environmentalContext = `
Active Form: "${form.title}" (ID: ${form.id})
Total Submissions: ${form._count.submissions}
Available Data Fields: ${fields.join(', ')}
        `.trim();
      }
    }

    // 3. User State
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, name: true }
    });

    const userContext = `
Requesting User: ${user?.name || 'Unknown'}
User Role: ${user?.role || 'INSTRUCTOR'}
    `.trim();

    return `
[CONTEXTUAL ANCHORS]
TEMPORAL: The current real-world time is ${temporalContext.human} ${temporalContext.time} (${temporalContext.iso}). Use this to resolve all relative time queries.
ENVIRONMENTAL: ${environmentalContext}
USER STATE: ${userContext}

Instruction: You must align your reasoning and data queries with these specific contextual anchors. Do not hallucinate dates or fields outside this scope.
    `.trim();
  }
}
