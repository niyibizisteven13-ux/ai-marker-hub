import { Router, type Request, type Response } from 'express';
import { prisma } from '../db.js';
import logger from '../utils/logger.js';
import { accessStatus } from '../services/mySebAccess.js';

/**
 * The lecturer's MySEB dashboard (/api/myseb-dashboard, signed in): one call that returns what the home screen needs, so it opens fast on a phone.
 * Their own tests and tasks only (the same ownership checks as everywhere else), which of them are protected by MySEB (so have a live room),
 * the live numbers of the busiest rooms, and the state of their MySEB access.
 */
const router = Router();
const db = prisma as any;
const userOf = (req: Request) => String((req as any).user?.userId ?? '');

export interface DashRoom { kind: 'form' | 'task'; id: string; title: string; updatedAt: string; link: string; live: null | { inExam: number; paused: number; left: number; ended: number; total: number } }
export interface DashItem { kind: 'form' | 'task'; id: string; title: string; updatedAt: string; mySeb: boolean }

/** Gives a slow room at most this long: the home screen must not wait for one MySEB room. */
const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> => new Promise((resolve) => { const t = setTimeout(() => resolve(null), ms); p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); }); });
const roomLink = (kind: 'form' | 'task', id: string) => `/live/${kind}/${encodeURIComponent(id)}`;

export async function buildOverview(userId: string, role?: string, now = Date.now()) {
  const { normalizeExam } = await import('../../shared/examRules.js');
  const my = await import('../services/mySeb.js');
  const forms: DashItem[] = [];
  const rows = await db.applicationForm.findMany({ where: { userId }, select: { id: true, title: true, schema: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 100 });
  for (const f of rows) {
    let on = false; try { on = !!normalizeExam(JSON.parse(f.schema || '{}').exam).requireMyseb; } catch { on = false; }
    forms.push({ kind: 'form', id: f.id, title: String(f.title || 'Untitled'), updatedAt: new Date(f.updatedAt).toISOString(), mySeb: on });
  }
  const tasks: DashItem[] = [];
  try {
    const svc = (await import('../services/assignments/runtime.js')).assignmentService();
    for (const t of (await svc.list(userId)).slice(0, 60) as any[]) {
      const info = await svc.mysebInfo(userId, t.id).catch(() => null);
      tasks.push({ kind: 'task', id: t.id, title: String(t.title || 'Untitled'), updatedAt: String(t.updatedAt ?? t.createdAt ?? new Date(now).toISOString()), mySeb: !!info?.requireMyseb });
    }
  } catch { /* tasks are optional on this server */ }
  const withRoom = [...forms, ...tasks].filter((x) => x.mySeb).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  // Live numbers for the most recent rooms, in parallel, each with its own short timeout.
  const rooms: DashRoom[] = await Promise.all(withRoom.slice(0, 12).map(async (r) => {
    const m: any = await withTimeout(my.monitor(r.kind === 'form' ? my.formTarget(userId, r.id) : my.assignmentTarget(userId, r.id), { frames: false }), 3500);
    const c = (m?.counts ?? null) as Record<string, number> | null;
    const live = c ? { inExam: c.IN_EXAM ?? 0, paused: c.PAUSED ?? 0, left: c.LEFT ?? 0, ended: c.ENDED ?? 0, total: (c.IN_EXAM ?? 0) + (c.PAUSED ?? 0) + (c.LEFT ?? 0) + (c.ENDED ?? 0) } : null;
    return { kind: r.kind, id: r.id, title: r.title, updatedAt: r.updatedAt, link: roomLink(r.kind, r.id), live };
  }));
  const liveNow = rooms.filter((r) => r.live && (r.live.inExam > 0 || r.live.paused > 0));
  return {
    access: await accessStatus(userId, role),
    totals: { forms: forms.length, tasks: tasks.length, rooms: withRoom.length, liveRooms: liveNow.length, studentsIn: liveNow.reduce((a, r) => a + (r.live?.inExam ?? 0), 0), needAttention: liveNow.reduce((a, r) => a + (r.live?.paused ?? 0) + (r.live?.left ?? 0), 0) },
    rooms: [...rooms].sort((a, b) => ((b.live?.inExam ?? 0) + (b.live?.paused ?? 0)) - ((a.live?.inExam ?? 0) + (a.live?.paused ?? 0))),
    forms: forms.slice(0, 12), tasks: tasks.slice(0, 12),
  };
}

router.get('/', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  void (async () => {
    const me = await db.user.findUnique({ where: { id: userOf(req) }, select: { id: true, name: true, role: true } });
    if (!me) return res.status(401).json({ success: false, error: 'Sign in again.' });
    res.json({ success: true, data: { name: String(me.name ?? '').split(' ')[0] || '', ...(await buildOverview(me.id, me.role)) } });
  })().catch((e) => { logger.warn('[myseb-dashboard]', { err: String(e?.message ?? e).slice(0, 200) }); if (!res.headersSent) res.status(500).json({ success: false, error: 'The dashboard could not load. Please try again.' }); });
});

export default router;
