import { Router, type Request, type Response } from 'express';
import { mySebEndExam, mySebOverview, mySebPurgeNow, pushMySebSettings } from '../services/mySebAdmin.js';
import { auditAction } from '../services/platform/audit.js';

/** Admin → MySEB (mounted at /api/admin/myseb, ADMIN only): server status, every exam, stop an exam, run the retention clean-up now. The on/off switches are in Platform controls. */
const router = Router();
const adminOf = (req: Request) => String((req as any).user?.userId ?? 'unknown');
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => { fn(req, res).catch((e) => { if (!res.headersSent) res.status(502).json({ success: false, error: (e as Error)?.message || 'MySEB did not answer.' }); }); };

router.get('/overview', wrap(async (_req, res) => { res.json({ success: true, data: await mySebOverview() }); }));
router.post('/exams/:id/end', wrap(async (req, res) => {
  const r = await mySebEndExam(String(req.params.id));
  await auditAction(adminOf(req), 'MYSEB_END_EXAM', 'myseb_exam', String(req.params.id), { reason: String(req.body?.reason ?? '').slice(0, 200), ended: r?.ended ?? null });
  res.json({ success: true, data: r });
}));
router.post('/purge', wrap(async (req, res) => {
  const r = await mySebPurgeNow();
  await auditAction(adminOf(req), 'MYSEB_PURGE', 'myseb', 'purge', r);
  res.json({ success: true, data: r });
}));
router.post('/sync', wrap(async (_req, res) => { await pushMySebSettings(); res.json({ success: true }); }));
export default router;
