import { randomUUID } from 'node:crypto';
import { prisma } from '../../db.js';
import logger from '../../utils/logger.js';
import { EmailService } from '../EmailService.js';
import { PLANS, SOLD_PLANS, currentGoPacks, fxUsdRwf, planFor, planIdForSubscription, refreshBillingSettings, subscriptionTypeFor, walletBalance, type SoldPlanId } from './plans.js';
import { MomoError, momoConfig, momoReady, normalizeMsisdn, paymentStatus, requestToPay } from './momo.js';
import { expiredEmail, paymentFailedEmail, receiptEmail, renewalReminderEmail, type Email } from './emails.js';

/**
 * Plan and credit purchases over MTN Mobile Money.
 *
 * start → MTN asks the payer to approve on their phone → status is confirmed by asking MTN (callback, the
 * user's page polling, and a background poller all call check()) → fulfil() exactly once: Starter / Pro /
 * Pro Plus time is extended or GO credits are added, a receipt number is issued, and the receipt goes out by email and
 * Telegram. Amounts always come from the server's price list, never from the browser.
 */

const db = prisma as any;
const PENDING_TTL_MS = 15 * 60_000;
const MONTH_MS = 30 * 86_400_000;

/** A plan sold online, or a GO credit top-up. */
export type Purpose = SoldPlanId | 'GO_PACK';
export const PURPOSES: readonly Purpose[] = [...SOLD_PLANS, 'GO_PACK'];
export class BillingError extends Error {
  constructor(message: string, public status = 400, public code = 'BILLING_ERROR') { super(message); }
}

export interface Quote { purpose: Purpose; item: string; months: number; credits: number; amountRwf: number; amountUsd: number; packId?: string }

export async function quote(purpose: Purpose, opts: { packId?: string; months?: number } = {}): Promise<Quote> {
  await refreshBillingSettings();
  const months = Math.min(12, Math.max(1, Math.round(opts.months ?? 1)));
  if (purpose === 'GO_PACK') {
    const pack = currentGoPacks().find((p) => p.id === opts.packId);
    if (!pack) throw new BillingError('Choose a GO credit pack.', 400, 'INVALID_PACK');
    return { purpose, item: `GO credits · ${pack.credits.toLocaleString('en-US')} credits`, months: 0, credits: pack.credits, amountRwf: pack.rwf, amountUsd: Math.round((pack.rwf / fxUsdRwf()) * 100) / 100, packId: pack.id };
  }
  const plan = (SOLD_PLANS as readonly string[]).includes(purpose) ? PLANS[purpose] : null;
  if (!plan?.priceRwf) throw new BillingError('This plan is not available for online payment.', 400, 'INVALID_PLAN');
  const amountRwf = plan.priceRwf * months;
  return { purpose, item: `${plan.name} plan · ${months} month${months > 1 ? 's' : ''}`, months, credits: 0, amountRwf, amountUsd: Math.round((amountRwf / fxUsdRwf()) * 100) / 100 };
}

export function publicPayment(p: any) {
  return {
    id: p.id, purpose: p.purpose, packId: p.packId, months: p.months, credits: p.credits, amountRwf: p.amountRwf, amountUsd: p.amountUsd, currency: p.currency,
    phoneMasked: p.phoneMasked, status: p.status, reason: p.providerReason, receiptNumber: p.receiptNumber, transactionId: p.financialTransactionId,
    createdAt: new Date(p.createdAt).toISOString(), paidAt: p.fulfilledAt ? new Date(p.fulfilledAt).toISOString() : null,
  };
}

/** Starts a Mobile Money payment; the payer approves it on their phone. */
export async function startPayment(userId: string, input: { purpose: Purpose; packId?: string; months?: number; phone: string }) {
  if (!momoReady()) throw new BillingError('Mobile Money payments are being set up. Please try again soon.', 503, 'NOT_CONFIGURED');
  const q = await quote(input.purpose, input);
  let phone;
  try { phone = normalizeMsisdn(input.phone); } catch (e) { throw new BillingError((e as Error).message, 400, 'INVALID_PHONE'); }
  // One request at a time: a second tap while the phone prompt is open would charge twice.
  const recent = await db.billingPayment.findFirst({ where: { userId, status: 'PENDING', createdAt: { gte: new Date(Date.now() - 2 * 60_000) } }, orderBy: { createdAt: 'desc' } });
  if (recent) return { payment: publicPayment(recent), reused: true };

  const id = randomUUID();
  const currency = momoConfig().currency;
  const row = await db.billingPayment.create({
    data: { id, userId, purpose: q.purpose, packId: q.packId ?? null, months: q.months, credits: q.credits, amountRwf: q.amountRwf, amountUsd: q.amountUsd, currency, provider: 'MTN_MOMO', phoneMasked: phone.masked, status: 'PENDING', checks: 0, fulfilledAt: null, emailedAt: null, receiptNumber: null, financialTransactionId: null, providerStatus: null, providerReason: null, createdAt: new Date(), updatedAt: new Date() },
  });
  try {
    await requestToPay({ referenceId: id, amount: q.amountRwf, msisdn: phone.msisdn, externalId: id.slice(0, 18).replace(/-/g, ''), payerMessage: `Bwenge AI: ${q.item}`, payeeNote: `Bwenge ${q.purpose} ${userId.slice(0, 8)}` });
  } catch (e) {
    const err = e instanceof MomoError ? e : new MomoError('Mobile Money could not start the payment.');
    await db.billingPayment.update({ where: { id }, data: { status: 'FAILED', providerReason: err.code, updatedAt: new Date() } });
    throw new BillingError(err.message, err.status, err.code);
  }
  return { payment: publicPayment(row), reused: false };
}

/** Confirms a payment with MTN and fulfils it on success. Safe to call any number of times. */
export async function checkPayment(paymentId: string, userId?: string) {
  const p = await db.billingPayment.findUnique({ where: { id: paymentId } });
  if (!p || (userId && p.userId !== userId)) throw new BillingError('Payment not found.', 404, 'NOT_FOUND');
  if (p.status !== 'PENDING') return publicPayment(p);
  const r = await paymentStatus(p.id);
  if (r.status === 'SUCCESSFUL') return publicPayment(await fulfil(p, r.financialTransactionId));
  const expired = Date.now() - new Date(p.createdAt).getTime() > PENDING_TTL_MS;
  if (r.status === 'FAILED' || expired) {
    const status = r.status === 'FAILED' ? 'FAILED' : 'EXPIRED';
    const done = await db.billingPayment.updateMany({ where: { id: p.id, status: 'PENDING' }, data: { status, providerStatus: r.status, providerReason: r.reason ?? (expired ? 'EXPIRED' : null), checks: (p.checks ?? 0) + 1, updatedAt: new Date() } });
    const after = await db.billingPayment.findUnique({ where: { id: p.id } });
    if (Number(done?.count ?? 0) > 0) void notifyFailed(after).catch(() => undefined);
    return publicPayment(after);
  }
  await db.billingPayment.update({ where: { id: p.id }, data: { checks: (p.checks ?? 0) + 1, updatedAt: new Date() } });
  return publicPayment({ ...p, checks: (p.checks ?? 0) + 1 });
}

const receiptNumberFor = (p: any, at: Date) => `BW-${at.toISOString().slice(0, 10).replace(/-/g, '')}-${String(p.id).replace(/-/g, '').slice(0, 6).toUpperCase()}`;

/** Grants what was paid for, exactly once (the first caller wins the conditional update). */
export async function fulfil(p: any, financialTransactionId?: string) {
  const now = new Date();
  const won = await db.billingPayment.updateMany({
    where: { id: p.id, fulfilledAt: null },
    data: { status: 'SUCCESSFUL', providerStatus: 'SUCCESSFUL', fulfilledAt: now, receiptNumber: receiptNumberFor(p, now), financialTransactionId: financialTransactionId ?? null, updatedAt: now },
  });
  if (Number(won?.count ?? 0) === 0) return db.billingPayment.findUnique({ where: { id: p.id } });

  if (p.purpose === 'GO_PACK') {
    await db.creditLedger.create({ data: { id: randomUUID(), userId: p.userId, delta: p.credits, reason: 'purchase', paymentId: p.id, note: p.packId, createdAt: now } });
  } else {
    // Older payments may say INSTITUTION; they keep granting that plan.
    const planType = subscriptionTypeFor(planIdForSubscription(p.purpose) ?? 'PRO');
    const sub = await db.subscription.findUnique({ where: { userId: p.userId } });
    const stillActive = sub && sub.status === 'ACTIVE' && sub.planType === planType && sub.endDate && new Date(sub.endDate).getTime() > now.getTime();
    const from = stillActive ? new Date(sub.endDate).getTime() : now.getTime();
    const endDate = new Date(from + Math.max(1, p.months) * MONTH_MS);
    if (sub) await db.subscription.update({ where: { userId: p.userId }, data: { planType, status: 'ACTIVE', endDate, ...(stillActive ? {} : { startDate: now }) } });
    else await db.subscription.create({ data: { id: randomUUID(), userId: p.userId, planType, status: 'ACTIVE', startDate: now, endDate, createdAt: now, updatedAt: now } });
  }
  const done = await db.billingPayment.findUnique({ where: { id: p.id } });
  // The assistant sees the new plan and credits on the very next message (imported lazily: platformContext imports this file).
  void import('../platformContext.js').then((m) => m.invalidatePlatformContext(p.userId)).catch(() => undefined);
  void notifyReceipt(done).catch((e) => logger.warn('[billing] receipt notification failed', { errorType: e?.name }));
  logger.info('[billing] payment fulfilled', { paymentId: p.id, purpose: p.purpose });
  return done;
}

// ── Notifications (each sent once; NotificationLog keys) ─────────────────────
async function once(key: string, userId: string, channel: 'email' | 'telegram', send: () => Promise<boolean>) {
  if (await db.notificationLog.findUnique({ where: { key } }).catch(() => null)) return false;
  const ok = await send().catch(() => false);
  if (ok) await db.notificationLog.create({ data: { id: randomUUID(), key, userId, channel, createdAt: new Date() } }).catch(() => undefined);
  return ok;
}

async function contact(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }).catch(() => null);
  const email = user?.email && !String(user.email).endsWith('@users.invalid') ? user.email : null;
  const telegram = await db.telegramSession.findFirst({ where: { userId } }).catch(() => null);
  return { name: user?.name?.split(' ')[0] ?? '', email, chatId: telegram?.chatId ?? null };
}

const sendMail = async (to: string | null, e: Email) => (to ? (await EmailService.getInstance().sendEmail({ to, ...e })).success : false);
async function sendTelegram(chatId: string | null, html: string, button?: { text: string; url: string }) {
  if (!chatId) return false;
  const { telegramApi } = await import('../telegram/api.js');
  await telegramApi().sendMessage(chatId, html, button ? { keyboard: { inline_keyboard: [[button]] } } : {});
  return true;
}
const appUrl = () => (process.env.APP_BASE_URL || 'https://www.bwenge.space').replace(/\/$/, '');
const htmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function grantText(p: any) {
  if (p.purpose === 'GO_PACK') {
    const balance = await walletBalance(p.userId);
    return { grant: `${p.credits.toLocaleString('en-US')} GO credits were added to your account.`, balanceNote: `Your GO balance is now ${balance.toLocaleString('en-US')} credits.` };
  }
  const sub = await db.subscription.findUnique({ where: { userId: p.userId } });
  const until = sub?.endDate ? new Date(sub.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Kigali' }) : '';
  return { grant: `Your ${PLANS[planIdForSubscription(p.purpose) ?? 'PRO'].name} plan is active${until ? ` until ${until}` : ''}.`, balanceNote: undefined };
}

export async function notifyReceipt(p: any) {
  const c = await contact(p.userId);
  const g = await grantText(p);
  const item = (await quote(p.purpose, { packId: p.packId ?? undefined, months: p.months || 1 }).catch(() => null))?.item ?? p.purpose;
  const email = receiptEmail({ name: c.name, receiptNumber: p.receiptNumber, paidAt: new Date(p.fulfilledAt), item, amountRwf: p.amountRwf, amountUsd: p.amountUsd, currency: p.currency, phoneMasked: p.phoneMasked, transactionId: p.financialTransactionId, grant: g.grant, balanceNote: g.balanceNote });
  const mailed = await once(`receipt:${p.id}:email`, p.userId, 'email', () => sendMail(c.email, email));
  if (mailed) await db.billingPayment.update({ where: { id: p.id }, data: { emailedAt: new Date() } }).catch(() => undefined);
  await once(`receipt:${p.id}:telegram`, p.userId, 'telegram', () => sendTelegram(c.chatId,
    `✅ <b>Payment received</b>\n\n${htmlEsc(item)} · <b>${p.amountRwf.toLocaleString('en-US')} ${htmlEsc(p.currency)}</b>\n${htmlEsc(g.grant)}${g.balanceNote ? `\n${htmlEsc(g.balanceNote)}` : ''}\n\n<i>Receipt ${htmlEsc(p.receiptNumber)}</i>`));
}

async function notifyFailed(p: any) {
  const c = await contact(p.userId);
  const item = (await quote(p.purpose, { packId: p.packId ?? undefined, months: p.months || 1 }).catch(() => null))?.item ?? p.purpose;
  await once(`failed:${p.id}:email`, p.userId, 'email', () => sendMail(c.email, paymentFailedEmail({ name: c.name, item, amountRwf: p.amountRwf, reason: p.providerReason })));
}

/** Daily-ish sweep: reminders 3 days and 1 day before a plan ends, and a notice when it has ended. */
export async function runRenewalSweep(now = Date.now()) {
  await refreshBillingSettings();
  const subs = await db.subscription.findMany({ where: { status: 'ACTIVE' } });
  let sent = 0;
  for (const s of subs) {
    if (!s.endDate) continue;
    const end = new Date(s.endDate);
    const daysLeft = Math.ceil((end.getTime() - now) / 86_400_000);
    const plan = PLANS[planIdForSubscription(s.planType) ?? 'PRO'];
    // Plans no longer sold online (Institution) renew as Pro.
    const priceRwf = plan.priceRwf || PLANS.PRO.priceRwf || 0;
    const c = await contact(s.userId);
    if (daysLeft <= 0) {
      const key = `expired:${s.userId}:${end.toISOString().slice(0, 10)}`;
      await db.subscription.update({ where: { userId: s.userId }, data: { status: 'EXPIRED' } }).catch(() => undefined);
      if (await once(`${key}:email`, s.userId, 'email', () => sendMail(c.email, expiredEmail({ name: c.name, plan: plan.name, priceRwf })))) sent++;
      await once(`${key}:telegram`, s.userId, 'telegram', () => sendTelegram(c.chatId, `⏳ <b>Your ${plan.name} plan has ended</b>\n\nYou are on the Free plan now. Your files and memories are kept.`, { text: `Renew · ${priceRwf.toLocaleString('en-US')} RWF`, url: `${appUrl()}/upgrade?renew=1` }));
    } else if (daysLeft <= 3) {
      const stage = daysLeft <= 1 ? 1 : 3;
      const key = `renewal-${stage}:${s.userId}:${end.toISOString().slice(0, 10)}`;
      if (await once(`${key}:email`, s.userId, 'email', () => sendMail(c.email, renewalReminderEmail({ name: c.name, plan: plan.name, endDate: end, daysLeft, priceRwf, priceUsd: Math.round((priceRwf / fxUsdRwf()) * 100) / 100 })))) sent++;
      await once(`${key}:telegram`, s.userId, 'telegram', () => sendTelegram(c.chatId, `🔔 <b>Your ${plan.name} plan ends ${daysLeft <= 1 ? 'tomorrow' : `in ${daysLeft} days`}</b>\n\nRenew with Mobile Money to keep your credits and memory.`, { text: `Renew · ${priceRwf.toLocaleString('en-US')} RWF`, url: `${appUrl()}/upgrade?renew=1` }));
    }
  }
  return { checked: subs.length, sent };
}

/** Background jobs: confirm pending payments every 30 s (missed callbacks) and run the renewal sweep hourly. */
let started = false;
export function startBillingJobs() {
  if (started) return;
  started = true;
  setInterval(async () => {
    try {
      const pending = await db.billingPayment.findMany({ where: { status: 'PENDING', createdAt: { gte: new Date(Date.now() - 30 * 60_000) } }, take: 50 });
      for (const p of pending) await checkPayment(p.id).catch(() => undefined);
    } catch (e) { logger.warn('[billing] poller failed', { errorType: (e as Error)?.name }); }
  }, 30_000).unref();
  setInterval(() => void runRenewalSweep().catch((e) => logger.warn('[billing] renewal sweep failed', { errorType: e?.name })), 3600_000).unref();
  setTimeout(() => void runRenewalSweep().catch(() => undefined), 60_000).unref();
}

/** What the app shows about the user's billing state (plan, renewal, wallet, pending payment). */
export async function billingState(userId: string) {
  const [plan, sub, wallet, pending] = await Promise.all([
    planFor(userId),
    db.subscription.findUnique({ where: { userId } }).catch(() => null),
    walletBalance(userId),
    db.billingPayment.findFirst({ where: { userId, status: 'PENDING' }, orderBy: { createdAt: 'desc' } }).catch(() => null),
  ]);
  const active = sub && sub.status === 'ACTIVE' && (!sub.endDate || new Date(sub.endDate).getTime() > Date.now());
  return {
    plan: plan.id, planName: plan.name,
    subscription: active ? { planType: sub.planType, endDate: sub.endDate ? new Date(sub.endDate).toISOString() : null, daysLeft: sub.endDate ? Math.max(0, Math.ceil((new Date(sub.endDate).getTime() - Date.now()) / 86_400_000)) : null } : null,
    wallet,
    pendingPayment: pending ? publicPayment(pending) : null,
    payments: momoReady() ? 'ready' : 'unavailable',
  };
}
