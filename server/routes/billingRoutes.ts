import { Router, type Request, type Response } from 'express';
import { pauseMessage, salesState } from '../services/billing/sales.js';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../../production/auth.js';
import { PLANS, SOLD_PLANS, currentGoPacks, fxUsdRwf, refreshBillingSettings } from '../services/billing/plans.js';
import { momoMode } from '../services/billing/momo.js';
import { BillingError, PURPOSES, billingState, checkPayment, publicPayment, startPayment, type Purpose } from '../services/billing/payments.js';
import { usageSummary } from '../services/billing/usage.js';

/**
 * Billing API (/api/billing): plans and prices (USD and RWF), the user's state, Mobile Money checkout,
 * payment status and receipts. The MTN callback only triggers a status check with MTN; its body is not trusted.
 */
const router = Router();
const db = prisma as any;
const userIdOf = (req: Request) => (req as any).user?.userId as string;

function fail(res: Response, e: any) {
  if (e instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request.', code: 'INVALID' });
  if (e instanceof BillingError) return res.status(e.status).json({ error: e.message, code: e.code });
  return res.status(500).json({ error: 'Billing is unavailable right now. Please try again.', code: 'ERROR' });
}

/** Public price list for the Upgrade page. */
router.get('/plans', async (_req, res) => {
  await refreshBillingSettings();
  const P = PLANS;
  const sales = await salesState();
  res.json({
    success: true,
    fxUsdRwf: fxUsdRwf(),
    payments: momoMode(),
    sales: { paused: sales.paused, message: sales.paused ? pauseMessage(sales) : null },
    plans: [
      { id: 'FREE', name: 'Free', priceUsd: 0, priceRwf: 0, period: 'forever', limits: P.FREE.limits },
      { id: 'GO', name: P.GO.name, priceUsd: null, priceRwf: null, period: 'pay as you go', limits: P.GO.limits, packs: currentGoPacks().map((p) => ({ ...p, usd: Math.round((p.rwf / fxUsdRwf()) * 100) / 100 })) },
      ...SOLD_PLANS.map((id) => ({ id, name: P[id].name, priceUsd: P[id].priceUsd, priceRwf: P[id].priceRwf, period: 'month', limits: P[id].limits })),
    ],
  });
});

router.use(requireAuth);

/** Everything the app needs to show the user's state: plan, renewal, GO balance, usage, pending payment. */
router.get('/me', async (req, res) => {
  try {
    const userId = userIdOf(req);
    const [state, usage, telegram] = await Promise.all([
      billingState(userId),
      usageSummary(userId),
      db.telegramSession.findFirst({ where: { userId } }).catch(() => null),
    ]);
    res.json({ success: true, ...state, usage: { day: usage.credits.day, week: usage.credits.week, month: usage.credits.month }, memory: usage.limits.memory, telegram: { linked: Boolean(telegram) } });
  } catch (e) { fail(res, e); }
});

router.post('/checkout', async (req, res) => {
  try {
    const body = z.object({ purpose: z.enum(PURPOSES as [Purpose, ...Purpose[]]), packId: z.string().max(40).optional(), months: z.number().int().min(1).max(12).optional(), phone: z.string().min(6).max(32) }).strict().parse(req.body ?? {});
    const r = await startPayment(userIdOf(req), body as { purpose: Purpose; packId?: string; months?: number; phone: string });
    res.status(r.reused ? 200 : 201).json({ success: true, ...r, message: 'Approve the payment on your phone with your Mobile Money PIN. If no prompt appears, check pending approvals in your MoMo menu.' });
  } catch (e) { fail(res, e); }
});

router.get('/payments', async (req, res) => {
  try {
    const rows = await db.billingPayment.findMany({ where: { userId: userIdOf(req) }, orderBy: { createdAt: 'desc' }, take: 50 });
    res.json({ success: true, payments: rows.map(publicPayment) });
  } catch (e) { fail(res, e); }
});

router.get('/payments/:id', async (req, res) => {
  try { res.json({ success: true, payment: await checkPayment(req.params.id, userIdOf(req)) }); } catch (e) { fail(res, e); }
});

/** Printable receipt (HTML) for a successful payment. */
router.get('/payments/:id/receipt', async (req, res) => {
  try {
    const p = await db.billingPayment.findUnique({ where: { id: req.params.id } });
    if (!p || p.userId !== userIdOf(req) || p.status !== 'SUCCESSFUL') return res.status(404).json({ error: 'Receipt not found.' });
    const { receiptEmail } = await import('../services/billing/emails.js');
    const user = await db.user.findUnique({ where: { id: p.userId }, select: { name: true } });
    const item = p.purpose === 'GO_PACK' ? `GO credits · ${p.credits} credits` : `${p.purpose === 'INSTITUTION' ? 'Institution' : 'PRO'} plan · ${p.months} month${p.months > 1 ? 's' : ''}`;
    const r = receiptEmail({ name: user?.name ?? '', receiptNumber: p.receiptNumber, paidAt: new Date(p.fulfilledAt), item, amountRwf: p.amountRwf, amountUsd: p.amountUsd, currency: p.currency, phoneMasked: p.phoneMasked, transactionId: p.financialTransactionId, grant: '' });
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.type('html').send(r.html);
  } catch (e) { fail(res, e); }
});

export default router;

/** MTN callback (no user session): re-checks the payment with MTN; the request body is not trusted. */
export const momoCallbackRouter = Router();
momoCallbackRouter.post('/:id', async (req, res) => {
  const id = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).end();
  void checkPayment(id).catch(() => undefined);
  res.status(200).json({ received: true });
});
momoCallbackRouter.put('/:id', (req, res) => { void checkPayment(String(req.params.id)).catch(() => undefined); res.status(200).json({ received: true }); });
