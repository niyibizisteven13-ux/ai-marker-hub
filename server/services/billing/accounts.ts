import { prisma } from '../../db.js';
import logger from '../../utils/logger.js';

/**
 * One account across web and Telegram. Before linking, a Telegram chat uses a placeholder account
 * (email ending in @users.invalid). When the chat is linked to a real Bwenge account, everything the placeholder
 * built up moves over (usage, GO credits, memories, payments, generated files), so limits, credits, memory
 * and files are shared between the website and the bot from then on.
 */
const db = prisma as any;
const TABLES = ['usageRecord', 'creditLedger', 'memoryVector', 'billingPayment', 'generatedArtifact'] as const;

export async function mergePlaceholderAccount(fromUserId: string, toUserId: string): Promise<Record<string, number>> {
  if (!fromUserId || !toUserId || fromUserId === toUserId) return {};
  const from = await db.user.findUnique({ where: { id: fromUserId }, select: { email: true } }).catch(() => null);
  if (!from || !String(from.email).endsWith('@users.invalid')) return {}; // only placeholder accounts are merged
  const moved: Record<string, number> = {};
  for (const t of TABLES) {
    try {
      const r = await db[t].updateMany({ where: { userId: fromUserId }, data: { userId: toUserId } });
      moved[t] = Number(r?.count ?? 0);
    } catch (e) {
      logger.warn('[accounts] merge step failed', { table: t, errorType: (e as Error)?.name });
    }
  }
  logger.info('[accounts] Telegram placeholder merged into linked account', { moved });
  return moved;
}
