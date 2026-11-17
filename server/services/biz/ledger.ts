import { clean, oneOf, type Product } from './model.js';

/**
 * The owner's private money notebook: sales and expenses, kept per business. Never part of publicView.
 * Stored as one document (`biz-ledger:<id>`), newest first, at most MAX_ENTRIES (older entries fall off; the dashboard only needs recent months).
 */
export type LedgerType = 'sale' | 'expense';
export type SaleStatus = 'completed' | 'pending' | 'cancelled';
export interface LedgerEntry {
  id: string; type: LedgerType; amount: number; at: string; status: SaleStatus; src: 'studio' | 'chat' | 'scan' | 'page';
  item?: string; qty?: number; productId?: string; customer?: string; method?: 'cash' | 'momo' | 'card' | 'credit'; note?: string; category?: string;
  /** Mobile-money collection: provider, its reference (this entry's id) and a masked number. */
  pay?: { provider: 'mtn' | 'airtel'; phone: string; state: 'pending' | 'success' | 'failed' };
}
export const MAX_ENTRIES = 5000;
export const EXPENSE_CATEGORIES = ['stock', 'rent', 'transport', 'salaries', 'utilities', 'marketing', 'other'] as const;

const KIGALI = 2 * 3600_000;
export const dayOf = (t: number | string) => new Date((typeof t === 'string' ? Date.parse(t) : t) + KIGALI).toISOString().slice(0, 10);

/** Validates one entry from the studio, the assistant or a scan. Pure; returns an error text for anything wrong. */
export function cleanEntry(input: any, id: string, nowMs: number, products: Product[] = []): LedgerEntry | { error: string } {
  const type = oneOf(['sale', 'expense'] as const, input?.type, 'sale');
  const n = Number(String(input?.amount ?? '').replace(/[,\s]/g, ''));
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000_000) return { error: 'The amount must be a number of RWF above zero.' };
  let at = nowMs; if (input?.at) { const t = Date.parse(String(input.at)); if (!Number.isFinite(t)) return { error: 'That date is not valid.' }; if (t > nowMs + 86_400_000) return { error: 'The date cannot be in the future.' }; if (t < nowMs - 400 * 86_400_000) return { error: 'That date is too old.' }; at = t; }
  const e: LedgerEntry = { id, type, amount: Math.round(n), at: new Date(at).toISOString(), status: type === 'sale' ? oneOf(['completed', 'pending', 'cancelled'] as const, input?.status, 'completed') : 'completed', src: oneOf(['studio', 'chat', 'scan', 'page'] as const, input?.src, 'studio') };
  const item = clean(input?.item, 80); if (item) e.item = item;
  const qty = Number(input?.qty); if (Number.isFinite(qty) && qty > 0 && qty <= 100000) e.qty = Math.round(qty * 100) / 100;
  const p = typeof input?.productId === 'string' ? products.find((x) => x.id === input.productId) : undefined; if (p) { e.productId = p.id; if (!e.item) e.item = p.name; }
  const customer = clean(input?.customer, 60); if (customer) e.customer = customer;
  if (input?.method) e.method = oneOf(['cash', 'momo', 'card', 'credit'] as const, input.method, 'cash');
  const note = clean(input?.note, 200); if (note) e.note = note;
  if (type === 'expense') e.category = oneOf(EXPENSE_CATEGORIES, input?.category, 'other');
  return e;
}

const sum = (xs: LedgerEntry[]) => xs.reduce((a, e) => a + e.amount, 0);
const pct = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);

/** Everything the dashboard shows, from the entries and the product list. Pure, for tests. */
export function summarize(entries: LedgerEntry[], products: Product[], nowMs: number, days = 7) {
  const today = dayOf(nowMs), yesterday = dayOf(nowMs - 86_400_000);
  const sales = entries.filter((e) => e.type === 'sale' && e.status === 'completed'), exp = entries.filter((e) => e.type === 'expense');
  const on = (xs: LedgerEntry[], d: string) => xs.filter((e) => dayOf(e.at) === d);
  const t = { sales: sum(on(sales, today)), expenses: sum(on(exp, today)), orders: on(entries.filter((e) => e.type === 'sale'), today).length };
  const y = { sales: sum(on(sales, yesterday)), expenses: sum(on(exp, yesterday)), orders: on(entries.filter((e) => e.type === 'sale'), yesterday).length };
  const span = Math.max(1, Math.min(90, days)); const series = Array.from({ length: span }, (_, i) => { const d = dayOf(nowMs - (span - 1 - i) * 86_400_000); return { day: d, sales: sum(on(sales, d)), expenses: sum(on(exp, d)) }; });
  const from = series[0].day; const inRange = sales.filter((e) => dayOf(e.at) >= from);
  const byItem = new Map<string, { name: string; amount: number; qty: number }>();
  for (const e of inRange) { const k = (e.item ?? 'Other sales').toLowerCase(); const r = byItem.get(k) ?? { name: e.item ?? 'Other sales', amount: 0, qty: 0 }; r.amount += e.amount; r.qty += e.qty ?? 1; byItem.set(k, r); }
  const top = [...byItem.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);
  const todaySales = entries.filter((e) => e.type === 'sale' && dayOf(e.at) === today);
  const customers = new Set(entries.filter((e) => e.type === 'sale' && e.customer && dayOf(e.at) >= dayOf(nowMs - 29 * 86_400_000)).map((e) => e.customer!.toLowerCase()));
  const rangeSales = sum(inRange), rangeExp = sum(exp.filter((e) => dayOf(e.at) >= from));
  return {
    today: { ...t, profit: t.sales - t.expenses }, yesterday: { ...y, profit: y.sales - y.expenses },
    change: { sales: pct(t.sales, y.sales), orders: pct(t.orders, y.orders), profit: pct(t.sales - t.expenses, y.sales - y.expenses) },
    range: { days: span, sales: rangeSales, expenses: rangeExp, profit: rangeSales - rangeExp }, series, top,
    orders: { completed: todaySales.filter((e) => e.status === 'completed').length, pending: todaySales.filter((e) => e.status === 'pending').length, cancelled: todaySales.filter((e) => e.status === 'cancelled').length },
    customers: customers.size,
    lowStock: products.filter((p) => typeof p.stock === 'number' && p.stock <= (p.lowAt ?? 5)).map((p) => ({ id: p.id, name: p.name, stock: p.stock as number, unit: p.unit ?? '' })).slice(0, 8),
    recent: entries.slice(0, 12),
  };
}
