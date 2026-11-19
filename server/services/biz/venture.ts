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

export interface VentureDeps { grantBadge?: (ownerId: string) => Promise<void>; /** The founder's WhatsApp number, shown as the contact. */ whatsapp?: string }
export interface VentureResult { url: string; created: boolean; products: number; sections: number; verified: boolean }

/** Makes (or refreshes) the 4biz page for this account and publishes it; optionally gives the owner the verified badge. Safe to run again. */
export async function ensureVenture(svc: BizService, ownerId: string, deps: VentureDeps = {}, site: string = SITE()): Promise<VentureResult> {
  const v = venturePage(site);
  const have = (await svc.list(ownerId)).find((b) => b.slug === VENTURE_SLUG);
  let created = false; let biz = have;
  if (!biz) { biz = await svc.create(ownerId, { name: v.name, slug: VENTURE_SLUG, category: v.category }); created = true; }
  await svc.update(ownerId, biz.id, { name: v.name, category: v.category, theme: v.theme, tagline: v.tagline, about: v.about, ...(deps.whatsapp ? { whatsapp: deps.whatsapp } : {}), website: site });
  // Products by name: add the missing ones, refresh the words of the ones already there.
  const productIds: Record<string, string> = {};
  const current = (await svc.list(ownerId)).find((b) => b.id === biz!.id)!.products;
  for (const p of v.products) {
    const existing = current.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
    if (existing) { await svc.updateProduct(ownerId, biz.id, existing.id, { description: p.description, available: true, hidden: false }); productIds[p.name] = existing.id; }
    else productIds[p.name] = (await svc.addProduct(ownerId, biz.id, { name: p.name, price: null, description: p.description })).id;
  }
  const sectionIds: Record<string, string> = {};
  for (const s of v.sections) { const saved = await svc.saveSection(ownerId, biz.id, { id: s.title, ...s }); sectionIds[s.title] = saved.id; }
  await svc.setTranslation(ownerId, biz.id, 'rw', { tagline: v.rw.tagline, about: v.rw.about, products: Object.fromEntries(Object.entries(v.rw.products).map(([n, d]) => [productIds[n], { name: n, description: d }])) });
  await svc.setPublished(ownerId, biz.id, true);
  let verified = false; if (deps.grantBadge) { await deps.grantBadge(ownerId); verified = true; }
  return { url: `${site}/b/${VENTURE_SLUG}`, created, products: v.products.length, sections: v.sections.length, verified };
}
