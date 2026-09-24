import { PrismaClient } from '@prisma/client';
import { PlanPolicy } from './types.js';
import { IndividualPlanPolicy } from './IndividualPlan.js';
import { OrganizationPlanPolicy } from './OrganizationPlan.js';
import { BusinessPlanPolicy } from './BusinessPlan.js';

const prisma = new PrismaClient();

export async function resolvePlanPolicy(userId: string): Promise<PlanPolicy> {
  const membership = await prisma.organizationMember.findFirst({
    where: { userId }
  });

  if (membership) {
    return new OrganizationPlanPolicy(membership.organizationId);
  }

  // Check for Business subscription
  const subscription = await prisma.subscription.findUnique({
    where: { userId }
  });

  if (subscription && subscription.status === 'ACTIVE') {
    return new BusinessPlanPolicy();
  }

  // Fallback to individual plan
  return new IndividualPlanPolicy();
}
