import { AiService } from './AiService.js';
import logger from '../utils/logger.js';
import { parseModelJson } from '../utils/textSanitizers.js';

export type EmotionalTone = 'neutral' | 'frustrated' | 'confused' | 'excited' | 'stressed' | 'sad' | 'grateful' | 'angry';
export type PersonaMode = 'professional' | 'empathetic' | 'encouraging' | 'gentle' | 'celebratory' | 'socratic';

export interface SentimentResult {
  tone: EmotionalTone;
  intensity: number; // 0.0 - 1.0
  suggestedPersona: PersonaMode;
  systemPromptAddendum: string;
}

const PERSONA_ADDENDUMS: Record<PersonaMode, string> = {
  professional: '',
  empathetic: `
## EMPATHY MODE ACTIVE
The user appears to be frustrated or upset. Prioritize:
- Acknowledge their feelings first before providing answers.
- Use warm, validating language ("I understand that's frustrating...").
- Keep responses concise and avoid overwhelming them with information.
- Offer one clear next step rather than a list of options.`,
  encouraging: `
## ENCOURAGEMENT MODE ACTIVE
The user seems confused or uncertain. Prioritize:
- Be extra patient and use simple, clear language.
- Break down explanations into small, manageable steps.
- Affirm their effort: "That's a great question."
- End with a confidence-building statement.`,
  gentle: `
## GENTLE MODE ACTIVE
The user appears to be in distress or sad. Prioritize:
- Use a very soft, compassionate tone.
- Do not rush to give solutions — acknowledge first.
- If the topic seems emotionally sensitive, offer to slow down.
- Avoid clinical or overly technical language.`,
  celebratory: `
## CELEBRATION MODE ACTIVE
The user is excited or celebrating. Match their energy:
- Be enthusiastic and positive.
- Affirm their achievement.
- Use uplifting language.`,
  socratic: `
## SOCRATIC MODE ACTIVE
The user is in a learning mindset. Prioritize:
- Ask guiding questions rather than giving direct answers.
- Encourage critical thinking.
- Build understanding step by step.`,
};

export class SentimentService {
  private static instance: SentimentService;

  private constructor() {}

  public static getInstance(): SentimentService {
    if (!SentimentService.instance) SentimentService.instance = new SentimentService();
    return SentimentService.instance;
  }

  /**
   * Analyzes the emotional tone of a user message.
   * Uses a fast, lightweight Claude call (~200ms target).
   */
  public async analyze(message: string): Promise<SentimentResult> {
    const fallback: SentimentResult = {
      tone: 'neutral', intensity: 0.3, suggestedPersona: 'professional',
      systemPromptAddendum: '',
    };
    if (!process.env.ANTHROPIC_API_KEY || !message.trim()) return fallback;

    const systemPrompt = `You are an emotional tone classifier. Analyze the message and return ONLY valid JSON:
{
  "tone": <one of: "neutral"|"frustrated"|"confused"|"excited"|"stressed"|"sad"|"grateful"|"angry">,
  "intensity": <float 0.0-1.0>,
  "persona": <one of: "professional"|"empathetic"|"encouraging"|"gentle"|"celebratory"|"socratic">
}
Do NOT include any text outside the JSON object.`;

    try {
      const raw = (await AiService.getInstance().completeText(message.slice(0, 500), { system: systemPrompt, maxTokens: 256, timeoutMs: 15_000 })).trim();
      const json = parseModelJson(raw);

      const tone = json.tone as EmotionalTone || 'neutral';
      const suggestedPersona = json.persona as PersonaMode || 'professional';

      return {
        tone,
        intensity: Math.min(1, Math.max(0, Number(json.intensity) || 0.3)),
        suggestedPersona,
        systemPromptAddendum: PERSONA_ADDENDUMS[suggestedPersona] || '',
      };
    } catch (e) {
      logger.warn('SentimentService.analyze error, using fallback', e);
      return fallback;
    }
  }

  /**
   * Applies sentiment-adaptive addendum to an existing system prompt.
   */
  public applyToSystemPrompt(basePrompt: string, sentiment: SentimentResult): string {
    if (!sentiment.systemPromptAddendum || sentiment.tone === 'neutral') return basePrompt;
    return basePrompt + sentiment.systemPromptAddendum;
  }
}
