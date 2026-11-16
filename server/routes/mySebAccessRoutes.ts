import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import logger from '../utils/logger.js';
import { auditAction } from '../services/platform/audit.js';
import { flagOn } from '../services/platform/settings.js';
import { accessOf, accessStatus, createRequest, decideRequest, grantAccess, listRequests, listSubscribers, monthRwf, paymentConfig, paymentInfo, pendingRequestOf, revokeAccess, savePaymentConfig } from '../services/mySebAccess.js';

/**
 * MySEB is sold (see services/mySebAccess.ts).
 *  - lecturerRouter (/api/myseb-access, signed in): what I have, how to pay, and "I have paid".
 *  - adminRouter (/api/admin/myseb-access, ADMIN): prices and where to pay, requests waiting, enable someone by email, subscribers, revoke.
 */
const db = prisma as any;
const userOf = (req: Request) => String((req as any).user?.userId ?? '');
const bad = (res: Response, status: number, error: string) => res.status(status).json({ success: false, error });
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => { res.setHeader('Cache-Control', 'no-store'); fn(req, res).catch((e) => { logger.warn('[myseb-access]', { path: req.path, error: (e as Error)?.message }); if (!res.headersSent) bad(res, 500, (e as Error)?.message || 'Something went wrong.'); }); };

export const lecturerRouter = Router();
lecturerRouter.get('/', wrap(async (req, res) => {
  const me = await db.user.findUnique({ where: { id: userOf(req) }, select: { id: true, email: true, role: true } });
  if (!me) return bad(res, 401, 'Sign in again.');
  const [status, cfg, pending] = await Promise.all([accessStatus(me.id, me.role), paymentConfig(), pendingRequestOf(me.id)]);
  res.json({ success: true, data: { status, payment: paymentInfo(cfg, { email: me.email }), pendingRequest: pending ? { plan: pending.plan, createdAt: pending.createdAt } : null } });
}));
lecturerRouter.post('/request', wrap(async (req, res) => {
  const p = z.object({ plan: z.enum(['MONTH', 'TEST']), note: z.string().max(300).default('') }).safeParse(req.body);
  if (!p.success) return bad(res, 400, 'Choose a plan: MONTH or TEST.');
  const me = await db.user.findUnique({ where: { id: userOf(req) }, select: { id: true, email: true, name: true } });
  if (!me) return bad(res, 401, 'Sign in again.');
  const r = await createRequest(me, p.data.plan, p.data.note);
  await auditAction(me.id, 'MYSEB_PAYMENT_CLAIMED', 'myseb_access', r.id, { plan: r.plan });
  res.json({ success: true, data: { request: { plan: r.plan, createdAt: r.createdAt } } });
}));

export const adminRouter = Router();
const adminOf = (req: Request) => userOf(req) || 'unknown';
adminRouter.get('/', wrap(async (_req, res) => {
  const [cfg, pending, decided, subscribers] = await Promise.all([paymentConfig(), listRequests('pending'), listRequests(undefined, 60), listSubscribers()]);
  res.json({ success: true, data: { charging: flagOn('myseb.requirePayment'), config: cfg, monthRwf: monthRwf(cfg), pending, recent: decided.filter((r) => r.status !== 'pending').slice(0, 15), subscribers } });
}));
adminRouter.put('/config', wrap(async (req, res) => {
  const p = z.object({ monthUsd: z.number().min(1).max(1000).optional(), testRwf: z.number().int().min(100).max(1_000_000).optional(), momoCode: z.string().trim().regex(/^\d{3,20}$/, 'The Mobile Money code is digits only.').optional(), momoName: z.string().trim().min(2).max(80).optional(), whatsapp: z.preprocess((v) => (typeof v === 'string' ? v.replace(/[\s().-]/g, '') : v), z.string().regex(/^\+?\d{8,15}$/, 'Use the WhatsApp number with its country code, for example +250788123456.').or(z.literal(''))).optional() }).strict().safeParse(req.body ?? {});
  if (!p.success) return bad(res, 400, p.error.issues[0]?.message || 'Those values are not valid.');
  const patch: Record<string, unknown> = { ...p.data }; if (typeof p.data.whatsapp === 'string') patch.whatsapp = p.data.whatsapp.replace(/\D/g, '');
  const cfg = await savePaymentConfig(patch, adminOf(req));
  await auditAction(adminOf(req), 'MYSEB_PAYMENT_SETTINGS', 'myseb_access', 'config', { ...p.data, whatsapp: p.data.whatsapp ? '(set)' : p.data.whatsapp });
  res.json({ success: true, data: { config: cfg, monthRwf: monthRwf(cfg) } });
}));
/** "Allow this email to continue": the administrator gives a person access after they paid. */
adminRouter.post('/grant', wrap(async (req, res) => {
  const p = z.object({ email: z.string().email(), plan: z.enum(['MONTH', 'TEST']), months: z.number().int().min(1).max(24).optional(), tests: z.number().int().min(1).max(500).optional(), note: z.string().max(200).optional() }).safeParse(req.body);
  if (!p.success) return bad(res, 400, 'Give their email, the plan (MONTH or TEST) and, if needed, how many months or tests.');
  const u = await db.user.findUnique({ where: { email: p.data.email.toLowerCase() }, select: { id: true, email: true } });
  if (!u) return bad(res, 404, 'No account has that email. They must sign in to Bwenge once first.');
  const a = await grantAccess({ userId: u.id, plan: p.data.plan, months: p.data.months, tests: p.data.tests, by: adminOf(req), note: p.data.note });
  const waiting = (await listRequests('pending')).filter((r) => r.userId === u.id);
  for (const r of waiting) await decideRequest(r.id, false, adminOf(req)).catch(() => undefined);   // closed: the access was given directly
  await auditAction(adminOf(req), 'MYSEB_ACCESS_GRANT', 'user', u.id, { plan: p.data.plan, months: p.data.months, tests: p.data.tests, note: p.data.note });
  res.json({ success: true, data: { email: u.email, monthUntil: a.monthUntil, tests: a.tests } });
}));
adminRouter.post('/requests/:id/approve', wrap(async (req, res) => {
  const p = z.object({ plan: z.enum(['MONTH', 'TEST']).optional(), months: z.number().int().min(1).max(24).optional(), tests: z.number().int().min(1).max(500).optional() }).safeParse(req.body ?? {});
  if (!p.success) return bad(res, 400, 'Those values are not valid.');
  const r = await decideRequest(String(req.params.id), true, adminOf(req), p.data);
  if (!r) return bad(res, 404, 'That request is not waiting any more.');
  await auditAction(adminOf(req), 'MYSEB_ACCESS_GRANT', 'user', r.userId, { plan: p.data.plan ?? r.plan, months: p.data.months, tests: p.data.tests, request: r.id });
  res.json({ success: true });
}));
adminRouter.post('/requests/:id/reject', wrap(async (req, res) => {
  const r = await decideRequest(String(req.params.id), false, adminOf(req));
  if (!r) return bad(res, 404, 'That request is not waiting any more.');
  await auditAction(adminOf(req), 'MYSEB_ACCESS_REJECT', 'user', r.userId, { request: r.id });
  res.json({ success: true });
}));
adminRouter.post('/revoke', wrap(async (req, res) => {
  const p = z.object({ userId: z.string().min(1).max(80) }).safeParse(req.body);
  if (!p.success) return bad(res, 400, 'Say whose access to remove.');
  const a = await accessOf(p.data.userId);
  if (!a.monthUntil && a.tests <= 0) return bad(res, 404, 'That person has no access to remove.');
  await revokeAccess(p.data.userId, adminOf(req));
  await auditAction(adminOf(req), 'MYSEB_ACCESS_REVOKE', 'user', p.data.userId, {});
  res.json({ success: true });
}));
