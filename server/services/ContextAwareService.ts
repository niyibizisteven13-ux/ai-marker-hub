import { prisma } from '../db.js';
import logger from '../utils/logger.js';
import { retrieveKnowledgeChunks } from './KnowledgeRetrievalService.js';
import { isExecutionTraceExample } from './DatasetQualityService.js';
import { buildOwnedFormWhere, buildUserContextScope } from './ai/dataScope.js';

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
   * Returns an accessible provider model and optional dataset-grounded prompt adapter.
   */
  public async getActiveFineTunedModelContext(userId: string): Promise<{
    modelName: string;
    baseModel: string;
    adapterPrompt: string;
    fewShotBlock: string;
    exampleCount: number;
  }> {
    try {
      const memberships = await prisma.organizationMember.findMany({
        where: { userId },
        select: { organizationId: true },
      });
      const organizationIds = memberships.map(({ organizationId }) => organizationId);
      const scope = buildUserContextScope(userId, organizationIds);
      const allowedDatasets = await prisma.dataset.findMany({
        where: scope.datasets,
        select: { id: true },
      });
      const allowedDatasetIds = allowedDatasets.map(({ id }) => id);
      const models = await prisma.aiModel.findMany({
        where: { status: 'active', environment: 'production' },
        orderBy: { updatedAt: 'desc' },
      });

      const allowedModels = models.filter((model) =>
        model.datasetId ? allowedDatasetIds.includes(model.datasetId) : !model.adapterPrompt,
      );
      const activeFtModel =
        allowedModels.find((model) => Boolean(model.adapterPrompt)) || allowedModels[0];

      let adapterPrompt = (activeFtModel as any)?.adapterPrompt || '';
      let datasetId = (activeFtModel as any)?.datasetId || '';

      const readyJobs = allowedDatasetIds.length
        ? await prisma.fineTuneJob.findMany({
        where: { status: 'ADAPTER_READY', targetEnvironment: 'production', datasetId: { in: allowedDatasetIds } },
        orderBy: { updatedAt: 'desc' },
        take: 1,
      })
        : [];
      const latestJob: any = readyJobs[0];
      if (latestJob) {
        if (!adapterPrompt && latestJob.adapterPrompt) {
          adapterPrompt = latestJob.adapterPrompt;
        }
        if (!datasetId && latestJob.datasetId) {
          datasetId = latestJob.datasetId;
        }
      }

      // Fetch approved DatasetExamples as supporting in-context examples for the active adapter.
      const loadedExamples = datasetId
        ? await prisma.datasetExample.findMany({
            where: { status: 'approved', consentGiven: true, piiReviewed: true, datasetId },
            orderBy: { updatedAt: 'desc' },
            take: 12,
          })
        : [];
      const approvedExamples = loadedExamples.filter((example: any) => !isExecutionTraceExample(example));

      const fewShotBlock =
        approvedExamples.length > 0
          ? approvedExamples
              .slice(0, 8)
              .map(
                (ex: any, i: number) =>
                  `[Dataset-grounded adapter example #${i + 1}]\nInstruction: ${ex.instruction || ex.prompt || ''}${
                    ex.input ? `\nInput: ${ex.input}` : ''
                  }\nTarget Output: ${ex.output || ex.completion || ''}`
              )
              .join('\n\n')
          : '';

      return {
        modelName: activeFtModel?.baseModel || 'zai-org/GLM-5.3-Flash',
        baseModel: activeFtModel?.baseModel || 'zai-org/GLM-5.3-Flash',
        adapterPrompt,
        fewShotBlock,
        exampleCount: approvedExamples.length,
      };
    } catch (err) {
      logger.warn('Failed to load dataset-grounded prompt adapter context:', err);
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
   * Gathers multidimensional system states, real database records, the active dataset adapter,
   * active admin system prompts, and RAG knowledge chunks to build a hydrated context block.
   */
  public async buildHydratedPrompt(userId: string, formId?: string, userQuery?: string) {
    const memberships = await prisma.organizationMember.findMany({
      where: { userId },
      select: { organizationId: true },
    });
    const organizationIds = memberships.map(({ organizationId }) => organizationId);
    const scope = buildUserContextScope(userId, organizationIds);

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
      const form = await prisma.applicationForm.findFirst({
        where: buildOwnedFormWhere(userId, formId),
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
      const [allForms, allSubmissions, allInsights, allDatasets, allExamples, chunkCount] = await Promise.all([
        prisma.applicationForm.findMany({
          where: scope.forms,
          take: 10,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.formSubmission.findMany({
          where: scope.submissions,
          take: 30,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.extractedInsight.findMany({
          where: scope.insights,
          take: 30,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.dataset.findMany({
          where: scope.datasets,
          include: { _count: { select: { examples: true } } },
          take: 10,
        }),
        prisma.datasetExample.findMany({
          where: scope.examples,
          take: 15,
        }),
        prisma.documentChunk.count({
          where: scope.chunks,
        }),
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
- Curated prompt-adapter datasets in DB: ${allDatasets.length} (${allExamples.length} approved examples active)
- Indexed Knowledge Base Chunks in DB: ${chunkCount}
      `.trim();
    } catch (e) {
      logger.warn('Could not build full DB snapshot in ContextAwareService:', e);
    }

    if (userQuery) {
      const relevantChunks = await retrieveKnowledgeChunks(userQuery, { limit: 5, userId });
      if (relevantChunks.length > 0) {
        dbSnapshotContext += `\n\n[READY KNOWLEDGE BASE SOURCES — use only for claims they support]\n${relevantChunks
          .map(({ chunk, score }) => `[EVIDENCE ID: ${chunk.chunkId}] [${chunk.sourceFilename}${chunk.section ? `, ${chunk.section}` : ''}; relevance ${score}]: ${String(chunk.text || '').slice(0, 1_200)}`)
          .join('\n\n')}`;
      } else {
        dbSnapshotContext += '\n\n[KNOWLEDGE BASE RETRIEVAL]\nNo relevant passage matched this query. If asked for facts from the knowledge base, explicitly say the evidence is unavailable and do not guess.';
      }
    }

    // 4. Active Provider Model, Dataset Adapter, and Admin System Prompt
    const ftContext = await this.getActiveFineTunedModelContext(userId);
    let adminPromptBlock = '';
    try {
      const activePrompts = await prisma.promptVersion.findMany({
        where: { active: true, environment: 'production' },
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
ACTIVE MODEL: ${ftContext.modelName} (Base: ${ftContext.baseModel}, Approved Dataset Examples: ${ftContext.exampleCount})
${dbSnapshotContext}
${adminPromptBlock}
${ftContext.adapterPrompt ? `\n[DATASET-GROUNDED AI KNOWLEDGE ADAPTER]\n${ftContext.adapterPrompt}` : ''}
${ftContext.fewShotBlock ? `\n[APPROVED DATASET EXAMPLES]\n${ftContext.fewShotBlock}` : ''}

EXECUTION DIRECTIVE: Execute tasks directly and concisely. Do not write filler introductions or unnecessary prose. For knowledge-base facts, use only matching READY source passages and cite claims with the exact [EVIDENCE:chunk-id] shown in the passage. Never invent citations. If no relevant passage is available, say the knowledge base cannot support the answer.
    `.trim();
  }
}
