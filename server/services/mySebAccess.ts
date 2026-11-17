import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { fxUsdRwf } from './billing/plans.js';
import { flagOn } from './platform/settings.js';
import { MySebError } from './mySeb.js';

/**
 * MySEB is sold. A lecturer needs access to get a code for students:
 *  - MONTH: unlimited tests for 30 days per month paid (default US$5), or
 *  - TEST: one test (one live room) per credit (default 1,500 RWF); a test keeps working for all its codes after its first.
 * Payment is manual for now: the lecturer pays by MTN Mobile Money to the code shown, sends the screenshot on WhatsApp, and the administrator
 * enables them in Admin → MySEB sales. Administrators are never charged, and the administrator can turn charging off (switch "MySEB: charge").
 * Everything is stored in appSetting rows: "myseb-payment" (the prices and where to pay), "myseb-access:<user>" and "myseb-req:<id>".
 */
const db = prisma as any;
export type AccessPlan = 'MONTH' | 'TEST';
export interface PaymentConfig { monthUsd: number; testRwf: number; momoCode: string; momoName: string; whatsapp: string }
export const DEFAULT_PAYMENT: PaymentConfig = { monthUsd: 5, testRwf: 1500, momoCode: '2191184', momoName: 'Niyibizi Steven', whatsapp: '250799691108' };
export interface AccessRecord { monthUntil: string | null; tests: number; usedExams: string[]; history: Array<{ at: string; plan: AccessPlan; by: string; note?: string; months?: number; tests?: number }> }
export interface AccessRequest { id: string; userId: string; email: string; name: string; plan: AccessPlan; note: string; status: 'pending' | 'approved' | 'rejected'; createdAt: string; decidedAt?: string; decidedBy?: string }
const EMPTY: AccessRecord = { monthUntil: null, tests: 0, usedExams: [], history: [] };
const DAY = 86_400_000;
const get = async (key: string) => (await db.appSetting.findUnique({ where: { key } }).catch(() => null))?.value;
async function put(key: string, value: unknown, by: string) {
  const existing = await db.appSetting.findUnique({ where: { key } });
  if (existing) await db.appSetting.update({ where: { key }, data: { value, updatedBy: by, updatedAt: new Date() } });
  else await db.appSetting.create({ data: { key, value, updatedBy: by, updatedAt: new Date() } });
}

export async function paymentConfig(): Promise<PaymentConfig> {
  const v = (await get('myseb-payment')) as Partial<PaymentConfig> | undefined;
  const num = (x: unknown, d: number, lo: number, hi: number) => (typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi ? x : d);
  return {
    monthUsd: num(v?.monthUsd, DEFAULT_PAYMENT.monthUsd, 1, 1000), testRwf: Math.round(num(v?.testRwf, DEFAULT_PAYMENT.testRwf, 100, 1_000_000)),
    momoCode: typeof v?.momoCode === 'string' && v.momoCode ? v.momoCode.slice(0, 20) : DEFAULT_PAYMENT.momoCode,
    momoName: typeof v?.momoName === 'string' && v.momoName ? v.momoName.slice(0, 80) : DEFAULT_PAYMENT.momoName,
    // The administrator's own setting wins (even an empty one), then the server setting, then the number given when MySEB went on sale.
    whatsapp: String(v?.whatsapp ?? process.env.MYSEB_WHATSAPP ?? DEFAULT_PAYMENT.whatsapp).replace(/\D/g, '').slice(0, 15),
  };
}
export const savePaymentConfig = async (patch: Partial<PaymentConfig>, by: string) => { const next = { ...(await paymentConfig()), ...patch }; await put('myseb-payment', next, by); return paymentConfig(); };
/** The monthly price in RWF at today's exchange rate, rounded to the nearest 100. */
export const monthRwf = (cfg: PaymentConfig) => Math.round((cfg.monthUsd * fxUsdRwf()) / 100) * 100;

export function paymentInfo(cfg: PaymentConfig, who?: { email?: string }) {
  const month = monthRwf(cfg);
  const text = `Hello, I paid for MySEB. Plan: ______ (Monthly US$${cfg.monthUsd} / One test ${cfg.testRwf.toLocaleString('en-US')} RWF). My email on Bwenge: ${who?.email ?? '______'}. Payment screenshot attached.`;
  return {
    monthUsd: cfg.monthUsd, monthRwf: month, testRwf: cfg.testRwf, momoCode: cfg.momoCode, momoName: cfg.momoName, whatsapp: cfg.whatsapp || null,
    whatsappLink: cfg.whatsapp ? `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(text)}` : null,
  };
}
export function paymentMessage(info: ReturnType<typeof paymentInfo>, email?: string) {
  return `MySEB is a paid service. Choose one: monthly US$${info.monthUsd} (about ${info.monthRwf.toLocaleString('en-US')} RWF) for unlimited tests for 30 days, or ${info.testRwf.toLocaleString('en-US')} RWF for one test. `
    + `Pay by MTN Mobile Money to code ${info.momoCode} (name: ${info.momoName}), then send the payment screenshot${info.whatsapp ? ` on WhatsApp to +${info.whatsapp}` : ' on WhatsApp (the number is shown in the live room)'} with your email${email ? ` (${email})` : ''}. `
    + 'You are given access within a few minutes; then try again.';
}

export async function accessOf(userId: string): Promise<AccessRecord> {
  const v = (await get(`myseb-access:${userId}`)) as Partial<AccessRecord> | undefined;
  return { monthUntil: typeof v?.monthUntil === 'string' ? v.monthUntil : null, tests: Math.max(0, Number(v?.tests) || 0), usedExams: Array.isArray(v?.usedExams) ? v!.usedExams!.map(String).slice(-500) : [], history: Array.isArray(v?.history) ? v!.history!.slice(-20) : [] };
}
export const monthActive = (a: AccessRecord, now = Date.now()) => !!a.monthUntil && Date.parse(a.monthUntil) > now;

/** What a lecturer sees about their own access. */
export async function accessStatus(userId: string, role?: string) {
  const exempt = role === 'ADMIN' || !flagOn('myseb.requirePayment');
  const a = await accessOf(userId);
  return { exempt, charging: flagOn('myseb.requirePayment'), monthActive: monthActive(a), monthUntil: monthActive(a) ? a.monthUntil : null, tests: a.tests, hasAccess: exempt || monthActive(a) || a.tests > 0 };
}

/** The gate: may this person get a code for this test? Takes one test credit the first time a test is opened without a monthly plan. */
export async function requireMySebAccess(userId: string, examKey: string): Promise<void> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { role: true, email: true } }).catch(() => null);
  if (u?.role === 'ADMIN' || !flagOn('myseb.requirePayment')) return;
  const a = await accessOf(userId);
  if (a.usedExams.includes(examKey) || monthActive(a)) return;
  if (a.tests > 0) { await put(`myseb-access:${userId}`, { ...a, tests: a.tests - 1, usedExams: [...a.usedExams, examKey].slice(-500) }, 'system'); return; }
  const info = paymentInfo(await paymentConfig(), { email: u?.email });
  throw new MySebError(paymentMessage(info, u?.email), 402, 'MYSEB_PAYMENT_REQUIRED', info);
}

/** The administrator gives access (after a payment). MONTH adds 30 days per month to whichever is later: now or the current end. TEST adds test credits. */
export async function grantAccess(input: { userId: string; plan: AccessPlan; months?: number; tests?: number; by: string; note?: string }) {
  const a = await accessOf(input.userId); const now = Date.now();
  const next: AccessRecord = { ...a };
  const entry: AccessRecord['history'][number] = { at: new Date(now).toISOString(), plan: input.plan, by: input.by, ...(input.note ? { note: input.note.slice(0, 200) } : {}) };
  if (input.plan === 'MONTH') {
    const months = Math.max(1, Math.min(24, Math.round(input.months ?? 1)));
    next.monthUntil = new Date(Math.max(now, a.monthUntil ? Date.parse(a.monthUntil) : 0) + months * 30 * DAY).toISOString(); entry.months = months;
  } else {
    const tests = Math.max(1, Math.min(500, Math.round(input.tests ?? 1)));
    next.tests = a.tests + tests; entry.tests = tests;
  }
  next.history = [...a.history, entry].slice(-20);
  await put(`myseb-access:${input.userId}`, next, input.by);
  return next;
}
export async function revokeAccess(userId: string, by: string) { const a = await accessOf(userId); await put(`myseb-access:${userId}`, { ...a, monthUntil: null, tests: 0, history: [...a.history, { at: new Date().toISOString(), plan: 'MONTH' as AccessPlan, by, note: 'revoked' }].slice(-20) }, by); }

/** "I have paid": the lecturer tells the administrator. One waiting request per person (a second one updates it). */
export async function createRequest(user: { id: string; email: string; name: string }, plan: AccessPlan, note: string): Promise<AccessRequest> {
  const rows = await db.appSetting.findMany({ where: { key: { startsWith: 'myseb-req:' } }, orderBy: { updatedAt: 'desc' }, take: 300 });
  const mine = rows.map((r: any) => r.value as AccessRequest).find((r: AccessRequest) => r.userId === user.id && r.status === 'pending');
  const req: AccessRequest = { id: mine?.id ?? randomUUID(), userId: user.id, email: user.email, name: user.name, plan, note: note.slice(0, 300), status: 'pending', createdAt: mine?.createdAt ?? new Date().toISOString() };
  await put(`myseb-req:${req.id}`, req, user.id);
  if (!mine) void import('./telegram/agentic.js').then((m) => m.notifyAdminsOfPayment(req)).catch(() => undefined);   // the administrator gets it on Telegram with Approve / Reject
  return req;
}
export async function listRequests(status?: AccessRequest['status'], take = 100): Promise<AccessRequest[]> {
  const rows = await db.appSetting.findMany({ where: { key: { startsWith: 'myseb-req:' } }, orderBy: { updatedAt: 'desc' }, take: 400 });
  return rows.map((r: any) => r.value as AccessRequest).filter((r: AccessRequest) => !status || r.status === status).slice(0, take);
}
export async function pendingRequestOf(userId: string) { return (await listRequests('pending')).find((r) => r.userId === userId) ?? null; }
export async function decideRequest(id: string, approve: boolean, by: string, grant?: { months?: number; tests?: number; plan?: AccessPlan }) {
  const v = (await get(`myseb-req:${id}`)) as AccessRequest | undefined;
  if (!v || v.status !== 'pending') return null;
  const next: AccessRequest = { ...v, status: approve ? 'approved' : 'rejected', decidedAt: new Date().toISOString(), decidedBy: by };
  await put(`myseb-req:${id}`, next, by);
  if (approve) await grantAccess({ userId: v.userId, plan: grant?.plan ?? v.plan, months: grant?.months, tests: grant?.tests, by, note: `request ${id.slice(0, 8)}` });
  return next;
}
/** Everyone with access right now (a monthly plan that has not ended, or test credits left). */
export async function listSubscribers() {
  const rows = await db.appSetting.findMany({ where: { key: { startsWith: 'myseb-access:' } }, orderBy: { updatedAt: 'desc' }, take: 500 });
  const out: Array<{ userId: string; email: string; name: string; monthUntil: string | null; tests: number; history: AccessRecord['history'] }> = [];
  for (const r of rows) {
    const userId = String(r.key).slice('myseb-access:'.length); const a = await accessOf(userId);
    if (!monthActive(a) && a.tests <= 0) continue;
    const u = await db.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }).catch(() => null);
    out.push({ userId, email: u?.email ?? userId, name: u?.name ?? '', monthUntil: monthActive(a) ? a.monthUntil : null, tests: a.tests, history: a.history.slice(-3) });
  }
  return out;
}
