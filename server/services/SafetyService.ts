import { AiService } from './AiService.js';
import logger from '../utils/logger.js';
import { parseModelJson } from '../utils/textSanitizers.js';

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
  private auditLog: Array<{ timestamp: string; input: string; result: SafetyResult }> = [];
  private readonly MAX_AUDIT_LOG = 1000;

  private constructor() {}

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
   * Use Claude to classify ambiguous or borderline content.
   * Only called when instant block patterns don't match.
   */
  private async classifyWithClaude(text: string): Promise<{ category: SafetyCategory; reason: string }> {
    if (!process.env.ANTHROPIC_API_KEY) return { category: 'safe', reason: 'Claude not configured — defaulting to safe' };
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
      const raw = (await AiService.getInstance().completeText(text.slice(0, 800), { system: systemPrompt, maxTokens: 256, timeoutMs: 10_000 })).trim();
      const json = parseModelJson(raw);
      const category: SafetyCategory = ['safe', 'borderline', 'harmful', 'illegal'].includes(json.category) ? json.category : 'safe';
      return { category, reason: json.reason || '' };
    } catch (e) {
      logger.warn('SafetyService.classifyWithClaude error, defaulting to safe', e);
      return { category: 'safe', reason: 'Classification failed — defaulting to safe' };
    }
  }

  /**
   * Full safety scan of a user message.
   * Fast path: instant block patterns (no LLM).
   * Slow path: Claude classification for ambiguous content.
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
    const { category, reason } = await this.classifyWithClaude(text);
    const blocked = category === 'harmful' || category === 'illegal';
    const result: SafetyResult = { category, blocked, reason, piiDetected: pii.detected, piiTypes: pii.types };

    if (blocked) this.audit(text, result);
    return result;
  }

  /**
   * The checks that cost nothing (blocked patterns, personal data), so a reply never waits for a classifier.
   * The model itself declines harmful requests; the slower classification runs afterwards with reviewLater.
   */
  public quickScan(text: string): SafetyResult {
    const pii = this.detectPII(text);
    const blockReason = this.instantBlock(text);
    if (blockReason) {
      const result: SafetyResult = { category: 'illegal', blocked: true, reason: blockReason, piiDetected: pii.detected, piiTypes: pii.types };
      this.audit(text, result);
      return result;
    }
    return { category: 'safe', blocked: false, piiDetected: pii.detected, piiTypes: pii.types };
  }

  /** Classifies the message in the background and records it in the audit log when it looks harmful. Never throws. */
  public reviewLater(text: string): void {
    const looksRoutine = text.length < 20 || /^(hi|hello|thanks|thank you|ok|yes|no|great|help me with)/i.test(text.trim());
    if (looksRoutine || !process.env.ANTHROPIC_API_KEY) return;
    void this.classifyWithClaude(text).then(({ category, reason }) => {
      if (category === 'harmful' || category === 'illegal') {
        const pii = this.detectPII(text);
        this.audit(text, { category, blocked: false, reason: `flagged after reply: ${reason}`, piiDetected: pii.detected, piiTypes: pii.types });
      }
    }).catch(() => undefined);
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
