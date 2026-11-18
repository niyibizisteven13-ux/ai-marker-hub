import { AiService } from './AiService.js';
import logger from '../utils/logger.js';
import { parseModelJson } from '../utils/textSanitizers.js';

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export interface ConfidenceResult {
  score: number; // 0-100
  level: ConfidenceLevel;
  explanation: string;
  uncertainClaims: string[];
  correctedText?: string;
}

export class ConfidenceService {
  private static instance: ConfidenceService;

  private constructor() {}

  public static getInstance(): ConfidenceService {
    if (!ConfidenceService.instance) ConfidenceService.instance = new ConfidenceService();
    return ConfidenceService.instance;
  }

  private async callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured.');
    return (await AiService.getInstance().completeText(userPrompt, { system: systemPrompt, maxTokens: 1024, timeoutMs: 30_000 })).trim();
  }

  /**
   * Assess confidence of an AI-generated response.
   * Returns a ConfidenceResult with a score 0-100, level, and list of uncertain claims.
   */
  public async assessConfidence(originalQuery: string, aiResponse: string): Promise<ConfidenceResult> {
    if (!process.env.ANTHROPIC_API_KEY) {
      return { score: 50, level: 'UNKNOWN', explanation: 'Claude API not configured.', uncertainClaims: [] };
    }
    const systemPrompt = `You are a rigorous fact-auditor. Your ONLY job is to analyze an AI response and assess its confidence/accuracy.
Return ONLY valid JSON with this exact shape:
{
  "score": <number 0-100>,
  "level": <"HIGH"|"MEDIUM"|"LOW">,
  "explanation": <one sentence summary>,
  "uncertainClaims": [<list of specific claims that might be hallucinations or unverifiable>]
}
Do NOT include any other text outside the JSON.`;
    const userPrompt = `ORIGINAL QUERY: ${originalQuery}\n\nAI RESPONSE TO AUDIT:\n${aiResponse}`;
    try {
      const raw = await this.callClaude(systemPrompt, userPrompt);
      const json = parseModelJson(raw);
      return {
        score: Math.min(100, Math.max(0, Number(json.score) || 50)),
        level: ['HIGH', 'MEDIUM', 'LOW'].includes(json.level) ? json.level : 'MEDIUM',
        explanation: json.explanation || '',
        uncertainClaims: Array.isArray(json.uncertainClaims) ? json.uncertainClaims : [],
      };
    } catch (e) {
      logger.warn('ConfidenceService.assessConfidence parse error', e);
      return { score: 50, level: 'UNKNOWN', explanation: 'Could not parse confidence assessment.', uncertainClaims: [] };
    }
  }

  /**
   * Self-correction pass: ask Claude to review and fix its own output.
   * Adds [UNCERTAIN] markers to dubious claims and returns a corrected version.
   */
  public async selfCorrect(originalQuery: string, aiResponse: string): Promise<string> {
    if (!process.env.ANTHROPIC_API_KEY) return aiResponse;
    const systemPrompt = `You are a self-correction engine for an AI assistant named Bwenge.
Your task: Review the AI response below and:
1. Add [UNCERTAIN] inline tag immediately before any claim you cannot verify with high confidence.
2. If a claim is clearly wrong, replace it with the correct fact.
3. If you don't know something, add a note: [NOTE: This claim could not be verified — please double-check.]
4. Preserve the original formatting and length.
5. If the response looks fully accurate, return it unchanged.
Return ONLY the corrected response text. No preamble, no explanation.`;
    const userPrompt = `ORIGINAL QUERY: ${originalQuery}\n\nAI RESPONSE TO SELF-CORRECT:\n${aiResponse}`;
    try {
      return await this.callClaude(systemPrompt, userPrompt);
    } catch (e) {
      logger.warn('ConfidenceService.selfCorrect error, returning original', e);
      return aiResponse;
    }
  }

  /**
   * Inject a confidence badge into a markdown response.
   * Appends a small badge at the top: 🟢 HIGH / 🟡 MEDIUM / 🔴 LOW
   */
  public injectConfidenceBadge(text: string, result: ConfidenceResult): string {
    const badges: Record<ConfidenceLevel, string> = {
      HIGH: '🟢 **Confidence: HIGH** — This response is highly reliable.',
      MEDIUM: '🟡 **Confidence: MEDIUM** — Some claims may need verification.',
      LOW: '🔴 **Confidence: LOW** — Treat this response with caution and verify key facts.',
      UNKNOWN: '⚪ **Confidence: Unknown**',
    };
    if (result.level === 'HIGH') return text; // Don't clutter high-confidence responses
    return `> ${badges[result.level]}\n\n${text}`;
  }
}
