import logger from '../utils/logger.js';

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  catch (err: any) {
    if (err?.name === 'AbortError') throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    throw err;
  } finally { clearTimeout(timer); }
}

export type SafetyCategory = 'safe' | 'borderline' | 'harmful' | 'illegal';

export interface SafetyResult {
  category: SafetyCategory;
  blocked: boolean;
  reason?: string;
  piiDetected: boolean;
  piiTypes: string[];
}

// Regex patterns for PII detection
const PII_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'email', pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g },
  { name: 'phone_number', pattern: /(?:\+?\d{1,3}[\s\-.])?\(?\d{3}\)?[\s\-.]\d{3}[\s\-.]\d{4}/g },
  { name: 'credit_card', pattern: /\b(?:\d{4}[\s\-]?){3}\d{4}\b/g },
  { name: 'national_id', pattern: /\b[A-Z]{1,2}\d{6,9}\b/g },
  { name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
];

// Hard-coded blocked phrases (fast path — no LLM call needed)
const INSTANT_BLOCK_PATTERNS = [
  /how to (make|synthesize|create|build) (a )?bomb/i,
  /how to (make|synthesize|produce) (drugs|meth|heroin|fentanyl)/i,
  /child (porn|sexual abuse|exploitation)/i,
  /terrorism|mass (shooting|murder) plan/i,
  /hack (into)? (bank|government|military)/i,
];

export class SafetyService {
  private static instance: SafetyService;
  private gonkaBaseUrl: string;
  private gonkaApiKey: string;
  private gonkaModel: string;
  private auditLog: Array<{ timestamp: string; input: string; result: SafetyResult }> = [];
  private readonly MAX_AUDIT_LOG = 1000;

  private constructor() {
    this.gonkaApiKey = process.env.GONKA_API_KEY || '';
    this.gonkaBaseUrl = (process.env.GONKA_BASE_URL || 'https://api.gonkarouter.io/v1').replace(/\/$/, '') + '/chat/completions';
    this.gonkaModel = process.env.GONKA_MODEL || 'zai-org/GLM-5.3-Flash';
  }

  public static getInstance(): SafetyService {
    if (!SafetyService.instance) SafetyService.instance = new SafetyService();
    return SafetyService.instance;
  }

  /**
   * Fast PII detection using regex (no LLM call).
   */
  public detectPII(text: string): { detected: boolean; types: string[] } {
    const types: string[] = [];
    for (const { name, pattern } of PII_PATTERNS) {
      pattern.lastIndex = 0; // reset regex state
      if (pattern.test(text)) types.push(name);
    }
    return { detected: types.length > 0, types };
  }

  /**
   * Redact PII from text for safe logging.
   */
  public redactPII(text: string): string {
    let redacted = text;
    for (const { name, pattern } of PII_PATTERNS) {
      pattern.lastIndex = 0;
      redacted = redacted.replace(pattern, `[REDACTED_${name.toUpperCase()}]`);
    }
    return redacted;
  }

  /**
   * Check if a message should be instantly blocked without LLM call.
   */
  private instantBlock(text: string): string | null {
    for (const pattern of INSTANT_BLOCK_PATTERNS) {
      if (pattern.test(text)) return `Request matches blocked content pattern: ${pattern.source.slice(0, 60)}`;
    }
    return null;
  }

  /**
   * Use Gonka to classify ambiguous or borderline content.
   * Only called when instant block patterns don't match.
   */
  private async classifyWithGonka(text: string): Promise<{ category: SafetyCategory; reason: string }> {
    if (!this.gonkaApiKey) return { category: 'safe', reason: 'Gonka not configured — defaulting to safe' };
    const systemPrompt = `You are a content safety classifier for an educational AI platform used by teachers and students.
Classify the user message and return ONLY valid JSON:
{
  "category": <"safe"|"borderline"|"harmful"|"illegal">,
  "reason": <one sentence explanation>
}
Categories:
- safe: normal educational or general use
- borderline: sensitive but not explicitly harmful (e.g. asking about historical violence for academic purposes)
- harmful: clearly harmful content (violence, hate speech, harassment)
- illegal: requests to help with illegal activities
Return safe for any normal educational, coding, math, writing, or professional task.`;
    try {
      const response = await fetchWithTimeout(this.gonkaBaseUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.gonkaApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.gonkaModel,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text.slice(0, 800) }],
          temperature: 0.0, max_tokens: 128, stream: false,
        }),
      }, 10_000);
      const data: any = await response.json();
      const raw = (data?.choices?.[0]?.message?.content || '').replace(/```json?/g, '').replace(/```/g, '').trim();
      const json = JSON.parse(raw);
      const category: SafetyCategory = ['safe', 'borderline', 'harmful', 'illegal'].includes(json.category) ? json.category : 'safe';
      return { category, reason: json.reason || '' };
    } catch (e) {
      logger.warn('SafetyService.classifyWithGonka error, defaulting to safe', e);
      return { category: 'safe', reason: 'Classification failed — defaulting to safe' };
    }
  }

  /**
   * Full safety scan of a user message.
   * Fast path: instant block patterns (no LLM).
   * Slow path: Gonka classification for ambiguous content.
   */
  public async scan(text: string): Promise<SafetyResult> {
    const pii = this.detectPII(text);

    // Fast path: instant block
    const blockReason = this.instantBlock(text);
    if (blockReason) {
      const result: SafetyResult = { category: 'illegal', blocked: true, reason: blockReason, piiDetected: pii.detected, piiTypes: pii.types };
      this.audit(text, result);
      return result;
    }

    // Fast path: very short or clearly safe messages skip LLM classification
    const looksRoutine = text.length < 20 || /^(hi|hello|thanks|thank you|ok|yes|no|great|help me with)/i.test(text.trim());
    if (looksRoutine) {
      return { category: 'safe', blocked: false, piiDetected: pii.detected, piiTypes: pii.types };
    }

    // Slow path: LLM classification
    const { category, reason } = await this.classifyWithGonka(text);
    const blocked = category === 'harmful' || category === 'illegal';
    const result: SafetyResult = { category, blocked, reason, piiDetected: pii.detected, piiTypes: pii.types };

    if (blocked) this.audit(text, result);
    return result;
  }

  /**
   * Scan AI output before sending to client.
   * Checks for accidental PII or harmful content in AI responses.
   */
  public scanOutput(text: string): { safe: boolean; redacted: string } {
    const pii = this.detectPII(text);
    if (!pii.detected) return { safe: true, redacted: text };
    logger.warn(`SafetyService: PII detected in AI output (${pii.types.join(', ')}) — redacting`);
    return { safe: false, redacted: this.redactPII(text) };
  }

  private audit(input: string, result: SafetyResult) {
    const redactedInput = this.redactPII(input);
    logger.warn(`[SAFETY AUDIT] blocked=${result.blocked} category=${result.category} reason=${result.reason} pii=${result.piiTypes.join(',')}`);
    this.auditLog.push({ timestamp: new Date().toISOString(), input: redactedInput.slice(0, 200), result });
    if (this.auditLog.length > this.MAX_AUDIT_LOG) this.auditLog.shift();
  }

  public getAuditLog() { return [...this.auditLog]; }
}
