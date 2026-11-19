export type { Lang, Translation, PublicSection, Post, PublicPost, Business, PublicBusiness, PublicMedia, Product, Media, Enquiry, DayStats, Hours, Day, Theme, Category } from '../../server/services/biz/model';
export const CATEGORIES: Array<{ id: string; label: string }> = [
  { id: 'shop', label: 'Shop' }, { id: 'restaurant', label: 'Restaurant or café' }, { id: 'salon', label: 'Salon or barber' }, { id: 'farm', label: 'Farm' },
  { id: 'services', label: 'Services' }, { id: 'school', label: 'School or training' }, { id: 'health', label: 'Health' }, { id: 'transport', label: 'Transport' }, { id: 'craft', label: 'Crafts' }, { id: 'other', label: 'Other' },
];
export const DAYS: Array<{ id: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'; label: string }> = [
  { id: 'mon', label: 'Monday' }, { id: 'tue', label: 'Tuesday' }, { id: 'wed', label: 'Wednesday' }, { id: 'thu', label: 'Thursday' }, { id: 'fri', label: 'Friday' }, { id: 'sat', label: 'Saturday' }, { id: 'sun', label: 'Sunday' },
];
/** The colour a business chooses for its page. `on` is the text colour that stays readable on it. */
export const THEMES: Record<string, { label: string; accent: string; on: string }> = {
  gold: { label: 'Gold', accent: '#E9A23B', on: '#1A1405' }, teal: { label: 'Teal', accent: '#0F9D8F', on: '#FFFFFF' }, green: { label: 'Green', accent: '#1E9E5A', on: '#FFFFFF' },
  blue: { label: 'Blue', accent: '#2F6FED', on: '#FFFFFF' }, rose: { label: 'Rose', accent: '#DB4F8E', on: '#FFFFFF' }, violet: { label: 'Violet', accent: '#7C5CF0', on: '#FFFFFF' }, ink: { label: 'Ink', accent: '#0E1722', on: '#FFFFFF' },
};
export const rwf = (n: number | null | undefined) => (n === null || n === undefined ? 'Ask for price' : `${n.toLocaleString('en-US')} RWF`);
export const pageUrl = (slug: string, origin = typeof window !== 'undefined' ? window.location.origin : 'https://www.bwenge.space') => `${origin}/b/${slug}`;

export interface LedgerEntry {
  id: string; type: 'sale' | 'expense'; amount: number; at: string; status: 'completed' | 'pending' | 'cancelled'; src: 'studio' | 'chat' | 'scan' | 'page';
  item?: string; qty?: number; productId?: string; customer?: string; method?: 'cash' | 'momo' | 'card' | 'credit'; note?: string; category?: string; pay?: { provider: 'mtn' | 'airtel'; phone: string; state: 'pending' | 'success' | 'failed' };
}
export interface Dashboard {
  today: { sales: number; expenses: number; orders: number; profit: number }; yesterday: { sales: number; expenses: number; orders: number; profit: number };
  change: { sales: number | null; orders: number | null; profit: number | null }; range: { days: number; sales: number; expenses: number; profit: number };
  series: Array<{ day: string; sales: number; expenses: number }>; top: Array<{ name: string; amount: number; qty: number }>;
  orders: { completed: number; pending: number; cancelled: number }; customers: number; lowStock: Array<{ id: string; name: string; stock: number; unit: string }>;
  recent: LedgerEntry[]; newMessages: number; entries: number;
}

export interface SecretsStatus {
  mtn: { set: boolean; hint?: string; environment?: string; at?: string }; airtel: { set: boolean; hint?: string; environment?: string; at?: string };
  acceptPay: boolean; payOpen: boolean; fields: Record<'mtn' | 'airtel', Array<{ id: string; label: string; secret: boolean; help: string }>>;
}

export interface AgentSettings { level: 'off' | 'watch' | 'assist' | 'run'; alerts: boolean; morning: boolean; evening: boolean; weekly: boolean }

export interface Recurring { id: string; name: string; amount: number; category: string; every: 'week' | 'month'; on: number; paused?: boolean }
export interface Costs {
  month: { key: string; total: number; byCategory: Array<{ category: string; amount: number }>; sales: number; profit: number }; lastMonth: { key: string; total: number };
  change: number | null; trend: Array<{ month: string; total: number }>; budgets: Array<{ category: string; limit: number; spent: number; pct: number }>;
  top: LedgerEntry[]; recurring: Recurring[]; monthlyCommitted: number;
}

export interface FieldInfo { key: string; label: string; type: 'text' | 'number' | 'date' | 'choice'; options?: string[]; required?: boolean }
export interface TrackerInfo { id: string; name: string; description: string; fields: FieldInfo[]; statuses: string[]; records?: number; open?: number }
export interface TrackerRecordInfo { id: string; at: string; values: Record<string, string | number>; status: string; src: 'studio' | 'chat' | 'page' }
export interface SectionInfo { id: string; type: 'text' | 'faq' | 'list' | 'links' | 'form'; title: string; body?: string; items?: Array<{ title: string; text?: string; price?: string; url?: string }>; trackerId?: string; button?: string; hidden?: boolean }

/* ---- Programs (a plan sold once and used with a pass): see server/services/biz/programs.ts */
export type DayId = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export interface ItemWindow { item: string; from: string; to: string }
export interface ProgramInfo {
  id: string; title: string; description?: string; priceRwf: number; days: number; items: string[]; openDays: DayId[]; windows?: ItemWindow[]; terms?: string; maxMembers?: number; totalUses?: number; joinCode?: string; checkIn?: 'staff' | 'self'; active: boolean;
  counts?: { active: number; pending: number; total: number };
}
export type PlanState = 'pending' | 'not_started' | 'active' | 'expired' | 'paused' | 'cancelled';
export interface MemberInfo {
  id: string; programId: string; programTitle: string; name: string; phone: string; idNumber?: string; code: string; state: PlanState; startDate: string; endDate: string;
  paid: boolean; paidRwf: number; payMethod?: 'momo_prompt' | 'momo_manual' | 'cash'; claimed?: { at: string; ref?: string }; note?: string;
  servingDaysLeft: number; usesLeft: number; totalUses?: number; usedTotal?: number; usedToday: string[]; createdAt: string;
}
export interface ProgramSummary {
  plans: number; members: number; active: number; pending: number; expired: number; soldThisMonth: number; waitingConfirmation: number;
  expiring: Array<{ memberId: string; name: string; phone: string; endDate: string; program: string }>;
}
export interface RedeemResult { ok: boolean; code?: string; message?: string; item?: string; useId?: string; member?: MemberInfo }
export interface TodayInfo {
  date: string; open: boolean; servedCount: number; expected: number;
  served: Array<{ useId: string; memberId: string; name: string; code: string; item: string; at: string; by?: 'scan' | 'code' | 'self'; canUndo: boolean }>;
  notYet: Array<{ memberId: string; name: string; phone: string; code: string }>;
}
export interface CardDay { date: string; dow: DayId; open: boolean; used: string[] }
/** One card, as the signed-in customer sees it: who it is for, the dates and what was used each day (the grid), and the QR code once it is paid. */
export interface CardInfo {
  cardId: string;
  business: { name: string; slug: string; theme: string };
  program: { title: string; checkIn?: 'staff' | 'self'; totalUses?: number; items: string[]; openDays: DayId[]; windows?: ItemWindow[]; terms?: string; priceRwf: number; days: number };
  member: { name: string; phone: string; idNumber?: string; code: string; state: PlanState; startDate: string; endDate: string; daysLeft: number; servingDaysLeft: number; usesLeft: number; usedTotal: number; paid: boolean; paidAt: string | null };
  qr: string | null;
  /** Only when the owner set self check-in: what the customer can tap now, and the tick they can still take back. */
  tick: null | { needsCode: true; items: Array<{ item: string; allowed: boolean; reason?: string; message?: string }>; undo: { useId: string; item: string } | null };
  today: { date: string; openToday: boolean; used: Array<{ item: string; at: string }> };
  calendar: CardDay[];
  payment: null | { amount: number; momoCode: string | null; momoName: string | null; online: boolean; promptSent: boolean; claimed: { at: string; ref?: string } | null; whatsapp: string | null };
}
export interface MeInfo { name: string; phone: string; username?: string; cards: Array<{ id: string; programTitle: string; state: PlanState; startDate: string; endDate: string; usesLeft: number; paid: boolean }> }
