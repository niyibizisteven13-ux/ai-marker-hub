import { prisma } from '../db.js';
import { AgentPillarBase } from './AgentPillars.js';
import { FormScoringService } from './FormScoringService.js';
import logger from '../utils/logger.js';

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
      let insights: any = {};
      try {
        const rawInsights = await this.aiService.sendGonkaChat(
          `FORM: ${submission.form.title}\nFORM QUESTIONS: ${submission.form.schema}\nSUBMISSION ANSWERS: ${submission.data}`,
          { system: systemPrompt },
        );
        insights = this.aiService.parseModelJson(rawInsights);
      } catch (error: any) {
        if (!scoreResult) throw error;
        logger.warn(`Insight summary unavailable for ${submissionId}; preserving the AI score.`, error.message);
      }

      await prisma.extractedInsight.upsert({
        where: { submissionId },
        update: {
          skills: JSON.stringify(Array.isArray(insights.skills) ? insights.skills : []),
          experienceYears: Number.isFinite(Number(insights.experienceYears)) ? Number(insights.experienceYears) : null,
          sentiment: insights.sentiment || null,
          topPassion: insights.topPassion || null,
          summary: insights.summary || scoreResult?.feedback || 'Application analyzed.',
          score: scoreResult?.totalScore,
          scoringFeedback: scoreResult?.feedback,
          scoringDetails: scoreResult?.criterionBreakdown ? JSON.stringify(scoreResult.criterionBreakdown) : null,
        },
        create: {
          submissionId,
          skills: JSON.stringify(Array.isArray(insights.skills) ? insights.skills : []),
          experienceYears: Number.isFinite(Number(insights.experienceYears)) ? Number(insights.experienceYears) : null,
          sentiment: insights.sentiment || null,
          topPassion: insights.topPassion || null,
          summary: insights.summary || scoreResult?.feedback || 'Application analyzed.',
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
  public async runDeepAnalysis(formId: string, requirements?: string) {
    const form = await prisma.applicationForm.findUnique({ where: { id: formId } });
    if (!form) throw new Error('Form not found.');
    const submissions = await prisma.formSubmission.findMany({
      where: { formId },
      include: { extractedInsights: true }
    });

    if (submissions.length === 0) return { totalSubmissions: 0, message: 'No submissions to analyze.', candidates: [], selectedCount: 0 };

    const pending = submissions.filter((submission) => !submission.extractedInsights);
    for (const submission of pending) await this.extractInsights(submission.id);
    const analyzed = await prisma.formSubmission.findMany({ where: { formId }, include: { extractedInsights: true }, orderBy: { createdAt: 'asc' } });

    const totalSubmissions = analyzed.length;
    const scoredSubmissions = analyzed.filter(s => s.extractedInsights?.score !== null && s.extractedInsights?.score !== undefined);
    const scoresList = scoredSubmissions.map(s => Number(s.extractedInsights?.score || 0)).sort((a, b) => a - b);
    const averageScore = scoresList.length > 0
      ? scoresList.reduce((acc, s) => acc + s, 0) / scoresList.length
      : 0;
    const highestScore = scoresList.length > 0 ? scoresList[scoresList.length - 1] : 0;
    const lowestScore = scoresList.length > 0 ? scoresList[0] : 0;
    const medianScore = scoresList.length > 0 ? scoresList[Math.floor(scoresList.length / 2)] : 0;

    const atRiskCount = analyzed.filter(s => s.extractedInsights?.atRisk || (Number(s.extractedInsights?.score ?? 100) < 50)).length;

    let savedSettings: any = {};
    try { savedSettings = form.selectionSettings ? JSON.parse(form.selectionSettings) : {}; } catch { savedSettings = {}; }
    let schema: any = {};
    try { schema = JSON.parse(form.schema || '{}'); } catch { schema = {}; }

    const questions: any[] = [
      ...(Array.isArray(schema.questions) ? schema.questions : []),
      ...(Array.isArray(schema.fields) ? schema.fields : []),
    ];

    const parsedSubmissions = analyzed.map((s) => {
      let dataObj: Record<string, any> = {};
      try { dataObj = JSON.parse(s.data || '{}'); } catch { dataObj = {}; }
      return { submission: s, answers: dataObj };
    });

    const questionSummaries = questions.map((q: any, idx: number) => {
      const qId = String(q.id ?? q.number ?? idx + 1);
      const qTitle = String(q.title || q.label || `Question ${idx + 1}`);
      const qType = String(q.type || 'SHORT_TEXT').toUpperCase();
      const options = Array.isArray(q.options)
        ? q.options.map((o: any) => (typeof o === 'string' ? o : String(o?.label || '')))
        : [];

      const counts: Record<string, number> = {};
      options.forEach((opt: string) => { if (opt) counts[opt] = 0; });

      const textResponses: Array<{ submissionId: string; value: string; submittedAt: Date }> = [];
      const numericValues: number[] = [];
      let answeredCount = 0;
      let correctCount = 0;
      const hasCorrectAnswer = q.correctAnswer !== undefined && q.correctAnswer !== null && String(q.correctAnswer).trim() !== '';

      for (const { submission, answers } of parsedSubmissions) {
        const val = answers[qId] ?? answers[qTitle];
        if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)) continue;
        answeredCount++;

        if (hasCorrectAnswer) {
          const expected = String(q.correctAnswer).trim().toLowerCase();
          const actual = Array.isArray(val)
            ? val.map((v: any) => String(v).trim().toLowerCase()).join(', ')
            : String(val).trim().toLowerCase();
          if (actual === expected || (expected.length > 3 && actual.includes(expected))) {
            correctCount++;
          }
        }

        if (Array.isArray(val)) {
          val.forEach((item: any) => {
            const label = String(item);
            counts[label] = (counts[label] || 0) + 1;
          });
          textResponses.push({ submissionId: submission.id, value: val.join(', '), submittedAt: submission.createdAt });
        } else if (val && typeof val === 'object') {
          const formatted = Object.entries(val)
            .map(([r, c]) => `${r}: ${Array.isArray(c) ? c.join(', ') : c}`)
            .join(' · ');
          textResponses.push({ submissionId: submission.id, value: formatted, submittedAt: submission.createdAt });
        } else {
          const strVal = String(val).trim();
          if (['MULTIPLE_CHOICE', 'DROPDOWN', 'RADIO', 'SELECT', 'CHECKBOX'].includes(qType) || options.length > 0) {
            counts[strVal] = (counts[strVal] || 0) + 1;
          }
          if (['RATING', 'LINEAR_SCALE', 'NUMBER'].includes(qType) && Number.isFinite(Number(strVal))) {
            numericValues.push(Number(strVal));
            counts[strVal] = (counts[strVal] || 0) + 1;
          }
          textResponses.push({ submissionId: submission.id, value: strVal, submittedAt: submission.createdAt });
        }
      }

      const distribution = Object.entries(counts).map(([option, count]) => ({
        option,
        count,
        percentage: answeredCount > 0 ? Math.round((count / answeredCount) * 100) : 0,
      }));

      const averageNumeric = numericValues.length > 0
        ? Math.round((numericValues.reduce((a, b) => a + b, 0) / numericValues.length) * 10) / 10
        : null;

      return {
        id: qId,
        title: qTitle,
        type: qType,
        required: Boolean(q.required),
        points: q.points ? Number(q.points) : null,
        correctAnswer: q.correctAnswer || null,
        answeredCount,
        totalSubmissions,
        responseRate: totalSubmissions > 0 ? Math.round((answeredCount / totalSubmissions) * 100) : 0,
        correctCount: hasCorrectAnswer ? correctCount : null,
        accuracyRate: hasCorrectAnswer && answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : null,
        averageNumeric,
        distribution,
        textResponses: textResponses.slice(0, 50),
      };
    });

    const insightsSummary = analyzed
      .map((s, idx) => `Respondent #${idx + 1} (Score: ${s.extractedInsights?.score ?? 'N/A'}): ${s.extractedInsights?.summary || s.data.slice(0, 220)}`)
      .filter(Boolean)
      .join('\n');

    let qualitativeInsight = `Analyzed ${totalSubmissions} response(s) across ${questions.length} question(s). Average score is ${Math.round(averageScore * 10) / 10}/100 (range ${lowestScore}–${highestScore}).`;
    let keyPatterns: string[] = [];

    if (insightsSummary) {
      try {
        const rawOverview = await this.aiService.sendGonkaChat(
          `Analyze these ${totalSubmissions} form responses for "${form.title}".\nQUESTION DISTRIBUTIONS:\n${JSON.stringify(questionSummaries.map(q => ({ title: q.title, responseRate: q.responseRate, topOptions: q.distribution.slice(0, 4), accuracyRate: q.accuracyRate })))}\n\nRESPONDENT SUMMARIES:\n${insightsSummary}\n\nReturn JSON ONLY:\n{\n  "executiveSummary": "3-sentence high-signal cohort analysis",\n  "keyPatterns": ["Pattern 1", "Pattern 2", "Pattern 3"]\n}`,
          { system: 'You are Bwenge Senior Form Analytics Agent powered by GonkaRouter. Return valid JSON only.' }
        );
        const parsedOverview = this.aiService.parseModelJson(rawOverview);
        if (parsedOverview?.executiveSummary) {
          qualitativeInsight = String(parsedOverview.executiveSummary);
        } else if (typeof rawOverview === 'string' && rawOverview.trim().length > 20 && !rawOverview.trim().startsWith('{')) {
          qualitativeInsight = rawOverview.trim().slice(0, 600);
        }
        if (Array.isArray(parsedOverview?.keyPatterns)) {
          keyPatterns = parsedOverview.keyPatterns.map(String).filter(Boolean);
        }
      } catch (e) {
        logger.warn('AI Qualitative analysis fallback used', e);
      }
    }

    if (keyPatterns.length === 0) {
      keyPatterns = [
        `Cohort average score is ${Math.round(averageScore * 10) / 10}/100 across ${totalSubmissions} submission(s), with a top score of ${highestScore}/100.`,
        questionSummaries[0]
          ? `"${questionSummaries[0].title}" achieved a ${questionSummaries[0].responseRate}% response rate.`
          : 'All required questions achieved high completion rates.',
        `${analyzed.filter(s => (s.extractedInsights?.score || 0) >= 75).length} respondent(s) scored 75+ and meet high-performing selection thresholds.`,
      ];
    }

    let selection: any = null;
    const requirementText = (requirements || savedSettings.requirements || schema.requirements || schema.description || 'Select the strongest respondents based on answer quality, accuracy, and completeness.').trim();
    const maxSelections = Math.max(0, Number(savedSettings.maxSelections) || 0);
    if (requirementText && analyzed.length > 0) {
      const evidence = analyzed.slice(0, 250).map((submission, index) => ({
        rankId: index + 1,
        submissionId: submission.id,
        submittedAt: submission.createdAt,
        answers: JSON.parse(submission.data),
        score: submission.extractedInsights?.score ?? 75,
        scoringFeedback: submission.extractedInsights?.scoringFeedback,
        summary: submission.extractedInsights?.summary,
        criteria: submission.extractedInsights?.scoringDetails ? JSON.parse(submission.extractedInsights.scoringDetails) : [],
      }));
      try {
        const raw = await this.aiService.sendGonkaChat(
          `Evaluate all candidates against the user's requirements. Return a ranked list of the supplied rankIds only, with score 0-100, selected boolean, and concise evidence-based reasoning.\nREQUIREMENTS: ${requirementText}\nCANDIDATES: ${JSON.stringify(evidence)}`,
          { system: 'You are an impartial admissions and candidate selection analyst powered by GonkaRouter. Return JSON only: {"summary":"...","rankings":[{"rankId":1,"score":85,"selected":true,"reason":"..."}]}' }
        );
        const parsedSel = this.aiService.parseModelJson(raw);
        const rankings = Array.isArray(parsedSel?.rankings) ? parsedSel.rankings : [];
        const allowed = new Set(evidence.map((candidate) => candidate.rankId));
        const safeRankings = rankings
          .filter((row: any) => allowed.has(Number(row.rankId)))
          .map((row: any) => ({
            rankId: Number(row.rankId),
            score: Number.isFinite(Number(row.score)) ? Math.max(0, Math.min(100, Math.round(Number(row.score)))) : 75,
            selected: Boolean(row.selected),
            reason: String(row.reason || 'Evaluated against selection criteria.'),
          }));

        for (const cand of evidence) {
          if (!safeRankings.some((r: any) => r.rankId === cand.rankId)) {
            const fallbackScore = Number.isFinite(Number(cand.score)) ? Number(cand.score) : 70;
            safeRankings.push({
              rankId: cand.rankId,
              score: fallbackScore,
              selected: fallbackScore >= 70,
              reason: cand.scoringFeedback || cand.summary || 'Evaluated based on response completeness and rubric alignment.',
            });
          }
        }

        safeRankings.sort((a: any, b: any) => b.score - a.score);
        const eligible = safeRankings.filter((row: any) => row.selected);
        const selectedIds = new Set(eligible.slice(0, maxSelections || eligible.length).map((row: any) => Number(row.rankId)));
        safeRankings.forEach((row: any) => { row.selected = selectedIds.has(Number(row.rankId)); });

        selection = {
          summary: parsedSel?.summary || qualitativeInsight,
          rankings: safeRankings,
        };

        const writes = safeRankings.map((row: any) => {
          const candidate = evidence.find((item) => item.rankId === Number(row.rankId))!;
          return prisma.extractedInsight.upsert({
            where: { submissionId: candidate.submissionId },
            update: {
              selected: Boolean(row.selected),
              score: row.score,
              scoringFeedback: String(row.reason || ''),
              scoringDetails: JSON.stringify({
                criteria: candidate.criteria,
                selection: { score: row.score, reason: String(row.reason || '') },
                requirements: requirementText,
              }),
            },
            create: {
              submissionId: candidate.submissionId,
              selected: Boolean(row.selected),
              score: row.score,
              scoringFeedback: String(row.reason || ''),
              summary: candidate.summary || String(row.reason || ''),
              scoringDetails: JSON.stringify({
                criteria: candidate.criteria,
                selection: { score: row.score, reason: String(row.reason || '') },
                requirements: requirementText,
              }),
            },
          });
        });
        await prisma.$transaction([
          prisma.extractedInsight.updateMany({
            where: { submissionId: { in: analyzed.map((submission) => submission.id) } },
            data: { selected: false },
          }),
          ...writes,
        ]);
      } catch (error: any) {
        logger.warn(`AI ranking fallback used for form ${formId}:`, error.message);
        const fallbackRankings = evidence
          .map((cand) => {
            const sc = Number.isFinite(Number(cand.score)) ? Number(cand.score) : 75;
            return {
              rankId: cand.rankId,
              score: sc,
              selected: sc >= 70,
              reason: cand.scoringFeedback || cand.summary || 'Ranked by rubric score and response completeness.',
            };
          })
          .sort((a: any, b) => b.score - a.score);
        selection = { summary: qualitativeInsight, rankings: fallbackRankings };
      }
    }

    const refreshed = await prisma.formSubmission.findMany({
      where: { formId },
      include: { extractedInsights: true },
      orderBy: { createdAt: 'desc' },
    });

    const candidates = refreshed
      .map((submission) => ({
        id: submission.id,
        submittedAt: submission.createdAt,
        answers: JSON.parse(submission.data),
        score: submission.extractedInsights?.score ?? null,
        selected: submission.extractedInsights?.selected ?? false,
        sentiment: submission.extractedInsights?.sentiment || 'positive',
        skills: (() => {
          try { return JSON.parse(submission.extractedInsights?.skills || '[]'); } catch { return []; }
        })(),
        feedback: (() => {
          try {
            const details = JSON.parse(submission.extractedInsights?.scoringDetails || '{}');
            return details.selection?.reason || submission.extractedInsights?.scoringFeedback || submission.extractedInsights?.summary || null;
          } catch {
            return submission.extractedInsights?.scoringFeedback || submission.extractedInsights?.summary || null;
          }
        })(),
        scoringDetails: submission.extractedInsights?.scoringDetails ? JSON.parse(submission.extractedInsights.scoringDetails) : null,
      }))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

    const finalScores = candidates.filter((c) => c.score !== null).map((c) => Number(c.score));
    const finalAvg = finalScores.length > 0 ? Math.round((finalScores.reduce((a, b) => a + b, 0) / finalScores.length) * 10) / 10 : Math.round(averageScore * 10) / 10;

    return {
      totalSubmissions,
      averageScore: finalAvg,
      highestScore: finalScores.length > 0 ? Math.max(...finalScores) : highestScore,
      lowestScore: finalScores.length > 0 ? Math.min(...finalScores) : lowestScore,
      medianScore,
      atRiskCount,
      qualitativeInsight,
      keyPatterns,
      questionSummaries,
      requirements: requirementText || null,
      selection,
      selectedCount: candidates.filter((c) => c.selected).length,
      candidates,
      generatedAt: new Date().toISOString()
    };
  }
}

