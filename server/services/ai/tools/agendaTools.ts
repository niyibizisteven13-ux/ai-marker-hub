import type { Tool, ToolServices } from '../types.js';
import { err } from './helpers.js';
import { agendaStore, MAX_ITEMS_PER_USER, newItem, notifyPrefs, outbox } from '../../agenda/store.js';
import { buildSchedule, describeSchedule, DEFAULT_TZ, validTimeZone } from '../../agenda/schedule.js';
import { cancelProposal, planText, proposalStore, runProposal, undoProposal, validateSteps } from '../../agenda/proposals.js';

/**
 * Making the chat work for the user when they are not there: tasks that run on a schedule (a morning brief, a reminder to check
 * hand-ins), and plans that are shown first and run only on a yes, with an undo. Everything here is scoped to the signed-in user.
 */
const ID = { type: 'string', description: 'The id (from list_agenda or list_proposals).' } as const;

export function agendaTools(services: ToolServices): Tool[] {
  const ag = services.agenda;
  const audit = (userId: string) => async (action: string, details: unknown) => { await services.audit?.(userId, `CHAT_${action}`, 'agenda', null, details).catch(() => undefined); };

  const schedule: Tool = {
    definition: {
      name: 'schedule_task',
      description: "Set up something for the assistant to do by itself later, and send the answer to the user's Telegram (or email). Use it for 'every morning at 7 tell me what needs me', 'remind me on Friday to mark the quiz', 'each Monday summarise last week's hand-ins'. kind 'brief' is the morning brief (what needs the user today). The task can read and write things up and propose changes, but cannot change anything without the user's yes; set allow_marking only if the user said it may mark by itself. Say back in one line what you set up and when it will first run.",
      parameters: { type: 'object', required: ['title', 'when'], properties: {
        title: { type: 'string', description: 'Short name, e.g. "Morning brief".' },
        prompt: { type: 'string', description: 'What to do, as if the user typed it in the chat (leave empty for the standard brief).' },
        kind: { type: 'string', enum: ['task', 'brief'] },
        when: { type: 'string', enum: ['once', 'daily', 'weekly'] },
        time: { type: 'string', description: 'Local time, 24-hour "HH:MM" (daily and weekly).' },
        days: { type: 'array', items: { type: 'string', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }, description: 'For weekly.' },
        at: { type: 'string', description: 'For once: date and time, ISO 8601 with a zone ("2026-11-20T08:00:00+02:00") or without (read in the user\'s time zone).' },
        timezone: { type: 'string', description: `IANA time zone, default ${DEFAULT_TZ} (Rwanda).` },
        allow_marking: { type: 'boolean' },
      } },
    },
    async execute(input, ctx) {
      const i = input as { title: string; prompt?: string; kind?: 'task' | 'brief'; when: 'once' | 'daily' | 'weekly'; time?: string; days?: string[]; at?: string; timezone?: string; allow_marking?: boolean };
      const tz = i.timezone ?? DEFAULT_TZ; if (!validTimeZone(tz)) return err(`"${tz}" is not a time zone I know. Use a name like Africa/Kigali.`);
      const built = buildSchedule({ when: i.when, time: i.time, days: i.days, at: i.at }, new Date(), tz);
      if (built.ok === false) return err(built.error);
      const store = agendaStore();
      if ((await store.list(ctx.userId)).length >= MAX_ITEMS_PER_USER) return err(`There are already ${MAX_ITEMS_PER_USER} scheduled tasks. Delete one first (cancel_task).`);
      const item = newItem({ userId: ctx.userId, title: i.title, prompt: i.prompt?.trim() || (i.kind === 'brief' ? '' : i.title), schedule: built.schedule, tz, kind: i.kind ?? 'task', allowMarking: !!i.allow_marking });
      await store.put(item); await audit(ctx.userId)('AGENDA_ADD', { id: item.id, title: item.title, schedule: describeSchedule(item.schedule, tz) });
      return { text: `Scheduled "${item.title}" (${describeSchedule(item.schedule, tz)}). First run: ${item.nextRunAt}. The answer is sent to their Telegram if linked, otherwise by email, otherwise shown in the chat. id ${item.id}` };
    },
  };

  const list: Tool = {
    definition: { name: 'list_agenda', description: "The user's scheduled tasks and the last result of each, and anything that was found while they were away and not yet shown. Call it when they ask what is scheduled, or at the start of a conversation if they ask 'anything new?'.", parameters: { type: 'object', properties: {} } },
    async execute(_i, ctx) {
      const items = await agendaStore().list(ctx.userId); const waiting = await outbox().take(ctx.userId);
      const lines = items.map((t) => `- ${t.title} [${t.id}] ${describeSchedule(t.schedule, t.tz)}${t.enabled ? '' : ' (off)'}; next ${t.nextRunAt ?? 'never'}; ${t.lastRunAt ? `last ${t.lastStatus}: ${t.lastSummary}` : 'not run yet'}`);
      const news = waiting.map((w) => `* ${w.title} (${w.at}): ${w.text}`);
      return { text: `${lines.length ? lines.join('\n') : 'No scheduled tasks.'}${news.length ? `\n\nFound while the user was away:\n${news.join('\n')}` : ''}` };
    },
  };

  const cancel: Tool = {
    definition: { name: 'cancel_task', description: 'Pause, resume or delete one scheduled task.', parameters: { type: 'object', required: ['id', 'action'], properties: { id: ID, action: { type: 'string', enum: ['pause', 'resume', 'delete'] } } } },
    async execute(input, ctx) {
      const i = input as { id: string; action: 'pause' | 'resume' | 'delete' }; const store = agendaStore(); const t = await store.get(ctx.userId, String(i.id));
      if (!t) return err('That scheduled task was not found.');
      if (i.action === 'delete') { await store.remove(ctx.userId, t.id); return { text: `Deleted "${t.title}".` }; }
      const { nextRun } = await import('../../agenda/schedule.js');
      const next = i.action === 'resume' ? nextRun(t.schedule, new Date(), t.tz)?.toISOString() ?? null : t.nextRunAt;
      await store.put({ ...t, enabled: i.action === 'resume' && next !== null, nextRunAt: next, failures: i.action === 'resume' ? 0 : t.failures });
      return { text: `${i.action === 'pause' ? 'Paused' : 'Resumed'} "${t.title}".` };
    },
  };

  const propose: Tool = {
    definition: {
      name: 'propose_actions',
      description: "Show the user a plan of changes BEFORE doing them, and do nothing until they say yes. Use it when a request would change several things, or the user asked 'what should I do about X' and the answer is actions (close the task, release the marks, let students back in, set the room rules). Give each step in plain words (label) and, where it can be reversed, its undo. Steps are the same tools you would call directly (publish_form, task_settings, release_task_results, live_room_settings, ...). After calling it, show the plan and ask them to confirm; the user can also tap Do it in Telegram. NEVER call run_proposal in the same turn: wait for their yes.",
      parameters: { type: 'object', required: ['title', 'steps'], properties: {
        title: { type: 'string' },
        steps: { type: 'array', items: { type: 'object', required: ['tool', 'input', 'label'], properties: { tool: { type: 'string' }, input: { type: 'object' }, label: { type: 'string', description: 'What this does, in plain words the user reads.' }, undo: { type: 'object', description: 'How to put it back: { tool, input, label }.' } } } },
      } },
    },
    async execute(input, ctx) {
      const i = input as { title: string; steps: unknown };
      const v = validateSteps(i.steps, (t) => ag?.has(t) ?? true); if (v.ok === false) return err(v.error);
      const p = await proposalStore().create(ctx.userId, String(i.title || 'Plan'), v.steps);
      return { text: `Plan saved (id ${p.id}). Nothing has been done.\n${planText(p)}\nAsk the user to confirm (they can also tap "Do it" on Telegram). When they say yes, call run_proposal with this id.` };
    },
  };

  const run: Tool = {
    definition: { name: 'run_proposal', description: "Do a plan the user has just said yes to (from propose_actions). Only after their explicit yes in this conversation; never in the same turn as propose_actions.", parameters: { type: 'object', required: ['id'], properties: { id: ID } } },
    async execute(input, ctx) {
      if (!ag) return err('Plans are not available here.');
      const store = proposalStore(); const p = await store.get(ctx.userId, String((input as any).id));
      if (p && p.status === 'pending' && Date.now() - Date.parse(p.createdAt) < 4000) return err('The user has not confirmed yet. Show them the plan and wait for their yes.');
      const r = await runProposal(store, ctx.userId, String((input as any).id), (t, inp) => ag.exec(ctx.userId, t, inp), { audit: audit(ctx.userId) });
      return r.ok ? { text: r.text } : err(r.text);
    },
  };
  const undo: Tool = {
    definition: { name: 'undo_proposal', description: 'Put back what a plan changed (the steps that can be reversed), when the user asks to undo it.', parameters: { type: 'object', required: ['id'], properties: { id: ID } } },
    async execute(input, ctx) {
      if (!ag) return err('Plans are not available here.');
      const r = await undoProposal(proposalStore(), ctx.userId, String((input as any).id), (t, inp) => ag.exec(ctx.userId, t, inp), { audit: audit(ctx.userId) });
      return r.ok ? { text: r.text } : err(r.text);
    },
  };
  const pending: Tool = {
    definition: { name: 'list_proposals', description: 'Plans that are waiting for the user\'s yes (from propose_actions or a scheduled task), and cancel one with cancel=true.', parameters: { type: 'object', properties: { cancel: { type: 'boolean' }, id: ID } } },
    async execute(input, ctx) {
      const i = input as { cancel?: boolean; id?: string };
      if (i.cancel && i.id) { const r = await cancelProposal(proposalStore(), ctx.userId, i.id); return r.ok ? { text: r.text } : err(r.text); }
      const rows = await proposalStore().pending(ctx.userId);
      return { text: rows.length ? rows.map((p) => `[${p.id}] ${planText(p)}`).join('\n\n') : 'No plans are waiting.' };
    },
  };
  const notify: Tool = {
    definition: { name: 'notify_settings', description: "What the assistant may message the user about on Telegram without being asked: live-room 'needs you' alerts (liveAlerts) and, for the platform owner, payment requests (payments). Change with the fields; call with none to read.", parameters: { type: 'object', properties: { liveAlerts: { type: 'boolean' }, payments: { type: 'boolean' } } } },
    async execute(input, ctx) {
      const i = input as { liveAlerts?: boolean; payments?: boolean }; const n = notifyPrefs();
      const next = (i.liveAlerts !== undefined || i.payments !== undefined) ? await n.set(ctx.userId, i) : await n.get(ctx.userId);
      return { text: `Live-room alerts: ${next.liveAlerts ? 'on' : 'off'}. Payment requests: ${next.payments ? 'on' : 'off'}.` };
    },
  };
  return [schedule, list, cancel, propose, run, undo, pending, notify];
}
