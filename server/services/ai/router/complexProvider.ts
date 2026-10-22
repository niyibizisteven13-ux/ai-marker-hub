type Env = Record<string, string | undefined>;

/** A second, OpenAI-compatible provider used only for big tasks (COMPLEX and ARTIFACT_SPEC). */
export interface ComplexProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** On transient failure, answer with Gonka instead of failing the request. */
  fallbackToGonka: boolean;
  /** Whether requests with images may be sent to this provider. */
  supportsVision: boolean;
}

const MODEL_ID = /^[\w.\-/:@]{1,128}$/;

/**
 * Reads the big-task provider from env. Returns `config: null` (with a reason) when it is off or incomplete,
 * in which case every request stays on Gonka.
 *
 *   AI_COMPLEX_PROVIDER=gonka (default) | deepseek | openrouter
 *   deepseek:   DEEPSEEK_API_KEY, DEEPSEEK_COMPLEX_MODEL (default deepseek-chat), DEEPSEEK_BASE_URL (default https://api.deepseek.com/v1)
 *   openrouter: OPENROUTER_API_KEY, OPENROUTER_COMPLEX_MODEL (required)
 *   AI_COMPLEX_FALLBACK_TO_GONKA=true (default) | false
 *   AI_COMPLEX_SUPPORTS_VISION=false (default) | true
 */
export function loadComplexProvider(env: Env = process.env): { config: ComplexProviderConfig | null; reason: string } {
  const kind = (env.AI_COMPLEX_PROVIDER ?? 'gonka').trim().toLowerCase();
  const common = {
    fallbackToGonka: (env.AI_COMPLEX_FALLBACK_TO_GONKA ?? 'true').toLowerCase() !== 'false',
    supportsVision: env.AI_COMPLEX_SUPPORTS_VISION === 'true',
  };
  if (kind === 'gonka' || kind === '') return { config: null, reason: 'big tasks use Gonka (AI_COMPLEX_PROVIDER=gonka)' };

  if (kind === 'deepseek') {
    const apiKey = env.DEEPSEEK_API_KEY?.trim();
    const model = (env.DEEPSEEK_COMPLEX_MODEL ?? 'deepseek-chat').trim();
    if (!apiKey) return { config: null, reason: 'AI_COMPLEX_PROVIDER=deepseek but DEEPSEEK_API_KEY is not set' };
    if (!MODEL_ID.test(model)) return { config: null, reason: 'DEEPSEEK_COMPLEX_MODEL is not a valid model id' };
    return { config: { name: 'DeepSeek', baseUrl: env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com/v1', apiKey, model, ...common }, reason: 'deepseek' };
  }

  if (kind === 'openrouter') {
    const apiKey = env.OPENROUTER_API_KEY?.trim();
    const model = env.OPENROUTER_COMPLEX_MODEL?.trim() ?? '';
    if (!apiKey) return { config: null, reason: 'AI_COMPLEX_PROVIDER=openrouter but OPENROUTER_API_KEY is not set' };
    if (!MODEL_ID.test(model)) return { config: null, reason: 'AI_COMPLEX_PROVIDER=openrouter needs OPENROUTER_COMPLEX_MODEL' };
    return { config: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey, model, ...common }, reason: 'openrouter' };
  }

  return { config: null, reason: `unknown AI_COMPLEX_PROVIDER "${kind}"` };
}
