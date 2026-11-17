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

/** A button on a live-room message: the tap is the lecturer's decision. Only the person the button was made for can use it. */
export async function roomButton(api: TelegramApi, chatId: string, session: any, token: string, target?: { id: number }): Promise<string> {
  const { takeToken } = await import('../agenda/roomTokens.js');
  const got = await takeToken(token, session?.userId);
  if (got.ok === false) return got.why === 'not_yours' ? 'This button is not yours.' : got.why === 'expired' ? 'This button has expired: open the live room.' : 'This button was already used.';
  const { runRoomToken } = await import('../mySebButtons.js');
  const r = await runRoomToken(got.token);
  if (target) await api.call('editMessageReplyMarkup', { chat_id: chatId, message_id: target.id, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
  await api.sendMessage(chatId, card(r.ok ? '✅' : '⚠️', 'Live room', esc(r.text)));
  return r.ok ? 'Done' : 'Not done';
}

/** /room: the live rooms the assistant is watching for this person, with the controls. */
export async function showRooms(api: TelegramApi, chatId: string, session: any): Promise<void> {
  const userId: string | undefined = session?.userId;
  if (!userId) { await api.sendMessage(chatId, card('🎛', 'Live rooms', esc('Link your Bwenge account first (Settings).'))); return; }
  const [{ makeToken }, my] = await Promise.all([import('../agenda/roomTokens.js'), import('../mySeb.js')]);
  const db = prisma as any;
  const rows = (await db.appSetting.findMany({ where: { key: { startsWith: 'myseb-agent:' } }, orderBy: { updatedAt: 'desc' }, take: 200 })).map((r: any) => r.value)
    .filter((v: any) => v?.ownerId === userId && v?.rules?.on).slice(0, 4);
  if (!rows.length) { await api.sendMessage(chatId, card('🎛', 'Live rooms', esc('No room is being watched right now. Switch the room assistant on in a live room, or ask me to start a test.'))); return; }
  for (const v of rows) {
    const load = v.kind === 'form' ? my.formTarget(userId, v.ref) : my.assignmentTarget(userId, v.ref);
    const m: any = await my.monitor(load, { frames: false }).catch(() => null);
    const c = m?.counts ?? {};
    const common = { userId, kind: v.kind, ref: v.ref } as const;
    const text = `${esc(m?.exam?.title ?? 'Live room')}\n${esc(`In the test ${c.IN_EXAM ?? 0} · paused ${c.PAUSED ?? 0} · lost connection ${c.LEFT ?? 0} · finished ${c.ENDED ?? 0}`)}\nAssistant: ${esc(v.rules.level === 'run' ? 'autopilot' : v.rules.level === 'watch' ? 'watching only' : 'assisting')}${v.rules.dryRun ? ' (practice mode)' : ''}`;
    await api.sendMessage(chatId, card('🎛', 'Live room', text), { keyboard: { inline_keyboard: [[
      { text: '⏸ Pause all', callback_data: `ra:${await makeToken({ ...common, action: 'pause' })}` },
      { text: '▶ All back in', callback_data: `ra:${await makeToken({ ...common, action: 'resume_all' })}` },
    ], [
      { text: '+5 min', callback_data: `ra:${await makeToken({ ...common, action: 'add', minutes: 5 })}` },
      { text: '+10 min', callback_data: `ra:${await makeToken({ ...common, action: 'add', minutes: 10 })}` },
    ]] } as any });
  }
}
