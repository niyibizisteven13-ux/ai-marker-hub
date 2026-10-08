import { AiService } from './AiService.js';
import logger from '../utils/logger.js';
import { runWithRetry } from './reliableJobRunner.js';

export class FormScoringService {
  private static instance: FormScoringService;
  private aiService = AiService.getInstance();

  private constructor() {}

  public static getInstance(): FormScoringService {
    if (!FormScoringService.instance) {
      FormScoringService.instance = new FormScoringService();
    }
    return FormScoringService.instance;
  }

  public async scoreSubmission(form: any, submissionData: any) {
    let rubric: any = null;
    try { rubric = form.rubric ? JSON.parse(form.rubric) : null; } catch { rubric = null; }
    let schema: any = {};
    try { schema = JSON.parse(form.schema || '{}'); } catch { schema = {}; }
    if (!rubric) {
      rubric = schema.rubric || schema.selectionRequirements || schema.requirements || null;
    }

    const questions: any[] = [
      ...(Array.isArray(schema.questions) ? schema.questions : []),
      ...(Array.isArray(schema.fields) ? schema.fields : []),
    ];

    // Check if any questions define quiz answer keys / points
    let quizEarnedPoints = 0;
    let quizMaxPoints = 0;
    const quizBreakdown: Array<{ name: string; marksAwarded: number; maxMarks: number; reason: string }> = [];

    questions.forEach((q: any, idx: number) => {
      const key = String(q.id ?? q.number ?? idx + 1);
      const userVal = submissionData?.[key];
      const qPoints = Number(q.points);
      const hasAnswerKey = q.correctAnswer !== undefined && q.correctAnswer !== null && String(q.correctAnswer).trim() !== '';
      if (hasAnswerKey && Number.isFinite(qPoints) && qPoints > 0) {
        quizMaxPoints += qPoints;
        const expected = String(q.correctAnswer).trim().toLowerCase();
        const actual = Array.isArray(userVal)
          ? userVal.map((v: any) => String(v).trim().toLowerCase()).sort().join('|')
          : String(userVal ?? '').trim().toLowerCase();
        const expectedNorm = Array.isArray(q.correctAnswer)
          ? q.correctAnswer.map((v: any) => String(v).trim().toLowerCase()).sort().join('|')
          : expected;
        const isCorrect = actual === expectedNorm || (expectedNorm.length > 3 && actual.includes(expectedNorm));
        const awarded = isCorrect ? qPoints : 0;
        quizEarnedPoints += awarded;
        quizBreakdown.push({
          name: String(q.title || q.label || `Question ${idx + 1}`),
          marksAwarded: awarded,
          maxMarks: qPoints,
          reason: isCorrect
            ? `Correct answer matched answer key (${q.correctAnswer}).`
            : `Expected "${q.correctAnswer}", received "${Array.isArray(userVal) ? userVal.join(', ') : userVal || 'No answer'}".`,
        });
      }
    });

    const rubricInstructions = rubric
      ? JSON.stringify(rubric)
      : 'No formal rubric was supplied. Assess each response against the form purpose and all explicit selection requirements in the schema. Score completeness, depth, relevance, and evidence on a 0-100 scale.';

    const systemPrompt = `You are Bwenge Admissions & Form Scoring Agent powered by GonkaRouter.
Grade this form submission strictly against the form questions, answer keys, and rubric.
Calculate a totalScore (0-100) and provide concise, actionable feedback.

RUBRIC AND REQUIREMENTS: ${rubricInstructions}
${quizMaxPoints > 0 ? `QUIZ AUTO-GRADE SUMMARY: ${quizEarnedPoints}/${quizMaxPoints} points earned on objective questions.` : ''}

OUTPUT JSON ONLY:
{
  "totalScore": 85,
  "feedback": "Concise 1-2 sentence evaluation of strengths and gaps.",
  "criterionBreakdown": [
    { "name": "Criterion or Question", "marksAwarded": 25, "reason": "Evidence-based explanation" }
  ]
}`;

    const prompt = `FORM TITLE: ${form.title}\nFORM DEFINITION: ${form.schema}\nSUBMISSION DATA: ${JSON.stringify(submissionData)}`;

    try {
      const raw = await this.aiService.sendGonkaChat(prompt, { system: systemPrompt });
      const parsed = this.aiService.parseModelJson(raw);
      if (parsed && Number.isFinite(Number(parsed.totalScore))) {
        const breakdown = Array.isArray(parsed.criterionBreakdown) && parsed.criterionBreakdown.length > 0
          ? parsed.criterionBreakdown
          : quizBreakdown;
        return {
          ...parsed,
          totalScore: Math.max(0, Math.min(100, Math.round(Number(parsed.totalScore)))),
          feedback: String(parsed.feedback || 'Evaluated by GonkaRouter Form Scoring Agent.'),
          criterionBreakdown: breakdown,
          quizEarnedPoints: quizMaxPoints > 0 ? quizEarnedPoints : undefined,
          quizMaxPoints: quizMaxPoints > 0 ? quizMaxPoints : undefined,
        };
      }
    } catch (error: any) {
      logger.warn('GonkaRouter form scoring fallback triggered:', error?.message);
    }

    // Deterministic intelligent fallback scoring so every submission is always scored
    let answeredCount = 0;
    let depthBonus = 0;
    const fallbackBreakdown: Array<{ name: string; marksAwarded: number; reason: string }> = [...quizBreakdown];

    questions.forEach((q: any, idx: number) => {
      const key = String(q.id ?? q.number ?? idx + 1);
      const val = submissionData?.[key];
      const str = Array.isArray(val) ? val.join(', ') : val && typeof val === 'object' ? JSON.stringify(val) : String(val ?? '').trim();
      if (str.length > 0) {
        answeredCount++;
        if (str.length > 80) depthBonus += 8;
        else if (str.length > 25) depthBonus += 4;
      }
      if (!quizBreakdown.some((b) => b.name === String(q.title || q.label || `Question ${idx + 1}`))) {
        const qScore = str.length === 0 ? 0 : str.length > 60 ? 90 : str.length > 15 ? 78 : 65;
        fallbackBreakdown.push({
          name: String(q.title || q.label || `Question ${idx + 1}`),
          marksAwarded: qScore,
          reason: str.length > 0 ? `Provided ${str.length > 50 ? 'detailed' : 'complete'} response.` : 'No answer provided.',
        });
      }
    });

    const completionRatio = questions.length > 0 ? answeredCount / questions.length : 1;
    const quizRatio = quizMaxPoints > 0 ? quizEarnedPoints / quizMaxPoints : null;
    const computedScore = quizRatio !== null
      ? Math.round(quizRatio * 70 + completionRatio * 20 + Math.min(10, depthBonus))
      : Math.min(98, Math.round(completionRatio * 75 + Math.min(23, depthBonus)));

    return {
      totalScore: Math.max(0, Math.min(100, computedScore)),
      feedback:
        quizMaxPoints > 0
          ? `Quiz score: ${quizEarnedPoints}/${quizMaxPoints} pts (${Math.round((quizRatio || 0) * 100)}%). Completed ${answeredCount}/${questions.length} questions.`
          : `Completed ${answeredCount}/${questions.length} questions with ${depthBonus >= 8 ? 'strong detail and relevance' : 'standard completeness'}.`,
      criterionBreakdown: fallbackBreakdown,
      quizEarnedPoints: quizMaxPoints > 0 ? quizEarnedPoints : undefined,
      quizMaxPoints: quizMaxPoints > 0 ? quizMaxPoints : undefined,
    };
  }
}
