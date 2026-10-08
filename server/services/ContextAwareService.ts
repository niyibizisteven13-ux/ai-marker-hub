import { prisma } from '../db.js';
import logger from '../utils/logger.js';

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
   * Returns the currently active fine-tuned or primary AI model from the database,
   * along with its distilled adapter instructions and approved training examples.
   */
  public async getActiveFineTunedModelContext(): Promise<{
    modelName: string;
    baseModel: string;
    adapterPrompt: string;
    fewShotBlock: string;
    exampleCount: number;
  }> {
    try {
      const models = await prisma.aiModel.findMany({
        where: { status: 'active' },
        orderBy: { updatedAt: 'desc' },
      });

      // Prefer a fine-tuned model (ft:* or linked to a dataset) if active
      const activeFtModel =
        models.find((m: any) => m.dataset || String(m.name || '').startsWith('ft:') || (m as any).adapterPrompt) ||
        models[0];

      let adapterPrompt = (activeFtModel as any)?.adapterPrompt || '';
      let datasetId = (activeFtModel as any)?.datasetId || '';

      // Also check most recent COMPLETED FineTuneJob
      const completedJobs = await prisma.fineTuneJob.findMany({
        where: { status: 'COMPLETED' },
        orderBy: { updatedAt: 'desc' },
        take: 1,
      });
      const latestJob: any = completedJobs[0];
      if (latestJob) {
        if (!adapterPrompt && latestJob.adapterPrompt) {
          adapterPrompt = latestJob.adapterPrompt;
        }
        if (!datasetId && latestJob.datasetId) {
          datasetId = latestJob.datasetId;
        }
      }

      // Fetch approved DatasetExamples from the database to apply real in-context fine-tuned weights
      const exampleWhere: any = { status: 'approved' };
      if (datasetId) {
        exampleWhere.datasetId = datasetId;
      }
      let approvedExamples = await prisma.datasetExample.findMany({
        where: exampleWhere,
        orderBy: { updatedAt: 'desc' },
        take: 12,
      });

      // Fallback to any approved examples if specific dataset had none
      if (approvedExamples.length === 0 && datasetId) {
        approvedExamples = await prisma.datasetExample.findMany({
          where: { status: 'approved' },
          orderBy: { updatedAt: 'desc' },
          take: 12,
        });
      }

      const fewShotBlock =
        approvedExamples.length > 0
          ? approvedExamples
              .slice(0, 8)
              .map(
                (ex: any, i: number) =>
                  `[Fine-Tuned Example #${i + 1}]\nInstruction: ${ex.instruction || ex.prompt || ''}${
                    ex.input ? `\nInput: ${ex.input}` : ''
                  }\nTarget Output: ${ex.output || ex.completion || ''}`
              )
              .join('\n\n')
          : '';

      return {
        modelName: activeFtModel?.name || (latestJob ? `ft:gonkarouter:${latestJob.id.slice(0, 8)}` : 'zai-org/GLM-5.3-Flash'),
        baseModel: activeFtModel?.baseModel || 'zai-org/GLM-5.3-Flash',
        adapterPrompt,
        fewShotBlock,
        exampleCount: approvedExamples.length,
      };
    } catch (err) {
      logger.warn('Failed to load active fine-tuned model context:', err);
      return {
        modelName: 'zai-org/GLM-5.3-Flash',
        baseModel: 'zai-org/GLM-5.3-Flash',
        adapterPrompt: '',
        fewShotBlock: '',
        exampleCount: 0,
      };
    }
  }

  /**
   * Gathers multidimensional system states, real database records, active fine-tuned model weights,
   * active admin system prompts, and RAG knowledge chunks to build a hydrated context block.
   */
  public async buildHydratedPrompt(userId: string, formId?: string, userQuery?: string) {
    // 1. Temporal Context
    const now = new Date();
    const temporalContext = {
      iso: now.toISOString(),
      human: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      time: now.toLocaleTimeString('en-US'),
    };

    // 2. Environmental & Database Form Context
    let environmentalContext = 'No single active form selected.';
    if (formId) {
      const form = await prisma.applicationForm.findUnique({
        where: { id: formId },
        include: { _count: { select: { submissions: true } }, submissions: { include: { extractedInsights: true } } },
      });

      if (form) {
        let schema: any = {};
        try {
          schema = JSON.parse(form.schema || '{}');
        } catch {}
        const fields = (schema.questions || schema.fields || []).map((f: any) => f.title || f.label).filter(Boolean);
        const subs = Array.isArray((form as any).submissions) ? (form as any).submissions : [];
        const scores = subs
          .map((s: any) => s.extractedInsights?.score)
          .filter((sc: any) => typeof sc === 'number');
        const avgScore = scores.length > 0 ? (scores.reduce((a: number, b: number) => a + b, 0) / scores.length).toFixed(1) : 'N/A';

        environmentalContext = `
Active Form: "${form.title}" (ID: ${form.id})
Total Submissions: ${subs.length} (Average AI Score: ${avgScore})
Available Data Fields: ${fields.join(', ') || 'Standard fields'}
        `.trim();
      }
    }

    // 3. Real Platform Database Snapshot (Forms, Submissions, Graded Scripts, Datasets, Knowledge Base)
    let dbSnapshotContext = '';
    try {
      const [allForms, allSubmissions, allInsights, allDatasets, allExamples, allChunks] = await Promise.all([
        prisma.applicationForm.findMany({ take: 10, orderBy: { createdAt: 'desc' } }),
        prisma.formSubmission.findMany({ take: 30, orderBy: { createdAt: 'desc' } }),
        prisma.extractedInsight.findMany({ take: 30, orderBy: { createdAt: 'desc' } }),
        prisma.dataset.findMany({ include: { _count: { select: { examples: true } } }, take: 10 }),
        prisma.datasetExample.findMany({ where: { status: 'approved' }, take: 15 }),
        prisma.documentChunk.findMany({ take: 8, orderBy: { createdAt: 'desc' } }),
      ]);

      const insightScores = allInsights.map((i: any) => Number(i.score)).filter((n) => Number.isFinite(n));
      const meanScore =
        insightScores.length > 0
          ? (insightScores.reduce((a, b) => a + b, 0) / insightScores.length).toFixed(1)
          : 'N/A';

      dbSnapshotContext = `
[REAL DATABASE TELEMETRY & RECORDS]
- Active Application Forms in DB: ${allForms.length} (${allForms.map((f: any) => `"${f.title}"`).slice(0, 4).join(', ') || 'none'})
- Form Submissions in DB: ${allSubmissions.length} | Scored Candidate Insights: ${allInsights.length} (Mean Score: ${meanScore}%)
- Curated Fine-Tuning Datasets in DB: ${allDatasets.length} (${allExamples.length} approved training examples active)
- Indexed Knowledge Base Chunks in DB: ${allChunks.length}
      `.trim();

      if (allChunks.length > 0) {
        const relevantChunks = userQuery
          ? allChunks.filter((c: any) =>
              userQuery
                .toLowerCase()
                .split(/\W+/)
                .filter((w) => w.length > 3)
                .some((w) => String(c.text || '').toLowerCase().includes(w) || String(c.sourceFilename || '').toLowerCase().includes(w))
            )
          : [];
        const chunksToInject = (relevantChunks.length > 0 ? relevantChunks : allChunks).slice(0, 4);
        dbSnapshotContext += `\n\n[VERIFIED KNOWLEDGE BASE CHUNKS]\n${chunksToInject
          .map((c: any) => `• [${c.sourceFilename}]: ${String(c.text || '').slice(0, 350)}`)
          .join('\n')}`;
      }
    } catch (e) {
      logger.warn('Could not build full DB snapshot in ContextAwareService:', e);
    }

    // 4. Active Fine-Tuned Model & Admin System Prompt
    const ftContext = await this.getActiveFineTunedModelContext();
    let adminPromptBlock = '';
    try {
      const activePrompts = await prisma.promptVersion.findMany({
        where: { active: true },
        orderBy: { createdAt: 'desc' },
        take: 2,
      });
      if (activePrompts.length > 0) {
        adminPromptBlock = `\n[ACTIVE ADMIN SYSTEM PROMPT DIRECTIVES]\n${activePrompts.map((p: any) => p.text).join('\n')}`;
      }
    } catch {}

    // 5. User State
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, name: true },
    });

    const userContext = `Requesting User: ${user?.name || 'Unknown'} (${user?.role || 'INSTRUCTOR'})`;

    return `
[CONTEXTUAL ANCHORS]
TEMPORAL: ${temporalContext.human} ${temporalContext.time} (${temporalContext.iso})
ENVIRONMENTAL: ${environmentalContext}
USER STATE: ${userContext}
ACTIVE MODEL: ${ftContext.modelName} (Base: ${ftContext.baseModel}, Approved Fine-Tune Examples: ${ftContext.exampleCount})
${dbSnapshotContext}
${adminPromptBlock}
${ftContext.adapterPrompt ? `\n[FINE-TUNED MODEL ADAPTER WEIGHTS & CALIBRATION]\n${ftContext.adapterPrompt}` : ''}
${ftContext.fewShotBlock ? `\n[FINE-TUNED IN-CONTEXT TRAINING EXAMPLES FROM DATABASE]\n${ftContext.fewShotBlock}` : ''}

EXECUTION DIRECTIVE: Execute tasks directly and concisely. Do not write filler introductions or unnecessary prose—deliver working artifacts, accurate database-grounded analysis, and direct answers.
    `.trim();
  }
}

