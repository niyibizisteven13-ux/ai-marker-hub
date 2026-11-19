import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { requireAuth } from '../../production/auth.js';
import { visitorKey } from '../services/appFeedback.js';
import { bizService } from '../services/biz/runtime.js';
import { BizError } from '../services/biz/service.js';
import { ProgramError } from '../services/biz/programsService.js';
import { MediaError } from '../services/biz/media.js';
import { FREE_LIMITS, PAID_LIMITS, openNow } from '../services/biz/model.js';
import { planFor } from '../services/billing/plans.js';
import logger from '../utils/logger.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getJwtSecret } from '../auth/secrets.js';
import { openNow as openNowFor, publicView } from '../services/biz/model.js';
import { THEME_COLOR } from '../services/biz/shell.js';
const THEMES_FOR_ICON: Record<string, { accent: string; on: string }> = { gold: { accent: '#E9A23B', on: '#1A1405' }, teal: { accent: '#0F9D8F', on: '#FFFFFF' }, green: { accent: '#1E9E5A', on: '#FFFFFF' }, blue: { accent: '#2F6FED', on: '#FFFFFF' }, rose: { accent: '#DB4F8E', on: '#FFFFFF' }, violet: { accent: '#7C5CF0', on: '#FFFFFF' }, ink: { accent: '#0E1722', on: '#FFFFFF' } };

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
  if (e instanceof ProgramError) return res.status(e.status).json({ error: e.message, code: e.code });
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
  // The business's own installable app (a home-screen app that opens its page). Built only from public fields.
  r.get('/public/:slug/manifest.webmanifest', run(async (req, res) => {
    const b = await svc().publicBySlug(req.params.slug); if (!b) return res.status(404).end(); const slug = encodeURIComponent(b.slug);
    res.type('application/manifest+json').setHeader('Cache-Control', 'public, max-age=600');
    res.json({ name: b.name, short_name: b.name.slice(0, 12), description: b.tagline || undefined, id: `/b/${slug}`, start_url: `/b/${slug}?source=app`, scope: `/b/${slug}`, display: 'standalone', orientation: 'portrait',
      background_color: '#FFFFFF', theme_color: THEME_COLOR[b.theme] ?? '#0E1722', icons: [{ src: `/api/biz/public/${slug}/icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }] });
  }));
  r.get('/public/:slug/icon.svg', run(async (req, res) => {
    const b = await svc().publicBySlug(req.params.slug); if (!b) return res.status(404).end();
    const t = THEMES_FOR_ICON[b.theme] ?? { accent: '#0E1722', on: '#FFFFFF' }; const ini = b.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase().replace(/[<>&"']/g, '');
    res.type('image/svg+xml').setHeader('Cache-Control', 'public, max-age=3600');
    res.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${t.accent}"/><text x="256" y="300" font-family="Arial,Helvetica,sans-serif" font-size="210" font-weight="700" text-anchor="middle" fill="${t.on}">${ini || 'B'}</text></svg>`);
  }));
  r.get('/public/:slug/posts', run(async (req, res) => { res.setHeader('Cache-Control', 'private, no-cache'); res.json({ posts: await svc().publicPosts(req.params.slug, { limit: Number(req.query.limit) || 20, postId: typeof req.query.post === 'string' ? req.query.post : undefined, visitor: who(req) }) }); }));
  r.post('/public/:slug/posts/:pid/like', run(async (req, res) => res.json(await svc().like(req.params.slug, req.params.pid, who(req)))));
  r.get('/public/:slug/posts/:pid/comments', run(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ comments: await svc().publicComments(req.params.slug, req.params.pid) }); }));
  r.post('/public/:slug/posts/:pid/comments', run(async (req, res) => res.status(201).json({ comment: await svc().addComment(req.params.slug, req.params.pid, req.body ?? {}, who(req)) })));
  r.post('/public/:slug/forms/:sid', run(async (req, res) => { const out = await svc().submitForm(req.params.slug, req.params.sid, req.body ?? {}, who(req)); res.status(out.saved ? 201 : 200).json({ ok: true }); }));
  r.post('/public/:slug/track', run(async (req, res) => { const k = ['whatsapp', 'call', 'share'].includes(String(req.body?.kind)) ? req.body.kind : null; if (!k) return res.status(400).json({ error: 'Unknown kind.' }); res.json({ ok: await svc().track(req.params.slug, k, who(req)) }); }));
  r.post('/public/:slug/enquiry', run(async (req, res) => { const out = await svc().submitEnquiry(req.params.slug, req.body ?? {}, who(req)); res.status(out.saved ? 201 : 200).json({ ok: true }); }));
  r.post('/public/:slug/order', run(async (req, res) => { const out = await svc().submitOrder(req.params.slug, req.body ?? {}, who(req)); res.status(out.saved ? 201 : 200).json({ ok: true, total: out.total }); }));
  r.post('/public/:slug/pay', run(async (req, res) => res.status(201).json(await svc().submitPayment(req.params.slug, req.body ?? {}, who(req)))));
  r.get('/public/:slug/pay/:ref', run(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await svc().publicPayStatus(req.params.slug, req.params.ref)); }));
  // Programs and other programs: join from the shared link, pay, and show the pass. The pass link is a secret only its holder has.
  r.post('/public/:slug/plans/:pid/join', run(async (req, res) => res.status(201).json(await svc().joinProgram(req.params.slug, req.params.pid, req.body ?? {}, who(req)))));
  r.get('/public/:slug/pass/:token', run(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex'); res.json(await svc().passView(req.params.slug, req.params.token)); }));
  r.post('/public/:slug/pass/:token/pay', run(async (req, res) => res.json(await svc().payMember(req.params.slug, req.params.token, req.body ?? {}, who(req)))));
  r.post('/public/:slug/pass/:token/claim', run(async (req, res) => res.json(await svc().claimPaid(req.params.slug, req.params.token, req.body ?? {}, who(req)))));
  r.post('/public/:slug/report', run(async (req, res) => { await svc().report(req.params.slug, req.body ?? {}, who(req)); res.json({ ok: true }); }));

  r.get('/owner-media/:bizId/:mid', run(async (req, res) => {
    if (!validSignature(req.params.bizId, req.params.mid, req.query.exp, req.query.sig)) return res.status(403).end();
    const f = await svc().mediaById(req.params.bizId, req.params.mid); if (!f) return res.status(404).end();
    await send(req, res, f, 'private, max-age=600');
  }));

  /* ------------------------------------------------------------ owner */
  r.use(requireAuth);
  r.get('/mine', run(async (req, res) => {
    const plan = await planFor(me(req)).catch(() => null); const paid = !!plan && plan.id !== 'FREE'; const { bizAllowed } = await import('../services/biz/runtime.js');
    if (!(await bizAllowed(me(req)))) {
      // Locked: the dashboard needs a paid plan. Say so, with the price from the plan table; show only the names of businesses already made.
      const { PLANS } = await import('../services/billing/plans.js'); const list = await svc().list(me(req));
      return res.json({ prefs: await svc().prefs(me(req)), locked: true, businesses: list.map((b) => ({ id: b.id, name: b.name, slug: b.slug, published: b.published })), limits: FREE_LIMITS, plan: plan?.name ?? 'Free', upgrade: { plan: 'STARTER', name: PLANS.STARTER.name, priceRwf: PLANS.STARTER.priceRwf, priceNote: PLANS.STARTER.priceNote, url: '/upgrade' } });
    }
    res.json({ prefs: await svc().prefs(me(req)), locked: false, paid, businesses: await svc().list(me(req)), limits: paid ? PAID_LIMITS : FREE_LIMITS, plan: plan?.name ?? 'Free', upgradeUrl: '/upgrade' });
  }));
  r.put('/prefs', run(async (req, res) => res.json({ prefs: await svc().setPrefs(me(req), req.body ?? {}) })));
  r.post('/', run(async (req, res) => res.status(201).json({ business: await svc().create(me(req), req.body ?? {}) })));
  r.get('/:id', run(async (req, res) => res.json({ business: await svc().get(me(req), req.params.id) })));
  r.patch('/:id', run(async (req, res) => res.json({ business: await svc().update(me(req), req.params.id, req.body ?? {}) })));
  r.delete('/:id', run(async (req, res) => { await svc().remove(me(req), req.params.id); res.status(204).end(); }));
  r.post('/:id/publish', run(async (req, res) => res.json({ business: await svc().setPublished(me(req), req.params.id, req.body?.on === true) })));

  // programs (programs): the plans, the people on them, serving a item by scan or code
  r.get('/:id/programs', run(async (req, res) => res.json({ programs: await svc().programs(me(req), req.params.id), summary: await svc().programSummary(me(req), req.params.id) })));
  r.post('/:id/programs', run(async (req, res) => res.status(201).json({ program: await svc().saveProgram(me(req), req.params.id, req.body ?? {}) })));
  r.delete('/:id/programs/:pid', run(async (req, res) => { await svc().deleteProgram(me(req), req.params.id, req.params.pid); res.status(204).end(); }));
  r.get('/:id/members', run(async (req, res) => res.json({ members: await svc().members(me(req), req.params.id, { programId: typeof req.query.program === 'string' ? req.query.program : undefined, state: typeof req.query.state === 'string' ? req.query.state : undefined, q: typeof req.query.q === 'string' ? req.query.q : undefined }) })));
  r.post('/:id/members/:mid/confirm', run(async (req, res) => res.json({ member: await svc().confirmPayment(me(req), req.params.id, req.params.mid, req.body ?? {}) })));
  r.patch('/:id/members/:mid', run(async (req, res) => res.json({ member: await svc().setMember(me(req), req.params.id, req.params.mid, req.body ?? {}) })));
  r.post('/:id/uses/redeem', run(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await svc().redeem(me(req), req.params.id, req.body ?? {})); }));
  r.post('/:id/uses/:useId/undo', run(async (req, res) => res.json(await svc().undoUse(me(req), req.params.id, req.params.useId))));
  r.get('/:id/uses/today', run(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await svc().today(me(req), req.params.id)); }));

  r.post('/:id/products', run(async (req, res) => res.status(201).json({ product: await svc().addProduct(me(req), req.params.id, req.body ?? {}) })));
  r.patch('/:id/products/:pid', run(async (req, res) => res.json({ product: await svc().updateProduct(me(req), req.params.id, req.params.pid, req.body ?? {}) })));
  r.delete('/:id/products/:pid', run(async (req, res) => { await svc().removeProduct(me(req), req.params.id, req.params.pid); res.status(204).end(); }));

  r.post('/:id/media', (req, res, next) => upload.single('file')(req, res, (err?: any) => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large. A photo can be up to 6 MB and a video up to 25 MB.' : 'The file could not be uploaded.' });
    next();
  }), run(async (req, res) => {
    const file = (req as any).file as { originalname: string; buffer: Buffer } | undefined; if (!file) return res.status(400).json({ error: 'Choose a photo or a video first.' });
    res.status(201).json({ media: await svc().addMedia(me(req), req.params.id, { name: file.originalname, data: file.buffer, caption: req.body?.caption, scope: req.body?.scope }) });
  }));
  r.patch('/:id/media/:mid', run(async (req, res) => res.json({ media: await svc().updateMedia(me(req), req.params.id, req.params.mid, req.body ?? {}) })));
  r.delete('/:id/media/:mid', run(async (req, res) => { await svc().removeMedia(me(req), req.params.id, req.params.mid); res.status(204).end(); }));
  r.get('/:id/media-urls', run(async (req, res) => { const b = await svc().get(me(req), req.params.id); res.json({ urls: Object.fromEntries(b.media.map((m) => [m.id, signedMediaUrl(b.id, m.id)])) }); }));
  r.get('/:id/preview', run(async (req, res) => { const b = await svc().get(me(req), req.params.id); res.json({ business: publicView(b), openNow: openNowFor(b.hours) }); }));

  r.get('/:id/posts', run(async (req, res) => res.json({ posts: await svc().posts(me(req), req.params.id) })));
  r.post('/:id/posts', run(async (req, res) => res.status(201).json({ post: await svc().addPost(me(req), req.params.id, req.body ?? {}) })));
  r.patch('/:id/posts/:pid', run(async (req, res) => res.json({ post: await svc().setPost(me(req), req.params.id, req.params.pid, req.body ?? {}) })));
  r.delete('/:id/posts/:pid', run(async (req, res) => { await svc().removePost(me(req), req.params.id, req.params.pid); res.status(204).end(); }));
  r.get('/:id/posts/:pid/comments', run(async (req, res) => res.json({ comments: await svc().comments(me(req), req.params.id, req.params.pid) })));
  r.post('/:id/posts/:pid/comments', run(async (req, res) => res.status(201).json({ comment: await svc().replyComment(me(req), req.params.id, req.params.pid, req.body?.text) })));
  r.delete('/:id/comments/:cid', run(async (req, res) => { await svc().removeComment(me(req), req.params.id, req.params.cid); res.status(204).end(); }));
  r.get('/:id/enquiries', run(async (req, res) => res.json({ enquiries: await svc().enquiries(me(req), req.params.id) })));
  r.patch('/:id/enquiries/:eid', run(async (req, res) => res.json({ enquiry: await svc().setEnquiry(me(req), req.params.id, req.params.eid, req.body?.status) })));
  r.get('/:id/ledger', run(async (req, res) => res.json({ entries: await svc().ledger(me(req), req.params.id, { type: req.query.type === 'sale' || req.query.type === 'expense' ? req.query.type : undefined, days: Math.min(400, Math.max(0, Number(req.query.days) || 0)) || undefined }) })));
  r.post('/:id/ledger', run(async (req, res) => res.status(201).json(await svc().addEntry(me(req), req.params.id, { ...(req.body ?? {}), src: 'studio' }))));
  r.patch('/:id/ledger/:eid', run(async (req, res) => res.json({ entry: await svc().setEntryStatus(me(req), req.params.id, req.params.eid, req.body?.status) })));
  r.delete('/:id/ledger/:eid', run(async (req, res) => { await svc().removeEntry(me(req), req.params.id, req.params.eid); res.status(204).end(); }));
  r.patch('/:id/ledger/:eid/edit', run(async (req, res) => res.json({ entry: await svc().updateEntry(me(req), req.params.id, req.params.eid, req.body ?? {}) })));
  r.get('/:id/costs', run(async (req, res) => res.json(await svc().costs(me(req), req.params.id))));
  r.put('/:id/budgets', run(async (req, res) => { await svc().setBudget(me(req), req.params.id, req.body?.category, req.body?.amount); res.json(await svc().costs(me(req), req.params.id)); }));
  r.get('/:id/recurring', run(async (req, res) => res.json({ recurring: await svc().recurring(me(req), req.params.id) })));
  r.post('/:id/recurring', run(async (req, res) => res.status(201).json({ recurring: await svc().addRecurring(me(req), req.params.id, req.body ?? {}) })));
  r.patch('/:id/recurring/:rid', run(async (req, res) => { if (!(await svc().setRecurring(me(req), req.params.id, req.params.rid, req.body ?? {}))) return res.status(404).json({ error: 'That recurring cost was not found.' }); res.json({ ok: true }); }));
  r.get('/:id/sections', run(async (req, res) => res.json({ sections: await svc().sections(me(req), req.params.id) })));
  r.post('/:id/sections', run(async (req, res) => res.status(201).json({ section: await svc().saveSection(me(req), req.params.id, req.body ?? {}) })));
  r.patch('/:id/sections/:sid', run(async (req, res) => res.json({ section: await svc().saveSection(me(req), req.params.id, { ...(req.body ?? {}), id: req.params.sid }) })));
  r.post('/:id/sections/:sid/move', run(async (req, res) => { await svc().moveSection(me(req), req.params.id, req.params.sid, Number(req.body?.dir) || 0); res.json({ ok: true }); }));
  r.delete('/:id/sections/:sid', run(async (req, res) => { if (!(await svc().removeSection(me(req), req.params.id, req.params.sid))) return res.status(404).json({ error: 'That section was not found.' }); res.status(204).end(); }));
  r.get('/:id/trackers', run(async (req, res) => res.json({ trackers: await svc().trackers(me(req), req.params.id) })));
  r.post('/:id/trackers', run(async (req, res) => res.status(201).json({ tracker: await svc().createTracker(me(req), req.params.id, req.body ?? {}) })));
  r.post('/:id/features/:kind', run(async (req, res) => res.status(201).json(await svc().addFeature(me(req), req.params.id, req.params.kind, req.body?.lang === 'rw' ? 'rw' : 'en'))));
  r.delete('/:id/trackers/:tid', run(async (req, res) => { if (!(await svc().deleteTracker(me(req), req.params.id, req.params.tid))) return res.status(404).json({ error: 'That tracker was not found.' }); res.status(204).end(); }));
  r.get('/:id/trackers/:tid/records', run(async (req, res) => res.json(await svc().records(me(req), req.params.id, req.params.tid, { status: typeof req.query.status === 'string' ? req.query.status : undefined }))));
  r.post('/:id/trackers/:tid/records', run(async (req, res) => res.status(201).json({ record: await svc().addRecord(me(req), req.params.id, req.params.tid, req.body ?? {}) })));
  r.patch('/:id/records/:rid', run(async (req, res) => res.json({ record: await svc().updateRecord(me(req), req.params.id, req.params.rid, req.body ?? {}) })));
  r.delete('/:id/records/:rid', run(async (req, res) => { if (!(await svc().deleteRecord(me(req), req.params.id, req.params.rid))) return res.status(404).json({ error: 'That record was not found.' }); res.status(204).end(); }));
  r.put('/:id/lang', run(async (req, res) => res.json({ lang: await svc().setLang(me(req), req.params.id, req.body?.lang) })));
  r.put('/:id/translations/:lang', run(async (req, res) => res.json({ translation: await svc().setTranslation(me(req), req.params.id, req.params.lang, req.body ?? {}) })));
  r.get('/:id/dashboard', run(async (req, res) => res.json(await svc().dashboard(me(req), req.params.id, [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 7))));
  /** The owner's own Business Agent chat (a dedicated agent for this business, not the general chat). Spends credits like any assistant action. */
  r.post('/:id/agent/chat', run(async (req, res) => {
    const b = await svc().get(me(req), req.params.id);
    const message = String(req.body?.message ?? '').trim().slice(0, 2000); if (!message) return res.status(400).json({ error: 'Write a message first.' });
    const { allowAi } = await import('../services/billing/aiMeter.js'); if (!(await allowAi(res, me(req), 'chat'))) return;
    const history = (Array.isArray(req.body?.history) ? req.body.history : []).slice(-12).map((h: any) => ({ role: h?.role === 'assistant' ? 'assistant' : 'user', content: String(h?.text ?? '').slice(0, 2500) })).filter((h: any) => h.content);
    let files: Array<{ type: 'image'; base64: string; mediaType: string }> | undefined;
    const img = typeof req.body?.image === 'string' ? req.body.image : '';
    if (img) {
      const buf = Buffer.from(img.replace(/^data:[^,]+,/, ''), 'base64'); const { sniff } = await import('../services/biz/media.js'); const m = sniff(buf);
      if (!m || m.kind !== 'image' || buf.length > 6 * 1024 * 1024) return res.status(400).json({ error: 'Attach a photo (JPEG, PNG or WebP) up to 6 MB.' });
      files = [{ type: 'image', base64: buf.toString('base64'), mediaType: m.mime }];
    }
    const { CHAT_TOOLS, chatSystem } = await import('../services/biz/agent.js'); const { AiService } = await import('../services/AiService.js');
    const out: any = await (AiService.getInstance() as any).generalAssist({ userId: me(req), messages: [...history, { role: 'user', content: message }], planText: message, files, unattended: { toolNames: CHAT_TOOLS, system: chatSystem(b) }, channel: 'web' });
    res.json({ reply: String(out?.content?.[0]?.text ?? '').trim() || 'I could not answer that. Please try again.' });
  }));
  r.get('/:id/agent', run(async (req, res) => res.json({ agent: await svc().agent(me(req), req.params.id) })));
  r.put('/:id/agent', run(async (req, res) => res.json({ agent: await svc().setAgent(me(req), req.params.id, req.body ?? {}) })));
  r.get('/:id/secrets', run(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await svc().secretsStatus(me(req), req.params.id)); }));
  r.put('/:id/secrets/:provider', run(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); await svc().saveSecrets(me(req), req.params.id, req.params.provider, req.body ?? {}); res.json(await svc().secretsStatus(me(req), req.params.id)); }));
  r.delete('/:id/secrets/:provider', run(async (req, res) => { await svc().clearSecrets(me(req), req.params.id, req.params.provider); res.json(await svc().secretsStatus(me(req), req.params.id)); }));
  r.post('/:id/secrets/:provider/test', run(async (req, res) => res.json(await svc().testSecrets(me(req), req.params.id, req.params.provider))));
  r.post('/:id/pay', run(async (req, res) => res.status(201).json({ entry: await svc().requestPayment(me(req), req.params.id, req.body ?? {}) })));
  r.post('/:id/pay/:eid/refresh', run(async (req, res) => res.json({ entry: await svc().refreshPayment(me(req), req.params.id, req.params.eid) })));
  r.get('/:id/stats', run(async (req, res) => res.json(await svc().stats(me(req), req.params.id))));
  return r;
}
export default createBizRouter();
