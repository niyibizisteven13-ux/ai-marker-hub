import { prisma } from '../../db.js';
import { PLANS, planFor, type PlanId, type PlanInfo } from './plans.js';

/**
 * Storage sold with the plans: every file a user keeps (chat uploads, task files and the work students hand in
 * to their tasks) counts against the plan's storageMb. Files made for a while and then removed automatically
 * (marked papers, reports) do not count.
 */

const MB = 1024 * 1024;
const db = prisma as any;

export interface StorageState { usedBytes: number; files: number; limitBytes: number; plan: PlanInfo }

export async function storageState(userId: string): Promise<StorageState> {
  const plan = await planFor(userId);
  const agg = await db.fileRecord.aggregate({ where: { userId }, _sum: { size: true }, _count: { _all: true } }).catch(() => null);
  return { usedBytes: Number(agg?._sum?.size ?? 0), files: Number(agg?._count?._all ?? 0), limitBytes: plan.limits.storageMb * MB, plan };
}

export const formatSize = (bytes: number) => (bytes >= 1024 * MB ? `${(bytes / (1024 * MB)).toFixed(bytes >= 10 * 1024 * MB ? 0 : 1)} GB` : `${Math.max(bytes ? 1 : 0, Math.round(bytes / MB))} MB`);

/** The next plan with more storage, for the message. */
function biggerPlan(plan: PlanInfo): PlanInfo | null {
  const order: PlanId[] = ['STARTER', 'PRO', 'PLUS'];
  return order.map((id) => PLANS[id]).find((p) => p.limits.storageMb > plan.limits.storageMb) ?? null;
}

export class StorageFullError extends Error {
  readonly code = 'STORAGE_FULL';
  readonly status = 413;
  constructor(message: string, readonly upgrade: { plan: PlanId; url: string } | null) { super(message); }
}

/**
 * Refuses adding `bytes` when it would take the user past their storage. `forOthers` words the message for
 * someone handing in to this user's task (they cannot upgrade; the owner can).
 */
export async function ensureStorage(userId: string, bytes: number, opts: { forOthers?: boolean } = {}): Promise<void> {
  const s = await storageState(userId);
  if (s.usedBytes + bytes <= s.limitBytes) return;
  const next = biggerPlan(s.plan);
  if (opts.forOthers) throw new StorageFullError('The person who shared this task has no storage left for new files. Let them know; your answer was not sent.', null);
  throw new StorageFullError(
    `Your storage is full: ${formatSize(s.usedBytes)} of ${formatSize(s.limitBytes)} on the ${s.plan.name} plan. Delete files you no longer need${next ? `, or move to ${next.name} for ${formatSize(next.limits.storageMb * MB)}` : ''}.`,
    next ? { plan: next.id, url: '/upgrade?reason=storage' } : null,
  );
}

/** What the Usage page shows. */
export async function storageSummary(userId: string) {
  const s = await storageState(userId);
  return { usedMb: Math.round((s.usedBytes / MB) * 10) / 10, usedBytes: s.usedBytes, limitMb: s.plan.limits.storageMb, files: s.files };
}
