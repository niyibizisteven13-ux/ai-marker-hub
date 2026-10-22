import { ModelPolicyManager } from './modelPolicy.js';
import { TaskClassifier, type ClassificationContext, type RoutingReasonCode, type TaskClass } from './taskClassifier.js';
import type { ComplexProviderConfig } from './complexProvider.js';

export type { TaskClass } from './taskClassifier.js';

export interface RoutingDecision {
  taskClass: TaskClass;
  reasonCode: RoutingReasonCode;
  /** Provider label for logs: "gonka" or the big-task provider's name. */
  provider: string;
  model: string;
  /**
   * Per-request fallback model. null = no fallback; undefined = use the adapter's own fallback
   * (the big-task provider falls back to Gonka when AI_COMPLEX_FALLBACK_TO_GONKA is on).
   */
  fallbackModel: string | null | undefined;
  maxOutputTokens: number;
}

export interface RouteContext extends ClassificationContext {
  /** Requests with images may only fall back to a model known to accept images. */
  hasImages?: boolean;
}

const BIG_TASKS = new Set<TaskClass>(['COMPLEX', 'ARTIFACT_SPEC']);

/**
 * Chooses a model per request from the task class. Everyday chat stays on Gonka; COMPLEX and ARTIFACT_SPEC
 * go to the big-task provider when one is configured. Disabled with AI_MODEL_ROUTING=off, in which case
 * every request uses the STANDARD Gonka policy (the pre-routing behaviour).
 */
export class TaskRouter {
  constructor(
    private policies = new ModelPolicyManager(),
    private classifier = new TaskClassifier(),
    private enabled = (process.env.AI_MODEL_ROUTING ?? 'on').toLowerCase() !== 'off',
    private fallbackSupportsVision = process.env.GONKA_FALLBACK_SUPPORTS_VISION === 'true',
    private complex: ComplexProviderConfig | null = null,
  ) {}

  route(ctx: RouteContext): RoutingDecision {
    const { taskClass, reasonCode } = this.enabled
      ? this.classifier.classifyWithReason(ctx)
      : { taskClass: 'STANDARD' as const, reasonCode: 'DEFAULT' as const };
    const policy = this.policies.getPolicy(taskClass);

    if (this.complex && BIG_TASKS.has(taskClass) && (!ctx.hasImages || this.complex.supportsVision)) {
      return { taskClass, reasonCode, provider: this.complex.name, model: this.complex.model, fallbackModel: undefined, maxOutputTokens: policy.maxOutputTokens };
    }

    const fallback = this.policies.getFallbackModel(taskClass);
    return {
      taskClass,
      reasonCode,
      provider: 'gonka',
      model: policy.model,
      fallbackModel: fallback && (!ctx.hasImages || this.fallbackSupportsVision) ? fallback : null,
      maxOutputTokens: policy.maxOutputTokens,
    };
  }
}
