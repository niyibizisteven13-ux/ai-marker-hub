import { PLANS, type PlanLimits, type PlanId } from './plans.js';
import { checkUsage } from './usage.js';

/**
 * Premium features in one place. Every route that starts premium work (chat, REST, background jobs)
 * asks here, so a feature cannot be reached through a side door.
 *
 * Autonomous marking (exam scripts, red-pen PDFs, reports) needs a plan with `autonomousMarking`
 * (GO, PRO and Institution by default; admins can change it per plan) and is then counted against the
 * plan's daily marking limit like any other AI action. MARKING_REQUIRES_UPGRADE=false opens it to every
 * plan, for a controlled rollout.
 */

export const markingRequiresUpgrade = () => (process.env.MARKING_REQUIRES_UPGRADE ?? 'true').toLowerCase() !== 'false';

export const markingEntitled = (limits: PlanLimits) => !markingRequiresUpgrade() || limits.autonomousMarking !== false;

export interface FeatureDecision {
  allowed: boolean;
  plan: PlanId;
  code?: 'UPGRADE_REQUIRED' | string;
  message?: string;
  upgradeUrl?: string;
}

const firstPlanWithMarking = (): PlanId => (['GO', 'PRO', 'INSTITUTION'] as PlanId[]).find((id) => PLANS[id].limits.autonomousMarking) ?? 'PRO';

/** May this user start marking work now: plan entitlement first, then the plan's limits and the admin pause. */
export async function canUseAutonomousMarking(userId: string): Promise<FeatureDecision> {
  const gate = await checkUsage(userId, { kind: 'marking' });
  if (!markingEntitled(gate.plan.limits)) {
    const next = PLANS[firstPlanWithMarking()];
    return {
      allowed: false, plan: gate.plan.id, code: 'UPGRADE_REQUIRED', upgradeUrl: '/upgrade?reason=marking',
      message: `Automatic marking of handwritten scripts (red-pen PDFs and reports) is part of the ${next.name}${next.id === 'GO' ? ', PRO and Institution plans' : ' plan'}. Upgrade at /upgrade?reason=marking to use it; your ${gate.plan.name} plan keeps scanning, reading documents and chat.`,
    };
  }
  if (!gate.allowed) return { allowed: false, plan: gate.plan.id, code: gate.code ?? 'LIMIT', message: gate.message, upgradeUrl: gate.upgrade?.url };
  return { allowed: true, plan: gate.plan.id };
}
