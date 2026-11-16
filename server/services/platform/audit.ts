import { prisma } from '../../db.js';
import logger from '../../utils/logger.js';

/** One line in the administrator's audit log. Never throws: a logging problem must not stop the action that was just done. */
export async function auditAction(actorId: string, action: string, resourceType: string, resourceId?: string | null, details?: unknown): Promise<void> {
  try {
    await (prisma as any).auditLog.create({ data: { actorId, action, resourceType, resourceId: resourceId ?? null, details: details === undefined ? null : JSON.stringify(details).slice(0, 4000) } });
  } catch (e) { logger.warn('[audit] could not write', { action, error: (e as Error)?.message }); }
}
