import { TaskClass } from './taskClassifier.js';

export interface ModelPolicyConfig {
  model: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  timeoutMs: number;
  retryBudget: number;
  fallbackModel?: string;
}

export const DEFAULT_MODEL_POLICIES: Record<TaskClass, ModelPolicyConfig> = {
  SIMPLE: {
    model: process.env.GONKA_ECONOMICAL_MODEL || 'zai-org/GLM-5.3-Flash-Lite',
    maxInputTokens: 4096,
    maxOutputTokens: 1024,
    timeoutMs: 15_000,
    retryBudget: 1,
  },
  STANDARD: {
    model: process.env.GONKA_MODEL || 'zai-org/GLM-5.3-Flash',
    maxInputTokens: 16384,
    maxOutputTokens: 4096,
    timeoutMs: 30_000,
    retryBudget: 3,
    fallbackModel: process.env.GONKA_ECONOMICAL_MODEL,
  },
  COMPLEX: {
    model: process.env.GONKA_PREMIUM_MODEL || 'zai-org/GLM-4.6-Reasoning',
    maxInputTokens: 65536,
    maxOutputTokens: 8192,
    timeoutMs: 60_000,
    retryBudget: 3,
  },
  DETERMINISTIC: {
    model: process.env.GONKA_MODEL || 'zai-org/GLM-5.3-Flash',
    maxInputTokens: 8192,
    maxOutputTokens: 2048,
    timeoutMs: 20_000,
    retryBudget: 2,
  },
  ARTIFACT_SPEC: {
    model: process.env.GONKA_PREMIUM_MODEL || 'zai-org/GLM-4.6-Reasoning',
    maxInputTokens: 32768,
    maxOutputTokens: 8192,
    timeoutMs: 60_000,
    retryBudget: 3,
  },
};

/**
 * Validates and enforces model policies, fallback rules, and data-policy checks.
 */
export class ModelPolicyManager {
  private policies: Record<TaskClass, ModelPolicyConfig>;

  constructor(customPolicies?: Partial<Record<TaskClass, ModelPolicyConfig>>) {
    this.policies = { ...DEFAULT_MODEL_POLICIES, ...(customPolicies ?? {}) };
    this.validatePolicies();
  }

  private validatePolicies() {
    for (const [taskClass, policy] of Object.entries(this.policies)) {
      if (!policy.model) {
        console.warn(`[ModelPolicy] Warning: Model for task class ${taskClass} is unconfigured.`);
      }
    }
  }

  getPolicy(taskClass: TaskClass): ModelPolicyConfig {
    return this.policies[taskClass] ?? this.policies.STANDARD;
  }

  getFallbackModel(taskClass: TaskClass): string | undefined {
    // Never allow silent or automatic downgrade for COMPLEX or ARTIFACT_SPEC
    if (taskClass === 'COMPLEX' || taskClass === 'ARTIFACT_SPEC') {
      return undefined;
    }
    return this.policies[taskClass]?.fallbackModel;
  }
}
