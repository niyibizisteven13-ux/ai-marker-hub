import { randomUUID } from 'node:crypto';
import { prisma } from '../../db.js';
import { DEFAULT_TZ, nextRun, type Schedule } from './schedule.js';

/**
 * Where scheduled tasks, plans waiting for a yes and unseen results are kept: appSetting rows (no database change), behind a tiny
 * key-value interface so everything above it can be tested with an in-memory copy.
 */
export interface KV {
  get(key: string): Promise<unknown | undefined>;
  put(key: string, value: unknown, by: string): Promise<void>;
  del(key: string): Promise<void>;
  list(prefix: string, take: number): Promise<Array<{ key: string; value: unknown }>>;
}

export function appSettingKV(): KV {
  const db = prisma as any;
  return {
    async get(key) { return (await db.appSetting.findUnique({ where: { key } }).catch(() => null))?.value; },
    async put(key, value, by) {
      const existing = await db.appSetting.findUnique({ where: { key } });
      if (existing) await db.appSetting.update({ where: { key }, data: { value, updatedBy: by, updatedAt: new Date() } });
      else await db.appSetting.create({ data: { key, value, updatedBy: by, updatedAt: new Date() } });
    },
    async del(key) { await db.appSetting.deleteMany({ where: { key } }); },
    async list(prefix, take) { return (await db.appSetting.findMany({ where: { key: { startsWith: prefix } }, orderBy: { updatedAt: 'desc' }, take })).map((r: any) => ({ key: String(r.key), value: r.value })); },
  };
}
export function memoryKV(): KV & { rows: Map<string, unknown> } {
  const rows = new Map<string, unknown>();
  return {
    rows,
    async get(k) { return rows.get(k); },
    async put(k, v) { rows.set(k, JSON.parse(JSON.stringify(v))); },
    async del(k) { rows.delete(k); },
    async list(prefix, take) { return [...rows].filter(([k]) => k.startsWith(prefix)).slice(0, take).map(([key, value]) => ({ key, value })); },
  };
}

/* ------------------------------------------------------------------ scheduled tasks */
export interface AgendaItem {
  id: string; userId: string; title: string;
  /** What to do, in the user's own words (read by the assistant when the time comes). */
  prompt: string;
  schedule: Schedule; tz: string;
  kind: 'task' | 'brief';
  /** The user said yes to marking by itself (it only marks; showing results to students always needs a yes). */
  allowMarking: boolean;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt?: string; lastStatus?: 'ok' | 'failed'; lastSummary?: string;
  runs: number; failures: number; createdAt: string;
}
export const MAX_ITEMS_PER_USER = 20;
const key = (userId: string, id: string) => `agenda:${userId}:${id}`;

export function agendaStore(kv: KV = appSettingKV()) {
  const asItem = (v: unknown): AgendaItem | null => (v && typeof v === 'object' && (v as AgendaItem).id && (v as AgendaItem).userId ? (v as AgendaItem) : null);
  return {
    async list(userId: string): Promise<AgendaItem[]> {
      return (await kv.list(`agenda:${userId}:`, 100)).map((r) => asItem(r.value)).filter((x): x is AgendaItem => !!x).sort((a, b) => (a.nextRunAt ?? '9').localeCompare(b.nextRunAt ?? '9'));
    },
    async get(userId: string, id: string) { return asItem(await kv.get(key(userId, id))); },
    async put(item: AgendaItem) { await kv.put(key(item.userId, item.id), item, item.userId); },
    async remove(userId: string, id: string) { await kv.del(key(userId, id)); },
    /** Every enabled task whose time has come (all users). */
    async due(now: Date, take = 5000): Promise<AgendaItem[]> {
      return (await kv.list('agenda:', take)).map((r) => asItem(r.value)).filter((x): x is AgendaItem => !!x && x.enabled && !!x.nextRunAt && Date.parse(x.nextRunAt) <= now.getTime());
    },
  };
}
export type AgendaStore = ReturnType<typeof agendaStore>;

export function newItem(input: { userId: string; title: string; prompt: string; schedule: Schedule; tz?: string; kind?: 'task' | 'brief'; allowMarking?: boolean }, now: Date = new Date()): AgendaItem {
  const tz = input.tz ?? DEFAULT_TZ;
  return {
    id: randomUUID(), userId: input.userId, title: input.title.slice(0, 80), prompt: input.prompt.slice(0, 2000), schedule: input.schedule, tz,
    kind: input.kind ?? 'task', allowMarking: !!input.allowMarking, enabled: true,
    nextRunAt: nextRun(input.schedule, now, tz)?.toISOString() ?? null, runs: 0, failures: 0, createdAt: now.toISOString(),
  };
}

/* ------------------------------------------------------------------ results nobody has read yet (no Telegram, no email) */
export interface OutboxEntry { at: string; title: string; text: string }
export function outbox(kv: KV = appSettingKV()) {
  const k = (userId: string) => `agenda-outbox:${userId}`;
  return {
    async add(userId: string, e: OutboxEntry) {
      const cur = ((await kv.get(k(userId))) as { items?: OutboxEntry[] } | undefined)?.items ?? [];
      await kv.put(k(userId), { items: [...cur, { ...e, text: e.text.slice(0, 3000) }].slice(-10) }, userId);
    },
    /** Takes what is waiting (and empties it), so each result is told once. */
    async take(userId: string): Promise<OutboxEntry[]> {
      const cur = ((await kv.get(k(userId))) as { items?: OutboxEntry[] } | undefined)?.items ?? [];
      if (cur.length) await kv.del(k(userId));
      return cur;
    },
  };
}

/* ------------------------------------------------------------------ notification choices */
export interface NotifyPrefs { liveAlerts: boolean; payments: boolean }
export const DEFAULT_PREFS: NotifyPrefs = { liveAlerts: true, payments: true };
export function notifyPrefs(kv: KV = appSettingKV()) {
  const k = (userId: string) => `notify:${userId}`;
  return {
    async get(userId: string): Promise<NotifyPrefs> {
      const v = (await kv.get(k(userId))) as Partial<NotifyPrefs> | undefined;
      return { liveAlerts: typeof v?.liveAlerts === 'boolean' ? v.liveAlerts : DEFAULT_PREFS.liveAlerts, payments: typeof v?.payments === 'boolean' ? v.payments : DEFAULT_PREFS.payments };
    },
    async set(userId: string, patch: Partial<NotifyPrefs>): Promise<NotifyPrefs> {
      const next = { ...(await this.get(userId)), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === 'boolean')) } as NotifyPrefs;
      await kv.put(k(userId), next, userId); return next;
    },
  };
}
