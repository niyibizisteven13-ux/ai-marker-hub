import { createHash, randomUUID } from 'node:crypto';
import { MediaError, maxBytesFor, sniff, type MediaStore } from './media.js';
import { MAX_RECORDS, MAX_SECTIONS, MAX_TRACKERS, cleanSection, cleanTracker, cleanValues, template as featureTemplate, type Section, type Tracker, type TrackerRecord } from './features.js';
import { cleanAgent, cleanWorkflow, MAX_WORKFLOWS, type AgentSettings, type Workflow } from './agent.js';
import { FIELDS, PROVIDERS, cleanSecrets, keyFrom, open as openSecret, seal, type Provider, type SecretsDoc } from './secrets.js';
import { PayError, gatewayFor, maskPhone, msisdn, providerOf, realFetch, type Fetch, type Gateway } from './payments.js';
import { MAX_ENTRIES, cleanCategory, cleanEntry, cleanRecurring, dayOf, dueDays, monthOf, summarize, summarizeCosts, type Budgets, type LedgerEntry, type Recurring } from './ledger.js';
import { createPrograms } from './programsService.js';
import { buildDayReport, reportText } from './report.js';
import { RW_WORDS, wordsOf } from './programWords.js';
import {
  CATEGORIES, applyProfile, applyProfileData, PROFILE_MAX_VIDEO_MB, clean, cleanEmail, cleanPhone, cleanProduct, isLive, limitsFor, newBusiness, oneOf, publicView, slugFrom, validSlug,
  type Business, type Category, type DayStats, type Enquiry, type PublicBusiness, type Product, type Post, type PublicPost, type PostComment, type Lang, LANGS, type Translation, type PublicSection, MAX_POST_MEDIA, MAX_POST_TEXT, MAX_POSTS, MAX_COMMENTS, MAX_VIDEO_BYTES, MAX_VIDEO_MB, MAX_IMAGE_BYTES, publicMedia, type VideoInfo, type Media,
} from './model.js';

/**
 * Everything bwenge4biz does, with its storage injected (the AppSetting table in production, memory in tests). Every owner method checks that the
 * business belongs to the person asking; every public method answers only with `publicView` or a count.
 *   biz:<id> the business · biz-slug:<slug> -> id · biz-owner:<userId> -> ids · biz-enq:<id> messages · biz-stats:<id> counts
 *   biz-reports reports against pages · biz-index every id (for the administrator)
 */
export interface Kv { get<T>(key: string): Promise<T | null>; put(key: string, value: unknown): Promise<void>; del(key: string): Promise<void> }
export class BizError extends Error { constructor(message: string, public status = 400, public code = 'BIZ') { super(message); } }
export interface Deps { /** Who may use the owner side (the business dashboard is a paid feature). Absent: everyone. The public page never needs it. */ allowed?: (ownerId: string) => Promise<boolean>; kv: Kv; media: MediaStore; isPaid: (ownerId: string) => Promise<boolean>; /** Whether the owner bought the verified badge (a one-time payment). Absent: nobody is verified. */ isVerified?: (ownerId: string) => Promise<boolean>; /** Called after a video is stored, to make it play smoothly in the background (see videoPipeline.ts). Absent: videos are kept as uploaded. */ onVideo?: (job: { biz: string; id: string; ext: string }) => void; now?: () => number; secretKey?: Buffer; fetchImpl?: Fetch;
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
  type Served = { mime: string; size: number; etag: string; video?: Media['video']; open: (range?: { start: number; end: number }) => Promise<{ stream: NodeJS.ReadableStream }> } | null;
  const mediaCache = new Map<string, { until: number; file: Served }>();
  /** The stored file for a photo or video, or one of its other versions: 'lq' (the light video) or 'poster' (a picture of the video). The size comes from the store, so a processed file is always described correctly. */
  async function fileOf(bizId: string, m: Media, variant?: string): Promise<Served> {
    let id = m.id, ext = sniffExt(m.mime), mime = m.mime;
    if (variant === 'lq' && m.kind === 'video' && m.video?.lq) { id = `${m.id}-lq`; ext = 'mp4'; mime = 'video/mp4'; }
    else if (variant === 'poster' && m.kind === 'video' && m.video?.poster) { id = `${m.id}-poster`; ext = 'jpg'; mime = 'image/jpeg'; }
    else if (variant) return null;
    const size = (await media.size(bizId, id, ext)) ?? (id === m.id ? m.size : null); if (size === null) return null;
    return { mime, size, etag: `W/\"${id}-${m.video?.rev ?? 0}-${size}\"`, ...(m.video ? { video: m.video } : {}), open: (range) => media.open(bizId, id, ext, range) };
  }
  const save = async (b: Business) => { b.updatedAt = iso(); mediaCache.clear(); await kv.put(`biz:${b.id}`, b); };
  /** The owner's own business, or a plain "not found" (never says whether someone else's exists). */
  async function mine(ownerId: string, id: string): Promise<Business> {
    if (deps.allowed && !(await deps.allowed(ownerId))) throw new BizError('The business dashboard needs a paid plan. Choose a plan to unlock it.', 402, 'UPGRADE_REQUIRED');
    const b = await load(String(id)); if (!b || b.ownerId !== ownerId) throw new BizError('That business was not found.', 404, 'NOT_FOUND'); return b;
  }
  const slugOwner = async (slug: string) => (await kv.get<{ id: string }>(`biz-slug:${slug}`))?.id ?? null;
  async function audienceOf(b: Business) {
    const stats = (await kv.get<{ days: Record<string, DayStats> }>(`biz-stats:${b.id}`))?.days ?? {}; const t = now();
    const sum = (from: number, to: number) => { const o = emptyDay(); const lo = day(t - from * 86_400_000), hi = day(t - to * 86_400_000); for (const [d, v] of Object.entries(stats)) { if (d > lo && d <= hi) for (const k of Object.keys(o) as Array<keyof DayStats>) o[k] += v[k] ?? 0; } return o; };
    const posts = (await kv.get<{ items: Post[] }>(`biz-posts:${b.id}`))?.items ?? []; const likes = (await kv.get<{ by: Record<string, string[]> }>(`biz-likes:${b.id}`))?.by ?? {}; const com = (await kv.get<{ items: PostComment[] }>(`biz-comments:${b.id}`))?.items ?? [];
    const series: Array<{ day: string; views: number; taps: number }> = []; for (let i = 6; i >= 0; i--) { const d = day(t - i * 86_400_000); const v = stats[d]; series.push({ day: d, views: v?.views ?? 0, taps: (v?.whatsapp ?? 0) + (v?.calls ?? 0) + (v?.shares ?? 0) }); }
    const top = posts.map((p) => ({ id: p.id, text: p.text.slice(0, 80), likes: likes[p.id]?.length ?? 0, comments: com.filter((c) => c.postId === p.id).length, video: p.mediaIds.some((m) => b.media.find((x) => x.id === m)?.kind === 'video') })).sort((a, c) => (c.likes + c.comments * 2) - (a.likes + a.comments * 2)).slice(0, 3);
    const week = sum(7, 0), before = sum(14, 7);
    return { posts: posts.length, likes: Object.values(likes).reduce((a, l) => a + l.length, 0), comments: com.length, videos: b.media.filter((m) => m.kind === 'video').length, week, before, series, top };
  }
  async function limits(ownerId: string, category?: string) { return limitsFor(await deps.isPaid(ownerId), category); }
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



  /** Recurring costs that have come due become real expense entries (checked whenever the owner's numbers are read, so nothing needs a timer). */
  async function materialize(b: Business): Promise<number> {
    const doc = await kv.get<{ items: Recurring[] }>(`biz-recurring:${b.id}`); if (!doc?.items.length) return 0; let made = 0; const t = now(); const ledger = (await kv.get<{ items: LedgerEntry[] }>(`biz-ledger:${b.id}`)) ?? { items: [] };
    for (const r of doc.items) for (const d of dueDays(r, t)) { const e = cleanEntry({ type: 'expense', amount: r.amount, item: r.name, category: r.category, at: `${d}T12:00:00Z`, note: 'Recurring cost', src: 'studio' }, randomUUID(), t); if (!('error' in e)) { ledger.items.push(e); made++; } r.lastDay = d; }
    if (made || doc.items.some((r) => !r.paused)) { ledger.items.sort((a, c) => c.at.localeCompare(a.at)); await kv.put(`biz-ledger:${b.id}`, { items: ledger.items.slice(0, MAX_ENTRIES) }); await kv.put(`biz-recurring:${b.id}`, doc); }
    return made;
  }
  /** A budget alert when a category's spending this month passes 80% or 100% of its limit with this expense. */
  async function budgetAlert(b: Business, e: LedgerEntry, all: LedgerEntry[]) {
    if (e.type !== 'expense') return; const cat = e.category ?? 'other'; const limit = (await kv.get<Budgets>(`biz-budgets:${b.id}`))?.monthly[cat]; if (!limit) return;
    const spent = all.filter((x) => x.type === 'expense' && (x.category ?? 'other') === cat && monthOf(x.at) === monthOf(now())).reduce((a, x) => a + x.amount, 0); const before = spent - e.amount;
    for (const t of [100, 80]) if (before < (limit * t) / 100 && spent >= (limit * t) / 100) { alert(b, { title: `Budget · ${b.name}`, text: `${cat}: ${spent.toLocaleString('en-US')} of ${limit.toLocaleString('en-US')} RWF this month (${Math.round((spent / limit) * 100)}%).` }); return; }
  }
  /** The decrypted keys of one provider, only to call that provider; never returned to anyone. */
  async function gateway(b: Business, p: Provider): Promise<Gateway | null> {
    const doc = await kv.get<SecretsDoc>(`biz-secrets:${b.id}`); const e = doc?.[p]; if (!e) return null;
    try { return gatewayFor(p, JSON.parse(openSecret(e.sealed, secretKey())), e.environment, deps.fetchImpl ?? realFetch); } catch { return null; }
  }
  async function payReady(b: Business): Promise<boolean> { const doc = await kv.get<SecretsDoc>(`biz-secrets:${b.id}`); return !!(b.acceptPay && (doc?.mtn || doc?.airtel)); }
  /** The public sections of a page, with the fields of a form taken from its tracker (never the tracker's records). */
  async function publicSections(b: Business): Promise<PublicSection[]> {
    const trackers = (await kv.get<{ items: Tracker[] }>(`biz-trackers:${b.id}`))?.items ?? []; const out: PublicSection[] = [];
    for (const sec of b.sections ?? []) { if (sec.hidden) continue; const p: PublicSection = { id: sec.id, type: sec.type, title: sec.title, ...(sec.body ? { body: sec.body } : {}), ...(sec.items?.length ? { items: sec.items } : {}) };
      if (sec.type === 'form') { const t = trackers.find((x) => x.id === sec.trackerId); if (!t) continue; p.button = sec.button; p.form = { fields: t.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, ...(f.options ? { options: f.options } : {}), ...(f.required ? { required: true } : {}) })) }; }
      out.push(p); }
    return out;
  }
  const withPay = async (b: Business, v: PublicBusiness): Promise<PublicBusiness> => { const sections = await publicSections(b); const plans = await programs.publicPrograms(b).catch(() => []); const verified = deps.isVerified ? await deps.isVerified(b.ownerId).catch(() => false) : false; const out = { ...(sections.length ? { ...v, sections } : v), ...(plans.length ? { programs: plans } : {}), ...(verified ? { verified: true as const } : {}) }; return (await payReady(b)) ? { ...out, payOnline: { open: b.payOpen === true } } : out; };
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

  const programs = createPrograms({ kv, now, iso, secretKey, mine, save, publicLive, alert, tooMany, payReady, startPayment, settle });

  return {
    ...programs,
    /* ------------------------------------------------------------ owner */
    async list(ownerId: string): Promise<Business[]> {
      const ids = (await kv.get<{ ids: string[] }>(`biz-owner:${ownerId}`))?.ids ?? [];
      return (await Promise.all(ids.map(load))).filter((b): b is Business => !!b && b.ownerId === ownerId);
    },
    get: mine,

    async create(ownerId: string, input: { name?: unknown; slug?: unknown; category?: unknown }): Promise<Business> {
      if (deps.allowed && !(await deps.allowed(ownerId))) throw new BizError('The business dashboard needs a paid plan. Choose a plan to unlock it.', 402, 'UPGRADE_REQUIRED');
      const name = clean(input.name, 60); if (!name) throw new BizError('Give the business a name.');
      const cat = oneOf(CATEGORIES, input.category, 'other') as Category; const isProfile = cat === 'profile';
      const lim = await limits(ownerId, cat); const have = (await this.list(ownerId)).filter((x) => (x.category === 'profile') === isProfile);
      if (have.length >= lim.businesses) throw new BizError(isProfile ? `Your plan has room for ${lim.businesses} profile${lim.businesses === 1 ? '' : 's'}. Upgrade to add more.` : `Your plan has room for ${lim.businesses} business${lim.businesses === 1 ? '' : 'es'}. Upgrade to add more.`, 402, 'LIMIT');
      let slug = slugFrom(name); const wanted = input.slug !== undefined && input.slug !== '' ? validSlug(input.slug) : null;
      if (wanted) { if (wanted.ok === false) throw new BizError(wanted.error); slug = wanted.slug; }
      else { const v = validSlug(slug); if (v.ok === false) slug = `${slug.replace(/^bwenge-?/, '')}-biz`.slice(0, 32); if (validSlug(slug).ok === false) slug = `shop-${randomUUID().slice(0, 6)}`; }
      if (await slugOwner(slug)) { if (wanted) throw new BizError('That page name is taken. Try another.', 409, 'SLUG_TAKEN'); slug = `${slug.slice(0, 26)}-${randomUUID().slice(0, 4)}`; }
      const b = newBusiness(randomUUID(), ownerId, name, slug, cat, iso());
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
      if (patch.category !== undefined && (String(patch.category) === 'profile') !== (b.category === 'profile') && oneOf(CATEGORIES, patch.category, b.category) !== b.category) throw new BizError('A profile and a business are different pages. Create a new one instead of changing this one.');
      applyProfile(b, patch);
      if (patch.profile !== undefined) { if (b.category !== 'profile') throw new BizError('Only a profile page has these details.'); const r = applyProfileData(b, patch.profile); if (r.error) throw new BizError(r.error); }
      const pick = (k: 'logoId' | 'coverId') => { if (patch[k] === undefined) return; const m = b.media.find((x) => x.id === patch[k]); if (patch[k] && !(m && m.kind === 'image')) throw new BizError('Choose one of your photos.'); if (patch[k]) b[k] = m!.id; else delete b[k]; };
      pick('logoId'); pick('coverId');
      await save(b); return b;
    },

    async setPublished(ownerId: string, id: string, on: boolean): Promise<Business> {
      const b = await mine(ownerId, id);
      if (on && b.suspended) throw new BizError('This page was hidden by Bwenge. Contact support.', 403, 'SUSPENDED');
      if (on && !b.about && !b.tagline && !b.products.length && !b.media.length && !b.profile?.timeline.length && !b.profile?.headline) throw new BizError(b.category === 'profile' ? 'Add a short line about you, something you have done, or a photo or video first, so visitors see something.' : 'Add a short description, a product or a photo first, so visitors see something.', 400, 'EMPTY');
      b.published = !!on; await save(b); return b;
    },

    async remove(ownerId: string, id: string): Promise<void> {
      const b = await mine(ownerId, id);
      await deps.syncAgenda?.({ ...b, agent: undefined }).catch(() => undefined);
      await media.removeAll(b.id).catch(() => undefined);
      await programs.dropAll(b).catch(() => undefined);
      await Promise.all([kv.del(`biz:${b.id}`), kv.del(`biz-slug:${b.slug}`), kv.del(`biz-enq:${b.id}`), kv.del(`biz-stats:${b.id}`), kv.del(`biz-ledger:${b.id}`), kv.del(`biz-secrets:${b.id}`), kv.del(`biz-posts:${b.id}`), kv.del(`biz-likes:${b.id}`), kv.del(`biz-workflows:${b.id}`), kv.del(`biz-recurring:${b.id}`), kv.del(`biz-trackers:${b.id}`), kv.del(`biz-records:${b.id}`), kv.del(`biz-budgets:${b.id}`), kv.del(`biz-comments:${b.id}`)]);
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
    /** The biggest file this person may upload: a photo on the free plan, a video on a paid one. Checked before the file is read into memory. */
    async uploadCap(ownerId: string, bizId?: string): Promise<number> {
      if (await deps.isPaid(ownerId)) return MAX_VIDEO_BYTES;
      if (bizId) { const b = await mine(ownerId, bizId).catch(() => null); if (b?.category === 'profile') return PROFILE_MAX_VIDEO_MB * 1048576; }
      return MAX_IMAGE_BYTES;
    },
    async addMedia(ownerId: string, id: string, file: { name: string; data: Buffer; caption?: string; scope?: unknown; gallery?: boolean }): Promise<Business['media'][number]> {
      const b = await mine(ownerId, id); const lim = await limits(ownerId, b.category); const paid = await deps.isPaid(ownerId);
      const kind = sniff(file.data); if (!kind) throw new BizError('Use a JPEG, PNG, WebP or GIF photo, or an MP4 or WebM video.', 415, 'TYPE');
      if (file.data.length > maxBytesFor(kind.kind)) throw new BizError(kind.kind === 'image' ? 'A photo can be up to 6 MB.' : `A video can be up to ${MAX_VIDEO_MB} MB (about a minute at 1080p). Record a shorter clip or a lower quality.`, 413, 'TOO_LARGE');
      if (kind.kind === 'video' && !paid) {
        if (b.category !== 'profile') throw new BizError('Videos are for paid plans. Photos are free. Choose a plan to add videos.', 402, 'VIDEO_PAID');
        if (file.data.length > PROFILE_MAX_VIDEO_MB * 1048576) throw new BizError(`On the free plan a profile video can be up to ${PROFILE_MAX_VIDEO_MB} MB (about 40 seconds at 1080p). Record a shorter clip, or choose a plan for videos up to ${MAX_VIDEO_MB} MB.`, 413, 'TOO_LARGE');
        if (b.media.filter((m) => m.kind === 'video').length >= lim.videos) throw new BizError(`The free profile keeps ${lim.videos} videos. Remove one, or choose a plan for more.`, 402, 'LIMIT');
      }
      const feedUpload = file.scope === 'feed';
      if (feedUpload) { if (b.media.filter((m) => m.scope === 'feed').length >= lim.feed) throw new BizError(`That is the most feed photos and videos your plan keeps (${lim.feed}). Delete old posts to make room.`, 402, 'LIMIT'); }
      const count = b.media.filter((m) => m.kind === kind.kind && m.scope !== 'feed').length;
      if (!feedUpload && count >= (kind.kind === 'image' ? lim.images : lim.videos)) throw new BizError(`Your plan has room for ${kind.kind === 'image' ? lim.images + ' photos' : lim.videos + ' videos'}. Remove one or upgrade.`, 402, 'LIMIT');
      const used = b.media.reduce((a, m) => a + m.size, 0);
      if (used + file.data.length > lim.totalMediaMb * 1048576) throw new BizError(`That would pass your ${lim.totalMediaMb} MB of photos and videos. Remove some or upgrade.`, 402, 'LIMIT');
      const m: Business['media'][number] = { id: randomUUID(), kind: kind.kind, mime: kind.mime, size: file.data.length, name: clean(file.name, 80) || `${kind.kind}.${kind.ext}`, ...(clean(file.caption, 120) ? { caption: clean(file.caption, 120) } : {}), createdAt: iso(), visible: true };
      await media.put(b.id, m.id, kind.ext, file.data);
      if (file.scope === 'feed') { m.visible = false; m.scope = 'feed'; }
      if ((file.gallery === false || file.scope === 'timeline') && file.scope !== 'feed') m.gallery = false;
      if (file.scope === 'timeline') m.scope = 'timeline';
      if (kind.kind === 'video' && deps.onVideo) m.video = { state: 'processing' };
      b.media.push(m); if (kind.kind === 'image' && !b.coverId && m.scope !== 'feed' && m.scope !== 'timeline') b.coverId = m.id; await save(b);
      if (m.video) deps.onVideo?.({ biz: b.id, id: m.id, ext: kind.ext });
      return m;
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
      if (m.kind === 'video') { await media.remove(b.id, `${m.id}-lq`, 'mp4').catch(() => undefined); await media.remove(b.id, `${m.id}-poster`, 'jpg').catch(() => undefined); }
      mediaCache.clear();
      b.media = b.media.filter((x) => x.id !== mediaId); if (b.coverId === mediaId) delete b.coverId; if (b.logoId === mediaId) delete b.logoId;
      for (const p of b.products) if (p.mediaId === mediaId) delete p.mediaId; await save(b);
    },


    /* ------------------------------------------------------------ money notebook: owner only */
    async ledger(ownerId: string, id: string, o: { type?: 'sale' | 'expense'; days?: number } = {}): Promise<LedgerEntry[]> {
      const b = await mine(ownerId, id); await materialize(b); let items = (await kv.get<{ items: LedgerEntry[] }>(`biz-ledger:${b.id}`))?.items ?? [];
      if (o.type) items = items.filter((e) => e.type === o.type); if (o.days) { const t = now() - o.days * 86_400_000; items = items.filter((e) => Date.parse(e.at) >= t); } return items;
    },
    async addEntry(ownerId: string, id: string, input: unknown): Promise<{ entry: LedgerEntry; product?: Product }> {
      const b = await mine(ownerId, id); const e = cleanEntry(input, randomUUID(), now(), b.products); if ('error' in e) throw new BizError(e.error);
      const doc = (await kv.get<{ items: LedgerEntry[] }>(`biz-ledger:${b.id}`)) ?? { items: [] };
      // The same expense twice within 15 minutes (or the same sale twice within 2 minutes from the chat) is almost always a repeat, a double tap or a retried message: refuse it unless the owner insists. Ordinary repeat sales in the studio are never blocked.
      const twin = (input as any)?.force === true ? null : doc.items.find((x) => x.type === e.type && x.amount === e.amount && (x.item ?? '').toLowerCase() === (e.item ?? '').toLowerCase() && Math.abs(Date.parse(x.at) - Date.parse(e.at)) < (e.type === 'expense' ? 15 : 2) * 60_000 && now() - Date.parse(x.at) < (e.type === 'expense' ? 15 : 2) * 60_000 && x.src !== 'page' && (e.type === 'expense' || e.src === 'chat'));
      if (twin) throw new BizError(`That looks like the same ${e.type} you already recorded (entry ${twin.id.slice(0, 8)}, ${twin.amount.toLocaleString('en-US')} RWF${twin.item ? `, ${twin.item}` : ''}). Not recorded again. Send it again with force only if it really is a second one.`, 409, 'DUPLICATE');
      doc.items.unshift(e); doc.items.sort((a, c) => c.at.localeCompare(a.at)); await kv.put(`biz-ledger:${b.id}`, { items: doc.items.slice(0, MAX_ENTRIES) });
      let product: Product | undefined;
      if (e.type === 'sale' && e.status === 'completed' && e.productId) product = await adjustStock(b, e.productId, -(e.qty ?? 1));
      await budgetAlert(b, e, doc.items);
      return { entry: e, product };
    },


    /** Fixing the notebook: change an entry (amount, item, category, note, customer, date) or delete it. A sale's stock effect is put back when it is deleted. */
    async updateEntry(ownerId: string, id: string, entryId: string, patch: Record<string, unknown>): Promise<LedgerEntry> {
      const b = await mine(ownerId, id); const doc = (await kv.get<{ items: LedgerEntry[] }>(`biz-ledger:${b.id}`)) ?? { items: [] }; const i = doc.items.findIndex((x) => x.id === entryId); if (i < 0) throw new BizError('That entry was not found.', 404);
      const old = doc.items[i]; const merged = cleanEntry({ ...old, ...Object.fromEntries(['amount', 'item', 'qty', 'customer', 'note', 'category', 'method'].filter((k) => patch[k] !== undefined).map((k) => [k, patch[k]])), ...(patch.date ? { at: patch.date } : {}), type: old.type, status: old.status, src: old.src, productId: old.productId }, old.id, now(), b.products);
      if ('error' in merged) throw new BizError(merged.error); if (old.pay) merged.pay = old.pay; doc.items[i] = merged; doc.items.sort((a, c) => c.at.localeCompare(a.at)); await kv.put(`biz-ledger:${b.id}`, doc); return merged;
    },
    /** Costs and spending: this month against last, by category, six months of trend, budgets and recurring costs. */
    async costs(ownerId: string, id: string) {
      const b = await mine(ownerId, id); await materialize(b); const items = (await kv.get<{ items: LedgerEntry[] }>(`biz-ledger:${b.id}`))?.items ?? [];
      return summarizeCosts(items, now(), (await kv.get<Budgets>(`biz-budgets:${b.id}`)) ?? { monthly: {} }, (await kv.get<{ items: Recurring[] }>(`biz-recurring:${b.id}`))?.items ?? []);
    },
    async setBudget(ownerId: string, id: string, category: unknown, amount: unknown): Promise<Budgets> {
      const b = await mine(ownerId, id); const cat = cleanCategory(category); const doc = (await kv.get<Budgets>(`biz-budgets:${b.id}`)) ?? { monthly: {} }; const n = Number(String(amount ?? '').replace(/[,\s]/g, ''));
      if (amount === null || amount === '' || n === 0) delete doc.monthly[cat]; else if (Number.isFinite(n) && n > 0 && n <= 1_000_000_000) { if (!doc.monthly[cat] && Object.keys(doc.monthly).length >= 30) throw new BizError('That is plenty of budgets. Remove one first.'); doc.monthly[cat] = Math.round(n); } else throw new BizError('The budget must be a number of RWF.');
      await kv.put(`biz-budgets:${b.id}`, doc); return doc;
    },
    async recurring(ownerId: string, id: string): Promise<Recurring[]> { const b = await mine(ownerId, id); return (await kv.get<{ items: Recurring[] }>(`biz-recurring:${b.id}`))?.items ?? []; },
    async addRecurring(ownerId: string, id: string, input: unknown): Promise<Recurring> {
      const b = await mine(ownerId, id); const r = cleanRecurring(input, randomUUID(), now()); if ('error' in r) throw new BizError(r.error);
      const doc = (await kv.get<{ items: Recurring[] }>(`biz-recurring:${b.id}`)) ?? { items: [] }; if (doc.items.length >= 30) throw new BizError('That is plenty of recurring costs. Remove one first.'); doc.items.push(r); await kv.put(`biz-recurring:${b.id}`, doc); return r;
    },
    async setRecurring(ownerId: string, id: string, rid: string, patch: { paused?: unknown; remove?: unknown }): Promise<boolean> {
      const b = await mine(ownerId, id); const doc = (await kv.get<{ items: Recurring[] }>(`biz-recurring:${b.id}`)) ?? { items: [] }; const r = doc.items.find((x) => x.id === rid || x.name.toLowerCase() === String(rid).toLowerCase()); if (!r) return false;
      if (patch.remove === true) doc.items = doc.items.filter((x) => x !== r); else if (patch.paused !== undefined) r.paused = patch.paused === true; await kv.put(`biz-recurring:${b.id}`, doc); return true;
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
    /** Whether this owner has the verified badge (the studio shows how to get it when not). */
    async verifiedOwner(ownerId: string): Promise<boolean> { return deps.isVerified ? deps.isVerified(ownerId).catch(() => false) : false; },
    /** What the page earned in attention (content makers and profiles): views, taps, posts, love and comments. */
    async dashboard(ownerId: string, id: string, days = 7) {
      const b = await mine(ownerId, id); await materialize(b); const items = (await kv.get<{ items: LedgerEntry[] }>(`biz-ledger:${b.id}`))?.items ?? [];
      const enq = (await kv.get<{ items: Enquiry[] }>(`biz-enq:${b.id}`))?.items ?? [];
      return { ...summarize(items, b.products, now(), days), newMessages: enq.filter((e) => e.status === 'new').length, entries: items.length, audience: await audienceOf(b) };
    },

    /** The closing report for a day (today by default; up to 30 days back): the numbers, and the same thing as a short text for WhatsApp. */
    async dayReport(ownerId: string, id: string, o: { date?: unknown; lang?: unknown } = {}) {
      const b = await mine(ownerId, id); await materialize(b); const today = dayOf(now());
      const d = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) && o.date <= today && o.date >= dayOf(Date.parse(`${today}T12:00:00Z`) - 30 * 86_400_000) ? o.date : today;
      const entries = (await kv.get<{ items: LedgerEntry[] }>(`biz-ledger:${b.id}`))?.items ?? []; const enq = (await kv.get<{ items: Enquiry[] }>(`biz-enq:${b.id}`))?.items ?? [];
      const low = b.products.filter((p) => typeof p.stock === 'number' && p.stock <= (p.lowAt ?? 5)).map((p) => ({ name: p.name, stock: p.stock as number, unit: p.unit ?? '' }));
      const report = buildDayReport({ date: d, name: b.name, entries, lowStock: low, newMessages: enq.filter((e) => e.status === 'new').length, programs: await programs.dayStats(b, d) });
      const lang = o.lang === 'rw' ? 'rw' : 'en'; const text = reportText(report, wordsOf(b.programText, lang === 'rw' ? RW_WORDS : undefined), lang);
      return { report, text };
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
    async publicPosts(slug: string, o: { limit?: number; visitor?: string; postId?: string } = {}): Promise<PublicPost[]> {
      const b = await publicLive(slug); if (!b) return []; const items = (await kv.get<{ items: Post[] }>(`biz-posts:${b.id}`))?.items ?? [];
      const likes = (await kv.get<{ by: Record<string, string[]> }>(`biz-likes:${b.id}`))?.by ?? {}; const com = (await kv.get<{ items: PostComment[] }>(`biz-comments:${b.id}`))?.items ?? [];
      const me = o.visitor ? vhash(o.visitor) : '';
      const pm = (mid: string) => { const m = b.media.find((x) => x.id === mid); return m ? publicMedia(m) : null; };
      const out: PublicPost[] = items.map((p) => ({ id: p.id, at: p.at, text: p.text, media: p.mediaIds.map(pm).filter((x): x is NonNullable<typeof x> => !!x), ...(p.pinned ? { pinned: true } : {}), ...(p.productId && b.products.some((x) => x.id === p.productId && !x.hidden) ? { productId: p.productId } : {}), likes: likes[p.id]?.length ?? 0, comments: com.filter((c) => c.postId === p.id).length, liked: !!me && !!likes[p.id]?.includes(me) }));
      out.sort((a, c) => Number(!!c.pinned) - Number(!!a.pinned) || c.at.localeCompare(a.at)); const page = out.slice(0, Math.min(50, Math.max(1, o.limit ?? 20)));
      const shared = o.postId ? out.find((p) => p.id === o.postId) : undefined;
      if (shared && !page.some((p) => p.id === shared.id)) page.push(shared);
      return page;
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


    /* ------------------------------------------------------------ features the owner or their agent creates: sections (public) and trackers (private) */
    async sections(ownerId: string, id: string): Promise<Section[]> { return (await mine(ownerId, id)).sections ?? []; },
    async saveSection(ownerId: string, id: string, input: any): Promise<Section> {
      const b = await mine(ownerId, id); const list = b.sections ?? []; const i = input?.id ? list.findIndex((x) => x.id === input.id || x.title.toLowerCase() === String(input.id).toLowerCase()) : -1;
      if (i < 0 && list.length >= MAX_SECTIONS) throw new BizError(`A page can have ${MAX_SECTIONS} extra sections. Remove one first.`);
      const sec = cleanSection(input, i >= 0 ? list[i].id : randomUUID(), i >= 0 ? list[i] : undefined); if ('error' in sec) throw new BizError(sec.error);
      if (sec.type === 'form' && !((await kv.get<{ items: Tracker[] }>(`biz-trackers:${b.id}`))?.items ?? []).some((t) => t.id === sec.trackerId)) throw new BizError('That tracker does not exist. Create it first.');
      if (i >= 0) list[i] = sec; else list.push(sec); b.sections = list; await save(b); return sec;
    },
    async removeSection(ownerId: string, id: string, sectionId: string): Promise<boolean> { const b = await mine(ownerId, id); const n = (b.sections ?? []).length; b.sections = (b.sections ?? []).filter((x) => x.id !== sectionId && x.title.toLowerCase() !== sectionId.toLowerCase()); if (b.sections.length === n) return false; if (!b.sections.length) delete b.sections; await save(b); return true; },
    async moveSection(ownerId: string, id: string, sectionId: string, dir: number): Promise<void> { const b = await mine(ownerId, id); const l = b.sections ?? []; const i = l.findIndex((x) => x.id === sectionId || x.title.toLowerCase() === sectionId.toLowerCase()); const j = i + (dir < 0 ? -1 : 1); if (i < 0 || j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; b.sections = l; await save(b); },
    async trackers(ownerId: string, id: string) {
      const b = await mine(ownerId, id); const ts = (await kv.get<{ items: Tracker[] }>(`biz-trackers:${b.id}`))?.items ?? []; const recs = (await kv.get<{ items: TrackerRecord[] }>(`biz-records:${b.id}`))?.items ?? [];
      return ts.map((t) => ({ ...t, records: recs.filter((r) => r.trackerId === t.id).length, open: recs.filter((r) => r.trackerId === t.id && r.status === t.statuses[0]).length }));
    },
    async createTracker(ownerId: string, id: string, input: unknown): Promise<Tracker> {
      const b = await mine(ownerId, id); const t = cleanTracker(input, randomUUID(), iso()); if ('error' in t) throw new BizError(t.error);
      const doc = (await kv.get<{ items: Tracker[] }>(`biz-trackers:${b.id}`)) ?? { items: [] }; if (doc.items.length >= MAX_TRACKERS) throw new BizError(`You can have ${MAX_TRACKERS} trackers. Delete one first.`);
      if (doc.items.some((x) => x.name.toLowerCase() === t.name.toLowerCase())) throw new BizError(`You already have a tracker called "${t.name}".`, 409, 'EXISTS'); doc.items.push(t); await kv.put(`biz-trackers:${b.id}`, doc); return t;
    },
    async deleteTracker(ownerId: string, id: string, trackerId: string): Promise<boolean> {
      const b = await mine(ownerId, id); const doc = (await kv.get<{ items: Tracker[] }>(`biz-trackers:${b.id}`)) ?? { items: [] }; const t = doc.items.find((x) => x.id === trackerId || x.name.toLowerCase() === trackerId.toLowerCase()); if (!t) return false;
      doc.items = doc.items.filter((x) => x !== t); await kv.put(`biz-trackers:${b.id}`, doc); const recs = (await kv.get<{ items: TrackerRecord[] }>(`biz-records:${b.id}`))?.items ?? []; await kv.put(`biz-records:${b.id}`, { items: recs.filter((r) => r.trackerId !== t.id) });
      if (b.sections?.some((x) => x.trackerId === t.id)) { b.sections = b.sections.filter((x) => x.trackerId !== t.id); await save(b); } return true;
    },
    async records(ownerId: string, id: string, trackerId: string, o: { status?: string } = {}): Promise<{ tracker: Tracker; records: TrackerRecord[] }> {
      const b = await mine(ownerId, id); const t = ((await kv.get<{ items: Tracker[] }>(`biz-trackers:${b.id}`))?.items ?? []).find((x) => x.id === trackerId || x.name.toLowerCase() === trackerId.toLowerCase()); if (!t) throw new BizError('That tracker was not found.', 404);
      return { tracker: t, records: ((await kv.get<{ items: TrackerRecord[] }>(`biz-records:${b.id}`))?.items ?? []).filter((r) => r.trackerId === t.id && (!o.status || r.status === o.status)) };
    },
    async addRecord(ownerId: string, id: string, trackerId: string, input: { values?: unknown; status?: unknown }, src: TrackerRecord['src'] = 'studio'): Promise<TrackerRecord> {
      const { tracker } = await this.records(ownerId, id, trackerId); const b = await mine(ownerId, id); const v = cleanValues(tracker, input.values ?? input); if ('error' in v) throw new BizError(v.error);
      const r: TrackerRecord = { id: randomUUID(), trackerId: tracker.id, at: iso(), values: v.values, status: tracker.statuses.find((x) => x.toLowerCase() === String(input.status ?? '').toLowerCase()) ?? tracker.statuses[0], src };
      const doc = (await kv.get<{ items: TrackerRecord[] }>(`biz-records:${b.id}`)) ?? { items: [] }; doc.items.unshift(r); await kv.put(`biz-records:${b.id}`, { items: doc.items.slice(0, MAX_RECORDS) }); return r;
    },
    async updateRecord(ownerId: string, id: string, recordId: string, patch: { values?: unknown; status?: unknown }): Promise<TrackerRecord> {
      const b = await mine(ownerId, id); const doc = (await kv.get<{ items: TrackerRecord[] }>(`biz-records:${b.id}`)) ?? { items: [] }; const r = doc.items.find((x) => x.id === recordId || x.id.startsWith(recordId)); if (!r || recordId.length < 6) throw new BizError('That record was not found.', 404);
      const t = ((await kv.get<{ items: Tracker[] }>(`biz-trackers:${b.id}`))?.items ?? []).find((x) => x.id === r.trackerId)!;
      if (patch.values) { const v = cleanValues(t, patch.values, true, r.values); if ('error' in v) throw new BizError(v.error); r.values = v.values; }
      if (patch.status !== undefined) { const st = t.statuses.find((x) => x.toLowerCase() === String(patch.status).toLowerCase()); if (!st) throw new BizError(`Status must be one of: ${t.statuses.join(', ')}.`); r.status = st; }
      await kv.put(`biz-records:${b.id}`, doc); return r;
    },
    async deleteRecord(ownerId: string, id: string, recordId: string): Promise<boolean> {
      const b = await mine(ownerId, id); const doc = (await kv.get<{ items: TrackerRecord[] }>(`biz-records:${b.id}`)) ?? { items: [] }; const r = recordId.length >= 6 ? doc.items.find((x) => x.id === recordId || x.id.startsWith(recordId)) : undefined; if (!r) return false;
      await kv.put(`biz-records:${b.id}`, { items: doc.items.filter((x) => x !== r) }); return true;
    },
    /** A visitor fills in a form section: the answer becomes a new record (status: the first one) in the tracker behind it. */
    async submitForm(slug: string, sectionId: string, input: { values?: unknown; website?: unknown }, visitor: string): Promise<{ saved: boolean }> {
      if (clean(input.website, 40)) return { saved: false };
      const b = await publicLive(slug); const sec = b?.sections?.find((x) => x.id === sectionId && x.type === 'form' && !x.hidden); if (!b || !sec) throw new BizError('This form is not available.', 404, 'NOT_FOUND');
      const t = ((await kv.get<{ items: Tracker[] }>(`biz-trackers:${b.id}`))?.items ?? []).find((x) => x.id === sec.trackerId); if (!t) throw new BizError('This form is not available.', 404, 'NOT_FOUND');
      const v = cleanValues(t, input.values); if ('error' in v) throw new BizError(v.error); if (!Object.keys(v.values).length) throw new BizError('Fill in the form first.');
      if (tooMany(`form|${visitor}`, 8, now())) throw new BizError('You sent several requests already. Please try again later.', 429, 'RATE');
      const r: TrackerRecord = { id: randomUUID(), trackerId: t.id, at: iso(), values: v.values, status: t.statuses[0], src: 'page' }; const doc = (await kv.get<{ items: TrackerRecord[] }>(`biz-records:${b.id}`)) ?? { items: [] }; doc.items.unshift(r); await kv.put(`biz-records:${b.id}`, { items: doc.items.slice(0, MAX_RECORDS) });
      alert(b, { title: `New ${t.name} · ${b.name}`, text: Object.entries(r.values).map(([k, x]) => `${t.fields.find((f) => f.key === k)?.label ?? k}: ${x}`).join(', ').slice(0, 300) });
      return { saved: true };
    },
    /** Switches on a ready-made feature (booking, faq, price list, deliveries, loans), in English or Kinyarwanda. */
    async addFeature(ownerId: string, id: string, kind: string, lang: Lang = 'en'): Promise<{ tracker?: Tracker; section?: Section }> {
      const tpl = featureTemplate(kind, lang); if (!tpl) throw new BizError('Unknown feature.'); const out: { tracker?: Tracker; section?: Section } = {};
      if (tpl.tracker) out.tracker = await this.createTracker(ownerId, id, tpl.tracker);
      if (tpl.section) out.section = await this.saveSection(ownerId, id, { ...tpl.section, ...(out.tracker ? { trackerId: out.tracker.id } : {}) });
      return out;
    },

    /* ------------------------------------------------------------ language */
    async setLang(ownerId: string, id: string, lang: unknown): Promise<Lang> { const b = await mine(ownerId, id); b.lang = LANGS.includes(lang as Lang) ? (lang as Lang) : b.lang ?? 'en'; await save(b); return b.lang; },
    /** Stores the page's words in another language. Only the fields given change; each text is cleaned like the original. */
    async setTranslation(ownerId: string, id: string, lang: unknown, input: any): Promise<Translation> {
      const b = await mine(ownerId, id); if (!LANGS.includes(lang as Lang) || lang === 'en') throw new BizError('Choose a language to translate into (rw).'); const l = lang as Lang; const t: Translation = { ...(b.translations?.[l] ?? {}) };
      if (input?.tagline !== undefined) t.tagline = clean(input.tagline, 120); if (input?.about !== undefined) t.about = clean(input.about, 1500);
      const map = (src: any, ids: string[], fields: Array<[string, number]>) => { const out: Record<string, any> = {}; for (const [k, v] of Object.entries(src ?? {})) { if (!ids.includes(k) || !v || typeof v !== 'object') continue; const o: Record<string, any> = {}; for (const [f, max] of fields) if ((v as any)[f] !== undefined) o[f] = clean((v as any)[f], max); out[k] = o; } return out; };
      if (input?.products) t.products = { ...(t.products ?? {}), ...map(input.products, b.products.map((p) => p.id), [['name', 80], ['description', 400], ['unit', 20]]) };
      if (input?.sections) { const base = map(input.sections, (b.sections ?? []).map((x) => x.id), [['title', 60], ['body', 1500], ['button', 30]]); for (const [k, v] of Object.entries(input.sections as Record<string, any>)) if (base[k] && Array.isArray(v?.items)) base[k].items = v.items.slice(0, 30).map((it: any) => ({ title: clean(it?.title, 100), ...(clean(it?.text, 500) ? { text: clean(it.text, 500) } : {}), ...(clean(it?.price, 30) ? { price: clean(it.price, 30) } : {}) })).filter((it: any) => it.title); t.sections = { ...(t.sections ?? {}), ...base }; }
      if (input?.posts && typeof input.posts === 'object') { const posts = (await kv.get<{ items: Post[] }>(`biz-posts:${b.id}`))?.items ?? []; t.posts = { ...(t.posts ?? {}) }; for (const [k, v] of Object.entries(input.posts as Record<string, unknown>)) if (posts.some((p) => p.id === k)) t.posts[k] = clean(v, MAX_POST_TEXT); }
      b.translations = { ...(b.translations ?? {}), [l]: t }; await save(b); return t;
    },

    /* ------------------------------------------------------------ the owner's own preferences (per person, not per business) */
    async prefs(userId: string): Promise<{ studioLang?: Lang }> { const p = await kv.get<{ studioLang?: Lang }>(`biz-prefs:${userId}`); return p && LANGS.includes(p.studioLang as Lang) ? { studioLang: p.studioLang } : {}; },
    async setPrefs(userId: string, patch: { studioLang?: unknown }): Promise<{ studioLang?: Lang }> { const cur = await this.prefs(userId); if (LANGS.includes(patch.studioLang as Lang)) cur.studioLang = patch.studioLang as Lang; await kv.put(`biz-prefs:${userId}`, cur); return cur; },

    /* ------------------------------------------------------------ routines (workflows) the owner saves and runs by chat */
    async workflows(ownerId: string, id: string): Promise<Workflow[]> { const b = await mine(ownerId, id); return (await kv.get<{ items: Workflow[] }>(`biz-workflows:${b.id}`))?.items ?? []; },
    async saveWorkflow(ownerId: string, id: string, input: unknown): Promise<Workflow> {
      const b = await mine(ownerId, id); const c = cleanWorkflow(input); if ('error' in c) throw new BizError(c.error);
      const doc = (await kv.get<{ items: Workflow[] }>(`biz-workflows:${b.id}`)) ?? { items: [] }; const i = doc.items.findIndex((w) => w.name.toLowerCase() === c.name.toLowerCase());
      if (i < 0 && doc.items.length >= MAX_WORKFLOWS) throw new BizError(`You can keep ${MAX_WORKFLOWS} routines. Delete one first.`);
      const w: Workflow = { id: i >= 0 ? doc.items[i].id : randomUUID(), ...c, createdAt: i >= 0 ? doc.items[i].createdAt : iso() }; if (i >= 0) doc.items[i] = w; else doc.items.push(w);
      await kv.put(`biz-workflows:${b.id}`, doc); return w;
    },
    async deleteWorkflow(ownerId: string, id: string, name: string): Promise<boolean> {
      const b = await mine(ownerId, id); const doc = (await kv.get<{ items: Workflow[] }>(`biz-workflows:${b.id}`)) ?? { items: [] }; const n = doc.items.length;
      doc.items = doc.items.filter((w) => w.name.toLowerCase() !== String(name).trim().toLowerCase() && w.id !== name); await kv.put(`biz-workflows:${b.id}`, doc); return doc.items.length < n;
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
    async mediaById(bizId: string, mediaId: string, variant?: string) {
      const b = await load(String(bizId)); const m = b?.media.find((x) => x.id === mediaId); if (!b || !m) return null;
      return fileOf(b.id, m, variant);
    },
    /** Called by the video pipeline when it has finished (or given up) on a video: records the picture size, whether the light version and poster exist, and the new file size. */
    async setVideoInfo(bizId: string, mediaId: string, patch: { mime?: string; size?: number; video: VideoInfo }): Promise<void> {
      const b = await load(bizId); const m = b?.media.find((x) => x.id === mediaId); if (!b || !m) return;
      if (patch.mime) m.mime = patch.mime; if (patch.size) m.size = patch.size; m.video = patch.video; mediaCache.clear(); await save(b);
    },
    /** Videos that were still being prepared when the server stopped, so they can be queued again. */
    async pendingVideos(): Promise<Array<{ biz: string; id: string; ext: string }>> {
      const ids = (await kv.get<{ ids: string[] }>('biz-index'))?.ids ?? []; const out: Array<{ biz: string; id: string; ext: string }> = [];
      for (const id of ids) { const b = await load(id); for (const m of b?.media ?? []) if (m.kind === 'video' && m.video?.state === 'processing') out.push({ biz: b!.id, id: m.id, ext: sniffExt(m.mime) }); }
      return out;
    },
    /** How the page looks to visitors, for the owner, also before it is published. */
    async preview(ownerId: string, id: string): Promise<PublicBusiness> { const b = await mine(ownerId, id); return withPay(b, publicView(b)); },
    /** A photo or video of a live page, only if the owner shows it. */
    async mediaFor(slug: string, mediaId: string, variant?: string) {
      // A video asks for many pieces, one request each: remember who may see what for a few seconds instead of reading the page every time.
      const ck = `${slug}|${mediaId}|${variant ?? ''}`; const hit = mediaCache.get(ck); if (hit && hit.until > now()) return hit.file;
      const b = await publicLive(slug); const m = b?.media.find((x) => x.id === mediaId); if (!b || !m) return null;
      if (!m.visible && !((await kv.get<{ items: Post[] }>(`biz-posts:${b.id}`))?.items ?? []).some((p) => p.mediaIds.includes(m.id))) return null;
      const file = await fileOf(b.id, m, variant); mediaCache.set(ck, { until: now() + 15_000, file }); if (mediaCache.size > 2000) mediaCache.clear(); return file;
      return fileOf(b.id, m, variant);
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
      mediaCache.clear();
      const id = await slugOwner(String(slug).toLowerCase()); const b = id ? await load(id) : null; if (!b) throw new BizError('Page not found.', 404);
      if (reason) b.suspended = { at: iso(), reason: clean(reason, 200) || 'Hidden by Bwenge' }; else delete b.suspended; await save(b);
    },
  };
}
const sniffExt = (mime: string) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' } as Record<string, string>)[mime] ?? 'bin';
export type BizService = ReturnType<typeof createBizService>;
export { MediaError };
