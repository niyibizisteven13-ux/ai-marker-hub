import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import logger from '../utils/logger.js';
import { FLAGS, FLAG_IDS, flagOn, loadPlatformSettings, savePlatformSettings, settingsPatchSchema } from '../services/platform/settings.js';
import { auditAction } from '../services/platform/audit.js';
import { clientIp } from '../services/platform/security.js';
import { usageSummary } from '../services/billing/usage.js';
import { storageState } from '../services/billing/storage.js';

/**
 * The administrator's platform controls (mounted at /api/admin/platform, ADMIN only): switches and maintenance, the audit log, one person's
 * account, everyone's content, organisations, background jobs, Telegram, security and retention. MySEB has its own file (adminMySebRoutes.ts).
 * Every change is written to the audit log with who did it.
 */
const router = Router();
const db = prisma as any;
const adminOf = (req: Request) => String((req as any).user?.userId ?? 'unknown');
const bad = (res: Response, status: number, error: string) => res.status(status).json({ success: false, error });
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => { fn(req, res).catch((e) => { logger.warn('[admin platform]', { path: req.path, error: (e as Error)?.message }); if (!res.headersSent) bad(res, 500, (e as Error)?.message || 'Something went wrong.'); }); };
const lazy = async <T>(f: () => Promise<T>, fallback: T): Promise<T> => { try { return await f(); } catch { return fallback; } };

/* ------------------------------------------------------------------ switches, maintenance, announcement, blocks, retention */
const DAY = 86_400_000;
const retentionInfo = (mysebDays: number | null) => [
  { id: 'myseb', label: 'MySEB: finished exams, their students, logs, saved answers and codes', value: `${mysebDays ?? Number(process.env.RETENTION_DAYS || 90)} days`, editable: true, source: mysebDays ? 'set here' : 'server default' },
  { id: 'exams', label: 'Marked exam sets (scripts, results)', value: `${Math.round(Number(process.env.EXAM_RETENTION_MS || 0) / DAY) || 'server default'}${process.env.EXAM_RETENTION_MS ? ' days' : ''}`, editable: false, source: 'server setting (EXAM_RETENTION_MS)' },
  { id: 'tasks', label: 'Tasks and hand-ins', value: '365 days', editable: false, source: 'built in' },
  { id: 'classes', label: 'Classes (courses)', value: '5 years', editable: false, source: 'built in' },
  { id: 'failedSignIns', label: 'Failed sign-in records', value: '30 days', editable: false, source: 'built in' },
];

router.get('/settings', wrap(async (_req, res) => {
  const s = await loadPlatformSettings(true);
  res.json({ success: true, data: { settings: s, flags: FLAGS.map((f) => ({ id: f.id, label: f.label, hint: f.hint, group: f.group, on: flagOn(f.id, s) })), retention: retentionInfo(s.retention.mysebDays) } });
}));

router.put('/settings', wrap(async (req, res) => {
  const parsed = settingsPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) return bad(res, 400, `Not valid: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const patch = parsed.data;
  const unknown = Object.keys(patch.flags ?? {}).filter((k) => !FLAG_IDS.includes(k));
  if (unknown.length) return bad(res, 400, `Unknown switch: ${unknown.join(', ')}`);
  if (patch.blockedIps) {
    const mine = clientIp(req);
    if (mine && patch.blockedIps.some((b) => (b.endsWith('.') || b.endsWith(':') ? mine.startsWith(b) : mine === b))) return bad(res, 400, 'That would block your own address.');
  }
  const next = await savePlatformSettings(patch, adminOf(req));
  const changed = Object.keys(patch);
  await auditAction(adminOf(req), 'UPDATE_PLATFORM_SETTINGS', 'platform', 'platform', { changed, flags: patch.flags, maintenance: patch.maintenance, announcement: patch.announcement === null ? 'removed' : patch.announcement ? 'set' : undefined, blockedIps: patch.blockedIps?.length, retention: patch.retention });
  const { pushMySebSettings } = await import('../services/mySebAdmin.js');
  void pushMySebSettings().catch(() => undefined);
  res.json({ success: true, data: { settings: next, flags: FLAGS.map((f) => ({ id: f.id, label: f.label, hint: f.hint, group: f.group, on: flagOn(f.id, next) })), retention: retentionInfo(next.retention.mysebDays) } });
}));

/* ------------------------------------------------------------------ audit log: filters, paging, export */
const csv = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
router.get('/audit', wrap(async (req, res) => {
  const q = z.object({ actor: z.string().max(80).optional(), action: z.string().max(80).optional(), resource: z.string().max(80).optional(), q: z.string().max(80).optional(),
    from: z.string().max(40).optional(), to: z.string().max(40).optional(), before: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(500).default(100), format: z.enum(['json', 'csv']).default('json') }).safeParse(req.query);
  if (!q.success) return bad(res, 400, 'Those filters are not valid.');
  const f = q.data; const where: any = {};
  if (f.actor) where.actorId = f.actor;
  if (f.action) where.action = { contains: f.action };
  if (f.resource) where.resourceType = f.resource;
  if (f.q) where.details = { contains: f.q };
  const range: any = {};
  for (const [k, v] of [['gte', f.from], ['lt', f.before ?? (f.to ? new Date(Date.parse(f.to) + DAY).toISOString() : undefined)]] as const) if (v) { const d = new Date(v); if (!Number.isNaN(+d)) range[k] = d; }
  if (Object.keys(range).length) where.createdAt = range;
  const take = f.format === 'csv' ? 5000 : f.limit;
  const rows = await db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: take + 1 });
  const more = rows.length > take; const data = rows.slice(0, take);
  if (f.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
    return res.send(['time,actor,action,resource type,resource id,details', ...data.map((r: any) => [new Date(r.createdAt).toISOString(), r.actorId, r.action, r.resourceType, r.resourceId, r.details].map(csv).join(','))].join('\n'));
  }
  res.json({ success: true, data, next: more ? new Date(data[data.length - 1].createdAt).toISOString() : null });
}));

/* ------------------------------------------------------------------ one person's account */
const planOf = async (id: string) => (await lazy(async () => (await import('../services/billing/plans.js')).planFor(id), null as any))?.name ?? null;
async function contentOf(userId: string) {
  const forms = await db.applicationForm.findMany({ where: { userId }, select: { id: true, title: true, updatedAt: true, schema: true }, orderBy: { updatedAt: 'desc' }, take: 100 });
  const tasks = await lazy(async () => (await (await import('../services/assignments/runtime.js')).assignmentService().list(userId)).map((t: any) => ({ id: t.id, title: t.title, open: t.open, submitted: t.submitted })), [] as any[]);
  const courses = await lazy(async () => (await (await import('../services/courses/runtime.js')).courseService().list(userId)).map((c: any) => ({ id: c.id, name: c.name, students: c.students })), [] as any[]);
  const exams = await lazy(async () => (await (await import('../services/educationRuntime.js')).examService.listExams(userId)).map((e: any) => ({ id: e.examId, title: e.title, candidates: e.candidates, marked: e.marked })), [] as any[]);
  return { forms: forms.map((f: any) => { let ex: any = {}; try { ex = JSON.parse(f.schema || '{}'); } catch { /* unreadable */ } return { id: f.id, title: f.title, updatedAt: f.updatedAt, open: ex.acceptingResponses !== false, myseb: !!ex.exam?.requireMyseb }; }), tasks, courses, exams };
}

router.get('/users/:id', wrap(async (req, res) => {
  const id = String(req.params.id);
  const u = await db.user.findUnique({ where: { id }, select: { id: true, email: true, name: true, role: true, createdAt: true, lastLoginAt: true, disabledAt: true, emailVerifiedAt: true } });
  if (!u) return bad(res, 404, 'User not found.');
  const [sessions, usage, storage, content, orgs, telegram] = await Promise.all([
    db.refreshSession.count({ where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } } }).catch(() => 0),
    lazy(() => usageSummary(id), null as any),
    lazy(() => storageState(id), null as any),
    contentOf(id),
    db.organizationMember.findMany({ where: { userId: id }, include: { organization: { select: { id: true, name: true } } } }).catch(() => []),
    db.telegramSession.count({ where: { userId: id } }).catch(() => 0),
  ]);
  const { platformSettings } = await import('../services/platform/settings.js');
  res.json({ success: true, data: {
    user: u, plan: await planOf(id), activeSessions: sessions, telegramLinked: telegram > 0,
    usage: usage ? { day: usage.credits?.day, week: usage.credits?.week, month: usage.credits?.month } : null,
    storage: storage ? { usedMb: Math.round(storage.usedBytes / 1048576 * 10) / 10, limitMb: Math.round(storage.limitBytes / 1048576), files: storage.files, extraMb: platformSettings().storageOverridesMb[id] ?? 0 } : null,
    content, organizations: orgs.map((m: any) => ({ id: m.organization.id, name: m.organization.name, role: m.role })),
  } });
}));

router.post('/users/:id/revoke-sessions', wrap(async (req, res) => {
  const id = String(req.params.id);
  const r = await db.refreshSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  await auditAction(adminOf(req), 'REVOKE_USER_SESSIONS', 'user', id, { sessions: r.count });
  res.json({ success: true, data: { revoked: r.count } });
}));

/** How many times the apps were downloaded or installed from the "Get the app" page (by app and device, and per day). */
router.get('/downloads', wrap(async (_req, res) => {
  const { summary } = await import('../services/appDownloads.js');
  res.json({ success: true, data: await summary() });
}));

/** The ratings and survey answers sent from the Get the app page (and the same as a CSV file). */
router.get('/feedback', wrap(async (_req, res) => {
  const { adminFeedback } = await import('../services/appFeedback.js');
  res.json({ success: true, data: await adminFeedback() });
}));
router.get('/feedback.csv', wrap(async (_req, res) => {
  const { adminFeedback, feedbackCsv } = await import('../services/appFeedback.js');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="app-feedback.csv"');
  res.send(feedbackCsv((await adminFeedback()).items));
}));

/** For someone who lost their phone and their recovery codes: removes their passkeys and the sign-in step, then revokes their sessions. The administrator must have checked who is asking. */
router.post('/users/:id/reset-passkeys', wrap(async (req, res) => {
  const id = String(req.params.id);
  const { resetAll } = await import('../auth/passkeys.js');
  await resetAll(id);
  const r = await db.refreshSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  await auditAction(adminOf(req), 'RESET_USER_PASSKEYS', 'user', id, { sessions: r.count });
  res.json({ success: true, data: { reset: true, revoked: r.count } });
}));

router.post('/users/:id/storage', wrap(async (req, res) => {
  const p = z.object({ extraMb: z.number().int().min(0).max(1_000_000) }).safeParse(req.body);
  if (!p.success) return bad(res, 400, 'Give the extra storage in MB (0 removes it).');
  const id = String(req.params.id);
  if (!(await db.user.findUnique({ where: { id }, select: { id: true } }))) return bad(res, 404, 'User not found.');
  const s = await savePlatformSettings({ storageOverridesMb: { [id]: p.data.extraMb } }, adminOf(req));
  await auditAction(adminOf(req), 'SET_USER_STORAGE', 'user', id, { extraMb: p.data.extraMb });
  res.json({ success: true, data: { extraMb: s.storageOverridesMb[id] ?? 0 } });
}));

router.get('/users/:id/export', wrap(async (req, res) => {
  const id = String(req.params.id);
  const u = await db.user.findUnique({ where: { id }, select: { id: true, email: true, name: true, role: true, createdAt: true, lastLoginAt: true, disabledAt: true } });
  if (!u) return bad(res, 404, 'User not found.');
  const sub = await db.subscription.findUnique({ where: { userId: id } }).catch(() => null);
  const body = { exportedAt: new Date().toISOString(), user: u, plan: await planOf(id), subscription: sub, content: await contentOf(id), usage: await lazy(() => usageSummary(id), null as any) };
  await auditAction(adminOf(req), 'EXPORT_USER_DATA', 'user', id, {});
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Content-Disposition', `attachment; filename="user-${id}.json"`);
  res.send(JSON.stringify(body, null, 2));
}));

/** Erases a person's personal data (right to be forgotten): name, email, sign-in links, memory, Telegram link, tasks and classes. Records needed for accounting (payments, usage) stay, with no name on them. */
router.post('/users/:id/erase', wrap(async (req, res) => {
  const p = z.object({ confirmEmail: z.string().min(3).max(200) }).safeParse(req.body);
  if (!p.success) return bad(res, 400, "Type the person's email to confirm.");
  const id = String(req.params.id);
  const u = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
  if (!u) return bad(res, 404, 'User not found.');
  if (u.id === adminOf(req)) return bad(res, 400, 'You cannot erase your own account.');
  if (u.email.toLowerCase() !== p.data.confirmEmail.trim().toLowerCase()) return bad(res, 400, 'That email does not match this account.');
  if (u.role === 'ADMIN' && (await db.user.count({ where: { role: 'ADMIN', disabledAt: null } })) <= 1) return bad(res, 400, 'Cannot erase the last active administrator.');
  const before = await contentOf(id);
  await auditAction(adminOf(req), 'ERASE_USER', 'user', id, { forms: before.forms.length, tasks: before.tasks.length, courses: before.courses.length });
  const left: string[] = [];
  for (const t of before.tasks) await lazy(async () => { await (await import('../services/assignments/runtime.js')).assignmentService().remove(id, t.id); }, undefined).catch(() => left.push(`task ${t.id}`));
  for (const c of before.courses) await lazy(async () => { await (await import('../services/courses/runtime.js')).courseService().remove(id, c.id); }, undefined).catch(() => left.push(`class ${c.id}`));
  await db.$transaction(async (tx: any) => {
    await tx.refreshSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.identity.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await tx.memoryVector.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await tx.telegramSession.updateMany({ where: { userId: id }, data: { userId: null } }).catch(() => undefined);
    await tx.organizationMember.deleteMany({ where: { userId: id } }).catch(() => undefined);
    // Their forms stop taking answers; the answers already given belong to the people who gave them and stay.
    for (const f of before.forms) { const row = await tx.applicationForm.findUnique({ where: { id: f.id }, select: { schema: true } }); let s: any = {}; try { s = JSON.parse(row?.schema || '{}'); } catch { s = {}; } await tx.applicationForm.update({ where: { id: f.id }, data: { schema: JSON.stringify({ ...s, acceptingResponses: false }) } }); }
    await tx.user.update({ where: { id }, data: { email: `erased-${id}@erased.invalid`, name: 'Erased user', avatarUrl: null, disabledAt: new Date() } });
  });
  res.json({ success: true, data: { erased: true, formsClosed: before.forms.length, tasksRemoved: before.tasks.length - left.filter((x) => x.startsWith('task')).length, classesRemoved: before.courses.length - left.filter((x) => x.startsWith('class')).length, notRemoved: left } });
}));

/* ------------------------------------------------------------------ everyone's content */
router.get('/content/forms', wrap(async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 80);
  const where: any = q ? { OR: [{ title: { contains: q } }, { user: { email: { contains: q } } }] } : {};
  const rows = await db.applicationForm.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 100, include: { user: { select: { id: true, email: true, name: true } }, _count: { select: { submissions: true } } } }).catch(async () =>
    db.applicationForm.findMany({ where: q ? { title: { contains: q } } : {}, orderBy: { updatedAt: 'desc' }, take: 100 }));
  res.json({ success: true, data: rows.map((f: any) => { let s: any = {}; try { s = JSON.parse(f.schema || '{}'); } catch { /* unreadable */ } return { id: f.id, title: f.title, owner: f.user ? { id: f.user.id, email: f.user.email, name: f.user.name } : { id: f.userId }, responses: f._count?.submissions ?? null, open: s.acceptingResponses !== false, myseb: !!s.exam?.requireMyseb, timed: !!s.exam?.enabled, updatedAt: f.updatedAt }; }) });
}));
router.post('/content/forms/:id/close', wrap(async (req, res) => {
  const id = String(req.params.id);
  const row = await db.applicationForm.findUnique({ where: { id }, select: { schema: true, userId: true, title: true } });
  if (!row) return bad(res, 404, 'Form not found.');
  let s: any = {}; try { s = JSON.parse(row.schema || '{}'); } catch { s = {}; }
  await db.applicationForm.update({ where: { id }, data: { schema: JSON.stringify({ ...s, acceptingResponses: false }) } });
  await auditAction(adminOf(req), 'CLOSE_FORM', 'form', id, { title: row.title, owner: row.userId, reason: String(req.body?.reason ?? '').slice(0, 200) });
  res.json({ success: true });
}));
router.post('/content/tasks/:ownerId/:id/close', wrap(async (req, res) => {
  const svc = (await import('../services/assignments/runtime.js')).assignmentService();
  try { await svc.update(String(req.params.ownerId), String(req.params.id), { open: false }); } catch { return bad(res, 404, 'Task not found for that owner.'); }
  await auditAction(adminOf(req), 'CLOSE_TASK', 'task', String(req.params.id), { owner: req.params.ownerId, reason: String(req.body?.reason ?? '').slice(0, 200) });
  res.json({ success: true });
}));

/* ------------------------------------------------------------------ organisations */
router.get('/organizations', wrap(async (_req, res) => {
  const orgs = await db.organization.findMany({ orderBy: { createdAt: 'desc' }, include: { members: { include: { user: { select: { id: true, email: true, name: true, disabledAt: true } } } } } });
  res.json({ success: true, data: orgs.map((o: any) => ({ id: o.id, name: o.name, creditBalanceUsd: o.creditBalanceUsd, createdAt: o.createdAt, members: o.members.map((m: any) => ({ userId: m.userId, role: m.role, email: m.user?.email, name: m.user?.name, disabled: !!m.user?.disabledAt })) })) });
}));
router.post('/organizations/:id/members', wrap(async (req, res) => {
  const p = z.object({ email: z.string().email(), role: z.enum(['ADMIN', 'TEACHER']).default('TEACHER') }).safeParse(req.body);
  if (!p.success) return bad(res, 400, 'Give the email of an existing account and a role (ADMIN or TEACHER).');
  const user = await db.user.findUnique({ where: { email: p.data.email.toLowerCase() }, select: { id: true } });
  if (!user) return bad(res, 404, 'No account has that email. They must sign in once first.');
  const orgId = String(req.params.id);
  if (!(await db.organization.findUnique({ where: { id: orgId }, select: { id: true } }))) return bad(res, 404, 'Organisation not found.');
  await db.organizationMember.upsert({ where: { organizationId_userId: { organizationId: orgId, userId: user.id } }, update: { role: p.data.role }, create: { organizationId: orgId, userId: user.id, role: p.data.role } });
  await auditAction(adminOf(req), 'ORG_ADD_MEMBER', 'organization', orgId, { userId: user.id, role: p.data.role });
  res.json({ success: true });
}));
router.delete('/organizations/:id/members/:userId', wrap(async (req, res) => {
  const r = await db.organizationMember.deleteMany({ where: { organizationId: String(req.params.id), userId: String(req.params.userId) } });
  if (!r.count) return bad(res, 404, 'That person is not in this organisation.');
  await auditAction(adminOf(req), 'ORG_REMOVE_MEMBER', 'organization', String(req.params.id), { userId: req.params.userId });
  res.json({ success: true });
}));
router.patch('/organizations/:id', wrap(async (req, res) => {
  const p = z.object({ name: z.string().trim().min(1).max(120) }).safeParse(req.body);
  if (!p.success) return bad(res, 400, 'Give the new name.');
  const done = await db.organization.updateMany({ where: { id: String(req.params.id) }, data: { name: p.data.name } });
  if (!done.count) return bad(res, 404, 'Organisation not found.');
  await auditAction(adminOf(req), 'ORG_RENAME', 'organization', String(req.params.id), { name: p.data.name });
  res.json({ success: true });
}));
router.delete('/organizations/:id', wrap(async (req, res) => {
  const id = String(req.params.id);
  const n = await db.organizationMember.count({ where: { organizationId: id } });
  if (n > 0 && req.query.force !== 'true') return bad(res, 409, `This organisation has ${n} member(s). Remove them first, or confirm to remove the organisation with its members.`);
  await db.$transaction(async (tx: any) => { await tx.organizationMember.deleteMany({ where: { organizationId: id } }); await tx.organization.delete({ where: { id } }); }).catch(() => { throw new Error('Could not remove the organisation (it still owns knowledge or datasets).'); });
  await auditAction(adminOf(req), 'ORG_DELETE', 'organization', id, { members: n });
  res.json({ success: true });
}));

/* ------------------------------------------------------------------ background jobs */
router.get('/jobs', wrap(async (_req, res) => {
  const { fileJobQueue, overnightJobQueue } = await import('../services/educationRuntime.js').then(async (m) => ({ fileJobQueue: (await import('../services/AiService.js')).fileJobQueue, overnightJobQueue: (m as any).overnightJobQueue }));
  const [main, night] = await Promise.all([fileJobQueue.snapshot(), overnightJobQueue ? overnightJobQueue.snapshot() : Promise.resolve(null)]);
  const failed = await db.failedJob.findMany({ where: { status: 'needs_review' }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, jobId: true, jobType: true, errorMessage: true, attempts: true, createdAt: true } }).catch(() => []);
  const batches = await db.batchJob.groupBy({ by: ['status'], _count: { _all: true } }).catch(() => []);
  const stuck = await db.batchJob.findMany({ where: { status: { in: ['PENDING', 'PROCESSING'] }, updatedAt: { lt: new Date(Date.now() - 3600_000) } }, orderBy: { updatedAt: 'asc' }, take: 30, select: { id: true, userId: true, status: true, paperType: true, updatedAt: true } }).catch(() => []);
  res.json({ success: true, data: { queue: main, overnight: night, failed, batches: Object.fromEntries(batches.map((b: any) => [b.status, b._count._all])), stuckBatches: stuck } });
}));
const queueOf = async (which: string) => which === 'overnight' ? (await import('../services/educationRuntime.js')).overnightJobQueue : (await import('../services/AiService.js')).fileJobQueue;
router.post('/jobs/queue/:which/:id/cancel', wrap(async (req, res) => {
  const q: any = await queueOf(String(req.params.which)); const job = q ? await q.adminCancel(String(req.params.id)) : null;
  if (!job) return bad(res, 404, 'No such job.');
  await auditAction(adminOf(req), 'CANCEL_JOB', 'job', job.id, { type: job.type, owner: job.ownerId });
  res.json({ success: true });
}));
router.post('/jobs/queue/:which/:id/retry', wrap(async (req, res) => {
  const q: any = await queueOf(String(req.params.which)); const job = q ? await q.adminRetry(String(req.params.id)) : null;
  if (!job) return bad(res, 404, 'That job cannot be retried (only failed or cancelled jobs can).');
  await auditAction(adminOf(req), 'RETRY_JOB', 'job', String(req.params.id), { newJob: job.id, type: job.type });
  res.json({ success: true, data: { jobId: job.id } });
}));
router.post('/jobs/failed/:id/resolve', wrap(async (req, res) => {
  const done = await db.failedJob.updateMany({ where: { id: String(req.params.id), status: 'needs_review' }, data: { status: 'resolved' } });
  if (!done.count) return bad(res, 404, 'No such failed job waiting for review.');
  await auditAction(adminOf(req), 'RESOLVE_FAILED_JOB', 'job', String(req.params.id), {});
  res.json({ success: true });
}));
router.post('/jobs/batches/:id/fail', wrap(async (req, res) => {
  const r = await db.batchJob.updateMany({ where: { id: String(req.params.id), status: { in: ['PENDING', 'PROCESSING'] } }, data: { status: 'FAILED', errorMessage: 'Stopped by an administrator.' } });
  if (!r.count) return bad(res, 404, 'That batch is not running.');
  await auditAction(adminOf(req), 'STOP_BATCH', 'batch', String(req.params.id), {});
  res.json({ success: true });
}));

/* ------------------------------------------------------------------ Telegram */
router.get('/telegram', wrap(async (_req, res) => {
  const day = new Date(Date.now() - DAY);
  const [total, linked, active24h, recent] = await Promise.all([
    db.telegramSession.count().catch(() => 0), db.telegramSession.count({ where: { userId: { not: null } } }).catch(() => 0), db.telegramSession.count({ where: { lastActiveAt: { gte: day } } }).catch(() => 0),
    db.telegramSession.findMany({ orderBy: { lastActiveAt: 'desc' }, take: 30, include: { user: { select: { id: true, email: true, name: true } } } }).catch(() => []),
  ]);
  res.json({ success: true, data: { botConfigured: !!process.env.TELEGRAM_BOT_TOKEN, total, linked, active24h,
    recent: recent.map((s: any) => ({ id: s.id, chat: `…${String(s.chatId).slice(-4)}`, language: s.language, lastActiveAt: s.lastActiveAt, user: s.user ? { id: s.user.id, email: s.user.email, name: s.user.name } : null })) } });
}));
router.post('/telegram/:id/unlink', wrap(async (req, res) => {
  const row = await db.telegramSession.findUnique({ where: { id: String(req.params.id) }, select: { id: true, userId: true } });
  if (!row) return bad(res, 404, 'No such Telegram chat.');
  await db.telegramSession.update({ where: { id: row.id }, data: { userId: null } });
  await auditAction(adminOf(req), 'TELEGRAM_UNLINK', 'telegram', row.id, { userId: row.userId });
  res.json({ success: true });
}));

/* ------------------------------------------------------------------ security */
router.get('/security', wrap(async (_req, res) => {
  const now = Date.now();
  await db.authEvent.deleteMany({ where: { createdAt: { lt: new Date(now - 30 * DAY) } } }).catch(() => undefined);   // kept 30 days
  const events = await db.authEvent.findMany({ where: { createdAt: { gte: new Date(now - 7 * DAY) } }, orderBy: { createdAt: 'desc' }, take: 2000 }).catch(() => []);
  const parse = (m: string | null) => { try { return JSON.parse(m || '{}'); } catch { return {}; } };
  const byHour = Array.from({ length: 24 }, () => 0); const ips = new Map<string, number>();
  for (const e of events) { const age = now - new Date(e.createdAt).getTime(); if (age < DAY) byHour[23 - Math.min(23, Math.floor(age / 3600_000))]++; const ip = parse(e.meta).ip; if (ip) ips.set(ip, (ips.get(ip) ?? 0) + 1); }
  const { platformSettings } = await import('../services/platform/settings.js');
  const disabled = await db.user.count({ where: { disabledAt: { not: null } } }).catch(() => 0);
  const admins = await db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }).catch(() => []);
  res.json({ success: true, data: {
    failedSignIns: { last24h: events.filter((e: any) => now - new Date(e.createdAt).getTime() < DAY).length, last7d: events.length, byHour },
    topSources: [...ips].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([ip, n]) => ({ ip, attempts: n, blocked: platformSettings().blockedIps.includes(ip) })),
    recent: events.slice(0, 30).map((e: any) => ({ at: e.createdAt, type: e.type, ip: parse(e.meta).ip ?? null, email: parse(e.meta).email ?? null })),
    blockedIps: platformSettings().blockedIps, disabledAccounts: disabled, recentAdminActions: admins,
  } });
}));

export default router;
