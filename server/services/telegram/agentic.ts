import { prisma } from '../../db.js';
import type { TelegramApi } from './api.js';
import { card } from './ui.js';
import { esc } from './format.js';

/**
 * The agentic parts in Telegram: Do it / Cancel / Undo on plans, Approve / Reject on MySEB payment requests (administrator only),
 * and /agenda. A button tap is the user's yes, so a plan runs straight from it. Every call is scoped to the linked account.
 */
export const BRIEF_COMMAND_TEXT = 'Write my morning brief: what needs me today across my live rooms, tasks, classes and exams, and what you suggest.';

async function exec() { const { bwengeAgent } = await import('../AiService.js'); return bwengeAgent.services.agenda!.exec; }

export async function planCallback(api: TelegramApi, chatId: string, session: any, action: string, id: string, target?: { id: number }): Promise<string> {
  const userId: string | undefined = session?.userId;
  if (!userId) return 'Link your Bwenge account first.';
  const { proposalStore, runProposal, undoProposal, cancelProposal } = await import('../agenda/proposals.js');
  const store = proposalStore(); const run = await exec();
  const audit = async (a: string, d: unknown) => { const { auditAction } = await import('../platform/audit.js'); await auditAction(userId, `CHAT_${a}`, 'agenda', null, d).catch(() => undefined); };
  const r = action === 'run' ? await runProposal(store, userId, id, (t, i) => run(userId, t, i), { audit })
    : action === 'undo' ? await undoProposal(store, userId, id, (t, i) => run(userId, t, i), { audit })
    : await cancelProposal(store, userId, id);
  const p = await store.get(userId, id);
  const canUndo = action === 'run' && r.ok && p?.steps.some((s, i) => s.undo && p.results?.[i]?.ok);
  if (target) await api.call('editMessageReplyMarkup', { chat_id: chatId, message_id: target.id, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
  await api.sendMessage(chatId, card(r.ok ? '✅' : '⚠️', p?.title ?? 'Plan', esc(r.text)), canUndo ? { keyboard: { inline_keyboard: [[{ text: '↩️ Undo', callback_data: `pp:undo:${id}` }]] } as any } : {});
  return r.ok ? 'Done' : 'Not done';
}

export async function paymentCallback(api: TelegramApi, chatId: string, session: any, action: string, id: string, target?: { id: number }): Promise<string> {
  const userId: string | undefined = session?.userId;
  const admin = userId ? (await prisma.user.findUnique({ where: { id: userId }, select: { role: true } }).catch(() => null))?.role === 'ADMIN' : false;
  if (!admin) return 'Only the administrator can do this.';
  const { decideRequest } = await import('../mySebAccess.js');
  const approve = action === 'ok';
  const r = await decideRequest(id, approve, userId!);
  if (target) await api.call('editMessageReplyMarkup', { chat_id: chatId, message_id: target.id, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
  const { auditAction } = await import('../platform/audit.js'); await auditAction(userId!, approve ? 'CHAT_MYSEB_APPROVE' : 'CHAT_MYSEB_REJECT', 'myseb_request', id, { via: 'telegram' }).catch(() => undefined);
  await api.sendMessage(chatId, card(r ? (approve ? '✅' : '✖️') : '⚠️', 'MySEB payment', esc(r ? `${approve ? 'Approved' : 'Rejected'}: ${r.name} <${r.email}>` : 'That request was not found or was already decided.')));
  return r ? (approve ? 'Approved' : 'Rejected') : 'Already decided';
}

/** /agenda: what is scheduled, and the plans waiting for a yes (with their buttons). */
export async function showAgenda(api: TelegramApi, chatId: string, session: any): Promise<void> {
  const userId: string | undefined = session?.userId;
  if (!userId) { await api.sendMessage(chatId, card('📅', 'Agenda', esc('Link your Bwenge account first (Settings), then I can work for you while you are away.'))); return; }
  const [{ agendaStore }, { proposalStore, planText }, { describeSchedule }] = await Promise.all([import('../agenda/store.js'), import('../agenda/proposals.js'), import('../agenda/schedule.js')]);
  const [items, plans] = await Promise.all([agendaStore().list(userId), proposalStore().pending(userId)]);
  const lines = items.length ? items.map((t) => `• <b>${esc(t.title)}</b> — ${esc(describeSchedule(t.schedule, t.tz))}${t.enabled ? '' : ' (off)'}`).join('\n') : esc('Nothing is scheduled. Tell me, for example: "every morning at 7 send me what needs me".');
  await api.sendMessage(chatId, card('📅', 'Agenda', lines));
  for (const p of plans.slice(0, 5)) await api.sendMessage(chatId, card('📝', 'Waiting for your yes', esc(planText(p))), { keyboard: { inline_keyboard: [[{ text: '✅ Do it', callback_data: `pp:run:${p.id}` }, { text: '✖ Cancel', callback_data: `pp:no:${p.id}` }]] } as any });
}

/** Tells every administrator (who has payment alerts on) that someone says they paid, with the buttons to decide. */
export async function notifyAdminsOfPayment(req: { id: string; name: string; email: string; plan: string; note: string }): Promise<number> {
  const [{ notifyUser, liveNotifyDeps }, { notifyPrefs }] = await Promise.all([import('../agenda/notify.js').then((m) => ({ notifyUser: m.notifyUser, liveNotifyDeps: m.liveNotifyDeps })), import('../agenda/store.js')]);
  const deps = await liveNotifyDeps();
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true }, take: 10 }).catch(() => []);
  let n = 0;
  for (const a of admins) {
    if (!(await notifyPrefs().get(a.id)).payments) continue;
    await notifyUser(a.id, { title: 'MySEB payment', text: `${req.name} <${req.email}> says they paid for ${req.plan === 'MONTH' ? 'a month' : 'one test'}.${req.note ? `\n"${req.note}"` : ''}\nCheck MoMo, then decide.`, buttons: [[{ text: '✅ Approve', callback_data: `ap:ok:${req.id}` }, { text: '✖ Reject', callback_data: `ap:no:${req.id}` }]] }, deps); n++;
  }
  return n;
}
