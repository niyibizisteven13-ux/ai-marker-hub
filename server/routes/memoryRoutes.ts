import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { MemoryService, MemoryUpgradeRequired } from '../services/MemoryService.js';
import { PLANS } from '../services/billing/plans.js';

/**
 * Settings → Memory (mounted at /api/memory behind requireAuth). Everyone can see the page; turning memory on
 * and adding memories need a plan with memory (402 UPGRADE_REQUIRED with the upgrade details otherwise).
 * Deleting is always allowed, so users keep control of their data after a downgrade.
 */
const router = Router();
const memory = () => MemoryService.getInstance();
const userIdOf = (req: Request) => (req as any).user?.userId as string;

function fail(res: Response, e: any) {
  if (e instanceof MemoryUpgradeRequired) {
    const pro = PLANS.PRO;
    return res.status(402).json({ error: e.message, code: e.code, upgrade: { plan: 'PRO', name: pro.name, priceUsd: pro.priceUsd, listPriceUsd: pro.listPriceUsd, priceRwf: pro.priceRwf, url: '/upgrade?reason=memory' } });
  }
  if (e instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request.', code: 'INVALID' });
  const status = e?.code === 'NOT_FOUND' ? 404 : e?.code === 'SENSITIVE' || e?.code === 'INVALID' ? 400 : 500;
  return res.status(status).json({ error: status === 500 ? 'Memory is unavailable right now.' : e.message, code: e?.code ?? 'ERROR' });
}

router.get('/', async (req, res) => {
  try {
    const q = z.object({ kind: z.enum(['fact', 'preference', 'note', 'episode']).optional(), q: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(500).optional(), offset: z.coerce.number().int().min(0).optional() }).parse(req.query);
    const [status, list] = await Promise.all([memory().status(userIdOf(req)), memory().list(userIdOf(req), q)]);
    res.json({ success: true, ...status, ...list, pro: { name: PLANS.PRO.name, priceUsd: PLANS.PRO.priceUsd, listPriceUsd: PLANS.PRO.listPriceUsd, priceRwf: PLANS.PRO.priceRwf } });
  } catch (e) { fail(res, e); }
});

router.patch('/settings', async (req, res) => {
  try {
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(req.body ?? {});
    res.json({ success: true, ...(await memory().setEnabled(userIdOf(req), enabled)) });
  } catch (e) { fail(res, e); }
});

router.post('/', async (req, res) => {
  try {
    const body = z.object({ content: z.string().min(3).max(500), kind: z.enum(['fact', 'preference', 'note']).optional() }).strict().parse(req.body ?? {});
    const status = await memory().status(userIdOf(req));
    if (!status.available) throw new MemoryUpgradeRequired();
    res.status(201).json({ success: true, item: await memory().add(userIdOf(req), body.content, { kind: body.kind ?? 'note', source: 'user' }) });
  } catch (e) { fail(res, e); }
});

router.patch('/:id', async (req, res) => {
  try {
    const { content } = z.object({ content: z.string().min(3).max(500) }).strict().parse(req.body ?? {});
    res.json({ success: true, item: await memory().update(userIdOf(req), req.params.id, content) });
  } catch (e) { fail(res, e); }
});

router.delete('/:id', async (req, res) => {
  try { await memory().remove(userIdOf(req), req.params.id); res.json({ success: true }); } catch (e) { fail(res, e); }
});

router.delete('/', async (req, res) => {
  try { res.json({ success: true, deleted: await memory().clear(userIdOf(req)) }); } catch (e) { fail(res, e); }
});

export default router;
