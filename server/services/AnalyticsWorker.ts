import { PrismaClient } from '@prisma/client';
import { AgentPillarBase } from './AgentPillars.js';
import { FormScoringService } from './FormScoringService.js';
import logger from '../utils/logger.js';

const prisma = new PrismaClient();

export class AnalyticsWorker extends AgentPillarBase {
  private static instance: AnalyticsWorker;

  private constructor() {
    super();
  }

  public static getInstance(): AnalyticsWorker {
    if (!AnalyticsWorker.instance) {
      AnalyticsWorker.instance = new AnalyticsWorker();
    }
    return AnalyticsWorker.instance;
  }

  /**
   * Pillar 1: Perceive
   */
  public async perceive(formId: string): Promise<any> {
    const submissions = await prisma.formSubmission.findMany({
      where: { formId },
      include: { extractedInsights: true }
    });
    return submissions;
  }

  /**
   * Pillar 2: Reason
   */
  public async reason(userGoal: string, observation: any): Promise<any> {
    const systemPrompt = `You are a Senior Data Analyst Agent.
Analyze the student application dataset.
If finished, set "finished": true.
If you need a tool (like "parse_csv"), specify "tool_to_use".

OUTPUT JSON:
{ "thought": "Reasoning...", "tool_to_use": "name", "args": {}, "finished": boolean }`;

    const { text } = await this.aiService.sendClaudeChat({
      system: systemPrompt,
      messages: [
        { role: 'user', content: `GOAL: ${userGoal}\nDATA: ${JSON.stringify(observation)}` }
      ]
    });

    return this.aiService.parseModelJson(text);
  }

  /**
   * Qualitative Extraction Agent. (Kept for backwards compatibility or single-shot runs)
   */
  public async extractInsights(submissionId: string) {
    const submission = await prisma.formSubmission.findUnique({
      where: { id: submissionId },
      include: { form: true }
    });

    if (!submission) return;

    logger.info(`Analytics: Extracting insights for submission ${submissionId}`);

    const systemPrompt = `You are a Data Extraction Specialist.
Extract structured metadata from this form submission.
Mask any sensitive PII.

EXPECTED JSON:
{
  "skills": ["string"],
  "experienceYears": number,
  "sentiment": "positive|neutral|negative",
  "topPassion": "string",
  "summary": "1-sentence summary"
}`;

    try {
      // 1. Scoring Logic
      const scoringService = FormScoringService.getInstance();
      const scoreResult = await scoringService.scoreSubmission(submission.form, JSON.parse(submission.data));

      // 2. Original Insight Extraction
      const { text: insightText } = await this.aiService.sendClaudeChat({
        system: systemPrompt,
        messages: [{ role: 'user', content: `FORM: ${submission.form.title}\nDATA: ${submission.data}` }]
      });

      const insights = this.aiService.parseModelJson(insightText);

      await prisma.extractedInsight.upsert({
        where: { submissionId },
        update: {
          skills: JSON.stringify(insights.skills),
          experienceYears: insights.experienceYears,
          sentiment: insights.sentiment,
          topPassion: insights.topPassion,
          summary: insights.summary,
          score: scoreResult?.totalScore,
          scoringFeedback: scoreResult?.feedback,
          scoringDetails: scoreResult?.criterionBreakdown ? JSON.stringify(scoreResult.criterionBreakdown) : null,
        },
        create: {
          submissionId,
          skills: JSON.stringify(insights.skills),
          experienceYears: insights.experienceYears,
          sentiment: insights.sentiment,
          topPassion: insights.topPassion,
          summary: insights.summary,
          score: scoreResult?.totalScore,
          scoringFeedback: scoreResult?.feedback,
          scoringDetails: scoreResult?.criterionBreakdown ? JSON.stringify(scoreResult.criterionBreakdown) : null,
        }
      });
    } catch (error: any) {
      logger.error(`Insight extraction failed for ${submissionId}:`, error.message);
    }
  }

  /**
   * Proactive Batch Aggregator.
   * Calculates statistical patterns across student papers.
   */
  public async aggregateBatchPerformance(userId: string, batchId: string) {
    try {
      logger.info(`Analytics: Aggregating performance for batch ${batchId}`);
      // Returning null as StudentScript table is not in the schema yet.
      return null;
    } catch (error: any) {
      logger.error(`Batch aggregation failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Deep Analysis for a specific form.
   * Aggregates all submissions and extracted insights into a report.
   */
  public async runDeepAnalysis(formId: string) {
    const submissions = await prisma.formSubmission.findMany({
      where: { formId },
      include: { extractedInsights: true }
    });

    if (submissions.length === 0) {
      return { totalSubmissions: 0, message: "No submissions to analyze." };
    }

    const totalSubmissions = submissions.length;
    const scoredSubmissions = submissions.filter(s => s.extractedInsights?.score !== null);
    const averageScore = scoredSubmissions.length > 0
      ? scoredSubmissions.reduce((acc, s) => acc + (s.extractedInsights?.score || 0), 0) / scoredSubmissions.length
      : 0;

    const atRiskCount = submissions.filter(s => s.extractedInsights?.atRisk).length;

    // Qualitative Summary using AI
    const insightsSummary = submissions
      .map(s => s.extractedInsights?.summary)
      .filter(Boolean)
      .join('\n');

    let qualitativeInsight = "Insufficient data for qualitative analysis.";
    if (insightsSummary) {
      try {
        const { text } = await this.aiService.sendClaudeChat(
          `Summarize these student application insights into a 3-sentence high-level overview of the cohort:\n\n${insightsSummary}`,
          { system: "You are a Senior Academic Analytics Agent." }
        );
        qualitativeInsight = text;
      } catch (e) {
        logger.warn('AI Qualitative analysis failed', e);
      }
    }

    return {
      totalSubmissions,
      averageScore: Math.round(averageScore * 10) / 10,
      atRiskCount,
      qualitativeInsight,
      generatedAt: new Date().toISOString()
    };
  }
}

