import { randomUUID } from 'node:crypto';
import { MediaError, maxBytesFor, sniff, type MediaStore } from './media.js';
import {
  CATEGORIES, applyProfile, clean, cleanEmail, cleanPhone, cleanProduct, isLive, limitsFor, newBusiness, oneOf, publicView, slugFrom, validSlug,
  type Business, type Category, type DayStats, type Enquiry, type PublicBusiness, type Product,
} from './model.js';

/**
 * Everything bwenge4biz does, with its storage injected (the AppSetting table in production, memory in tests). Every owner method checks that the
 * business belongs to the person asking; every public method answers only with `publicView` or a count.
 *   biz:<id> the business · biz-slug:<slug> -> id · biz-owner:<userId> -> ids · biz-enq:<id> messages · biz-stats:<id> counts
 *   biz-reports reports against pages · biz-index every id (for the administrator)
 */
export interface Kv { get<T>(key: string): Promise<T | null>; put(key: string, value: unknown): Promise<void>; del(key: string): Promise<void> }
export class BizError extends Error { constructor(message: string, public status = 400, public code = 'BIZ') { super(message); } }
export interface Deps { kv: Kv; media: MediaStore; isPaid: (ownerId: string) => Promise<boolean>; now?: () => number }
export interface Report { id: string; at: string; slug: string; reason: string; detail: string }

const MAX_STATS_DAYS = 62, MAX_REPORTS = 300;
const day = (t: number) => new Date(t + 2 * 3600_000).toISOString().slice(0, 10);       // Kigali date
const emptyDay = (): DayStats => ({ views: 0, whatsapp: 0, calls: 0, shares: 0, enquiries: 0 });
export const REPORT_REASONS = ['scam', 'illegal', 'offensive', 'copied', 'other'] as const;

/* Spam protection for the public forms, kept in memory (only a hash of the visitor is used as the key). */
const attempts = new Map<string, number[]>(); const lastCount = new Map<string, number>();
export const resetBizLimitsForTests = () => { attempts.clear(); lastCount.clear(); };
function tooMany(key: string, max: number, now: number, windowMs = 3_600_000) {
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { attempts.set(key, recent); return true; }
  attempts.set(key, [...recent, now]); if (attempts.size > 8000) attempts.clear(); return false;
}

export function createBizService(deps: Deps) {
  const { kv, media } = deps; const now = () => (deps.now ?? Date.now)();
  const iso = () => new Date(now()).toISOString();

  const load = async (id: string): Promise<Business | null> => kv.get<Business>(`biz:${id}`);
  const save = async (b: Business) => { b.updatedAt = iso(); await kv.put(`biz:${b.id}`, b); };
  /** The owner's own business, or a plain "not found" (never says whether someone else's exists). */
  async function mine(ownerId: string, id: string): Promise<Business> {
    const b = await load(String(id)); if (!b || b.ownerId !== ownerId) throw new BizError('That business was not found.', 404, 'NOT_FOUND'); return b;
  }
  const slugOwner = async (slug: string) => (await kv.get<{ id: string }>(`biz-slug:${slug}`))?.id ?? null;
  async function limits(ownerId: string) { return limitsFor(await deps.isPaid(ownerId)); }
  const bump = async (id: string, field: keyof DayStats) => {
    const s = (await kv.get<{ days: Record<string, DayStats> }>(`biz-stats:${id}`)) ?? { days: {} }; const d = day(now());
    s.days[d] = { ...emptyDay(), ...s.days[d] }; s.days[d][field] += 1;
    for (const old of Object.keys(s.days).sort().slice(0, Math.max(0, Object.keys(s.days).length - MAX_STATS_DAYS))) delete s.days[old];
    await kv.put(`biz-stats:${id}`, s);
  };
  async function publicLive(slug: string): Promise<Business | null> {
    const id = await slugOwner(String(slug).toLowerCase()); if (!id) return null; const b = await load(id); return b && isLive(b) ? b : null;
  }

  return {
    /* ------------------------------------------------------------ owner */
    async list(ownerId: string): Promise<Business[]> {
      const ids = (await kv.get<{ ids: string[] }>(`biz-owner:${ownerId}`))?.ids ?? [];
      return (await Promise.all(ids.map(load))).filter((b): b is Business => !!b && b.ownerId === ownerId);
    },
    get: mine,

    async create(ownerId: string, input: { name?: unknown; slug?: unknown; category?: unknown }): Promise<Business> {
      const name = clean(input.name, 60); if (!name) throw new BizError('Give the business a name.');
      const lim = await limits(ownerId); const have = await this.list(ownerId);
      if (have.length >= lim.businesses) throw new BizError(`Your plan has room for ${lim.businesses} business${lim.businesses === 1 ? '' : 'es'}. Upgrade to add more.`, 402, 'LIMIT');
      let slug = slugFrom(name); const wanted = input.slug !== undefined && input.slug !== '' ? validSlug(input.slug) : null;
      if (wanted) { if (wanted.ok === false) throw new BizError(wanted.error); slug = wanted.slug; }
      else { const v = validSlug(slug); if (v.ok === false) slug = `${slug.replace(/^bwenge-?/, '')}-biz`.slice(0, 32); if (validSlug(slug).ok === false) slug = `shop-${randomUUID().slice(0, 6)}`; }
      if (await slugOwner(slug)) { if (wanted) throw new BizError('That page name is taken. Try another.', 409, 'SLUG_TAKEN'); slug = `${slug.slice(0, 26)}-${randomUUID().slice(0, 4)}`; }
      const b = newBusiness(randomUUID(), ownerId, name, slug, oneOf(CATEGORIES, input.category, 'other') as Category, iso());
      await kv.put(`biz-slug:${slug}`, { id: b.id }); await save(b);
      const ids = (await kv.get<{ ids: string[] }>(`biz-owner:${ownerId}`))?.ids ?? []; await kv.put(`biz-owner:${ownerId}`, { ids: [...ids, b.id] });
      const all = (await kv.get<{ ids: string[] }>('biz-index'))?.ids ?? []; await kv.put('biz-index', { ids: [...all, b.id] });
      return b;
    },

    async update(ownerId: string, id: string, patch: Record<string, unknown>): Promise<Business> {
      const b = await mine(ownerId, id);
      if (patch.slug !== undefined && String(patch.slug).toLowerCase() !== b.slug) {
        const v = validSlug(patch.slug); if (v.ok === false) throw new BizError(v.error);
        if (await slugOwner(v.slug)) throw new BizError('That page name is taken. Try another.', 409, 'SLUG_TAKEN');
        await kv.del(`biz-slug:${b.slug}`); await kv.put(`biz-slug:${v.slug}`, { id: b.id }); b.slug = v.slug;
      }
      applyProfile(b, patch);
      const pick = (k: 'logoId' | 'coverId') => { if (patch[k] === undefined) return; const m = b.media.find((x) => x.id === patch[k]); if (patch[k] && !(m && m.kind === 'image')) throw new BizError('Choose one of your photos.'); if (patch[k]) b[k] = m!.id; else delete b[k]; };
      pick('logoId'); pick('coverId');
      await save(b); return b;
    },

    async setPublished(ownerId: string, id: string, on: boolean): Promise<Business> {
      const b = await mine(ownerId, id);
      if (on && b.suspended) throw new BizError('This page was hidden by Bwenge. Contact support.', 403, 'SUSPENDED');
      if (on && !b.about && !b.tagline && !b.products.length && !b.media.length) throw new BizError('Add a short description, a product or a photo first, so visitors see something.', 400, 'EMPTY');
      b.published = !!on; await save(b); return b;
    },

    async remove(ownerId: string, id: string): Promise<void> {
      const b = await mine(ownerId, id);
      await media.removeAll(b.id).catch(() => undefined);
      await Promise.all([kv.del(`biz:${b.id}`), kv.del(`biz-slug:${b.slug}`), kv.del(`biz-enq:${b.id}`), kv.del(`biz-stats:${b.id}`)]);
      const ids = (await kv.get<{ ids: string[] }>(`biz-owner:${ownerId}`))?.ids ?? []; await kv.put(`biz-owner:${ownerId}`, { ids: ids.filter((x) => x !== b.id) });
      const all = (await kv.get<{ ids: string[] }>('biz-index'))?.ids ?? []; await kv.put('biz-index', { ids: all.filter((x) => x !== b.id) });
    },

    /* products */
    async addProduct(ownerId: string, id: string, input: unknown): Promise<Product> {
      const b = await mine(ownerId, id); const lim = await limits(ownerId);
      if (b.products.length >= lim.products) throw new BizError(`You can have ${lim.products} products on your plan.`, 402, 'LIMIT');
      const p = cleanProduct(input, randomUUID()); if ('error' in p) throw new BizError(p.error);
      if (p.mediaId && !b.media.some((m) => m.id === p.mediaId)) delete p.mediaId;
      b.products.push(p); await save(b); return p;
    },
    async updateProduct(ownerId: string, id: string, productId: string, patch: unknown): Promise<Product> {
      const b = await mine(ownerId, id); const i = b.products.findIndex((p) => p.id === productId); if (i < 0) throw new BizError('That product was not found.', 404);
      const p = cleanProduct(patch, productId, b.products[i]); if ('error' in p) throw new BizError(p.error);
      if (p.mediaId && !b.media.some((m) => m.id === p.mediaId)) delete p.mediaId;
      b.products[i] = p; await save(b); return p;
    },
    async removeProduct(ownerId: string, id: string, productId: string): Promise<void> {
      const b = await mine(ownerId, id); const n = b.products.length; b.products = b.products.filter((p) => p.id !== productId);
      if (b.products.length === n) throw new BizError('That product was not found.', 404); await save(b);
    },

    /* photos and videos */
    async addMedia(ownerId: string, id: string, file: { name: string; data: Buffer; caption?: string }): Promise<Business['media'][number]> {
      const b = await mine(ownerId, id); const lim = await limits(ownerId);
      const kind = sniff(file.data); if (!kind) throw new BizError('Use a JPEG, PNG, WebP or GIF photo, or an MP4 or WebM video.', 415, 'TYPE');
      if (file.data.length > maxBytesFor(kind.kind)) throw new BizError(kind.kind === 'image' ? 'A photo can be up to 6 MB.' : 'A video can be up to 25 MB. Record a shorter clip.', 413, 'TOO_LARGE');
      const count = b.media.filter((m) => m.kind === kind.kind).length;
      if (count >= (kind.kind === 'image' ? lim.images : lim.videos)) throw new BizError(`Your plan has room for ${kind.kind === 'image' ? lim.images + ' photos' : lim.videos + ' videos'}. Remove one or upgrade.`, 402, 'LIMIT');
      const used = b.media.reduce((a, m) => a + m.size, 0);
      if (used + file.data.length > lim.totalMediaMb * 1048576) throw new BizError(`That would pass your ${lim.totalMediaMb} MB of photos and videos. Remove some or upgrade.`, 402, 'LIMIT');
      const m = { id: randomUUID(), kind: kind.kind, mime: kind.mime, size: file.data.length, name: clean(file.name, 80) || `${kind.kind}.${kind.ext}`, ...(clean(file.caption, 120) ? { caption: clean(file.caption, 120) } : {}), createdAt: iso(), visible: true };
      await media.put(b.id, m.id, kind.ext, file.data);
      b.media.push(m); if (kind.kind === 'image' && !b.coverId) b.coverId = m.id; await save(b); return m;
    },
    async updateMedia(ownerId: string, id: string, mediaId: string, patch: { caption?: unknown; visible?: unknown }) {
      const b = await mine(ownerId, id); const m = b.media.find((x) => x.id === mediaId); if (!m) throw new BizError('That photo or video was not found.', 404);
      if (patch.caption !== undefined) { const c = clean(patch.caption, 120); if (c) m.caption = c; else delete m.caption; }
      if (patch.visible !== undefined) { m.visible = patch.visible !== false; if (!m.visible) { if (b.coverId === m.id) delete b.coverId; if (b.logoId === m.id) delete b.logoId; } }
      await save(b); return m;
    },
    async removeMedia(ownerId: string, id: string, mediaId: string): Promise<void> {
      const b = await mine(ownerId, id); const m = b.media.find((x) => x.id === mediaId); if (!m) throw new BizError('That photo or video was not found.', 404);
      await media.remove(b.id, m.id, sniffExt(m.mime)).catch(() => undefined);
      b.media = b.media.filter((x) => x.id !== mediaId); if (b.coverId === mediaId) delete b.coverId; if (b.logoId === mediaId) delete b.logoId;
      for (const p of b.products) if (p.mediaId === mediaId) delete p.mediaId; await save(b);
    },

    /* messages from visitors, and counts: owner only */
    async enquiries(ownerId: string, id: string): Promise<Enquiry[]> { const b = await mine(ownerId, id); return (await kv.get<{ items: Enquiry[] }>(`biz-enq:${b.id}`))?.items ?? []; },
    async setEnquiry(ownerId: string, id: string, enqId: string, status: Enquiry['status']) {
      const b = await mine(ownerId, id); const doc = (await kv.get<{ items: Enquiry[] }>(`biz-enq:${b.id}`)) ?? { items: [] }; const e = doc.items.find((x) => x.id === enqId);
      if (!e) throw new BizError('That message was not found.', 404); e.status = oneOf(['new', 'seen', 'done'] as const, status, e.status); await kv.put(`biz-enq:${b.id}`, doc); return e;
    },
    async stats(ownerId: string, id: string) {
      const b = await mine(ownerId, id); const s = (await kv.get<{ days: Record<string, DayStats> }>(`biz-stats:${b.id}`))?.days ?? {};
      const since = day(now() - 29 * 86_400_000); const total = emptyDay(); const days: Array<{ day: string } & DayStats> = [];
      for (const d of Object.keys(s).sort()) if (d >= since) { days.push({ day: d, ...emptyDay(), ...s[d] }); for (const k of Object.keys(total) as Array<keyof DayStats>) total[k] += s[d][k] ?? 0; }
      const enq = (await kv.get<{ items: Enquiry[] }>(`biz-enq:${b.id}`))?.items ?? [];
      return { last30: total, days, newMessages: enq.filter((e) => e.status === 'new').length };
    },

    /* ------------------------------------------------------------ public */
    /** The public page, and one more view. Null when there is no such live page (an unpublished or hidden page looks like a missing one). */
    async publicBySlug(slug: string, opts: { count?: boolean } = {}): Promise<PublicBusiness | null> {
      const b = await publicLive(slug); if (!b) return null; if (opts.count) await bump(b.id, 'views').catch(() => undefined); return publicView(b);
    },
    async track(slug: string, kind: 'whatsapp' | 'call' | 'share', visitor: string): Promise<boolean> {
      const b = await publicLive(slug); if (!b) return false; const k = `${visitor}|${b.id}|${kind}`; const t = now();
      if (t - (lastCount.get(k) ?? 0) < 30_000) return true; lastCount.set(k, t); if (lastCount.size > 8000) lastCount.clear();
      await bump(b.id, kind === 'call' ? 'calls' : kind === 'whatsapp' ? 'whatsapp' : 'shares').catch(() => undefined); return true;
    },
    /** A file of a business by ids (drafts and hidden files too). Only reachable with a signed link the owner asked for; see bizRoutes. */
    async mediaById(bizId: string, mediaId: string) {
      const b = await load(String(bizId)); const m = b?.media.find((x) => x.id === mediaId); if (!b || !m) return null;
      return { mime: m.mime, size: m.size, open: (range?: { start: number; end: number }) => media.open(b.id, m.id, sniffExt(m.mime), range) };
    },
    /** How the page looks to visitors, for the owner, also before it is published. */
    async preview(ownerId: string, id: string): Promise<PublicBusiness> { return publicView(await mine(ownerId, id)); },
    /** A photo or video of a live page, only if the owner shows it. */
    async mediaFor(slug: string, mediaId: string) {
      const b = await publicLive(slug); const m = b?.media.find((x) => x.id === mediaId && x.visible); if (!b || !m) return null;
      return { mime: m.mime, size: m.size, open: (range?: { start: number; end: number }) => media.open(b.id, m.id, sniffExt(m.mime), range) };
    },
    async submitEnquiry(slug: string, input: { name?: unknown; contact?: unknown; message?: unknown; productId?: unknown; website?: unknown }, visitor: string): Promise<{ saved: boolean }> {
      if (clean(input.website, 40)) return { saved: false };                                                      // a robot filled the hidden field
      const b = await publicLive(slug); if (!b) throw new BizError('This page is not available.', 404, 'NOT_FOUND');
      const name = clean(input.name, 60), message = clean(input.message, 800); const contactRaw = clean(input.contact, 120);
      const contact = cleanEmail(contactRaw) ?? cleanPhone(contactRaw) ?? '';
      if (!message) throw new BizError('Write your message.'); if (!contact) throw new BizError('Add a phone number or an email so the business can reply.');
      // Only messages that are really sent count against the limit, so a typo in the form never locks an honest visitor out.
      if (tooMany(`enq|${visitor}`, 5, now())) throw new BizError('You sent several messages already. Please try again later.', 429, 'RATE');
      const lim = await limits(b.ownerId); const doc = (await kv.get<{ items: Enquiry[] }>(`biz-enq:${b.id}`)) ?? { items: [] };
      const productId = typeof input.productId === 'string' && b.products.some((p) => p.id === input.productId) ? input.productId : undefined;
      doc.items.unshift({ id: randomUUID(), at: iso(), name: name || 'Visitor', contact, message, ...(productId ? { productId } : {}), status: 'new' });
      await kv.put(`biz-enq:${b.id}`, { items: doc.items.slice(0, lim.enquiries) }); await bump(b.id, 'enquiries').catch(() => undefined);
      return { saved: true };
    },
    async report(slug: string, input: { reason?: unknown; detail?: unknown }, visitor: string): Promise<void> {
      const b = await publicLive(slug); if (!b) throw new BizError('This page is not available.', 404, 'NOT_FOUND');
      if (tooMany(`rep|${visitor}`, 4, now())) throw new BizError('Thank you. We already have your reports.', 429, 'RATE');
      const doc = (await kv.get<{ items: Report[] }>('biz-reports')) ?? { items: [] };
      doc.items.unshift({ id: randomUUID(), at: iso(), slug: b.slug, reason: oneOf(REPORT_REASONS, input.reason, 'other'), detail: clean(input.detail, 400) });
      await kv.put('biz-reports', { items: doc.items.slice(0, MAX_REPORTS) });
    },

    /* ------------------------------------------------------------ administrator */
    async adminOverview() {
      const ids = (await kv.get<{ ids: string[] }>('biz-index'))?.ids ?? []; const all = (await Promise.all(ids.map(load))).filter((b): b is Business => !!b);
      const reports = (await kv.get<{ items: Report[] }>('biz-reports'))?.items ?? [];
      return { businesses: all.map((b) => ({ id: b.id, slug: b.slug, name: b.name, ownerId: b.ownerId, published: b.published, suspended: b.suspended ?? null, reports: reports.filter((r) => r.slug === b.slug).length, updatedAt: b.updatedAt })).sort((a, b) => b.reports - a.reports || b.updatedAt.localeCompare(a.updatedAt)), reports: reports.slice(0, 100) };
    },
    /** Hides a page (with a reason) or shows it again (reason null). */
    async adminSuspend(slug: string, reason: string | null): Promise<void> {
      const id = await slugOwner(String(slug).toLowerCase()); const b = id ? await load(id) : null; if (!b) throw new BizError('Page not found.', 404);
      if (reason) b.suspended = { at: iso(), reason: clean(reason, 200) || 'Hidden by Bwenge' }; else delete b.suspended; await save(b);
    },
  };
}
const sniffExt = (mime: string) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' } as Record<string, string>)[mime] ?? 'bin';
export type BizService = ReturnType<typeof createBizService>;
export { MediaError };
