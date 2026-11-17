import type { Response } from 'express';
import { checkUsage, recordUsage, type GateResult } from './usage.js';
import type { UsageKind } from './plans.js';

/**
 * One gate for every AI feature that is not the chat itself (making a quiz from a file, making a form from a
 * description, marking written answers, summaries, translations). Before the model is called the user's plan
 * and credits are checked; if they are used up the answer is an "upgrade" message (HTTP 402) the app turns into a
 * button; after the call the credits are charged with the same meter as the chat, so web, Telegram and WhatsApp
 * all spend from one balance.
 */

export interface UpgradeBody {
  code: 'UPGRADE_REQUIRED' | 'UNAVAILABLE';
  error: string;
  upgrade?: { plan: string; url: string };
  /** Opens WhatsApp to the number the live room uses for payments, with a message ready (when that number is set). */
  whatsappLink?: string | null;
  plan?: string;
  resetsAt?: string;
}

/** What to send when a user is over their limit. Pure, for tests. */
export function upgradeBody(g: GateResult): { status: number; body: UpgradeBody } {
  const unavailable = g.code === 'PAUSED' || g.code === 'PROTECTED';
  return {
    status: unavailable ? 503 : 402,
    body: {
      code: unavailable ? 'UNAVAILABLE' : 'UPGRADE_REQUIRED',
      error: g.message ?? 'You have used your credits.',
      ...(g.upgrade ? { upgrade: { plan: g.upgrade.plan, url: g.upgrade.url } } : {}),
      plan: g.plan.id,
      ...(g.resetsAt ? { resetsAt: g.resetsAt } : {}),
    },
  };
}

/** A wa.me link to the payment number with a ready message. Pure, for tests. */
export const whatsappLinkFor = (number: string, planName: string) => `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(`Hello, I want to upgrade my Bwenge account (now on ${planName}). My email on Bwenge: ______`)}`;

/** Checks the limit; when the user is over it, answers with the upgrade message and returns false. */
export async function allowAi(res: Response, userId: string | undefined, kind: UsageKind = 'tool'): Promise<boolean> {
  if (!userId) { res.status(401).json({ error: 'Authentication required.' }); return false; }
  const g = await checkUsage(userId, { kind }).catch(() => null);
  if (!g || g.allowed) return true;
  const { status, body } = upgradeBody(g);
  if (status === 402) {
    const { paymentConfig } = await import('../mySebAccess.js');
    const number = (await paymentConfig().catch(() => null))?.whatsapp;
    body.whatsappLink = number ? whatsappLinkFor(number, g.plan.name) : null;
  }
  res.status(status).json(body);
  return false;
}

/** Rough tokens for a text (4 characters each), for charging calls whose provider does not report usage. */
export const estimateTokens = (text: string | number) => Math.ceil((typeof text === 'number' ? text : text.length) / 4);

/** Charges one AI action. `minCredits` is the fair price of the whole action (a quiz costs more than a translation). */
export async function chargeAi(userId: string, o: { kind?: UsageKind; input?: string | number; output?: string | number; minCredits?: number; channel?: 'web' | 'telegram' }): Promise<number> {
  return recordUsage(userId, {
    kind: o.kind ?? 'tool',
    inputTokens: o.input === undefined ? 0 : estimateTokens(o.input),
    outputTokens: o.output === undefined ? 0 : estimateTokens(o.output),
    minCredits: o.minCredits ?? 1,
    channel: o.channel as any,
  });
}

/** Fair prices, in credits, for the actions that have no token count of their own. */
export const AI_PRICE = { quizFromFile: 6, formFromDescription: 3, markOneWrittenAnswer: 1, summary: 1, translation: 1 } as const;
