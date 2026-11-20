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
/** The dashboard is free (pictures only: videos, the business agent and online payments need a paid plan, Starter or higher; administrators count as Institution). BIZ_REQUIRE_PAID=true puts the whole dashboard behind a paid plan. */
export const PAID_PLANS = ['STARTER', 'PRO', 'PLUS', 'INSTITUTION'];
export async function bizAllowed(userId: string): Promise<boolean> {
  if (process.env.BIZ_REQUIRE_PAID !== 'true') return true;
  const p = await planFor(userId).catch(() => null); return !!p && PAID_PLANS.includes(p.id);
}
/** Videos are made to play smoothly in the background (videoPipeline.ts). Started once, with the service; picks up videos that were still being prepared when the server last stopped. */
let pipeline: import('./videoPipeline.js').VideoPipeline | null = null;
export const bizService = (): BizService => {
  if (svc) return svc;
  const store = diskMediaStore();
  const made = createBizService({
    allowed: bizAllowed, kv: appSettingKv, notify: notifyOwner, syncAgenda, media: store,
    isVerified: async (userId) => (await import('../billing/badge.js')).hasBadge(userId),
    isPaid: async (userId) => { const p = await planFor(userId).catch(() => null); return !!p && p.id !== 'FREE'; },
    ...(process.env.BIZ_VIDEO_PIPELINE === '0' ? {} : { onVideo: (job: { biz: string; id: string; ext: string }) => { void startPipeline(store, () => made).then((p) => p.enqueue(job)); } }),
  });
  svc = made;
  if (process.env.NODE_ENV !== 'test' && process.env.BIZ_VIDEO_PIPELINE !== '0') setTimeout(() => { void startPipeline(store, () => made).then(async (p) => { for (const j of await made.pendingVideos().catch(() => [])) p.enqueue(j); }).catch(() => undefined); }, 20_000).unref?.();
  return made;
};
async function startPipeline(store: import('./media.js').MediaStore, get: () => BizService) {
  if (pipeline) return pipeline;
  const [{ createVideoPipeline }, { default: logger }] = await Promise.all([import('./videoPipeline.js'), import('../../utils/logger.js')]);
  return (pipeline = createVideoPipeline({ store, onDone: (biz, id, patch) => get().setVideoInfo(biz, id, patch), log: (m, x) => logger.info(`[biz-video] ${m}`, x) }));
}
export const setBizServiceForTests = (s: BizService | null) => { svc = s; };
