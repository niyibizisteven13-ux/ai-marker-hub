import logger from '../utils/logger.js';

const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  catch (err: any) {
    if (err?.name === 'AbortError') throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    throw err;
  } finally { clearTimeout(timer); }
}

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
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  private constructor() {
    this.apiKey = process.env.GONKA_API_KEY || '';
    this.baseUrl = (process.env.GONKA_BASE_URL || 'https://api.gonkarouter.io/v1').replace(/\/$/, '') + '/chat/completions';
    this.model = process.env.GONKA_MODEL || 'zai-org/GLM-5.3-Flash';
  }

  public static getInstance(): SentimentService {
    if (!SentimentService.instance) SentimentService.instance = new SentimentService();
    return SentimentService.instance;
  }

  /**
   * Analyzes the emotional tone of a user message.
   * Uses a fast, lightweight Gonka call (~200ms target).
   */
  public async analyze(message: string): Promise<SentimentResult> {
    const fallback: SentimentResult = {
      tone: 'neutral', intensity: 0.3, suggestedPersona: 'professional',
      systemPromptAddendum: '',
    };
    if (!this.apiKey || !message.trim()) return fallback;

    const systemPrompt = `You are an emotional tone classifier. Analyze the message and return ONLY valid JSON:
{
  "tone": <one of: "neutral"|"frustrated"|"confused"|"excited"|"stressed"|"sad"|"grateful"|"angry">,
  "intensity": <float 0.0-1.0>,
  "persona": <one of: "professional"|"empathetic"|"encouraging"|"gentle"|"celebratory"|"socratic">
}
Do NOT include any text outside the JSON object.`;

    try {
      const response = await fetchWithTimeout(this.baseUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message.slice(0, 500) }, // cap to avoid excess tokens
          ],
          temperature: 0.0,
          max_tokens: 128,
          stream: false,
        }),
      }, 15_000);

      const data: any = await response.json();
      if (!response.ok) throw new Error(`Sentiment API error: ${data?.error?.message}`);

      const raw = (data?.choices?.[0]?.message?.content || '').trim();
      const json = JSON.parse(raw.replace(/```json?/g, '').replace(/```/g, '').trim());

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
