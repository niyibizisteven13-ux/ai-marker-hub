import type { Tool, ToolServices } from '../types.js';
import { err } from './helpers.js';

/**
 * The platform owner in the chat: MySEB payment requests (see them, approve or reject), and a short overview of the platform.
 * Only for administrators, checked on every call; for anyone else the tools say they are not available. Approving needs the
 * administrator's explicit yes in the conversation (or the Approve button in Telegram).
 */
export function adminTools(services: ToolServices): Tool[] {
  const a = services.admin;
  if (!a) return [];
  const guard = async (userId: string) => ((await a.isAdmin(userId).catch(() => false)) ? null : err('This is only available to the platform administrator.'));
  const pending: Tool = {
    definition: { name: 'admin_pending_payments', description: 'Administrator only: MySEB payment requests waiting for approval ("I have paid"), with who, the plan and their note. Use for "who is waiting for access?", "any payments?".', parameters: { type: 'object', properties: {} } },
    async execute(_i, ctx) {
      const no = await guard(ctx.userId); if (no) return no;
      const rows = await a.pendingPayments();
      return { text: rows.length ? rows.map((r) => `- [${r.id}] ${r.name} <${r.email}> wants ${r.plan === 'MONTH' ? 'a month' : 'one test'} (${r.createdAt.slice(0, 16)})${r.note ? `: "${r.note}"` : ''}`).join('\n') + '\nThe money must be seen on MoMo before approving.' : 'No payment requests are waiting.' };
    },
  };
  const decide: Tool = {
    definition: { name: 'admin_decide_payment', description: 'Administrator only: approve (gives the lecturer MySEB access for the plan they asked for) or reject a payment request. Only after the administrator has said they saw the money (approve) or said to reject, in this conversation.', parameters: { type: 'object', required: ['id', 'approve'], properties: { id: { type: 'string' }, approve: { type: 'boolean' }, months: { type: 'number', description: 'Months to give (monthly plan), default 1.' }, tests: { type: 'number', description: 'Tests to give (one-test plan), default 1.' } } } },
    async execute(input, ctx) {
      const no = await guard(ctx.userId); if (no) return no;
      const i = input as { id: string; approve: boolean; months?: number; tests?: number };
      const r = await a.decidePayment(String(i.id), !!i.approve, ctx.userId, { months: i.months, tests: i.tests });
      await services.audit?.(ctx.userId, i.approve ? 'CHAT_MYSEB_APPROVE' : 'CHAT_MYSEB_REJECT', 'myseb_request', String(i.id), {}).catch(() => undefined);
      return r.ok ? { text: r.text } : err(r.text);
    },
  };
  const overview: Tool = {
    definition: { name: 'admin_overview', description: 'Administrator only: the platform at a glance: users, new users this week, payment requests waiting, MySEB exams and students live now, paying lecturers.', parameters: { type: 'object', properties: {} } },
    async execute(_i, ctx) {
      const no = await guard(ctx.userId); if (no) return no;
      const o = await a.overview();
      return { text: `Users: ${o.users} (+${o.newUsers7d} this week). Payment requests waiting: ${o.pendingPayments}. MySEB subscribers: ${o.subscribers}. Live now: ${o.liveExams === null ? 'unknown (MySEB server not reachable)' : `${o.liveExams} exams, ${o.liveStudents} students`}.` };
    },
  };
  return [pending, decide, overview];
}
