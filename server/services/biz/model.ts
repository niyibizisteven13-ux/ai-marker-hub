import type { AgentSettings } from './agent.js';
import type { Section } from './features.js';
import type { ProgramText } from './programs.js';
/**
 * bwenge4biz: a business page on Bwenge (bwenge.space/b/<name>) and the private side the owner uses to run it.
 *
 * THE RULE: the public sees only what `publicView` returns. Everything else on a business (visitor enquiries, visit counts, drafts, hidden
 * products, notes, reports, the owner's account) is private to the owner and never leaves through a public route. All public routes
 * answer with `publicView` and nothing else, so adding a private field here can never leak by accident.
 */

export const SLUG_MIN = 3;
export const SLUG_MAX = 32;
/** Names that would look like part of Bwenge or like the site's own pages. */
export const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'apps', 'b', 'biz', 'bwenge', 'bwenge4biz', 'chat', 'dashboard', 'download', 'help', 'home', 'login', 'logout', 'mail', 'myseb', 'new',
  'official', 'p', 'profile', 'profiles', 'bwenge4profile', 'pay', 'payment', 'payments', 'privacy', 'root', 'settings', 'signup', 'sign-in', 'status', 'support', 'terms', 'test', 'upgrade', 'www',
]);

export const CATEGORIES = ['shop', 'restaurant', 'salon', 'farm', 'services', 'school', 'health', 'transport', 'craft', 'creator', 'profile', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];
/**
 * Which kind of dashboard and page a category gets. `sell`: shops, cafés, farms, crafts (orders, stock, sales); `book`: salons, clinics, services, transport (bookings and requests);
 * `learn`: schools and training (courses and enrolments); `creator`: social-media and content makers (content, audience, brand deals, rates); `profile`: Bwenge4profile, a person's own page
 * (students and professionals: what they have done, videos, skills, a link for a letter or an email).
 */
export type Kind = 'sell' | 'book' | 'learn' | 'creator' | 'profile';
export const kindOf = (c: string): Kind => (c === 'profile' ? 'profile' : c === 'creator' ? 'creator' : c === 'school' ? 'learn' : c === 'salon' || c === 'health' || c === 'services' || c === 'transport' ? 'book' : 'sell');
export const THEMES = ['gold', 'teal', 'green', 'blue', 'rose', 'violet', 'ink'] as const;
export type Theme = (typeof THEMES)[number];
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Day = (typeof DAYS)[number];

export interface Hours { day: Day; open: string; close: string; closed?: boolean }
export interface Product { id: string; name: string; price: number | null; unit?: string; description?: string; /** A link to this product or service (https): the page shows an Open button to it instead of the order button. */ url?: string; mediaId?: string; available: boolean; hidden?: boolean; /** Private: units in stock and the level that raises a low-stock alert. Never in publicView. */ stock?: number; lowAt?: number }
export type MediaKind = 'image' | 'video' | 'document';
export const PROFILE_DOCUMENT_MIMES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
} as const;
/** What the server learned about an uploaded video and what it made from it (see videoPipeline.ts). `processing`: being turned into a smooth 720p file, a 360p file for slow connections and a poster picture; `ready`: done (or kept as uploaded when `raw`); `failed`: kept as uploaded. */
export interface VideoInfo { state: 'processing' | 'ready' | 'failed'; /** The picture as a viewer sees it (after rotation). */ w?: number; h?: number; duration?: number; lq?: boolean; poster?: boolean; /** Changes whenever the files change, so browsers may keep the old ones for a year. */ rev?: number; /** Played as uploaded: this server could not process it. */ raw?: boolean }
export type PublicVideo = Pick<VideoInfo, 'state' | 'w' | 'h' | 'duration' | 'lq' | 'poster' | 'rev' | 'raw'>;
export interface Media { id: string; video?: VideoInfo; /** false: used as the logo, the banner or a product picture only, so it is left out of the page's photo gallery. */ gallery?: false; kind: MediaKind; mime: string; size: number; name: string; caption?: string; createdAt: string; visible: boolean; /** 'feed': uploaded for an update post; not in the gallery, public only while a post shows it. */ scope?: 'feed' | 'timeline' }
/** An update the owner posted to the public feed, like an Instagram post: a caption and up to ten photos or short videos, optionally tagged with a product. */
export interface Post { id: string; at: string; text: string; mediaIds: string[]; pinned?: boolean; /** The product this post sells: gives the post an Order button. */ productId?: string }
export interface PublicSection { id: string; type: Section['type']; title: string; body?: string; items?: Section['items']; button?: string; form?: { fields: Array<{ key: string; label: string; type: string; options?: string[]; required?: boolean }> } }
export interface PublicPost { id: string; at: string; text: string; media: PublicMedia[]; pinned?: boolean; productId?: string; likes: number; comments: number; liked: boolean }
export interface PostComment { id: string; postId: string; name: string; text: string; at: string; /** Written by the business itself (a reply). */ owner?: boolean }
export const MAX_POST_TEXT = 1500, MAX_POST_MEDIA = 10, MAX_POSTS = 300, MAX_COMMENTS = 2000;
export type Lang = 'en' | 'rw';
export const LANGS: Lang[] = ['en', 'rw'];
/** The page's own words in another language (written by the owner or their agent): the public page uses them when a visitor picks that language. */
export interface Translation { tagline?: string; about?: string; products?: Record<string, { name?: string; description?: string; unit?: string }>; sections?: Record<string, { title?: string; body?: string; button?: string; items?: Array<{ title: string; text?: string; price?: string }> }>; posts?: Record<string, string> }
export const TIMELINE_KINDS = ['education', 'experience', 'project', 'award', 'event', 'volunteer', 'certificate'] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];
/** One thing a person did: a course, an internship, a project, a prize, a conference they attended. `from`/`to` are `YYYY` or `YYYY-MM`; `to` may be `present`. */
export interface TimelineItem { id: string; kind: TimelineKind; title: string; org?: string; place?: string; from?: string; to?: string; text?: string; url?: string; mediaIds?: string[] }
export interface ProfileLink { id: string; label: string; url: string }
/** Bwenge4profile: what a person shows about themselves (see kindOf). Everything here is public once the page is published. */
export interface ProfileData { headline?: string; school?: string; field?: string; location?: string; openTo?: string; skills: string[]; timeline: TimelineItem[]; links: ProfileLink[]; featured: string[]; cvUrl?: string }
export const PROFILE_MAX = { timeline: 60, links: 12, skills: 30, featured: 6 };
export interface Business {
  id: string; ownerId: string; slug: string; name: string; category: Category; tagline: string; about: string; theme: Theme;
  logoId?: string; coverId?: string;
  appName?: string; appIconId?: string;
  /** Where the business is on the map (public when set). */
  lat?: number; lng?: number;
  whatsapp?: string; phone?: string; email?: string; address?: string; mapUrl?: string; website?: string; instagram?: string; facebook?: string;
  hours: Hours[];
  /** MoMo Pay code and name, shown to visitors only when `showPay` is on. */
  momoCode?: string; momoName?: string; showPay: boolean;
  /** Pay online (customer approves on their phone): the page offers it only when the owner turned it on AND keys are saved. `payOpen` lets visitors type any amount. */
  acceptPay?: boolean; payOpen?: boolean;
  /** The business agent's settings (private): see agent.ts. */
  agent?: AgentSettings;
  /** Sections the owner or their agent added to the public page (FAQ, price list, a booking form…). */
  sections?: Section[];
  /** The owner's own words for programs (what they call the program, a member, the pass, one use…): see programs.ts. */
  programText?: ProgramText;
  /** Only for category `profile` (Bwenge4profile). */
  profile?: ProfileData;
  /** The language the page opens in, and what is translated (visitors can switch). */
  lang?: Lang; translations?: Partial<Record<Lang, Translation>>;
  products: Product[]; media: Media[];
  /** Private to the owner. */
  notes: string;
  published: boolean;
  /** Set by an administrator: the page is hidden whatever the owner does. */
  suspended?: { at: string; reason: string };
  createdAt: string; updatedAt: string;
}
export interface Enquiry { id: string; at: string; name: string; contact: string; message: string; productId?: string; status: 'new' | 'seen' | 'done' }
export interface DayStats { views: number; whatsapp: number; calls: number; shares: number; enquiries: number }

/* ---------------------------------------------------------------- limits */
export interface Limits { businesses: number; products: number; images: number; videos: number; totalMediaMb: number; /** Photos and videos uploaded for feed posts (they are not in the gallery). */ feed: number; enquiries: number }
export const FREE_LIMITS: Limits = { businesses: 1, products: 30, images: 12, videos: 0, totalMediaMb: 80, feed: 60, enquiries: 200 };
export const PAID_LIMITS: Limits = { businesses: 3, products: 200, images: 60, videos: 10, totalMediaMb: 2000, feed: 400, enquiries: 500 };
/** A personal profile is meant for students: a few videos are free (a profile without any video would miss the point), and it does not use up the business allowance. */
export const PROFILE_FREE_LIMITS: Limits = { businesses: 1, products: 10, images: 40, videos: 4, totalMediaMb: 400, feed: 120, enquiries: 200 };
export const PROFILE_MAX_VIDEO_MB = 100;
export const limitsFor = (paid: boolean, category?: string): Limits => (paid ? PAID_LIMITS : category === 'profile' ? PROFILE_FREE_LIMITS : FREE_LIMITS);
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
/** A video up to 200 MB (paid plans only): about a minute of 1080p from a phone, more at a lower quality. */
export const MAX_VIDEO_MB = 200;
export const MAX_VIDEO_BYTES = MAX_VIDEO_MB * 1024 * 1024;

/* ---------------------------------------------------------------- cleaning (every text a person types goes through these) */
export const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
export const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => ((list as readonly string[]).includes(String(v)) ? (String(v) as T) : fallback);
/** Digits only, with an optional country code, 8 to 15 digits. */
/** Digits only, with the country code. A local number (one leading 0, ten digits) gets BIZ_COUNTRY_CODE (default 250, Rwanda), so wa.me and tel: links work. */
export const cleanPhone = (v: unknown): string | undefined => { let d = String(v ?? '').replace(/\D/g, ''); if (/^0\d{9}$/.test(d)) d = `${process.env.BIZ_COUNTRY_CODE || '250'}${d.slice(1)}`; return d.length >= 8 && d.length <= 15 ? d : undefined; };
/** A web address that is https and has no login in it; anything else is dropped (no javascript:, data:, http:). */
export function cleanUrl(v: unknown, hosts?: RegExp): string | undefined {
  const s = String(v ?? '').trim(); if (!s || s.length > 300) return undefined;
  try { const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return undefined; if (hosts && !hosts.test(u.hostname)) return undefined; return u.href; } catch { return undefined; }
}
export const cleanEmail = (v: unknown): string | undefined => { const s = String(v ?? '').trim().toLowerCase(); return s.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : undefined; };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validSlug(v: unknown): { ok: true; slug: string } | { ok: false; error: string } {
  const slug = String(v ?? '').trim().toLowerCase();
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) return { ok: false, error: `The page name must be ${SLUG_MIN} to ${SLUG_MAX} characters.` };
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return { ok: false, error: 'Use only letters, numbers and single dashes, for example mama-grace-cafe.' };
  if (RESERVED_SLUGS.has(slug) || slug.startsWith('bwenge')) return { ok: false, error: 'That name is kept by Bwenge. Choose another.' };
  return { ok: true, slug };
}
/** A page name suggested from a business name ("Mama Grace's Café" gives "mama-graces-cafe"). */
export function slugFrom(name: string): string {
  const base = String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SLUG_MAX).replace(/-+$/g, '');
  return base.length >= SLUG_MIN ? base : `${base || 'my'}-biz`.slice(0, SLUG_MAX);
}

export function cleanHours(v: unknown): Hours[] {
  const out: Hours[] = [];
  for (const h of Array.isArray(v) ? v : []) {
    const day = oneOf(DAYS, h?.day, 'mon');
    if (!(DAYS as readonly string[]).includes(String(h?.day)) || out.some((x) => x.day === day)) continue;
    if (h?.closed === true) { out.push({ day, open: '00:00', close: '00:00', closed: true }); continue; }
    if (HHMM.test(String(h?.open)) && HHMM.test(String(h?.close))) out.push({ day, open: String(h.open), close: String(h.close) });
  }
  return out.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day));
}

/** A product as typed by the owner (or the AI): name required, price in RWF (whole francs) or none ("ask"). */
export function cleanProduct(input: any, id: string, prev?: Product): Product | { error: string } {
  const name = clean(input?.name ?? prev?.name, 80); if (!name) return { error: 'A product needs a name.' };
  const raw = input?.price === undefined ? prev?.price ?? null : input.price;
  let price: number | null = null;
  if (raw !== null && raw !== '' && raw !== undefined) { const n = Number(String(raw).replace(/[,\s]/g, '')); if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) return { error: 'The price must be a number of RWF.' }; price = Math.round(n); }
  const p: Product = { id, name, price, available: input?.available === undefined ? prev?.available ?? true : input.available !== false };
  const unit = clean(input?.unit ?? prev?.unit, 20); if (unit) p.unit = unit;
  const description = clean(input?.description ?? prev?.description, 400); if (description) p.description = description;
  if (input?.url !== undefined && String(input.url).trim() !== '' && !cleanUrl(input.url)) return { error: 'The link must start with https://, for example https://www.example.com/my-service.' };
  const url = input?.url === undefined ? prev?.url : cleanUrl(input.url); if (url) p.url = url;
  const mediaId = input?.mediaId === undefined ? prev?.mediaId : input.mediaId ? String(input.mediaId).slice(0, 60) : undefined; if (mediaId) p.mediaId = mediaId;
  const hidden = input?.hidden === undefined ? prev?.hidden : input.hidden === true; if (hidden) p.hidden = true;
  const stock = input?.stock === undefined ? prev?.stock : input.stock === null || input.stock === '' ? undefined : Number(input.stock);
  if (stock !== undefined) { if (!Number.isFinite(stock) || stock < 0 || stock > 1_000_000) return { error: 'Stock must be a number from 0 up.' }; p.stock = Math.round(stock * 100) / 100; }
  const lowAt = input?.lowAt === undefined ? prev?.lowAt : input.lowAt === null || input.lowAt === '' ? undefined : Number(input.lowAt);
  if (lowAt !== undefined && Number.isFinite(lowAt) && lowAt >= 0) p.lowAt = Math.round(lowAt);
  return p;
}

/** Applies the fields an owner may change on the page. Unknown fields are ignored; every text is cleaned. */
export function applyProfile(b: Business, patch: any): void {
  const set = <K extends keyof Business>(k: K, v: Business[K] | undefined) => { if (v === undefined || v === '') delete (b as any)[k]; else (b as any)[k] = v; };
  if (patch.name !== undefined) { const n = clean(patch.name, 60); if (n) b.name = n; }
  if (patch.category !== undefined) b.category = oneOf(CATEGORIES, patch.category, b.category);
  if (patch.theme !== undefined) b.theme = oneOf(THEMES, patch.theme, b.theme);
  if (patch.tagline !== undefined) b.tagline = clean(patch.tagline, 120);
  if (patch.about !== undefined) b.about = clean(patch.about, 1500);
  if (patch.notes !== undefined) b.notes = clean(patch.notes, 2000);
  if (patch.whatsapp !== undefined) set('whatsapp', cleanPhone(patch.whatsapp));
  if (patch.phone !== undefined) set('phone', cleanPhone(patch.phone));
  if (patch.email !== undefined) set('email', cleanEmail(patch.email));
  if (patch.address !== undefined) set('address', clean(patch.address, 160));
  if (patch.mapUrl !== undefined) set('mapUrl', cleanUrl(patch.mapUrl, /(^|\.)(google\.[a-z.]+|goo\.gl|maps\.app\.goo\.gl|openstreetmap\.org|osm\.org|waze\.com)$/i));
  if (patch.website !== undefined) set('website', cleanUrl(patch.website));
  if (patch.instagram !== undefined) set('instagram', cleanUrl(patch.instagram, /(^|\.)instagram\.com$/i));
  if (patch.facebook !== undefined) set('facebook', cleanUrl(patch.facebook, /(^|\.)(facebook\.com|fb\.com|fb\.me)$/i));
  if (patch.lat !== undefined || patch.lng !== undefined) {
    const la = patch.lat === null || patch.lat === '' ? null : Number(patch.lat), lo = patch.lng === null || patch.lng === '' ? null : Number(patch.lng);
    if (la === null || lo === null) { delete b.lat; delete b.lng; }
    else if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) { b.lat = Math.round(la * 1e6) / 1e6; b.lng = Math.round(lo * 1e6) / 1e6; }
  }
  if (patch.hours !== undefined) b.hours = cleanHours(patch.hours);
  if (patch.momoCode !== undefined) { const c = String(patch.momoCode ?? '').replace(/\D/g, ''); set('momoCode', c.length >= 3 && c.length <= 20 ? c : undefined); }
  if (patch.momoName !== undefined) set('momoName', clean(patch.momoName, 60));
  if (patch.lang !== undefined) b.lang = oneOf(LANGS, patch.lang, b.lang ?? 'en');
  if (patch.acceptPay !== undefined) set('acceptPay', patch.acceptPay === true ? true : undefined);
  if (patch.payOpen !== undefined) set('payOpen', patch.payOpen === true ? true : undefined);
  if (patch.showPay !== undefined) b.showPay = patch.showPay === true && !!b.momoCode;
}

const strs = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : []).map((x: unknown) => String(x)))];
const monthOk = (v: unknown) => { const t = String(v ?? '').trim().toLowerCase(); return /^\d{4}(-(0[1-9]|1[0-2]))?$/.test(t) || t === 'present' ? t : ''; };
const cleanTimeline = (v: unknown, prev: TimelineItem[], mediaIds: Set<string>): TimelineItem[] => {
  const out: TimelineItem[] = []; const used = new Set<string>();
  for (const r of (Array.isArray(v) ? v : []).slice(0, PROFILE_MAX.timeline)) {
    const title = clean(r?.title, 120); if (!title) continue;
    const kind = (TIMELINE_KINDS as readonly string[]).includes(r?.kind) ? (r.kind as TimelineKind) : 'event';
    let id = typeof r?.id === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(r.id) && !used.has(r.id) ? r.id : ''; if (!id) id = `t${Date.now().toString(36)}${out.length}${Math.random().toString(36).slice(2, 5)}`; used.add(id);
    const it: TimelineItem = { id, kind, title }; const old = prev.find((x) => x.id === id);
    const org = clean(r?.org ?? old?.org, 100); if (org) it.org = org; const place = clean(r?.place ?? old?.place, 80); if (place) it.place = place;
    const from = monthOk(r?.from); if (from && from !== 'present') it.from = from; const to = monthOk(r?.to); if (to) it.to = to;
    const text = clean(r?.text, 600); if (text) it.text = text; const url = cleanUrl(r?.url); if (url) it.url = url;
    const ms = strs(r?.mediaIds).filter((m) => mediaIds.has(m)).slice(0, 6); if (ms.length) it.mediaIds = ms;
    out.push(it);
  }
  return out;
};
/** Applies what the owner may change on a profile (Bwenge4profile). Only fields that are present change; every text is cleaned and every link must be https. */
export function applyProfileData(b: Business, patch: any): { error?: string } {
  if (!patch || typeof patch !== 'object') return {};
  const p: ProfileData = b.profile ?? { skills: [], timeline: [], links: [], featured: [] };
  const txt = (k: 'headline' | 'school' | 'field' | 'location' | 'openTo', max: number) => { if (patch[k] === undefined) return; const v = clean(patch[k], max); if (v) p[k] = v; else delete p[k]; };
  txt('headline', 90); txt('school', 100); txt('field', 100); txt('location', 80); txt('openTo', 160);
  if (patch.skills !== undefined) p.skills = [...new Set((Array.isArray(patch.skills) ? patch.skills : String(patch.skills ?? '').split(',')).map((x: unknown) => clean(x, 40)).filter((x: string) => !!x))].slice(0, PROFILE_MAX.skills) as string[];
  if (patch.links !== undefined) {
    const links: ProfileLink[] = [];
    for (const r of (Array.isArray(patch.links) ? patch.links : []).slice(0, PROFILE_MAX.links)) {
      const url = cleanUrl(r?.url); const label = clean(r?.label, 40); if (!url && (r?.url || label)) return { error: 'Every link must start with https://, for example https://www.linkedin.com/in/your-name.' };
      if (url) links.push({ id: typeof r?.id === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(r.id) ? r.id : `l${links.length}${Math.random().toString(36).slice(2, 6)}`, label: label || new URL(url).hostname.replace(/^www\./, ''), url });
    }
    p.links = links;
  }
  if (patch.cvUrl !== undefined) { const u = cleanUrl(patch.cvUrl); if (patch.cvUrl && !u) return { error: 'The CV link must start with https://.' }; if (u) p.cvUrl = u; else delete p.cvUrl; }
  const have = new Set(b.media.map((m) => m.id));
  if (patch.timeline !== undefined) p.timeline = cleanTimeline(patch.timeline, p.timeline, have);
  if (patch.featured !== undefined) p.featured = strs(patch.featured).filter((m) => have.has(m)).slice(0, PROFILE_MAX.featured);
  b.profile = p; return {};
}

/* ---------------------------------------------------------------- the public boundary */
export interface PublicMedia { id: string; kind: MediaKind; document?: { name: string; mime: string; size: number }; caption?: string; video?: PublicVideo }
/** The public face of one file: its kind, caption and, for a video, what a player needs (size of the picture, whether a light version and a poster exist). */
export const publicMedia = (m: Media): PublicMedia => ({ id: m.id, kind: m.kind, ...(m.kind === 'document' ? { document: { name: m.name, mime: m.mime, size: m.size } } : {}), ...(m.caption ? { caption: m.caption } : {}), ...(m.kind === 'video' && m.video ? { video: { state: m.video.state, ...(m.video.w ? { w: m.video.w, h: m.video.h } : {}), ...(m.video.duration ? { duration: m.video.duration } : {}), ...(m.video.lq ? { lq: true } : {}), ...(m.video.poster ? { poster: true } : {}), ...(m.video.rev ? { rev: m.video.rev } : {}), ...(m.video.raw ? { raw: true } : {}) } } : {}) });
export interface PublicBusiness {
  slug: string; name: string; category: Category; tagline: string; about: string; theme: Theme;
  logo?: PublicMedia; cover?: PublicMedia;
  appName?: string; appIcon?: PublicMedia;
  androidApkAvailable?: boolean;
  contact: { whatsapp?: string; phone?: string; email?: string; address?: string; mapUrl?: string; website?: string; instagram?: string; facebook?: string };
  hours: Hours[];
  pay?: { momoCode: string; momoName?: string };
  location?: { lat: number; lng: number };
  lang?: Lang; translations?: Partial<Record<Lang, Translation>>;
  sections?: PublicSection[];
  /** Present when visitors can pay online right on the page. */
  payOnline?: { open: boolean };
  /** The owner's own words for the programs below (public: they are only words). */
  programText?: ProgramText;
  /** The owner bought the verified badge (a one-time payment): shown as a check mark next to the name. */
  verified?: true;
  /** Programs customers can join (a monthly pass, ten visits, a month of lunches…): see programs.ts. */
  programs?: Array<{ checkIn: 'staff' | 'self'; id: string; title: string; description?: string; priceRwf: number; days: number; tariffs: Array<{ days: number; priceRwf: number }>; totalUses?: number; items: string[]; openDays: Day[]; windows?: Array<{ item: string; from: string; to: string }>; terms?: string; full: boolean; needsCode: boolean }>;
  products: Array<{ id: string; name: string; price: number | null; url?: string; unit?: string; description?: string; media?: PublicMedia; available: boolean }>;
  gallery: PublicMedia[];
  /** Only for a profile (Bwenge4profile). */
  profile?: PublicProfile;
  updatedAt: string;
}
export interface PublicProfile { headline?: string; school?: string; field?: string; location?: string; openTo?: string; skills: string[]; links: ProfileLink[]; cvUrl?: string; featured: PublicMedia[]; timeline: Array<Omit<TimelineItem, 'mediaIds'> & { media?: PublicMedia[] }> }

/** Whether a page may be shown at all. */
export const isLive = (b: Business) => b.published && !b.suspended;

/** The ONLY description of a business that public routes may return. Built field by field (never by copying the business). */
export function publicView(b: Business): PublicBusiness {
  const shown = new Map(b.media.filter((m) => m.visible && m.kind !== 'document').map((m) => [m.id, m]));
  const pm = (id?: string): PublicMedia | undefined => { const m = id ? shown.get(id) : undefined; return m ? publicMedia(m) : undefined; };
  const contact: PublicBusiness['contact'] = {};
  for (const k of ['whatsapp', 'phone', 'email', 'address', 'mapUrl', 'website', 'instagram', 'facebook'] as const) if (b[k]) contact[k] = b[k];
  const out: PublicBusiness = {
    slug: b.slug, name: b.name, category: b.category, tagline: b.tagline, about: b.about, theme: b.theme, contact, hours: b.hours.map((h) => ({ ...h })),
    products: b.products.filter((p) => !p.hidden).map((p) => ({ id: p.id, name: p.name, price: p.price, ...(p.unit ? { unit: p.unit } : {}), ...(p.description ? { description: p.description } : {}), ...(p.url ? { url: p.url } : {}), ...(pm(p.mediaId) ? { media: pm(p.mediaId) } : {}), available: p.available })),
    gallery: b.media.filter((m) => shown.has(m.id) && m.gallery !== false && m.id !== b.logoId && m.id !== b.coverId && m.id !== b.appIconId).map((m) => pm(m.id)!),
    updatedAt: b.updatedAt,
  };
  if (b.programText && Object.keys(b.programText).length) out.programText = { ...b.programText };
  if (b.lang && b.lang !== 'en') out.lang = b.lang; if (b.translations && Object.keys(b.translations).length) out.translations = b.translations;
  if (b.category === 'profile' && b.profile) {
    const q = b.profile; out.profile = { ...(q.headline ? { headline: q.headline } : {}), ...(q.school ? { school: q.school } : {}), ...(q.field ? { field: q.field } : {}), ...(q.location ? { location: q.location } : {}), ...(q.openTo ? { openTo: q.openTo } : {}), ...(q.cvUrl ? { cvUrl: q.cvUrl } : {}), skills: [...q.skills], links: q.links.map((l) => ({ ...l })), featured: q.featured.map(pm).filter((x): x is PublicMedia => !!x), timeline: q.timeline.map(({ mediaIds, ...t }) => { const ms = (mediaIds ?? []).map(pm).filter((x): x is PublicMedia => !!x); return { ...t, ...(ms.length ? { media: ms } : {}) }; }) };
  }
  if (typeof b.lat === 'number' && typeof b.lng === 'number') out.location = { lat: b.lat, lng: b.lng };
  const appIcon = pm(b.appIconId);
  if (appIcon) out.appIcon = appIcon;
  if (b.appName) out.appName = b.appName;
  const logo = pm(b.logoId), cover = pm(b.coverId); if (logo) out.logo = logo; if (cover) out.cover = cover;
  if (b.showPay && b.momoCode) out.pay = { momoCode: b.momoCode, ...(b.momoName ? { momoName: b.momoName } : {}) };
  return out;
}

/** "Open now" for a page, from its hours (the owner's local time is Kigali, UTC+2). */
export function openNow(hours: Hours[], now = Date.now()): boolean | null {
  if (!hours.length) return null;
  const k = new Date(now + 2 * 3600_000); const day = DAYS[(k.getUTCDay() + 6) % 7]; const h = hours.find((x) => x.day === day);
  if (!h) return null; if (h.closed) return false;
  const t = k.getUTCHours() * 60 + k.getUTCMinutes(); const [oh, om] = h.open.split(':').map(Number), [ch, cm] = h.close.split(':').map(Number);
  const o = oh * 60 + om, c = ch * 60 + cm;
  return c > o ? t >= o && t < c : t >= o || t < c;      // a closing time after midnight counts as the next day
}

export function newBusiness(id: string, ownerId: string, name: string, slug: string, category: Category, now: string): Business {
  return { id, ownerId, slug, name, category, tagline: '', about: '', theme: 'gold', hours: [], showPay: false, products: [], media: [], notes: '', published: false, createdAt: now, updatedAt: now };
}
