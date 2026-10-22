import { TASK_CLASSES, type TaskClass } from './taskClassifier.js';

export interface ModelPolicyConfig {
  model: string;
  maxOutputTokens: number;
  /** Fallback used only for transient provider failures; undefined means no fallback. */
  fallbackModel?: string;
}

type Env = Record<string, string | undefined>;

const MODEL_ID = /^[\w.\-/:@]{1,128}$/;

function cleanModel(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v && MODEL_ID.test(v) ? v : undefined;
}

function intEnv(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Builds routing policies from environment variables.
 * Every class uses GONKA_MODEL unless a class-specific model is explicitly configured, so routing
 * never sends traffic to a model nobody has verified exists on the gateway.
 *
 *   GONKA_MODEL                default/standard model (required for Gonka)
 *   GONKA_ECONOMICAL_MODEL     optional: simple chat (greetings, short Q&A)
 *   GONKA_PREMIUM_MODEL        optional: complex reasoning and artifact specifications
 *   GONKA_FALLBACK_MODEL       optional: fallback for SIMPLE/STANDARD/DETERMINISTIC on transient failures
 *   AI_MAX_OUTPUT_TOKENS_{SIMPLE,STANDARD,COMPLEX}   optional output caps
 */
export function loadModelPolicies(env: Env = process.env, defaultModel = 'zai-org/GLM-5.3-Flash'): Record<TaskClass, ModelPolicyConfig> {
  const standard = cleanModel(env.GONKA_MODEL) ?? defaultModel;
  const economical = cleanModel(env.GONKA_ECONOMICAL_MODEL) ?? standard;
  const premium = cleanModel(env.GONKA_PREMIUM_MODEL) ?? standard;
  const fallback = cleanModel(env.GONKA_FALLBACK_MODEL);
  const simpleTokens = intEnv(env.AI_MAX_OUTPUT_TOKENS_SIMPLE, 1024);
  const standardTokens = intEnv(env.AI_MAX_OUTPUT_TOKENS_STANDARD, 4096);
  const complexTokens = intEnv(env.AI_MAX_OUTPUT_TOKENS_COMPLEX, 8192);

  return {
    // Falling back from the economical model to the standard one is an upgrade, so it is the default.
    SIMPLE: { model: economical, maxOutputTokens: simpleTokens, fallbackModel: fallback ?? (economical !== standard ? standard : undefined) },
    STANDARD: { model: standard, maxOutputTokens: standardTokens, fallbackModel: fallback },
    DETERMINISTIC: { model: standard, maxOutputTokens: standardTokens, fallbackModel: fallback },
    // Quality-sensitive work is never silently downgraded to a weaker model.
    COMPLEX: { model: premium, maxOutputTokens: complexTokens },
    ARTIFACT_SPEC: { model: premium, maxOutputTokens: complexTokens },
  };
}

export class ModelPolicyManager {
  private policies: Record<TaskClass, ModelPolicyConfig>;

  constructor(customPolicies?: Partial<Record<TaskClass, ModelPolicyConfig>>, env: Env = process.env) {
    this.policies = { ...loadModelPolicies(env), ...(customPolicies ?? {}) };
    for (const c of TASK_CLASSES) {
      if (!cleanModel(this.policies[c]?.model)) throw new Error(`Model policy for ${c} has no valid model id.`);
    }
  }

  getPolicy(taskClass: TaskClass): ModelPolicyConfig {
    return this.policies[taskClass] ?? this.policies.STANDARD;
  }

  getFallbackModel(taskClass: TaskClass): string | undefined {
    if (taskClass === 'COMPLEX' || taskClass === 'ARTIFACT_SPEC') return undefined;
    const p = this.getPolicy(taskClass);
    return p.fallbackModel && p.fallbackModel !== p.model ? p.fallbackModel : undefined;
  }
}
