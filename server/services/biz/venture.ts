import type { BizService } from './service.js';

/**
 * The 4biz venture page: one Bwenge4biz page that presents the three products (MySEB, Bwenge AI, Bwenge4biz) under the aim "AI in our context".
 * It is also the worked example of what a venture page can look like: a name, a one-line aim, a description, the products, what the venture helps with,
 * answers to the usual questions and a way to reach the founder. `ensureVenture` makes or refreshes it for one account and can be run any number of times.
 */
export const VENTURE_SLUG = '4biz';
const SITE = () => (process.env.APP_BASE_URL || 'https://www.bwenge.space').replace(/\/$/, '');

export const venturePage = (site: string = SITE()) => ({
  name: '4biz', category: 'services', theme: 'ink',
  tagline: 'AI in our context',
  about: '4biz builds AI that fits how we live and work. Three products, one aim: help people and small businesses learn, keep their records straight and reach new markets.\n\nMySEB runs secure online exams. Bwenge AI is a study and work assistant that understands our context, in English and Kinyarwanda. Bwenge4biz gives every business a page, a notebook for sales and stock, programs such as meal cards and passes, and an assistant that helps it grow.',
  products: [
    { name: 'MySEB', description: 'Secure online exams for lecturers: a live room to watch the class, checks against cheating and results you can trust.' },
    { name: 'Bwenge AI', description: 'Your study and work assistant, in English and Kinyarwanda: answers, documents, research and marking, made for our context.' },
    { name: 'Bwenge4biz', description: 'A page for your business, a notebook for sales and stock, programs like meal cards, a closing report every day and an assistant that helps you grow.' },
  ],
  sections: [
    { type: 'links', title: 'Our products', items: [
      { title: 'MySEB', text: 'Secure exams for lecturers and schools.', url: `${site}/myseb` },
      { title: 'Bwenge AI', text: 'The assistant for study and work.', url: `${site}/` },
      { title: 'Bwenge4biz', text: 'Pages, records and growth for businesses.', url: `${site}/biz` },
    ] },
    { type: 'list', title: 'What we help with', items: [
      { title: 'Business growth', text: 'An assistant that reads your numbers, writes your closing report and suggests the next step.' },
      { title: 'Business records', text: 'Sales, expenses, stock and customers in one notebook, kept by chat or by tap.' },
      { title: 'Reaching new markets', text: 'A page you can share on WhatsApp, in English and Kinyarwanda, that customers beyond your street can find and trust.' },
    ] },
    { type: 'faq', title: 'Good to know', items: [
      { title: 'Who is 4biz for?', text: 'Lecturers and students, and any small business that wants to be found and to keep clear records: shops, restaurants, salons, farms, schools and more.' },
      { title: 'How do I start?', text: 'Open Bwenge4biz, make your page in a few minutes, then ask the assistant to set up your products and programs. Message us on WhatsApp if you want help.' },
      { title: 'What does the blue check mean?', text: 'The person behind this page is real and can be reached, and paid for verification. It is not an endorsement of any business.' },
    ] },
  ],
  rw: {
    tagline: 'AI mu byacu',
    about: '4biz ikora AI ijyanye n’uko tubaho kandi dukora. Ibicuruzwa bitatu, intego imwe: gufasha abantu n’ubucuruzi buto kwiga, kubika inyandiko neza no kugera ku masoko mashya.\n\nMySEB itegura ibizamini byizewe kuri interineti. Bwenge AI ni umufasha wo kwiga no gukora wumva ibyacu, mu Cyongereza no mu Kinyarwanda. Bwenge4biz iha buri bucuruzi urupapuro, ikayi y’ibyagurishijwe n’ibisigaye, porogaramu nk’amakarita y’amafunguro, n’umufasha ufasha gukura.',
    products: { MySEB: 'Ibizamini byizewe kuri interineti ku barimu: icyumba kizima cyo kureba ishuri, kwirinda uburiganya n’ibisubizo wakwizera.', 'Bwenge AI': 'Umufasha wawe wo kwiga no gukora, mu Cyongereza no mu Kinyarwanda: ibisubizo, inyandiko, ubushakashatsi no gusuzuma, byakorewe ibyacu.', Bwenge4biz: 'Urupapuro rw’ubucuruzi bwawe, ikayi y’ibyagurishijwe n’ibisigaye, porogaramu nk’amakarita y’amafunguro, raporo y’umunsi n’umufasha agufasha gukura.' } as Record<string, string>,
  },
});

/** Who the venture page is for: the account with the given email, or the caller when none is given. Throws a plain message when there is no such account. */
export async function resolveVentureOwner(email: unknown, caller: string, findByEmail: (email: string) => Promise<{ id: string } | null>): Promise<string> {
  const e = String(email ?? '').trim().toLowerCase(); if (!e) return caller;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw new Error('That does not look like an email address.');
  const u = await findByEmail(e); if (!u) throw new Error(`No account has the email ${e}. The person must sign up first.`); return u.id;
}

/** What any venture page is made of. The 4biz page is one of these; Bwenge AI fills one in for anyone who asks for a page like it. */
export interface VentureSpec {
  name: string; slug?: string; category?: string; theme?: string;
  /** The one-line aim, for example "AI in our context". */
  tagline: string;
  /** The main description (what the venture is and who it is for). */
  about: string;
  products?: Array<{ name: string; description?: string; priceRwf?: number | null }>;
  /** "What we help with": short headed points. */
  helps?: Array<{ title: string; text?: string }>;
  links?: Array<{ title: string; text?: string; url?: string }>;
  faq?: Array<{ title: string; text: string }>;
  whatsapp?: string; website?: string;
  /** Kinyarwanda words, when the owner gave them. */
  rw?: { tagline?: string; about?: string; products?: Record<string, string> };
}
export interface VentureDeps { grantBadge?: (ownerId: string) => Promise<void>; /** The founder's WhatsApp number, shown as the contact. */ whatsapp?: string; /** Publish the page now (the 4biz example does; Bwenge AI only when the owner said so). */ publish?: boolean }
export interface VentureResult { url: string; created: boolean; products: number; sections: number; verified: boolean; published: boolean }

/** The 4biz page as a spec. */
export const fourbizSpec = (site: string = SITE()): VentureSpec => { const v = venturePage(site); return {
  name: v.name, slug: VENTURE_SLUG, category: v.category, theme: v.theme, tagline: v.tagline, about: v.about, website: site, products: v.products,
  helps: v.sections[1].items!.map((x) => ({ title: x.title, text: x.text })), links: v.sections[0].items!.map((x) => ({ title: x.title, text: x.text, url: x.url })), faq: v.sections[2].items!.map((x) => ({ title: x.title, text: x.text! })), rw: v.rw,
}; };

/**
 * Makes (or refreshes) a venture page for one account from a spec: the page, its products, the sections "Our products" (links), "What we help with" and "Good to know", and Kinyarwanda words.
 * Safe to run again: products and sections are matched by name, never duplicated. The page is published only when `deps.publish` says so.
 */
export async function ensureVenturePage(svc: BizService, ownerId: string, spec: VentureSpec, deps: VentureDeps = {}, site: string = SITE()): Promise<VentureResult> {
  const slug = spec.slug || undefined;
  const have = (await svc.list(ownerId)).find((b) => (slug ? b.slug === slug : b.name.toLowerCase() === spec.name.toLowerCase()));
  let created = false; let biz = have;
  if (!biz) { biz = await svc.create(ownerId, { name: spec.name, ...(slug ? { slug } : {}), category: spec.category ?? 'other' }); created = true; }
  const whatsapp = spec.whatsapp ?? deps.whatsapp;
  await svc.update(ownerId, biz.id, { name: spec.name, ...(spec.category ? { category: spec.category } : {}), ...(spec.theme ? { theme: spec.theme } : {}), tagline: spec.tagline, about: spec.about, ...(whatsapp ? { whatsapp } : {}), ...(spec.website ? { website: spec.website } : {}) });
  const productIds: Record<string, string> = {}; const current = (await svc.list(ownerId)).find((b) => b.id === biz!.id)!.products;
  for (const p of spec.products ?? []) {
    const existing = current.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
    if (existing) { await svc.updateProduct(ownerId, biz.id, existing.id, { description: p.description ?? '', available: true, hidden: false, ...(p.priceRwf !== undefined ? { price: p.priceRwf } : {}) }); productIds[p.name] = existing.id; }
    else productIds[p.name] = (await svc.addProduct(ownerId, biz.id, { name: p.name, price: p.priceRwf ?? null, description: p.description })).id;
  }
  let sections = 0;
  if (spec.links?.length) { await svc.saveSection(ownerId, biz.id, { id: 'Our products', type: 'links', title: 'Our products', items: spec.links }); sections++; }
  if (spec.helps?.length) { await svc.saveSection(ownerId, biz.id, { id: 'What we help with', type: 'list', title: 'What we help with', items: spec.helps }); sections++; }
  if (spec.faq?.length) { await svc.saveSection(ownerId, biz.id, { id: 'Good to know', type: 'faq', title: 'Good to know', items: spec.faq }); sections++; }
  if (spec.rw && (spec.rw.tagline || spec.rw.about || spec.rw.products)) await svc.setTranslation(ownerId, biz.id, 'rw', { ...(spec.rw.tagline ? { tagline: spec.rw.tagline } : {}), ...(spec.rw.about ? { about: spec.rw.about } : {}), ...(spec.rw.products ? { products: Object.fromEntries(Object.entries(spec.rw.products).filter(([n]) => productIds[n]).map(([n, d]) => [productIds[n], { name: n, description: d }])) } : {}) });
  let published = false; if (deps.publish) { await svc.setPublished(ownerId, biz.id, true); published = true; }
  let verified = false; if (deps.grantBadge) { await deps.grantBadge(ownerId); verified = true; }
  return { url: `${site}/b/${(await svc.list(ownerId)).find((b) => b.id === biz!.id)!.slug}`, created, products: (spec.products ?? []).length, sections, verified, published };
}

/** Makes (or refreshes) the 4biz page for this account and publishes it; optionally gives the owner the verified badge. Safe to run again. */
export const ensureVenture = (svc: BizService, ownerId: string, deps: VentureDeps = {}, site: string = SITE()) => ensureVenturePage(svc, ownerId, fourbizSpec(site), { publish: true, ...deps }, site);
