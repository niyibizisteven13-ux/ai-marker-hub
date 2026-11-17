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
/** Instant alerts and the agent's schedule use the same machinery as the rest of the assistant: Telegram first, then email, then the chat. */
async function notifyOwner(ownerId: string, n: import('./service.js').BizNotice) {
  const [{ liveNotifyDeps, notifyUser }, { proposalStore }] = [await import('../agenda/notify.js').then(async (m) => ({ liveNotifyDeps: m.liveNotifyDeps, notifyUser: m.notifyUser })), await import('../agenda/proposals.js')];
  let buttons: Array<Array<{ text: string; callback_data: string }>> | undefined;
  if (n.plan) { const p = await proposalStore().create(ownerId, n.plan.title, n.plan.steps); buttons = [[{ text: `✅ ${n.plan.title.slice(0, 40)}`, callback_data: `pp:run:${p.id}` }, { text: '✖', callback_data: `pp:no:${p.id}` }]]; }
  await notifyUser(ownerId, { title: n.title, text: n.text, buttons }, await liveNotifyDeps());
}
async function syncAgenda(b: import('./model.js').Business) { const [{ agendaStore }, { syncBizAgenda }] = await Promise.all([import('../agenda/store.js'), import('./agent.js')]); await syncBizAgenda(agendaStore(), b); }
/** The business dashboard is a paid feature: a Starter plan or higher (administrators count as Institution). BIZ_REQUIRE_PAID=false opens it to everyone. */
export const PAID_PLANS = ['STARTER', 'PRO', 'PLUS', 'INSTITUTION'];
export async function bizAllowed(userId: string): Promise<boolean> {
  if (process.env.BIZ_REQUIRE_PAID === 'false') return true;
  const p = await planFor(userId).catch(() => null); return !!p && PAID_PLANS.includes(p.id);
}
export const bizService = (): BizService => (svc ??= createBizService({ allowed: bizAllowed, kv: appSettingKv, notify: notifyOwner, syncAgenda, media: diskMediaStore(), isPaid: async (userId) => { const p = await planFor(userId).catch(() => null); return !!p && p.id !== 'FREE'; } }));
export const setBizServiceForTests = (s: BizService | null) => { svc = s; };
