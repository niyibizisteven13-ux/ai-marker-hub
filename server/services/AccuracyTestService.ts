import { AiService } from './AiService.js';
import { GradingService } from './GradingService.js';

export class AccuracyTestService {
  private static instance: AccuracyTestService;
  private aiService = AiService.getInstance();
  private gradingService = GradingService.getInstance();

  private constructor() {}

  public static getInstance(): AccuracyTestService {
    if (!AccuracyTestService.instance) {
      AccuracyTestService.instance = new AccuracyTestService();
    }
    return AccuracyTestService.instance;
  }

  public async runHaikuVsSonnetTest(examPaper: any, studentScript: any) {
    const haikuModel = 'claude-3-5-haiku-20241022';
    const sonnetModel = 'claude-3-5-sonnet-20241022';

    const [haikuResult, sonnetResult] = await Promise.all([
      this.gradeWithModel(examPaper, studentScript, haikuModel),
      this.gradeWithModel(examPaper, studentScript, sonnetModel)
    ]);

    const comparison = this.compareResults(haikuResult, sonnetResult);

    return {
      haiku: haikuResult,
      sonnet: sonnetResult,
      comparison,
      timestamp: new Date().toISOString()
    };
  }

  private async gradeWithModel(examPaper: any, studentScript: any, model: string) {
    // This is a simplified version of GradingService.evaluateStudentScriptWithAI
    // but forced to use a specific Claude model.
    const systemInstruction = `You are Marker AI. Grade student answers strictly against the rubric. Output JSON.`;
    const prompt = `EXAM: ${JSON.stringify(examPaper)}\nSTUDENT: ${JSON.stringify(studentScript)}`;

    const { text } = await this.aiService.sendClaudeChat(prompt, { system: systemInstruction, model });
    return this.aiService.parseModelJson(text);
  }

  private compareResults(haiku: any, sonnet: any) {
    const haikuTotal = Array.isArray(haiku) ? haiku.reduce((sum: number, q: any) => sum + (q.awardedMarks || 0), 0) : 0;
    const sonnetTotal = Array.isArray(sonnet) ? sonnet.reduce((sum: number, q: any) => sum + (q.awardedMarks || 0), 0) : 0;

    return {
      totalMarksDiff: Math.abs(haikuTotal - sonnetTotal),
      agreementPercentage: haikuTotal === sonnetTotal ? 100 : (1 - Math.abs(haikuTotal - sonnetTotal) / Math.max(haikuTotal, sonnetTotal, 1)) * 100,
      details: Array.isArray(haiku) && Array.isArray(sonnet) ? haiku.map((h, i) => ({
        questionId: h.questionId,
        haikuScore: h.awardedMarks,
        sonnetScore: sonnet[i]?.awardedMarks,
        diff: Math.abs((h.awardedMarks || 0) - (sonnet[i]?.awardedMarks || 0))
      })) : []
    };
  }
}
