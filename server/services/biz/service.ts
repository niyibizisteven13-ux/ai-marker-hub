import { createHash, randomUUID } from 'node:crypto';
import { MediaError, maxBytesFor, sniff, type MediaStore } from './media.js';
import { cleanAgent, type AgentSettings } from './agent.js';
import { FIELDS, PROVIDERS, cleanSecrets, keyFrom, open as openSecret, seal, type Provider, type SecretsDoc } from './secrets.js';
import { PayError, gatewayFor, maskPhone, msisdn, providerOf, realFetch, type Fetch, type Gateway } from './payments.js';
import { MAX_ENTRIES, cleanEntry, summarize, type LedgerEntry } from './ledger.js';
import {
  CATEGORIES, applyProfile, clean, cleanEmail, cleanPhone, cleanProduct, isLive, limitsFor, newBusiness, oneOf, publicView, slugFrom, validSlug,
  type Business, type Category, type DayStats, type Enquiry, type PublicBusiness, type Product, type Post, type PublicPost, type PostComment, MAX_POST_MEDIA, MAX_POST_TEXT, MAX_POSTS, MAX_COMMENTS,
} from './model.js';

/**
 * Everything bwenge4biz does, with its storage injected (the AppSetting table in production, memory in tests). Every owner method checks that the
 * business belongs to the person asking; every public method answers only with `publicView` or a count.
 *   biz:<id> the business · biz-slug:<slug> -> id · biz-owner:<userId> -> ids · biz-enq:<id> messages · biz-stats:<id> counts
 *   biz-reports reports against pages · biz-index every id (for the administrator)
 */
export interface Kv { get<T>(key: string): Promise<T | null>; put(key: string, value: unknown): Promise<void>; del(key: string): Promise<void> }
export class BizError extends Error { constructor(message: string, public status = 400, public code = 'BIZ') { super(message); } }
export interface Deps { /** Who may use the owner side (the business dashboard is a paid feature). Absent: everyone. The public page never needs it. */ allowed?: (ownerId: string) => Promise<boolean>; kv: Kv; media: MediaStore; isPaid: (ownerId: string) => Promise<boolean>; now?: () => number; secretKey?: Buffer; fetchImpl?: Fetch;
  /** Tells the owner something at once (Telegram, email or the chat outbox). `plan` becomes a Do it / Cancel plan the owner approves. */
  notify?: (ownerId: string, n: BizNotice) => Promise<void>;
  /** Keeps the business agent's scheduled digests in line with its settings. */
  syncAgenda?: (b: Business) => Promise<void> }
export interface BizNotice { title: string; text: string; plan?: { title: string; steps: Array<{ tool: string; input: Record<string, unknown>; label: string }> } }
export interface Report { id: string; at: string; slug: string; reason: string; detail: string }

const MAX_STATS_DAYS = 62, MAX_REPORTS = 300;
const day = (t: number) => new Date(t + 2 * 3600_000).toISOString().slice(0, 10);       // Kigali date
const emptyDay = (): DayStats => ({ views: 0, whatsapp: 0, calls: 0, shares: 0, enquiries: 0 });
export const REPORT_REASONS = ['scam', 'illegal', 'offensive', 'copied', 'other'] as const;

/* Spam protection for the public forms, kept in memory (only a hash of the visitor is used as the key). */
const vhash = (visitor: string) => createHash('sha256').update(`biz-like|${visitor}`).digest('hex').slice(0, 14);
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
  /** An instant alert to the owner, only when their agent is on and alerts are enabled. Never blocks or fails the action that caused it. */
  const alert = (b: Business, n: BizNotice) => { const a = b.agent; if (!a || a.level === 'off' || !a.alerts || !deps.notify) return; void deps.notify(b.ownerId, n).catch(() => undefined); };
  /** The business agent and online payments are paid features (photos, the page, the notebook and the feed are not). */
  const needPaid = async (ownerId: string, what: string) => { if (!(await deps.isPaid(ownerId))) throw new BizError(`${what} needs a paid plan. Choose a plan to unlock it.`, 402, 'UPGRADE_REQUIRED'); };
  const secretKey = () => deps.secretKey ?? keyFrom(process.env.BIZ_SECRETS_KEY || process.env.JWT_SECRET || 'bwenge-dev');

  const load = async (id: string): Promise<Business | null> => kv.get<Business>(`biz:${id}`);
  const save = async (b: Business) => { b.updatedAt = iso(); await kv.put(`biz:${b.id}`, b); };
  /** The owner's own business, or a plain "not found" (never says whether someone else's exists). */
  async function mine(ownerId: string, id: string): Promise<Business> {
    if (deps.allowed && !(await deps.allowed(ownerId))) throw new BizError('The business dashboard needs a paid plan. Choose a plan to unlock it.', 402, 'UPGRADE_REQUIRED');
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
  /** Moves a product's private stock count (only when it has one); a product that runs out is marked out of stock on the page. */
  async function adjustStock(b: Business, productId: string, delta: number): Promise<Product | undefined> {
    const fresh = await load(b.id); const p = fresh?.products.find((x) => x.id === productId); if (!fresh || !p || typeof p.stock !== 'number') return undefined;
    p.stock = Math.max(0, Math.round((p.stock + delta) * 100) / 100); if (p.stock === 0 && delta < 0) p.available = false; if (p.stock > 0 && delta > 0) p.available = true;
    await save(fresh);
    if (delta < 0 && p.stock <= (p.lowAt ?? 5)) alert(fresh, { title: `Low stock · ${fresh.name}`, text: `${p.name}: ${p.stock === 0 ? 'sold out' : `only ${p.stock}${p.unit ? ' ' + p.unit : ''} left`}.`, ...(p.stock === 0 ? {} : {}) });
    return p;
  }

  /** The decrypted keys of one provider, only to call that provider; never returned to anyone. */
  async function gateway(b: Business, p: Provider): Promise<Gateway | null> {
    const doc = await kv.get<SecretsDoc>(`biz-secrets:${b.id}`); const e = doc?.[p]; if (!e) return null;
    try { return gatewayFor(p, JSON.parse(openSecret(e.sealed, secretKey())), e.environment, deps.fetchImpl ?? realFetch); } catch { return null; }
  }
  async function payReady(b: Business): Promise<boolean> { const doc = await kv.get<SecretsDoc>(`biz-secrets:${b.id}`); return !!(b.acceptPay && (doc?.mtn || doc?.airtel)); }
  const withPay = async (b: Business, v: PublicBusiness): Promise<PublicBusiness> => ((await payReady(b)) ? { ...v, payOnline: { open: b.payOpen === true } } : v);
  async function startPayment(b: Business, o: { phone: string; amount: number; item: string; customer?: string; src: LedgerEntry['src']; note?: string }): Promise<LedgerEntry> {
    const n = msisdn(o.phone); if (!n) throw new BizError('Enter a valid MTN or Airtel number, like 0788 123 456.');
    if (!Number.isInteger(o.amount) || o.amount < 100 || o.amount > 2_000_000) throw new BizError('The amount must be between 100 and 2,000,000 RWF.');
    const provider = providerOf(n); const gw = await gateway(b, provider);
    if (!gw) throw new BizError(`This business does not accept ${provider === 'mtn' ? 'MTN MoMo' : 'Airtel Money'} payments yet.`, 409, 'NO_PROVIDER');
    const id = randomUUID();
    try { await gw.request({ amount: o.amount, phone: n, ref: id, note: `${b.name}: ${o.item}`.slice(0, 80) }); } catch (e) { if (e instanceof PayError) throw new BizError(e.message, 502, 'PROVIDER'); throw e; }
    const e: LedgerEntry = { id, type: 'sale', amount: o.amount, at: iso(), status: 'pending', src: o.src, item: o.item.slice(0, 80), method: 'momo', pay: { provider, phone: maskPhone(n), state: 'pending' }, ...(o.customer ? { customer: o.customer } : {}), ...(o.note ? { note: o.note } : {}) };
    const doc = (await kv.get<{ items: LedgerEntry[] }>(`biz-ledger:${b.id}`)) ?? { items: [] }; doc.items.unshift(e); await kv.put(`biz-ledger:${b.id}`, { items: doc.items.slice(0, MAX_ENTRIES) });
    return e;
  }
  /** Asks the provider how a payment went and settles the sale: paid -> completed (stock goes down), failed -> cancelled. */
  async function settle(b: Business, entryId: string): Promise<LedgerEntry | null> {
    const doc = (await kv.get<{ items: LedgerEntry[] }>(`biz-ledger:${b.id}`)) ?? { items: [] }; const e = doc.items.find((x) => x.id === entryId); if (!e?.pay) return e ?? null;
    if (e.pay.state !== 'pending') return e;
    const gw = await gateway(b, e.pay.provider); if (!gw) return e;
    let st; try { st = await gw.status(e.id); } catch { return e; }                         // the provider is slow: stay pending and ask again later
    if (st === 'pending') { if (now() - Date.parse(e.at) > 15 * 60_000) st = 'failed'; else return e; }
    e.pay.state = st; e.status = st === 'success' ? 'completed' : 'cancelled'; await kv.put(`biz-ledger:${b.id}`, doc);
    if (st === 'success' && e.productId) await adjustStock(b, e.productId, -(e.qty ?? 1));
    if (st === 'success') alert(b, { title: `Paid · ${b.name}`, text: `${e.amount.toLocaleString('en-US')} RWF received by ${e.pay.provider === 'mtn' ? 'MTN MoMo' : 'Airtel Money'}${e.customer ? ` from ${e.customer}` : ''} (${e.item ?? 'payment'}).` });
    return e;
  }
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
      if (deps.allowed && !(await deps.allowed(ownerId))) throw new BizError('The business dashboard needs a paid plan. Choose a plan to unlock it.', 402, 'UPGRADE_REQUIRED');
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
      await deps.syncAgenda?.({ ...b, agent: undefined }).catch(() => undefined);
      await media.removeAll(b.id).catch(() => undefined);
      await Promise.all([kv.del(`biz:${b.id}`), kv.del(`biz-slug:${b.slug}`), kv.del(`biz-enq:${b.id}`), kv.del(`biz-stats:${b.id}`), kv.del(`biz-ledger:${b.id}`), kv.del(`biz-secrets:${b.id}`), kv.del(`biz-posts:${b.id}`), kv.del(`biz-likes:${b.id}`), kv.del(`biz-comments:${b.id}`)]);
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
    async addMedia(ownerId: string, id: string, file: { name: string; data: Buffer; caption?: string; scope?: unknown }): Promise<Business['media'][number]> {
      const b = await mine(ownerId, id); const lim = await limits(ownerId);
      const kind = sniff(file.data); if (!kind) throw new BizError('Use a JPEG, PNG, WebP or GIF photo, or an MP4 or WebM video.', 415, 'TYPE');
      if (file.data.length > maxBytesFor(kind.kind)) throw new BizError(kind.kind === 'image' ? 'A photo can be up to 6 MB.' : 'A video can be up to 25 MB. Record a shorter clip.', 413, 'TOO_LARGE');
      if (kind.kind === 'video' && !(await deps.isPaid(ownerId))) throw new BizError('Videos are for paid plans. Photos are free. Choose a plan to add videos.', 402, 'VIDEO_PAID');
      const feedUpload = file.scope === 'feed';
      if (feedUpload) { if (b.media.filter((m) => m.scope === 'feed').length >= lim.feed) throw new BizError(`That is the most feed photos and videos your plan keeps (${lim.feed}). Delete old posts to make room.`, 402, 'LIMIT'); }
      const count = b.media.filter((m) => m.kind === kind.kind && m.scope !== 'feed').length;
      if (!feedUpload && count >= (kind.kind === 'image' ? lim.images : lim.videos)) throw new BizError(`Your plan has room for ${kind.kind === 'image' ? lim.images + ' photos' : lim.videos + ' videos'}. Remove one or upgrade.`, 402, 'LIMIT');
      const used = b.media.reduce((a, m) => a + m.size, 0);
      if (used + file.data.length > lim.totalMediaMb * 1048576) throw new BizError(`That would pass your ${lim.totalMediaMb} MB of photos and videos. Remove some or upgrade.`, 402, 'LIMIT');
      const m: Business['media'][number] = { id: randomUUID(), kind: kind.kind, mime: kind.mime, size: file.data.length, name: clean(file.name, 80) || `${kind.kind}.${kind.ext}`, ...(clean(file.caption, 120) ? { caption: clean(file.caption, 120) } : {}), createdAt: iso(), visible: true };
      await media.put(b.id, m.id, kind.ext, file.data);
      if (file.scope === 'feed') { m.visible = false; m.scope = 'feed'; }
      b.media.push(m); if (kind.kind === 'image' && !b.coverId && m.scope !== 'feed') b.coverId = m.id; await save(b); return m;
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


    /* ------------------------------------------------------------ money notebook: owner only */
    async ledger(ownerId: string, id: string, o: { type?: 'sale' | 'expense'; days?: number } = {}): Promise<LedgerEntry[]> {
      const b = await mine(ownerId, id); let items = (await kv.get<{ items: LedgerEntry[] }>(`biz-ledger:${b.id}`))?.items ?? [];
      if (o.type) items = items.filter((e) => e.type === o.type); if (o.days) { const t = now() - o.days * 86_400_000; items = items.filter((e) => Date.parse(e.at) >= t); } return items;
    },
    async addEntry(ownerId: string, id: string, input: unknown): Promise<{ entry: LedgerEntry; product?: Product }> {
      const b = await mine(ownerId, id); const e = cleanEntry(input, randomUUID(), now(), b.products); if ('error' in e) throw new BizError(e.error);
      const doc = (await kv.get<{ items: LedgerEntry[] }>(`biz-ledger:${b.id}`)) ?? { items: [] };
      doc.items.unshift(e); doc.items.sort((a, c) => c.at.localeCompare(a.at)); await kv.put(`biz-ledger:${b.id}`, { items: doc.items.slice(0, MAX_ENTRIES) });
      let product: Product | undefined;
      if (e.type === 'sale' && e.status === 'completed' && e.productId) product = await adjustStock(b, e.productId, -(e.qty ?? 1));
      return { entry: e, product };
    },
    async setEntryStatus(ownerId: string, id: string, entryId: string, status: 'completed' | 'pending' | 'cancelled'): Promise<LedgerEntry> {
      const b = await mine(ownerId, id); const doc = (await kv.get<{ items: LedgerEntry[] }>(`biz-ledger:${b.id}`)) ?? { items: [] }; const e = doc.items.find((x) => x.id === entryId);
      if (!e || e.type !== 'sale') throw new BizError('That sale was not found.', 404); const was = e.status; e.status = oneOf(['completed', 'pending', 'cancelled'] as const, status, was); await kv.put(`biz-ledger:${b.id}`, doc);
      if (e.productId && was !== 'completed' && e.status === 'completed') await adjustStock(b, e.productId, -(e.qty ?? 1));
      if (e.productId && was === 'completed' && e.status !== 'completed') await adjustStock(b, e.productId, e.qty ?? 1);
      return e;
    },
    async removeEntry(ownerId: string, id: string, entryId: string): Promise<void> {
      const b = await mine(ownerId, id); const doc = (await kv.get<{ items: LedgerEntry[] }>(`biz-ledger:${b.id}`)) ?? { items: [] }; const e = doc.items.find((x) => x.id === entryId);
      if (!e) throw new BizError('That entry was not found.', 404);
      await kv.put(`biz-ledger:${b.id}`, { items: doc.items.filter((x) => x.id !== entryId) });
      if (e.type === 'sale' && e.status === 'completed' && e.productId) await adjustStock(b, e.productId, e.qty ?? 1);
    },
    /** The numbers behind the dashboard: today against yesterday, a chart, top sellers, orders, customers, low stock. */
    async dashboard(ownerId: string, id: string, days = 7) {
      const b = await mine(ownerId, id); const items = (await kv.get<{ items: LedgerEntry[] }>(`biz-ledger:${b.id}`))?.items ?? [];
      const enq = (await kv.get<{ items: Enquiry[] }>(`biz-enq:${b.id}`))?.items ?? [];
      return { ...summarize(items, b.products, now(), days), newMessages: enq.filter((e) => e.status === 'new').length, entries: items.length };
    },

    /* ------------------------------------------------------------ the public feed (an Instagram-style feed: photos, love, comments, order) */
    async posts(ownerId: string, id: string) {
      const b = await mine(ownerId, id); const items = (await kv.get<{ items: Post[] }>(`biz-posts:${b.id}`))?.items ?? [];
      const likes = (await kv.get<{ by: Record<string, string[]> }>(`biz-likes:${b.id}`))?.by ?? {}; const com = (await kv.get<{ items: PostComment[] }>(`biz-comments:${b.id}`))?.items ?? [];
      return items.map((p) => ({ ...p, likes: likes[p.id]?.length ?? 0, comments: com.filter((c) => c.postId === p.id).length }));
    },
    async addPost(ownerId: string, id: string, input: { text?: unknown; mediaIds?: unknown; productId?: unknown }): Promise<Post> {
      const b = await mine(ownerId, id); const text = clean(input.text, MAX_POST_TEXT);
      const ids = [...new Set((Array.isArray(input.mediaIds) ? input.mediaIds : []).map(String))].filter((m) => b.media.some((x) => x.id === m)).slice(0, MAX_POST_MEDIA);
      if (!text && !ids.length) throw new BizError('Write something or add a photo.');
      const doc = (await kv.get<{ items: Post[] }>(`biz-posts:${b.id}`)) ?? { items: [] }; const post: Post = { id: randomUUID(), at: iso(), text, mediaIds: ids };
      if (typeof input.productId === 'string' && b.products.some((p) => p.id === input.productId)) post.productId = input.productId;
      doc.items.unshift(post); const drop = doc.items.slice(MAX_POSTS); doc.items = doc.items.slice(0, MAX_POSTS); await kv.put(`biz-posts:${b.id}`, doc);
      for (const d of drop) await this.dropPostData(b, d, doc.items);
      return post;
    },
    async setPost(ownerId: string, id: string, postId: string, patch: { pinned?: unknown; text?: unknown; productId?: unknown }): Promise<Post> {
      const b = await mine(ownerId, id); const doc = (await kv.get<{ items: Post[] }>(`biz-posts:${b.id}`)) ?? { items: [] }; const p = doc.items.find((x) => x.id === postId); if (!p) throw new BizError('That post was not found.', 404);
      if (patch.pinned !== undefined) { for (const x of doc.items) delete x.pinned; if (patch.pinned === true) p.pinned = true; }
      if (patch.text !== undefined) { const t = clean(patch.text, MAX_POST_TEXT); if (!t && !p.mediaIds.length) throw new BizError('A post needs text or a photo.'); p.text = t; }
      if (patch.productId !== undefined) { if (typeof patch.productId === 'string' && b.products.some((x) => x.id === patch.productId)) p.productId = patch.productId; else delete p.productId; }
      await kv.put(`biz-posts:${b.id}`, doc); return p;
    },
    async removePost(ownerId: string, id: string, postId: string): Promise<void> {
      const b = await mine(ownerId, id); const doc = (await kv.get<{ items: Post[] }>(`biz-posts:${b.id}`)) ?? { items: [] }; const p = doc.items.find((x) => x.id === postId); if (!p) throw new BizError('That post was not found.', 404);
      doc.items = doc.items.filter((x) => x.id !== postId); await kv.put(`biz-posts:${b.id}`, doc); await this.dropPostData(b, p, doc.items);
    },
    /** A deleted post takes its likes, its comments and the photos uploaded only for it (unless another post still shows them). */
    async dropPostData(b: Business, p: Post, remaining: Post[]) {
      const likes = (await kv.get<{ by: Record<string, string[]> }>(`biz-likes:${b.id}`)); if (likes?.by[p.id]) { delete likes.by[p.id]; await kv.put(`biz-likes:${b.id}`, likes); }
      const com = await kv.get<{ items: PostComment[] }>(`biz-comments:${b.id}`); if (com) await kv.put(`biz-comments:${b.id}`, { items: com.items.filter((c) => c.postId !== p.id) });
      const fresh = (await load(b.id)); if (!fresh) return;
      for (const mid of p.mediaIds) { const m = fresh.media.find((x) => x.id === mid); if (!m || m.scope !== 'feed' || remaining.some((r) => r.mediaIds.includes(mid))) continue; await media.remove(fresh.id, m.id, sniffExt(m.mime)).catch(() => undefined); fresh.media = fresh.media.filter((x) => x.id !== mid); }
      await save(fresh);
    },
    /** The public feed: pinned first, then newest. `visitor` only decides which hearts are filled for this person. */
    async publicPosts(slug: string, o: { limit?: number; visitor?: string } = {}): Promise<PublicPost[]> {
      const b = await publicLive(slug); if (!b) return []; const items = (await kv.get<{ items: Post[] }>(`biz-posts:${b.id}`))?.items ?? [];
      const likes = (await kv.get<{ by: Record<string, string[]> }>(`biz-likes:${b.id}`))?.by ?? {}; const com = (await kv.get<{ items: PostComment[] }>(`biz-comments:${b.id}`))?.items ?? [];
      const me = o.visitor ? vhash(o.visitor) : '';
      const pm = (mid: string) => { const m = b.media.find((x) => x.id === mid); return m ? { id: m.id, kind: m.kind, ...(m.caption ? { caption: m.caption } : {}) } : null; };
      const out: PublicPost[] = items.map((p) => ({ id: p.id, at: p.at, text: p.text, media: p.mediaIds.map(pm).filter((x): x is NonNullable<typeof x> => !!x), ...(p.pinned ? { pinned: true } : {}), ...(p.productId && b.products.some((x) => x.id === p.productId && !x.hidden) ? { productId: p.productId } : {}), likes: likes[p.id]?.length ?? 0, comments: com.filter((c) => c.postId === p.id).length, liked: !!me && !!likes[p.id]?.includes(me) }));
      out.sort((a, c) => Number(!!c.pinned) - Number(!!a.pinned) || c.at.localeCompare(a.at)); return out.slice(0, Math.min(50, Math.max(1, o.limit ?? 20)));
    },
    /** Love: one per visitor per post, tapping again takes it back. Visitors are only a short hash, never stored as who. */
    async like(slug: string, postId: string, visitor: string): Promise<{ liked: boolean; likes: number }> {
      const b = await publicLive(slug); if (!b) throw new BizError('This page is not available.', 404, 'NOT_FOUND');
      if (!((await kv.get<{ items: Post[] }>(`biz-posts:${b.id}`))?.items ?? []).some((p) => p.id === postId)) throw new BizError('That post was not found.', 404);
      if (tooMany(`like|${visitor}`, 200, now())) throw new BizError('Slow down a little.', 429, 'RATE');
      const doc = (await kv.get<{ by: Record<string, string[]> }>(`biz-likes:${b.id}`)) ?? { by: {} }; const h = vhash(visitor); const list = doc.by[postId] ?? []; const had = list.includes(h);
      doc.by[postId] = had ? list.filter((x) => x !== h) : [...list, h].slice(-5000); await kv.put(`biz-likes:${b.id}`, doc); return { liked: !had, likes: doc.by[postId].length };
    },
    async publicComments(slug: string, postId: string): Promise<Array<Pick<PostComment, 'id' | 'name' | 'text' | 'at' | 'owner'>>> {
      const b = await publicLive(slug); if (!b) return []; const com = (await kv.get<{ items: PostComment[] }>(`biz-comments:${b.id}`))?.items ?? [];
      return com.filter((c) => c.postId === postId).sort((a, c) => a.at.localeCompare(c.at)).slice(-100).map(({ id, name, text, at, owner }) => ({ id, name, text, at, ...(owner ? { owner: true } : {}) }));
    },
    async addComment(slug: string, postId: string, input: { name?: unknown; text?: unknown; website?: unknown }, visitor: string): Promise<PostComment> {
      if (clean(input.website, 40)) throw new BizError('Not accepted.');
      const b = await publicLive(slug); if (!b) throw new BizError('This page is not available.', 404, 'NOT_FOUND');
      const post = ((await kv.get<{ items: Post[] }>(`biz-posts:${b.id}`))?.items ?? []).find((p) => p.id === postId); if (!post) throw new BizError('That post was not found.', 404);
      const name = clean(input.name, 40), text = clean(input.text, 300); if (!name) throw new BizError('Add your name.'); if (!text) throw new BizError('Write your comment.');
      if (tooMany(`com|${visitor}`, 12, now())) throw new BizError('You commented a lot already. Please try again later.', 429, 'RATE');
      const c: PostComment = { id: randomUUID(), postId, name, text, at: iso() }; const doc = (await kv.get<{ items: PostComment[] }>(`biz-comments:${b.id}`)) ?? { items: [] };
      doc.items.push(c); await kv.put(`biz-comments:${b.id}`, { items: doc.items.slice(-MAX_COMMENTS) });
      alert(b, { title: `New comment · ${b.name}`, text: `${name} commented on your post${post.text ? ` "${post.text.slice(0, 40)}"` : ''}: "${text.slice(0, 200)}"` });
      return c;
    },
    async comments(ownerId: string, id: string, postId: string): Promise<PostComment[]> { const b = await mine(ownerId, id); return ((await kv.get<{ items: PostComment[] }>(`biz-comments:${b.id}`))?.items ?? []).filter((c) => c.postId === postId); },
    async replyComment(ownerId: string, id: string, postId: string, text: unknown): Promise<PostComment> {
      const b = await mine(ownerId, id); if (!((await kv.get<{ items: Post[] }>(`biz-posts:${b.id}`))?.items ?? []).some((p) => p.id === postId)) throw new BizError('That post was not found.', 404);
      const t = clean(text, 300); if (!t) throw new BizError('Write your reply.'); const c: PostComment = { id: randomUUID(), postId, name: b.name, text: t, at: iso(), owner: true };
      const doc = (await kv.get<{ items: PostComment[] }>(`biz-comments:${b.id}`)) ?? { items: [] }; doc.items.push(c); await kv.put(`biz-comments:${b.id}`, { items: doc.items.slice(-MAX_COMMENTS) }); return c;
    },
    async removeComment(ownerId: string, id: string, commentId: string): Promise<void> {
      const b = await mine(ownerId, id); const doc = (await kv.get<{ items: PostComment[] }>(`biz-comments:${b.id}`)) ?? { items: [] }; if (!doc.items.some((c) => c.id === commentId)) throw new BizError('That comment was not found.', 404);
      await kv.put(`biz-comments:${b.id}`, { items: doc.items.filter((c) => c.id !== commentId) });
    },

    /* ------------------------------------------------------------ the business agent */
    async agent(ownerId: string, id: string): Promise<AgentSettings> { return cleanAgent(null, (await mine(ownerId, id)).agent); },
    async setAgent(ownerId: string, id: string, patch: unknown): Promise<AgentSettings> {
      const b = await mine(ownerId, id); const next = cleanAgent(patch, b.agent); if (next.level !== 'off') await needPaid(ownerId, 'The business agent'); b.agent = next; await save(b); await deps.syncAgenda?.(b).catch(() => undefined); return b.agent;
    },
    /* ------------------------------------------------------------ payment secrets and online payments */
    /** What the owner may see about saved keys: whether each provider is set, the last four characters, the environment, the date. Never the keys. */
    async secretsStatus(ownerId: string, id: string) {
      const b = await mine(ownerId, id); const doc = (await kv.get<SecretsDoc>(`biz-secrets:${b.id}`)) ?? {};
      const one = (p: Provider) => (doc[p] ? { set: true, hint: doc[p]!.hint, environment: doc[p]!.environment, at: doc[p]!.at } : { set: false });
      return { mtn: one('mtn'), airtel: one('airtel'), acceptPay: b.acceptPay === true, payOpen: b.payOpen === true, fields: FIELDS };
    },
    async saveSecrets(ownerId: string, id: string, provider: unknown, input: unknown) {
      const b = await mine(ownerId, id); await needPaid(ownerId, 'Online payments'); if (!PROVIDERS.includes(provider as Provider)) throw new BizError('Choose MTN or Airtel.'); const p = provider as Provider;
      const c = cleanSecrets(p, input); if ('error' in c) throw new BizError(c.error);
      const doc = (await kv.get<SecretsDoc>(`biz-secrets:${b.id}`)) ?? {}; doc[p] = { sealed: seal(JSON.stringify(c.fields), secretKey()), hint: c.hint, environment: c.environment, at: iso() };
      await kv.put(`biz-secrets:${b.id}`, doc);
    },
    async clearSecrets(ownerId: string, id: string, provider: unknown) {
      const b = await mine(ownerId, id); if (!PROVIDERS.includes(provider as Provider)) throw new BizError('Choose MTN or Airtel.');
      const doc = (await kv.get<SecretsDoc>(`biz-secrets:${b.id}`)) ?? {}; delete doc[provider as Provider]; await kv.put(`biz-secrets:${b.id}`, doc);
      if (!doc.mtn && !doc.airtel && b.acceptPay) { delete b.acceptPay; await save(b); }
    },
    /** Proves the saved keys work (gets an access token). Moves no money. */
    async testSecrets(ownerId: string, id: string, provider: unknown): Promise<{ ok: true }> {
      const b = await mine(ownerId, id); if (!PROVIDERS.includes(provider as Provider)) throw new BizError('Choose MTN or Airtel.');
      const gw = await gateway(b, provider as Provider); if (!gw) throw new BizError('Save the keys first.', 409);
      try { await gw.ping(); } catch (e) { throw new BizError(e instanceof PayError ? e.message : 'The test did not work.', 502, 'PROVIDER'); } return { ok: true };
    },
    /** The owner types a customer's number and an amount; the customer approves on their phone. */
    async requestPayment(ownerId: string, id: string, input: { phone?: unknown; amount?: unknown; item?: unknown; customer?: unknown }): Promise<LedgerEntry> {
      const b = await mine(ownerId, id); await needPaid(ownerId, 'Online payments'); return startPayment(b, { phone: String(input.phone ?? ''), amount: Math.round(Number(String(input.amount ?? '').replace(/[,\s]/g, ''))), item: clean(input.item, 60) || 'Payment', customer: clean(input.customer, 60) || undefined, src: 'studio' });
    },
    async refreshPayment(ownerId: string, id: string, entryId: string): Promise<LedgerEntry> { const b = await mine(ownerId, id); const e = await settle(b, entryId); if (!e) throw new BizError('That payment was not found.', 404); return e; },

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
      const b = await publicLive(slug); if (!b) return null; if (opts.count) await bump(b.id, 'views').catch(() => undefined); return withPay(b, publicView(b));
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
    async preview(ownerId: string, id: string): Promise<PublicBusiness> { const b = await mine(ownerId, id); return withPay(b, publicView(b)); },
    /** A photo or video of a live page, only if the owner shows it. */
    async mediaFor(slug: string, mediaId: string) {
      const b = await publicLive(slug); const m = b?.media.find((x) => x.id === mediaId); if (!b || !m) return null;
      if (!m.visible && !((await kv.get<{ items: Post[] }>(`biz-posts:${b.id}`))?.items ?? []).some((p) => p.mediaIds.includes(m.id))) return null;
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
      alert(b, { title: `New message · ${b.name}`, text: `${name || 'A visitor'} wrote: "${message.slice(0, 200)}" Contact: ${contact}.` });
      return { saved: true };
    },

    /** A customer's order from the public page: saved as a pending sale the owner confirms. Counts against the same spam limit as messages. */
    async submitOrder(slug: string, input: { name?: unknown; contact?: unknown; note?: unknown; items?: unknown; website?: unknown }, visitor: string): Promise<{ saved: boolean; total: number }> {
      if (clean(input.website, 40)) return { saved: false, total: 0 };
      const b = await publicLive(slug); if (!b) throw new BizError('This page is not available.', 404, 'NOT_FOUND');
      const name = clean(input.name, 60); const contactRaw = clean(input.contact, 120); const contact = cleanEmail(contactRaw) ?? cleanPhone(contactRaw) ?? '';
      if (!name) throw new BizError('Add your name.'); if (!contact) throw new BizError('Add a phone number or an email so the business can reach you.');
      const lines = (Array.isArray(input.items) ? input.items : []).slice(0, 30).map((x: any) => ({ p: b.products.find((p) => p.id === x?.productId && !p.hidden && p.available), qty: Math.round(Number(x?.qty)) })).filter((x) => x.p && x.qty >= 1 && x.qty <= 999);
      if (!lines.length) throw new BizError('Choose at least one product.');
      if (tooMany(`ord|${visitor}`, 5, now())) throw new BizError('You sent several orders already. Please try again later.', 429, 'RATE');
      const total = lines.reduce((a, l) => a + (l.p!.price ?? 0) * l.qty, 0); const lim = await limits(b.ownerId);
      const entry: LedgerEntry = { id: randomUUID(), type: 'sale', amount: Math.max(1, total), at: iso(), status: 'pending', src: 'page', item: lines.map((l) => `${l.p!.name} x${l.qty}`).join(', ').slice(0, 80), customer: name, note: clean(`${contact}${input.note ? ` · ${clean(input.note, 120)}` : ''}`, 200), ...(lines.length === 1 ? { productId: lines[0].p!.id, qty: lines[0].qty } : {}) };
      const doc = (await kv.get<{ items: LedgerEntry[] }>(`biz-ledger:${b.id}`)) ?? { items: [] }; doc.items.unshift(entry);
      await kv.put(`biz-ledger:${b.id}`, { items: doc.items.slice(0, Math.max(MAX_ENTRIES, lim.enquiries)) }); await bump(b.id, 'enquiries').catch(() => undefined);
      alert(b, { title: `New order · ${b.name}`, text: `${name} ordered ${entry.item}${total ? ` (${total.toLocaleString('en-US')} RWF)` : ''}. Contact: ${contact}.`, plan: { title: `Confirm ${name}'s order`, steps: [{ tool: 'biz_orders', input: { business: b.slug, confirm_ids: [entry.id] }, label: `Confirm the order from ${name}: ${entry.item}` }] } });
      return { saved: true, total };
    },

    /** A customer pays online from the page (the QR code leads here). The amount is worked out on the server from the products, never taken from the browser, unless the owner allowed any amount. */
    async submitPayment(slug: string, input: { name?: unknown; phone?: unknown; items?: unknown; amount?: unknown; website?: unknown }, visitor: string): Promise<{ ref: string; total: number }> {
      if (clean(input.website, 40)) throw new BizError('Not accepted.');
      const b = await publicLive(slug); if (!b) throw new BizError('This page is not available.', 404, 'NOT_FOUND'); if (!(await payReady(b))) throw new BizError('This business does not take online payments.', 409, 'NO_PAY');
      const lines = (Array.isArray(input.items) ? input.items : []).slice(0, 30).map((x: any) => ({ p: b.products.find((p) => p.id === x?.productId && !p.hidden && p.available && p.price !== null), qty: Math.round(Number(x?.qty)) })).filter((x) => x.p && x.qty >= 1 && x.qty <= 999);
      let total = lines.reduce((a, l) => a + l.p!.price! * l.qty, 0); let item = lines.map((l) => `${l.p!.name} x${l.qty}`).join(', ');
      if (!lines.length) { if (!b.payOpen) throw new BizError('Choose at least one product.'); total = Math.round(Number(String(input.amount ?? '').replace(/[,\s]/g, ''))); item = 'Payment at the shop'; }
      if (tooMany(`pay|${visitor}`, 6, now())) throw new BizError('Too many payment attempts. Please wait a little.', 429, 'RATE');
      const e = await startPayment(b, { phone: String(input.phone ?? ''), amount: total, item, customer: clean(input.name, 60) || undefined, src: 'page', ...(lines.length === 1 && lines[0].p ? { note: undefined } : {}) });
      if (lines.length === 1) { const doc = (await kv.get<{ items: LedgerEntry[] }>(`biz-ledger:${b.id}`))!; const x = doc.items.find((y) => y.id === e.id); if (x) { x.productId = lines[0].p!.id; x.qty = lines[0].qty; await kv.put(`biz-ledger:${b.id}`, doc); } }
      return { ref: e.id, total };
    },
    /** What a paying customer's screen asks while waiting: only the state, for a reference only that customer holds. */
    async publicPayStatus(slug: string, ref: string): Promise<{ state: 'pending' | 'success' | 'failed' }> {
      const b = await publicLive(slug); if (!b) throw new BizError('This page is not available.', 404, 'NOT_FOUND'); const e = await settle(b, String(ref).slice(0, 64));
      if (!e?.pay || e.src !== 'page') throw new BizError('Payment not found.', 404); return { state: e.pay.state };
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
