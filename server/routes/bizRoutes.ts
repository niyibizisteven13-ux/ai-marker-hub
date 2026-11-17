import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { requireAuth } from '../../production/auth.js';
import { visitorKey } from '../services/appFeedback.js';
import { bizService } from '../services/biz/runtime.js';
import { BizError } from '../services/biz/service.js';
import { MediaError } from '../services/biz/media.js';
import { FREE_LIMITS, PAID_LIMITS, openNow } from '../services/biz/model.js';
import { planFor } from '../services/billing/plans.js';
import logger from '../utils/logger.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getJwtSecret } from '../auth/secrets.js';
import { openNow as openNowFor, publicView } from '../services/biz/model.js';

/**
 * /api/biz
 *   public (no sign-in):  GET /public/:slug · GET /public/:slug/media/:id · POST /public/:slug/{track,enquiry,report}
 *   owner (signed in):    GET /mine · POST / · GET|PATCH|DELETE /:id · POST /:id/publish · products · media · messages · stats
 * Public routes answer only with publicView, counts, or a file of a live page that the owner shows. See server/services/biz/model.ts.
 */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 26 * 1024 * 1024, files: 1 } });
const who = (req: Request) => visitorKey(String(req.ip ?? req.socket?.remoteAddress ?? ''), String(req.headers['user-agent'] ?? ''));
const me = (req: Request) => String((req as any).user?.userId ?? '');
function fail(res: Response, e: unknown) {
  if (e instanceof BizError || e instanceof MediaError) return res.status(e.status).json({ error: e.message, ...(e instanceof BizError ? { code: e.code } : {}) });
  logger.error('[biz] failed', { errorType: (e as Error)?.name });
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
}
const run = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => { fn(req, res).catch((e) => fail(res, e)); };

/** Short-lived signed links so the studio can show an unpublished page's photos and videos (an image tag cannot send a sign-in header). */
const sign = (bizId: string, mediaId: string, exp: number) => createHmac('sha256', getJwtSecret()).update(`biz-media|${bizId}|${mediaId}|${exp}`).digest('base64url');
export const signedMediaUrl = (bizId: string, mediaId: string, ttlMs = 30 * 60_000, now = Date.now()) => { const exp = now + ttlMs; return `/api/biz/owner-media/${encodeURIComponent(bizId)}/${encodeURIComponent(mediaId)}?exp=${exp}&sig=${sign(bizId, mediaId, exp)}`; };
function validSignature(bizId: string, mediaId: string, exp: unknown, sig: unknown, now = Date.now()) {
  const e = Number(exp); if (!Number.isFinite(e) || e < now || e > now + 24 * 3600_000 || typeof sig !== 'string') return false;
  const want = Buffer.from(sign(bizId, mediaId, e)), got = Buffer.from(sig); return want.length === got.length && timingSafeEqual(want, got);
}

/** Streams a stored file with a Range answer when asked, so videos can be played and sought. */
async function send(req: Request, res: Response, f: { mime: string; size: number; open: (range?: { start: number; end: number }) => Promise<{ stream: NodeJS.ReadableStream }> }, cache: string) {
  res.setHeader('Content-Type', f.mime); res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Cache-Control', cache);
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox"); res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, f.size - Number(m[2])); let end = m[1] && m[2] ? Number(m[2]) : f.size - 1; end = Math.min(end, f.size - 1);
    if (!(start <= end) || start >= f.size) { res.status(416).setHeader('Content-Range', `bytes */${f.size}`); return res.end(); }
    res.status(206); res.setHeader('Content-Range', `bytes ${start}-${end}/${f.size}`); res.setHeader('Content-Length', String(end - start + 1));
    (await f.open({ start, end })).stream.pipe(res); return;
  }
  res.setHeader('Content-Length', String(f.size)); (await f.open()).stream.pipe(res);
}

export function createBizRouter(): Router {
  const r = Router();
  const svc = () => bizService();

  /* ------------------------------------------------------------ public */
  r.get('/public/:slug', run(async (req, res) => {
    const b = await svc().publicBySlug(req.params.slug, { count: true });
    if (!b) return res.status(404).json({ error: 'This page is not available.' });
    res.setHeader('Cache-Control', 'no-cache'); res.json({ business: b, openNow: openNow(b.hours) });
  }));
  r.get('/public/:slug/media/:mid', run(async (req, res) => {
    const f = await svc().mediaFor(req.params.slug, req.params.mid); if (!f) return res.status(404).end();
    await send(req, res, f, 'public, max-age=3600');
  }));
  r.post('/public/:slug/track', run(async (req, res) => { const k = ['whatsapp', 'call', 'share'].includes(String(req.body?.kind)) ? req.body.kind : null; if (!k) return res.status(400).json({ error: 'Unknown kind.' }); res.json({ ok: await svc().track(req.params.slug, k, who(req)) }); }));
  r.post('/public/:slug/enquiry', run(async (req, res) => { const out = await svc().submitEnquiry(req.params.slug, req.body ?? {}, who(req)); res.status(out.saved ? 201 : 200).json({ ok: true }); }));
  r.post('/public/:slug/report', run(async (req, res) => { await svc().report(req.params.slug, req.body ?? {}, who(req)); res.json({ ok: true }); }));

  r.get('/owner-media/:bizId/:mid', run(async (req, res) => {
    if (!validSignature(req.params.bizId, req.params.mid, req.query.exp, req.query.sig)) return res.status(403).end();
    const f = await svc().mediaById(req.params.bizId, req.params.mid); if (!f) return res.status(404).end();
    await send(req, res, f, 'private, max-age=600');
  }));

  /* ------------------------------------------------------------ owner */
  r.use(requireAuth);
  r.get('/mine', run(async (req, res) => {
    const plan = await planFor(me(req)).catch(() => null); const paid = !!plan && plan.id !== 'FREE';
    res.json({ businesses: await svc().list(me(req)), limits: paid ? PAID_LIMITS : FREE_LIMITS, plan: plan?.name ?? 'Free' });
  }));
  r.post('/', run(async (req, res) => res.status(201).json({ business: await svc().create(me(req), req.body ?? {}) })));
  r.get('/:id', run(async (req, res) => res.json({ business: await svc().get(me(req), req.params.id) })));
  r.patch('/:id', run(async (req, res) => res.json({ business: await svc().update(me(req), req.params.id, req.body ?? {}) })));
  r.delete('/:id', run(async (req, res) => { await svc().remove(me(req), req.params.id); res.status(204).end(); }));
  r.post('/:id/publish', run(async (req, res) => res.json({ business: await svc().setPublished(me(req), req.params.id, req.body?.on === true) })));

  r.post('/:id/products', run(async (req, res) => res.status(201).json({ product: await svc().addProduct(me(req), req.params.id, req.body ?? {}) })));
  r.patch('/:id/products/:pid', run(async (req, res) => res.json({ product: await svc().updateProduct(me(req), req.params.id, req.params.pid, req.body ?? {}) })));
  r.delete('/:id/products/:pid', run(async (req, res) => { await svc().removeProduct(me(req), req.params.id, req.params.pid); res.status(204).end(); }));

  r.post('/:id/media', (req, res, next) => upload.single('file')(req, res, (err?: any) => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large. A photo can be up to 6 MB and a video up to 25 MB.' : 'The file could not be uploaded.' });
    next();
  }), run(async (req, res) => {
    const file = (req as any).file as { originalname: string; buffer: Buffer } | undefined; if (!file) return res.status(400).json({ error: 'Choose a photo or a video first.' });
    res.status(201).json({ media: await svc().addMedia(me(req), req.params.id, { name: file.originalname, data: file.buffer, caption: req.body?.caption }) });
  }));
  r.patch('/:id/media/:mid', run(async (req, res) => res.json({ media: await svc().updateMedia(me(req), req.params.id, req.params.mid, req.body ?? {}) })));
  r.delete('/:id/media/:mid', run(async (req, res) => { await svc().removeMedia(me(req), req.params.id, req.params.mid); res.status(204).end(); }));
  r.get('/:id/media-urls', run(async (req, res) => { const b = await svc().get(me(req), req.params.id); res.json({ urls: Object.fromEntries(b.media.map((m) => [m.id, signedMediaUrl(b.id, m.id)])) }); }));
  r.get('/:id/preview', run(async (req, res) => { const b = await svc().get(me(req), req.params.id); res.json({ business: publicView(b), openNow: openNowFor(b.hours) }); }));

  r.get('/:id/enquiries', run(async (req, res) => res.json({ enquiries: await svc().enquiries(me(req), req.params.id) })));
  r.patch('/:id/enquiries/:eid', run(async (req, res) => res.json({ enquiry: await svc().setEnquiry(me(req), req.params.id, req.params.eid, req.body?.status) })));
  r.get('/:id/stats', run(async (req, res) => res.json(await svc().stats(me(req), req.params.id))));
  return r;
}
export default createBizRouter();
