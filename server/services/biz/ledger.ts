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
/** Suggested expense categories; an owner may use their own word (up to 24 letters), for example "server" or "investment". */
export const EXPENSE_CATEGORIES = ['stock', 'rent', 'transport', 'salaries', 'utilities', 'marketing', 'software', 'investment', 'other'] as const;
export const cleanCategory = (v: unknown): string => { const c = String(v ?? '').toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24); return c || 'other'; };

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
  if (type === 'expense') e.category = cleanCategory(input?.category);
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

/* ------------------------------------------------------------------ costs and spending: months, budgets, recurring costs */
export const monthOf = (t: number | string) => dayOf(t).slice(0, 7);
export interface Recurring { id: string; name: string; amount: number; category: string; every: 'week' | 'month'; /** Day of the month (1-28) or of the week (0 = Sunday ... 6). */ on: number; lastDay?: string; paused?: boolean; createdAt: string }
export interface Budgets { monthly: Record<string, number> }
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The days a recurring cost has come due since it last ran (at most 12), oldest first. A new one first falls due on its next matching day. Pure. */
export function dueDays(r: Recurring, nowMs: number): string[] {
  if (r.paused) return []; const today = dayOf(nowMs); const start = r.lastDay ? addDays(r.lastDay, 1) : dayOf(Date.parse(r.createdAt));
  const out: string[] = []; for (let d = start; d <= today && out.length < 12; d = addDays(d, 1)) { const dt = new Date(`${d}T12:00:00Z`); if (r.every === 'month' ? dt.getUTCDate() === r.on : dt.getUTCDay() === r.on) out.push(d); }
  return out;
}

export function cleanRecurring(input: any, id: string, nowMs: number): Recurring | { error: string } {
  const name = String(input?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60); if (!name) return { error: 'Give the recurring cost a name, for example "Server".' };
  const n = Number(String(input?.amount ?? '').replace(/[,\s]/g, '')); if (!Number.isFinite(n) || n <= 0 || n > 1_000_000_000) return { error: 'The amount must be a number of RWF above zero.' };
  const every = input?.every === 'week' ? 'week' : 'month'; const on = Math.round(Number(input?.on));
  if (every === 'month' && !(on >= 1 && on <= 28)) return { error: 'Choose a day of the month from 1 to 28.' }; if (every === 'week' && !(on >= 0 && on <= 6)) return { error: 'Choose a day of the week (0 = Sunday … 6 = Saturday).' };
  return { id, name, amount: Math.round(n), category: cleanCategory(input?.category), every, on, createdAt: new Date(nowMs).toISOString() };
}

/** Everything the "Costs and spending" screen shows. Pure. */
export function summarizeCosts(entries: LedgerEntry[], nowMs: number, budgets: Budgets = { monthly: {} }, recurring: Recurring[] = []) {
  const exp = entries.filter((e) => e.type === 'expense'); const cur = monthOf(nowMs); const prev = monthOf(Date.parse(`${cur}-01T12:00:00Z`) - 5 * 86_400_000);
  const by = (m: string) => { const rows = new Map<string, number>(); let total = 0; for (const e of exp) if (monthOf(e.at) === m) { total += e.amount; const k = e.category ?? 'other'; rows.set(k, (rows.get(k) ?? 0) + e.amount); } return { total, byCategory: [...rows.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount) }; };
  const month = by(cur), last = by(prev);
  const trend = Array.from({ length: 6 }, (_, i) => { const d = new Date(`${cur}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - (5 - i)); const m = d.toISOString().slice(0, 7); return { month: m, total: by(m).total }; });
  const budgetRows = Object.entries(budgets.monthly).map(([category, limit]) => { const spent = month.byCategory.find((c) => c.category === category)?.amount ?? 0; return { category, limit, spent, pct: limit > 0 ? Math.round((spent / limit) * 100) : 0 }; }).sort((a, b) => b.pct - a.pct);
  const top = exp.filter((e) => monthOf(e.at) === cur).sort((a, b) => b.amount - a.amount).slice(0, 5);
  const sales = entries.filter((e) => e.type === 'sale' && e.status === 'completed' && monthOf(e.at) === cur).reduce((a, e) => a + e.amount, 0);
  const monthlyCommitted = recurring.filter((r) => !r.paused).reduce((a, r) => a + (r.every === 'month' ? r.amount : r.amount * 4), 0);
  return { month: { key: cur, ...month, sales, profit: sales - month.total }, lastMonth: { key: prev, ...last }, change: last.total > 0 ? Math.round(((month.total - last.total) / last.total) * 1000) / 10 : null, trend, budgets: budgetRows, top, recurring, monthlyCommitted };
}
