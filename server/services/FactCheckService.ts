import crypto from 'crypto';
import logger from '../utils/logger.js';

const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  catch (err: any) {
    if (err?.name === 'AbortError') throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    throw err;
  } finally { clearTimeout(timer); }
}

export interface FactCheckResult {
  claim: string;
  verified: boolean;
  confidence: number; // 0-1
  sources: Array<{ title: string; url: string; snippet: string }>;
  verdict: 'TRUE' | 'FALSE' | 'UNVERIFIABLE' | 'PARTIALLY_TRUE';
  explanation: string;
}

export class FactCheckService {
  private static instance: FactCheckService;
  private gonkaBaseUrl: string;
  private gonkaApiKey: string;
  private gonkaModel: string;
  private redis: any = null;
  private readonly CACHE_TTL = 3600; // 1 hour

  private constructor() {
    this.gonkaApiKey = process.env.GONKA_API_KEY || '';
    this.gonkaBaseUrl = (process.env.GONKA_BASE_URL || 'https://api.gonkarouter.io/v1').replace(/\/$/, '') + '/chat/completions';
    this.gonkaModel = process.env.GONKA_MODEL || 'zai-org/GLM-5.3-Flash';
    this.initRedis();
  }

  public static getInstance(): FactCheckService {
    if (!FactCheckService.instance) FactCheckService.instance = new FactCheckService();
    return FactCheckService.instance;
  }

  private async initRedis() {
    if (!process.env.REDIS_URL) return;
    try {
      const { default: Redis } = await import('ioredis');
      this.redis = new Redis(process.env.REDIS_URL);
    } catch (e) {
      logger.warn('FactCheckService: Redis not available, caching disabled');
    }
  }

  private claimHash(claim: string): string {
    return 'fc:' + crypto.createHash('sha256').update(claim.toLowerCase().trim()).digest('hex').slice(0, 16);
  }

  private async getCache(key: string): Promise<FactCheckResult | null> {
    if (!this.redis) return null;
    try {
      const cached = await this.redis.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch { return null; }
  }

  private async setCache(key: string, value: FactCheckResult): Promise<void> {
    if (!this.redis) return;
    try { await this.redis.setex(key, this.CACHE_TTL, JSON.stringify(value)); } catch { /* ignore */ }
  }

  private async searchWeb(query: string): Promise<Array<{ title: string; url: string; content: string }>> {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) return [];
    try {
      const response = await fetchWithTimeout('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, query, search_depth: 'basic', max_results: 4, include_answer: false }),
      }, 15_000);
      const data: any = await response.json();
      return (data.results || []).map((r: any) => ({ title: r.title || '', url: r.url || '', content: r.content || '' }));
    } catch (e) {
      logger.warn('FactCheckService web search error', e);
      return [];
    }
  }

  private async synthesizeVerdict(claim: string, sources: Array<{ title: string; url: string; content: string }>): Promise<{ verdict: FactCheckResult['verdict']; confidence: number; explanation: string }> {
    if (!this.gonkaApiKey) return { verdict: 'UNVERIFIABLE', confidence: 0, explanation: 'Gonka API not configured.' };
    const sourceText = sources.length
      ? sources.map((s, i) => `[${i + 1}] ${s.title}\n${s.content.slice(0, 300)}`).join('\n\n')
      : 'No web sources found.';
    const systemPrompt = `You are a professional fact-checker. Given a claim and web evidence, return ONLY valid JSON:
{
  "verdict": <"TRUE"|"FALSE"|"PARTIALLY_TRUE"|"UNVERIFIABLE">,
  "confidence": <float 0.0-1.0>,
  "explanation": <one clear sentence>
}
No other text outside the JSON.`;
    const userPrompt = `CLAIM: "${claim}"\n\nWEB EVIDENCE:\n${sourceText}`;
    try {
      const response = await fetchWithTimeout(this.gonkaBaseUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.gonkaApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.gonkaModel,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
          temperature: 0.0, max_tokens: 256, stream: false,
        }),
      }, 20_000);
      const data: any = await response.json();
      if (!response.ok) throw new Error(`Gonka error: ${data?.error?.message}`);
      const raw = (data?.choices?.[0]?.message?.content || '').replace(/```json?/g, '').replace(/```/g, '').trim();
      const json = JSON.parse(raw);
      return {
        verdict: ['TRUE', 'FALSE', 'PARTIALLY_TRUE', 'UNVERIFIABLE'].includes(json.verdict) ? json.verdict : 'UNVERIFIABLE',
        confidence: Math.min(1, Math.max(0, Number(json.confidence) || 0)),
        explanation: json.explanation || '',
      };
    } catch (e) {
      logger.warn('FactCheckService.synthesizeVerdict error', e);
      return { verdict: 'UNVERIFIABLE', confidence: 0, explanation: 'Could not synthesize verdict.' };
    }
  }

  /**
   * Main entry point: fact-check a claim.
   * Caches results in Redis for 1 hour.
   */
  public async check(claim: string): Promise<FactCheckResult> {
    const cacheKey = this.claimHash(claim);
    const cached = await this.getCache(cacheKey);
    if (cached) {
      logger.info(`FactCheckService: cache hit for claim hash ${cacheKey}`);
      return cached;
    }
    const webSources = await this.searchWeb(claim);
    const { verdict, confidence, explanation } = await this.synthesizeVerdict(claim, webSources);
    const result: FactCheckResult = {
      claim,
      verified: verdict === 'TRUE',
      confidence,
      verdict,
      explanation,
      sources: webSources.map(s => ({ title: s.title, url: s.url, snippet: s.content.slice(0, 200) })),
    };
    await this.setCache(cacheKey, result);
    return result;
  }

  /**
   * Scan a block of text and extract claims that look like they need fact-checking.
   * Returns claims containing statistics, dates, or named entities.
   */
  public async extractCheckableClaims(text: string): Promise<string[]> {
    if (!this.gonkaApiKey) return [];
    const systemPrompt = `Extract factual claims from text that could potentially be hallucinations. Look for statistics, dates, named entities, and specific technical facts. Return ONLY a JSON array of strings. Example: ["The Eiffel Tower is 330 meters tall.", "Python was created in 1991."]. Return [] if no checkable claims exist.`;
    try {
      const response = await fetchWithTimeout(this.gonkaBaseUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.gonkaApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.gonkaModel,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text.slice(0, 1500) }],
          temperature: 0.0, max_tokens: 512, stream: false,
        }),
      }, 20_000);
      const data: any = await response.json();
      const raw = (data?.choices?.[0]?.message?.content || '').replace(/```json?/g, '').replace(/```/g, '').trim();
      return JSON.parse(raw);
    } catch { return []; }
  }
}
