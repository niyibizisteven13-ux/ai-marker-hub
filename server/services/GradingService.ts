import { AiService } from './AiService.js';
import { Type } from '@google/genai';
import { evaluateStudentSubmission as deepseekEvaluate } from '../../src/services/deepseekMarker.js';
import { runWithRetry } from './reliableJobRunner.js';
import { logJobCost } from './CostTrackingService.js';
import logger from '../utils/logger.js';
import { prisma } from '../db.js';

import { PreFlightService } from './preFlightService.js';

export class GradingService {
  private static instance: GradingService;
  private aiService = AiService.getInstance();

  private constructor() {}

  public static getInstance(): GradingService {
    if (!GradingService.instance) {
      GradingService.instance = new GradingService();
    }
    return GradingService.instance;
  }

  private clampNumber(value: unknown, min: number, max: number) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
  }

  public async evaluateStudentScriptWithAI(examPaper: any, studentScript: any, batchId: string = 'unknown', preferences?: { defaultStrictness?: string; agentTone?: string; autoSummarize?: boolean; customInstructions?: string | null }) {
    // 1. Pre-flight checks (CHEAPEST WIN)
    const rubricCheck = PreFlightService.validateRubricHealth(examPaper);
    if (!rubricCheck.isValid) {
      throw new Error(`Invalid Rubric: ${rubricCheck.reason}`);
    }

    const scriptCheck = PreFlightService.validateScriptQuality(studentScript);
    if (!scriptCheck.isValid) {
      throw new Error(`Script cannot be marked: ${scriptCheck.reason}`);
    }

    // Determine which model to use. Haiku 4.5 is default for grading as per master plan.
    const model = process.env.GRADING_MODEL || 'claude-3-5-haiku-20241022';

    const draftSystemInstruction = `You are Marker AI, an exam-marking assistant for schools and universities.

ROLE
Grade student answers strictly against the provided rubric/answer key. Be consistent, fair, and evidence-based.
Use ${model} capabilities for precise marking.

WHAT TO DO FOR EACH QUESTION
1. Read the question and its rubric criteria.
2. Read the student's answer for that question only.
3. Match answer content against each rubric criterion.
4. Award partial marks where partially correct — never all-or-nothing unless rubric says so.
5. Ignore spelling/grammar unless the rubric specifically grades language.
6. Flag (do not silently penalize) illegible, blank, or off-topic answers or possible plagiarism.

FLAG OPTIONS:
- "none", "illegible", "blank", "off_topic", "possible_plagiarism", "needs_teacher_review"

USER MARKING PREFERENCES
- Strictness: ${preferences?.defaultStrictness || 'STANDARD'} (apply proportionately; award partial credit for demonstrated understanding).
- Feedback tone: ${preferences?.agentTone || 'PROFESSIONAL'}.
- Include a concise outcome summary: ${preferences?.autoSummarize === false ? 'No' : 'Yes'}.
- Additional teacher guidance: ${preferences?.customInstructions?.trim() || 'None'}.
These preferences must not override the exam, answer key, rubric, safeguarding rules, or evidence in the student's response.

OUTPUT RULES
Return a JSON array of question evaluations.`;

    const reviewSystemInstruction = `You are Marker AI's quality reviewer for marking.
Review the draft marking results for consistency, fairness, and alignment to the rubric. Correct any over- or under-marking.`;

    const prompt = `Evaluate the following student answer script against the exam paper and rubric.
STUDENT: ${studentScript.studentName} (ID: ${studentScript.studentId})
EXAM & RUBRIC: ${JSON.stringify(examPaper, null, 2)}
STUDENT ANSWERS: ${JSON.stringify(studentScript.answers, null, 2)}`;

    try {
      // Primary Routing: Use GonkaRouter (GLM-5.3-Flash) for all script evaluations when active/available
      if (await this.aiService.providerAvailable('gonkarouter') || process.env.AI_PROVIDER === 'gonkarouter') {
        logger.info(`[GradingService] Exclusive Routing: using GonkaRouter (GLM-5.3-Flash) for batch ${batchId}`);
        const rawResult = await this.aiService.sendGonkaChat(prompt, { system: draftSystemInstruction });
        const results = this.aiService.parseModelJson(typeof rawResult === 'string' ? rawResult : (rawResult as any).text || '');
        return this.processResults(results, studentScript, examPaper);
      }

      // Prioritize Ollama if configured as primary provider
      if (process.env.AI_PROVIDER === 'ollama' && (await this.aiService.providerAvailable('ollama'))) {
        const rawResult = await this.aiService.sendOllamaChat(prompt, { system: draftSystemInstruction, json: true });
        const results = this.aiService.parseModelJson(rawResult);
        return this.processResults(results, studentScript, examPaper);
      }

      // Use Haiku for grading as the primary provider if configured
      if (await this.aiService.providerAvailable('anthropic')) {
        const result = await runWithRetry(batchId, 'grading', { studentScript }, async () => {
          const { text, usage, model: usedModel } = await this.aiService.sendClaudeChat(prompt, { system: draftSystemInstruction, model });

          // Log cost - using $0.05 as a placeholder for chargedUsd per script at 1.2x margin
          // In a real app, this might be (Total Payment / Num Scripts)
          //
          // FLAGGED: this flat $0.05 doesn't reconcile with the actual tiered
          // pricing in getPriceForService() (server.ts) — $0.20/script at
          // <=50 scripts up to $1.84/script at <=500. Whatever margin
          // reporting reads from logJobCost is currently wrong for every
          // batch that isn't exactly at the placeholder's assumed size.
          // Replacing with a real per-script charge requires knowing the
          // batch's total price and script count at this call site, which
          // this method doesn't currently receive — worth passing through
          // from the route layer.
          await logJobCost({
            jobId: batchId,
            jobType: 'grading',
            model: usedModel,
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            chargedUsd: 0.05,
          });

          return this.aiService.parseModelJson(text);
        });

        if (!result) throw new Error('AI grading did not return a result.');
        return this.processResults(result, studentScript, examPaper);
      }

      const providerRun = await this.aiService.runProviderRace(
        async () =>
          this.aiService.runAgenticWorkflow({
            draftPrompt: prompt,
            reviewPrompt: 'Refine this marking for fairness and consistency.',
            draftSystemInstruction,
            reviewSystemInstruction,
            responseSchema: { type: Type.ARRAY, items: { type: Type.OBJECT } }, // Schema omitted for brevity
          }),
        async () =>
          this.aiService.parseModelJson(
            await this.aiService.sendOpenAIChat(`${prompt}\nReturn JSON only.`, { json: true, system: draftSystemInstruction })
          ),
        async () => deepseekEvaluate(examPaper, examPaper.rubrics || [], JSON.stringify(studentScript.answers || []))
      );

      const bestResult = providerRun.successes[0]?.value;
      if (providerRun.successes.length === 0) {
        throw new Error('All configured AI grading providers failed.');
      }
      return this.processResults(bestResult, studentScript, examPaper);
    } catch (error: any) {
      logger.error('AI grading failed; script remains pending.', {
        batchId,
        errorType: error?.name || 'Error',
        status: typeof error?.status === 'number' ? error.status : undefined,
        timeout: error?.timeout === true,
        timeoutKind: error?.timeoutKind,
      });
      throw new Error('AI marking could not be completed. The script remains pending; please retry.');
    }
  }

  private processResults(results: any, studentScript: any, examPaper: any) {
    const questions = Array.isArray(examPaper?.questions) ? examPaper.questions : [];
    if (!Array.isArray(results) || results.length !== questions.length) {
      throw new Error('AI grading returned an incomplete result.');
    }

    const normalizedResults = results.map((result: any) => {
      const question = questions.find((candidate: any) =>
        (result?.questionId && String(candidate.id) === String(result.questionId)) ||
        (result?.questionNumber && String(candidate.number) === String(result.questionNumber))
      );
      const maxMarks = Number(question?.maxMarks);
      const awardedMarks = Number(result?.awardedMarks);
      if (
        !question ||
        !Number.isFinite(maxMarks) ||
        !Number.isFinite(awardedMarks) ||
        awardedMarks < 0 ||
        awardedMarks > maxMarks ||
        typeof result.feedbackToStudent !== 'string' ||
        !result.feedbackToStudent.trim()
      ) {
        throw new Error('AI grading returned an invalid question result.');
      }
      return {
        ...result,
        questionId: String(question.id),
        questionNumber: String(question.number),
        maxMarks,
        awardedMarks,
      };
    });
    if (new Set(normalizedResults.map((result: any) => result.questionId)).size !== questions.length) {
      throw new Error('AI grading returned duplicate question results.');
    }

    let totalAwarded = 0;
    let totalMax = 0;
    const flagsDetected: string[] = [];

    normalizedResults.forEach((r: any) => {
      totalAwarded += r.awardedMarks;
      totalMax += r.maxMarks;
      if (r.flag && r.flag !== 'none' && !flagsDetected.includes(r.flag)) {
        flagsDetected.push(r.flag);
      }
    });

    const percentage = totalMax > 0 ? Math.round((totalAwarded / totalMax) * 100) : 0;

    return {
      markedScript: {
        ...studentScript,
        status: 'marked',
        results: normalizedResults,
        totalAwardedMarks: Math.round(totalAwarded * 10) / 10,
        maxTotalMarks: totalMax,
        percentage,
        flags: flagsDetected,
        teacherApproved: false,
      },
      providers: ['GonkaRouter'],
    };
  }

  /**
   * FLAGGED — this previously returned `true` unconditionally outside of
   * development (the real Prisma check was written but commented out),
   * meaning batch payment was never actually verified in production.
   *
   * I don't know your Payment model's exact field names, so rather than
   * guess at a working Prisma query and risk it silently matching nothing
   * (which would just recreate this bug in a harder-to-spot form), this
   * now fails *closed* — unpaid unless a real check is wired in — and logs
   * loudly every time it's hit, so it can't ship silently again. Replace
   * the body with the real Prisma lookup once you confirm the schema
   * (likely something like `prisma.payment.findFirst({ where: { batchId,
   * status: 'SUCCESS' } })`), then delete the warning.
   */
  public async isBatchPaid(batchId: string): Promise<boolean> {
    if (process.env.NODE_ENV === 'development') return true;

    try {
      const payment = await (prisma as any).payment?.findFirst?.({
        where: { batchId, status: 'SUCCESS' },
      });
      if (payment) return true;
    } catch (err) {
      logger.error(`isBatchPaid: payment lookup failed for batch ${batchId} — treating as unpaid`, err);
    }

    logger.warn(
      `isBatchPaid: no confirmed payment found for batch ${batchId} in ${process.env.NODE_ENV || 'unknown'} — blocking. ` +
        `If this is unexpected, confirm the Payment model's field names against the query in isBatchPaid().`
    );
    return false;
  }

  /**
   * Rubric Simulator.
   * Runs model student answers through the rubric to verify marking ranges.
   */
  public async simulateMarking(examPaper: any) {
    logger.info(`Simulating rubric for: ${examPaper.title}`);
    if (examPaper.questions.some((question: any) => !String(question.modelAnswer || '').trim())) {
      return { isValid: false, reason: 'Every question needs a model answer before rubric simulation.' };
    }

    const modelScript = {
      studentName: 'Synthetic Student (Ideal)',
      studentId: 'AI-MODEL-001',
      answers: examPaper.questions.map((q: any) => ({
        questionId: q.id,
        questionNumber: q.number,
        answerText: q.modelAnswer,
      })),
    };

    try {
      const result = await this.evaluateStudentScriptWithAI(examPaper, modelScript, 'simulation');
      const awarded = result.markedScript.totalAwardedMarks;
      const max = result.markedScript.maxTotalMarks;

      // Logical Guardrail: Ideal student should get > 90%
      if (awarded / max < 0.9) {
        return {
          isValid: false,
          reason: `Rubric Logic Gap: The AI only awarded ${awarded}/${max} marks to a "Perfect" model answer. Your rubric might be too strict or criteria might be contradictory.`,
        };
      }

      return { isValid: true };
    } catch (e: any) {
      return { isValid: false, reason: `Simulation failed: ${e.message}` };
    }
  }
}
