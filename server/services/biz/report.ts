import { cap, type Words } from './programWords.js';
import type { LedgerEntry } from './ledger.js';

/**
 * The closing report for one day: what came in and went out, what sold, who was served under the programs, who has not come, what is waiting for the owner.
 * Everything is counted from the owner's own records (no AI guesses), so the same numbers show in the dashboard, in a WhatsApp message and in the assistant's digest.
 * `buildDayReport` and `reportText` are pure: the service reads the data, these only add it up and write it down.
 */
export interface ProgramDay {
  /** Uses ticked that day, by item. */
  byItem: Array<{ item: string; count: number }>; served: number; people: number; bySelf: number;
  /** Only for today: members with a plan open today who have not used all of today's items. */
  notYet: Array<{ name: string }> | null; expected: number | null;
  newMembers: number; collectedRwf: number;
  waiting: Array<{ name: string; programTitle: string }>; expiring: Array<{ name: string; endDate: string }>;
  plans: number; activeMembers: number;
}
export interface DayReport {
  date: string; name: string;
  money: { sales: number; expenses: number; profit: number; orders: number; pending: number; cancelled: number; yesterdaySales: number; salesChangePct: number | null };
  top: Array<{ name: string; amount: number; qty: number }>;
  programs: ProgramDay | null;
  lowStock: Array<{ name: string; stock: number; unit: string }>; newMessages: number;
  /** Plain sentences for the things the owner should look at first. */
  attention: string[];
}

const KIGALI = 2 * 3600_000;
export const dayOf = (t: number | string) => new Date((typeof t === 'string' ? Date.parse(t) : t) + KIGALI).toISOString().slice(0, 10);
const sum = (xs: LedgerEntry[]) => xs.reduce((a, e) => a + e.amount, 0);

export function buildDayReport(o: {
  date: string; name: string; entries: LedgerEntry[]; lowStock: DayReport['lowStock']; newMessages: number; programs: ProgramDay | null;
}): DayReport {
  const { date } = o; const prev = dayOf(Date.parse(`${date}T12:00:00Z`) - 86_400_000);
  const on = (d: string) => o.entries.filter((e) => dayOf(e.at) === d);
  const sold = (d: string) => on(d).filter((e) => e.type === 'sale' && e.status === 'completed'); const spent = (d: string) => on(d).filter((e) => e.type === 'expense');
  const sales = sum(sold(date)); const expenses = sum(spent(date)); const yesterdaySales = sum(sold(prev));
  const allSales = on(date).filter((e) => e.type === 'sale');
  const byItem = new Map<string, { name: string; amount: number; qty: number }>();
  for (const e of sold(date)) { const key = (e.item ?? 'Other sales').toLowerCase(); const r = byItem.get(key) ?? { name: e.item ?? 'Other sales', amount: 0, qty: 0 }; r.amount += e.amount; r.qty += e.qty ?? 1; byItem.set(key, r); }
  const r: DayReport = {
    date, name: o.name,
    money: { sales, expenses, profit: sales - expenses, orders: sold(date).length, pending: allSales.filter((e) => e.status === 'pending').length, cancelled: allSales.filter((e) => e.status === 'cancelled').length, yesterdaySales, salesChangePct: yesterdaySales > 0 ? Math.round(((sales - yesterdaySales) / yesterdaySales) * 100) : null },
    top: [...byItem.values()].sort((a, b) => b.amount - a.amount).slice(0, 3), programs: o.programs, lowStock: o.lowStock.slice(0, 5), newMessages: o.newMessages, attention: [],
  };
  r.attention = attentionOf(r, 'en');
  return r;
}

/* ---------------------------------------------------------------- the text (English or Kinyarwanda) */
type Lang = 'en' | 'rw';
/** The things to look at first, as plain sentences. */
export function attentionOf(r: DayReport, lang: Lang): string[] {
  const p = r.programs; const a: string[] = []; const en = lang === 'en'; const pl = (n: number, one: string, many: string) => (n === 1 ? one : many);
  if (r.money.pending) a.push(en ? `${r.money.pending} ${pl(r.money.pending, 'order', 'orders')} still pending` : `Ibyatumijwe ${r.money.pending} bigitegereje`);
  if (p?.waiting.length) a.push(en ? `${p.waiting.length} ${pl(p.waiting.length, 'payment', 'payments')} to confirm` : `Kwemeza ubwishyu ${p.waiting.length}`);
  if (p?.notYet?.length) a.push(en ? `${p.notYet.length} with a plan today did not come` : `${p.notYet.length} bafite ikarita uyu munsi ntibaje`);
  if (p?.expiring.length) a.push(en ? `${p.expiring.length} ${pl(p.expiring.length, 'plan', 'plans')} ending within 3 days` : `Amakarita ${p.expiring.length} arangira mu minsi 3`);
  if (r.lowStock.length) a.push(`${en ? 'Low stock' : 'Ibisigaye ni bike'}: ${r.lowStock.map((x) => x.name).join(', ')}`);
  if (r.newMessages) a.push(en ? `${r.newMessages} new ${pl(r.newMessages, 'message', 'messages')}` : `Ubutumwa bushya ${r.newMessages}`);
  if (r.money.expenses > 0 && r.money.sales === 0) a.push(en ? 'Expenses today but no sales recorded' : 'Hari amafaranga yasohotse ariko nta yinjiye yanditswe');
  return a;
}
const L = {
  en: { title: 'closing report', money: 'Money', sales: 'Sales', expenses: 'Expenses', profit: 'Profit', orders: 'Orders', pending: 'pending', vs: 'vs yesterday', best: 'Best sellers', served: 'Served today', people: 'people', self: 'ticked by the customer', notYet: 'Have a plan today but did not come', collected: 'Collected for plans', newMembers: 'New', waiting: 'Waiting for your confirmation', expiring: 'Ending within 3 days', look: 'Look at', quiet: 'Nothing recorded for this day yet.', active: 'active', none: 'nobody' },
  rw: { title: 'raporo y’umunsi', money: 'Amafaranga', sales: 'Yinjiye', expenses: 'Yasohotse', profit: 'Inyungu', orders: 'Ibyatumijwe', pending: 'bitegereje', vs: 'ugereranyije n’ejo', best: 'Ibyagurishijwe cyane', served: 'Bakiriwe uyu munsi', people: 'abantu', self: 'byashyizweho n’umukiliya', notYet: 'Bafite ikarita uyu munsi ariko ntibaje', collected: 'Yakusanyijwe ku makarita', newMembers: 'Bashya', waiting: 'Bategereje ko wemeza', expiring: 'Birangira mu minsi 3', look: 'Reba', quiet: 'Nta kintu cyanditswe kuri uyu munsi.', active: 'bafite', none: 'ntawe' },
} as const;
const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
const DOW = { en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], rw: ['Ku cyumweru', 'Kuwa mbere', 'Kuwa kabiri', 'Kuwa gatatu', 'Kuwa kane', 'Kuwa gatanu', 'Kuwa gatandatu'] } as const;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const longDate = (d: string, lang: Lang = 'en') => { const x = new Date(`${d}T12:00:00Z`); return `${DOW[lang][x.getUTCDay()]} ${x.getUTCDate()} ${MON[x.getUTCMonth()]} ${x.getUTCFullYear()}`; };
const shortDay = (d: string) => { const x = new Date(`${d}T12:00:00Z`); return `${x.getUTCDate()} ${MON[x.getUTCMonth()]}`; };
const list = (names: string[], max = 4) => (names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} +${names.length - max}`);

/** A short, WhatsApp-friendly text (stars make bold there). `w` are the owner's own words for the programs, so a restaurant reads "meals" and a gym "visits". */
export function reportText(r: DayReport, w: Words, lang: Lang = 'en'): string {
  const t = L[lang]; const out: string[] = [`*${r.name}: ${t.title}*`, longDate(r.date, lang), ''];
  const m = r.money; const hasMoney = m.sales || m.expenses || m.orders || m.pending;
  const hasPrograms = !!r.programs && (r.programs.plans > 0);
  if (!hasMoney && !(hasPrograms && (r.programs!.served || r.programs!.newMembers || r.programs!.collectedRwf))) out.push(t.quiet);
  if (hasMoney) {
    out.push(`*${t.money}*`, `${t.sales} ${rwf(m.sales)}${m.salesChangePct === null ? '' : ` (${m.salesChangePct >= 0 ? '+' : ''}${m.salesChangePct}% ${t.vs})`}`, `${t.expenses} ${rwf(m.expenses)} · ${t.profit} ${rwf(m.profit)}`,
      `${t.orders} ${m.orders}${m.pending ? ` (${m.pending} ${t.pending})` : ''}`);
    if (r.top.length) out.push(`${t.best}: ${r.top.map((x) => `${x.name} ${rwf(x.amount)}${x.qty > 1 ? ` (${x.qty})` : ''}`).join(' · ')}`);
    out.push('');
  }
  if (hasPrograms) {
    const p = r.programs!; out.push(`*${cap(w.programs)}*`);
    if (p.served || p.expected !== null) {
      out.push(`${t.served}: ${p.served} ${w.uses}${p.people ? ` · ${p.people} ${t.people}` : ''}${p.byItem.length > 1 ? ` (${p.byItem.map((x) => `${x.item} ${x.count}`).join(' · ')})` : ''}${p.bySelf ? ` · ${p.bySelf} ${t.self}` : ''}`);
    }
    if (p.notYet) out.push(`${t.notYet}: ${p.notYet.length ? `${p.notYet.length} (${list(p.notYet.map((x) => x.name))})` : t.none}`);
    if (p.newMembers || p.collectedRwf) out.push(`${t.newMembers} ${w.members}: ${p.newMembers} · ${t.collected}: ${rwf(p.collectedRwf)}`);
    if (p.waiting.length) out.push(`${t.waiting}: ${p.waiting.length} (${list(p.waiting.map((x) => x.name))})`);
    if (p.expiring.length) out.push(`${t.expiring}: ${p.expiring.length} (${list(p.expiring.map((x) => `${x.name} ${shortDay(x.endDate)}`))})`);
    out.push(`${p.activeMembers} ${w.members} ${t.active}`, '');
  }
  const att = attentionOf(r, lang); if (att.length) out.push(`*${t.look}*`, ...att.map((x) => `• ${x}`));
  while (out[out.length - 1] === '') out.pop();
  return out.join('\n');
}
