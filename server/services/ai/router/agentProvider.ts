type Env = Record<string, string | undefined>;

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Claude configuration for agent tasks (tool loops, structured assessment, report interpretation). */
export interface ClaudeAgentConfig {
  apiKey: string;
  model: string;
  effort: Effort;
  /** On transient Claude failures, answer with Gonka's standard model instead of failing. */
  fallbackToGonka: boolean;
  /** Requests with images may go to Claude (Claude models accept images). */
  supportsVision: boolean;
  /** Examination marking (scheme reading, handwriting, marking). Same as `model` unless CLAUDE_MARKING_MODEL is set. */
  markingModel: string;
  markingEffort: Effort;
  /** Reading handwriting (page images to text). Needs good eyesight rather than judgement, so by default a
   * cheaper model than an Opus/Fable marking model: CLAUDE_READING_MODEL, else Sonnet, else the marking model. */
  readingModel: string;
  readingEffort: Effort;
}

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const MODEL_ID = /^[\w.\-/:@]{1,128}$/;

/**
 * AI_AGENT_PROVIDER=anthropic routes agent tasks to Claude (default model claude-haiku-5-5);
 * anything else (default "gonka") keeps them on Gonka. Opt-in, so enabling a key never changes
 * billing silently. Everyday chat is unaffected either way.
 *
 *   ANTHROPIC_API_KEY, CLAUDE_AGENT_MODEL (default claude-haiku-5-5), CLAUDE_EFFORT (default medium),
 *   CLAUDE_FALLBACK_TO_GONKA (default true)
 *   CLAUDE_MARKING_MODEL (default: the agent model; e.g. claude-opus-5-5 for more accurate marking),
 *   CLAUDE_MARKING_EFFORT (default: CLAUDE_EFFORT)
 *   CLAUDE_READING_MODEL (default: claude-sonnet-5-5 when marking uses Opus/Fable/Mythos, else the marking model),
 *   CLAUDE_READING_EFFORT (default: medium)
 */
export function loadClaudeAgentConfig(env: Env = process.env): { config: ClaudeAgentConfig | null; reason: string } {
  const provider = (env.AI_AGENT_PROVIDER ?? 'gonka').trim().toLowerCase();
  if (provider !== 'anthropic' && provider !== 'claude') return { config: null, reason: 'agent tasks use Gonka (AI_AGENT_PROVIDER is not "anthropic")' };
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { config: null, reason: 'AI_AGENT_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set; agent tasks stay on Gonka' };
  const model = (env.CLAUDE_AGENT_MODEL ?? 'claude-haiku-5-5').trim();
  if (!MODEL_ID.test(model)) return { config: null, reason: 'CLAUDE_AGENT_MODEL is not a valid model id; agent tasks stay on Gonka' };
  const effortRaw = (env.CLAUDE_EFFORT ?? 'medium').trim().toLowerCase() as Effort;
  const effort = EFFORTS.includes(effortRaw) ? effortRaw : 'medium';
  const notes: string[] = [];
  if (!EFFORTS.includes(effortRaw)) notes.push(`CLAUDE_EFFORT "${env.CLAUDE_EFFORT}" is invalid; using medium`);
  let markingModel = env.CLAUDE_MARKING_MODEL?.trim() || model;
  if (!MODEL_ID.test(markingModel)) { notes.push('CLAUDE_MARKING_MODEL is not a valid model id; marking uses the agent model'); markingModel = model; }
  const markingEffortRaw = (env.CLAUDE_MARKING_EFFORT ?? '').trim().toLowerCase() as Effort;
  const markingEffort = EFFORTS.includes(markingEffortRaw) ? markingEffortRaw : effort;
  let readingModel = env.CLAUDE_READING_MODEL?.trim() || (/opus|fable|mythos/i.test(markingModel) ? 'claude-sonnet-5-5' : markingModel);
  if (!MODEL_ID.test(readingModel)) { notes.push('CLAUDE_READING_MODEL is not a valid model id; reading uses the marking model'); readingModel = markingModel; }
  const readingEffortRaw = (env.CLAUDE_READING_EFFORT ?? '').trim().toLowerCase() as Effort;
  const readingEffort = EFFORTS.includes(readingEffortRaw) ? readingEffortRaw : 'medium';
  return {
    config: { apiKey, model, effort, fallbackToGonka: (env.CLAUDE_FALLBACK_TO_GONKA ?? 'true').toLowerCase() !== 'false', supportsVision: true, markingModel, markingEffort, readingModel, readingEffort },
    reason: notes.length ? `claude (${notes.join('; ')})` : 'claude',
  };
}
