import { ModelPolicyManager } from './modelPolicy.js';
import { TaskClassifier, type ClassificationContext, type RoutingReasonCode, type TaskClass } from './taskClassifier.js';

export type { TaskClass } from './taskClassifier.js';

export interface RoutingDecision {
  taskClass: TaskClass;
  reasonCode: RoutingReasonCode;
  model: string;
  /** null = fallback disabled for this request. */
  fallbackModel: string | null;
  maxOutputTokens: number;
}

export interface RouteContext extends ClassificationContext {
  /** Requests with images may only fall back to a model known to accept images. */
  hasImages?: boolean;
}

/**
 * Chooses a model per request from the task class. Disabled with AI_MODEL_ROUTING=off,
 * in which case every request uses the STANDARD policy (the pre-routing behaviour).
 */
export class TaskRouter {
  constructor(
    private policies = new ModelPolicyManager(),
    private classifier = new TaskClassifier(),
    private enabled = (process.env.AI_MODEL_ROUTING ?? 'on').toLowerCase() !== 'off',
    private fallbackSupportsVision = process.env.GONKA_FALLBACK_SUPPORTS_VISION === 'true',
  ) {}

  route(ctx: RouteContext): RoutingDecision {
    const { taskClass, reasonCode } = this.enabled
      ? this.classifier.classifyWithReason(ctx)
      : { taskClass: 'STANDARD' as const, reasonCode: 'DEFAULT' as const };
    const policy = this.policies.getPolicy(taskClass);
    const fallback = this.policies.getFallbackModel(taskClass);
    return {
      taskClass,
      reasonCode,
      model: policy.model,
      fallbackModel: fallback && (!ctx.hasImages || this.fallbackSupportsVision) ? fallback : null,
      maxOutputTokens: policy.maxOutputTokens,
    };
  }
}
