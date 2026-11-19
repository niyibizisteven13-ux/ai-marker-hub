import { randomUUID } from 'node:crypto';
import { prisma } from '../../db.js';
import { BillingError, fulfil, publicPayment, receiptDelivery, quote, type Purpose } from './payments.js';
import { pauseMessage, salesState } from './sales.js';
import { hasBadge } from './badge.js';
import logger from '../../utils/logger.js';

const db = prisma as any;
export const MANUAL_PAYMENT = { momoCode: '2191184', momoName: 'Niyibizi Steven', whatsapp: '250799691108' };
// Deliberate opt-in: incomplete or sandbox credentials must never hide the working manual checkout.
export const automaticPaymentsEnabled = async () => {
  const row = await db.appSetting.findUnique({ where: { key: 'billing-automatic-payments' } });
  return row ? row.value?.enabled === true : process.env.BILLING_AUTOMATIC_PAYMENTS_ENABLED === 'true';
};
// Customer checkout stays manual until MTN production collection has been configured and verified.
// Saved settings and leftover gateway credentials must not reopen the phone-prompt form.
export async function paymentOptions() {
  return { payments: 'off' as const, manual: MANUAL_PAYMENT };
}
export async function startManualPayment(userId: string, input: { purpose: Purpose; packId?: string; months?: number }, admin = false) {
  const sales = await salesState();
  if (sales.paused && !admin) throw new BillingError(pauseMessage(sales), 503, 'SALES_PAUSED');
  if (!admin && !(await paymentOptions()).manual) throw new BillingError('Please use the automatic checkout.', 409);
  const q = await quote(input.purpose, input);
  if (q.purpose === 'VERIFIED_BADGE' && (await hasBadge(userId))) throw new BillingError('You already have the verified badge.', 409, 'ALREADY_VERIFIED');
  const recent = await db.billingPayment.findFirst({ where: { userId, provider: 'MTN_MOMO_MANUAL', status: 'PENDING', purpose: q.purpose, packId: q.packId ?? null, months: q.months, amountRwf: q.amountRwf, credits: q.credits, createdAt: { gte: new Date(Date.now() - 86_400_000) } }, orderBy: { createdAt: 'desc' } });
  if (recent) return publicPayment(recent);
  const row = await db.billingPayment.create({ data: { id: randomUUID(), userId, purpose: q.purpose, packId: q.packId ?? null, months: q.months, credits: q.credits, amountRwf: q.amountRwf, amountUsd: q.amountUsd, currency: 'RWF', provider: 'MTN_MOMO_MANUAL', phoneMasked: `MoMo Pay ${MANUAL_PAYMENT.momoCode}`, status: 'PENDING', fulfilledAt: null, emailedAt: null } });
  return publicPayment(row);
}
export async function approveManualPayment(id: string, transactionId: string, adminId: string) {
  const row = await db.billingPayment.findUnique({ where: { id } });
  if (!row || row.provider !== 'MTN_MOMO_MANUAL') throw new BillingError('Manual payment not found.', 404);
  if (row.status !== 'PENDING' && !row.fulfilledAt) throw new BillingError('This payment is no longer pending.', 409);
  if (row.fulfilledAt && row.financialTransactionId !== transactionId) throw new BillingError('This payment was approved with a different transaction ID.', 409);
  if (!row.fulfilledAt && await db.appSetting.findUnique({ where: { key: `manual-momo-transaction:${transactionId}` } })) throw new BillingError('This MoMo transaction has already been used.', 409, 'DUPLICATE_TRANSACTION');
  const done = await fulfil(row, transactionId, adminId);
  logger.info('[admin billing] manual payment verified', { admin: adminId, paymentId: id, userId: row.userId });
  return { ...publicPayment(done), receiptEmail: await receiptDelivery(done) };
}
