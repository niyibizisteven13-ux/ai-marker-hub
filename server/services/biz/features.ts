import { clean, cleanUrl } from './model.js';

/**
 * Features the owner (or their agent) creates without any code: public SECTIONS (text, FAQ, price list, buttons, a form) and private TRACKERS
 * (a small table with fields the owner chooses: bookings, deliveries, loans, anything). A form section feeds a tracker, so "booking" is a form
 * section plus a Bookings tracker. Everything is plain data that is checked here; nothing an owner types is ever run or shown as HTML.
 */
export type SectionType = 'text' | 'faq' | 'list' | 'links' | 'form';
export const SECTION_TYPES: SectionType[] = ['text', 'faq', 'list', 'links', 'form'];
export interface SectionItem { title: string; text?: string; price?: string; url?: string }
export interface Section { id: string; type: SectionType; title: string; body?: string; items?: SectionItem[]; /** For a form: the tracker that receives what visitors send, and the button label. */ trackerId?: string; button?: string; hidden?: boolean }
export const MAX_SECTIONS = 12, MAX_ITEMS = 30;

export type FieldType = 'text' | 'number' | 'date' | 'choice';
export interface Field { key: string; label: string; type: FieldType; options?: string[]; required?: boolean }
export interface Tracker { id: string; name: string; description: string; fields: Field[]; /** The values of the "status" choice, first is the default. */ statuses: string[]; createdAt: string }
export interface TrackerRecord { id: string; trackerId: string; at: string; values: Record<string, string | number>; status: string; src: 'studio' | 'chat' | 'page' }
export const MAX_TRACKERS = 10, MAX_FIELDS = 12, MAX_RECORDS = 3000;

const keyOf = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '').slice(0, 24) || 'field';

export function cleanSection(input: any, id: string, prev?: Section): Section | { error: string } {
  const type = (SECTION_TYPES as string[]).includes(input?.type) ? (input.type as SectionType) : prev?.type; if (!type) return { error: `Choose a section type: ${SECTION_TYPES.join(', ')}.` };
  const title = clean(input?.title ?? prev?.title, 60); if (!title) return { error: 'A section needs a title.' };
  const s: Section = { id, type, title };
  const body = clean(input?.body ?? prev?.body, 1500); if (body) s.body = body;
  if (type === 'faq' || type === 'list' || type === 'links') {
    const raw = input?.items ?? prev?.items ?? []; if (!Array.isArray(raw)) return { error: 'Items must be a list.' };
    const items: SectionItem[] = []; for (const x of raw.slice(0, MAX_ITEMS)) {
      const t = clean(x?.title, 100); if (!t) continue; const it: SectionItem = { title: t }; const tx = clean(x?.text, 500); if (tx) it.text = tx; const pr = clean(x?.price, 30); if (pr) it.price = pr;
      if (type === 'links') { const u = cleanUrl(x?.url); if (!u) continue; it.url = u; } items.push(it);
    }
    if (!items.length && type !== 'list') return { error: type === 'links' ? 'Add at least one link with a title and an https address.' : 'Add at least one question with its answer.' }; s.items = items;
  }
  if (type === 'form') { const tid = String(input?.trackerId ?? prev?.trackerId ?? ''); if (!tid) return { error: 'A form needs a tracker to send what visitors fill in.' }; s.trackerId = tid; s.button = clean(input?.button ?? prev?.button, 30) || 'Send'; }
  if (input?.hidden === true || (input?.hidden === undefined && prev?.hidden)) s.hidden = true;
  return s;
}

export function cleanTracker(input: any, id: string, nowIso: string): Tracker | { error: string } {
  const name = clean(input?.name, 40); if (!name) return { error: 'Give the tracker a name, for example "Bookings".' };
  if (!Array.isArray(input?.fields) || !input.fields.length) return { error: 'A tracker needs at least one field.' }; if (input.fields.length > MAX_FIELDS) return { error: `A tracker can have at most ${MAX_FIELDS} fields.` };
  const fields: Field[] = []; const used = new Set<string>();
  for (const f of input.fields) {
    const label = clean(f?.label ?? f?.name, 40); if (!label) return { error: 'Every field needs a label.' }; let key = keyOf(String(f?.key ?? label)); while (used.has(key)) key = `${key.slice(0, 21)}_${used.size}`; used.add(key);
    const type = (['text', 'number', 'date', 'choice'] as string[]).includes(f?.type) ? (f.type as FieldType) : 'text'; const fld: Field = { key, label, type };
    if (type === 'choice') { const opts = (Array.isArray(f?.options) ? f.options : []).map((o: unknown) => clean(o, 30)).filter(Boolean).slice(0, 12); if (opts.length < 2) return { error: `The field "${label}" needs at least two options.` }; fld.options = opts; }
    if (f?.required === true) fld.required = true; fields.push(fld);
  }
  const statuses = (Array.isArray(input?.statuses) ? input.statuses : ['new', 'confirmed', 'done']).map((o: unknown) => clean(o, 20)).filter(Boolean).slice(0, 8); if (statuses.length < 2) statuses.splice(0, statuses.length, 'new', 'done');
  return { id, name, description: clean(input?.description, 200), fields, statuses, createdAt: nowIso };
}

/** Checks one record's values against the tracker's fields. Returns the cleaned values, or a plain error that names the field. */
export function cleanValues(t: Tracker, input: any, partial = false, prev: Record<string, string | number> = {}): { values: Record<string, string | number> } | { error: string } {
  const values: Record<string, string | number> = { ...prev }; const src = input && typeof input === 'object' ? input : {};
  for (const f of t.fields) {
    const given = Object.prototype.hasOwnProperty.call(src, f.key) ? src[f.key] : Object.prototype.hasOwnProperty.call(src, f.label) ? src[f.label] : undefined;
    if (given === undefined) { if (!partial && f.required && values[f.key] === undefined) return { error: `${f.label} is required.` }; continue; }
    const raw = typeof given === 'string' ? given.trim() : given; if (raw === '' || raw === null) { if (f.required) return { error: `${f.label} is required.` }; delete values[f.key]; continue; }
    if (f.type === 'number') { const n = Number(String(raw).replace(/[,\s]/g, '')); if (!Number.isFinite(n) || Math.abs(n) > 1e12) return { error: `${f.label} must be a number.` }; values[f.key] = n; }
    else if (f.type === 'date') { const d = String(raw).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) return { error: `${f.label} must be a date like 2026-12-24.` }; values[f.key] = d; }
    else if (f.type === 'choice') { const o = (f.options ?? []).find((x) => x.toLowerCase() === String(raw).toLowerCase()); if (!o) return { error: `${f.label} must be one of: ${(f.options ?? []).join(', ')}.` }; values[f.key] = o; }
    else { const t2 = clean(raw, 300); if (!t2) { if (f.required) return { error: `${f.label} is required.` }; delete values[f.key]; continue; } values[f.key] = t2; }
  }
  return { values };
}

/** Ready-made features an agent can switch on in one step. Labels in English or Kinyarwanda. */
export function template(kind: string, lang: 'en' | 'rw' = 'en'): { tracker?: any; section: any } | null {
  const rw = lang === 'rw';
  if (kind === 'booking') return {
    tracker: { name: rw ? 'Gufata igihe' : 'Bookings', description: rw ? 'Abakiriya bafashe igihe' : 'Appointments customers asked for', statuses: rw ? ['bishya', 'byemejwe', 'byarangiye'] : ['new', 'confirmed', 'done'],
      fields: [{ label: rw ? 'Izina' : 'Name', type: 'text', required: true }, { label: rw ? 'Telefone' : 'Phone', type: 'text', required: true }, { label: rw ? 'Itariki' : 'Date', type: 'date', required: true }, { label: rw ? 'Serivisi' : 'Service', type: 'text' }, { label: rw ? 'Icyo ushaka' : 'Note', type: 'text' }] },
    section: { type: 'form', title: rw ? 'Fata igihe' : 'Book an appointment', body: rw ? 'Uzuza ibi tuguhamagare tukwemeze.' : 'Fill this in and we will confirm with you.', button: rw ? 'Ohereza' : 'Send request' } };
  if (kind === 'faq') return { section: { type: 'faq', title: rw ? 'Ibibazo bikunze kubazwa' : 'Frequently asked questions', items: [{ title: rw ? 'Mukora amasaha angahe?' : 'What are your opening hours?', text: rw ? 'Reba amasaha yacu hejuru.' : 'See our opening hours on this page.' }] } };
  if (kind === 'price_list') return { section: { type: 'list', title: rw ? 'Ibiciro' : 'Price list', items: [{ title: rw ? 'Igicuruzwa' : 'Item', price: '1,000 RWF' }] } };
  if (kind === 'deliveries') return { tracker: { name: rw ? 'Gutwara ibicuruzwa' : 'Deliveries', description: '', statuses: rw ? ['bitegereje', 'mu nzira', 'byatanzwe'] : ['waiting', 'on the way', 'delivered'], fields: [{ label: rw ? 'Umukiriya' : 'Customer', type: 'text', required: true }, { label: rw ? 'Aho bijya' : 'Address', type: 'text' }, { label: rw ? 'Amafaranga' : 'Amount', type: 'number' }] }, section: null as any };
  if (kind === 'loans') return { tracker: { name: rw ? 'Ideni' : 'Customer credit', description: '', statuses: rw ? ['ntibishyuwe', 'byishyuwe'] : ['unpaid', 'paid'], fields: [{ label: rw ? 'Umukiriya' : 'Customer', type: 'text', required: true }, { label: rw ? 'Amafaranga' : 'Amount', type: 'number', required: true }, { label: rw ? 'Itariki yo kwishyura' : 'Due date', type: 'date' }] }, section: null as any };
  return null;
}
export const TEMPLATES = ['booking', 'faq', 'price_list', 'deliveries', 'loans'];
