import { prisma } from '../../db.js';
import { planFor } from '../billing/plans.js';
import { diskMediaStore } from './media.js';
import { createBizService, type BizService, type Kv } from './service.js';

/** The real storage: the AppSetting table (no migration) and the server's disk. */
const db = prisma as any;
export const appSettingKv: Kv = {
  async get<T>(key: string) { const r = await db.appSetting.findUnique({ where: { key } }).catch(() => null); return r?.value && typeof r.value === 'object' ? (r.value as T) : null; },
  async put(key: string, value: unknown) {
    const at = new Date(); const ex = await db.appSetting.findUnique({ where: { key } }).catch(() => null);
    if (ex) await db.appSetting.update({ where: { key }, data: { value, updatedBy: 'biz', updatedAt: at } }); else await db.appSetting.create({ data: { key, value, updatedBy: 'biz', updatedAt: at } });
  },
  async del(key: string) { await db.appSetting.delete({ where: { key } }).catch(() => undefined); },
};
let svc: BizService | null = null;
export const bizService = (): BizService => (svc ??= createBizService({ kv: appSettingKv, media: diskMediaStore(), isPaid: async (userId) => { const p = await planFor(userId).catch(() => null); return !!p && p.id !== 'FREE'; } }));
export const setBizServiceForTests = (s: BizService | null) => { svc = s; };
