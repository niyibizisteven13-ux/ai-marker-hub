import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { prisma } from '../../db.js';
import logger from '../../utils/logger.js';
import { platformSettings } from './settings.js';

/**
 * Failed sign-in attempts, for the administrator's security view. Only failures are kept (with the address they came from, so it can be
 * blocked), and the view deletes anything older than 30 days.
 */
export const clientIp = (req: Pick<Request, 'ip' | 'headers'>) => String(req.ip || (req.headers?.['x-forwarded-for'] as string | undefined)?.split(',')[0] || '').replace(/^::ffff:/, '').slice(0, 64);

export async function recordAuthFailure(req: Pick<Request, 'ip' | 'headers'>, type: string, detail: { email?: string; userId?: string | null } = {}): Promise<void> {
  try {
    const ip = clientIp(req);
    await (prisma as any).authEvent.create({ data: {
      userId: detail.userId ?? null, type,
      ipHash: ip ? createHash('sha256').update(ip).digest() : null,
      meta: JSON.stringify({ ip, email: detail.email ? String(detail.email).slice(0, 120) : undefined }),
    } });
  } catch (e) { logger.warn('[security] could not record a failed sign-in', { error: (e as Error)?.message }); }
}

/** Is this address on the administrator's block list? (exact address, or a prefix ending in a dot such as "41.186.") */
export function isBlockedIp(ip: string, list = platformSettings().blockedIps): boolean {
  if (!ip || !list.length) return false;
  return list.some((b) => (b.endsWith('.') || b.endsWith(':') ? ip.startsWith(b) : ip === b));
}
