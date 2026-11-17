import { agendaStore, notifyPrefs, type AgendaItem, type AgendaStore, type KV, appSettingKV } from './store.js';
import { nextRun } from './schedule.js';
import { notifyUser, type NotifyDeps, type Notice } from './notify.js';
import { proposalStore, planText } from './proposals.js';
import { bizToolsFor, bizSystem } from '../biz/agent.js';

/**
 * The assistant working while nobody is looking. Every minute the tasks whose time has come run as a chat turn for their owner, with
 * a short list of tools: it can look at everything and write things up, it can propose changes (they wait for a yes), and it marks
 * work only when the owner said so when making the task. The result goes to the owner on Telegram, by email, or waits in the chat.
 */
export const BRIEF_PROMPT = 'Write my morning brief. Look at my live rooms, my tasks and hand-ins, my classes and my marked exams and tell me, in a few short lines each, what needs me today and what you suggest. Start with the most urgent. If something should be changed (a task to close, a result to release), propose it with propose_actions instead of doing it. If nothing needs me, say so in one line.';

/** What an unattended run may use: reading and writing up only, plus proposals. */
export const UNATTENDED_TOOLS = [
  'list_live_rooms', 'live_room_status', 'test_debrief', 'live_room_saved_answers', 'list_courses', 'course_overview', 'list_marked_exams',
  'task_results', 'exam_results', 'list_assignments', 'assignment_hand_ins', 'list_forms', 'review_form', 'analyze_form', 'form_report',
  'list_practice_classes', 'practice_class_overview', 'exam_candidate', 'recall_memory', 'list_agenda', 'propose_actions',
  'create_document', 'create_spreadsheet', 'create_chart',
];
export const toolsFor = (item: Pick<AgendaItem, 'allowMarking'> & Partial<Pick<AgendaItem, 'kind' | 'bizLevel'>>) => (item.kind === 'biz' ? bizToolsFor(item.bizLevel) : item.allowMarking ? [...UNATTENDED_TOOLS, 'mark_task', 'mark_assignment'] : UNATTENDED_TOOLS);

export interface RunnerDeps {
  /** One chat turn as the user, with only these tools. Returns the answer text. */
  assist(o: { userId: string; prompt: string; toolNames: string[]; system: string }): Promise<string>;
  notify: NotifyDeps;
  kv?: KV;
  now?: () => Date;
}

const SYSTEM = (item: AgendaItem) => (item.kind === 'biz' ? `${bizSystem(item.bizLevel, item.title.split(':')[0])}\n(${item.title})` : SYSTEM_GENERAL(item));
const SYSTEM_GENERAL = (item: AgendaItem) => `You are working on a scheduled task the user set up earlier ("${item.title}"). They are not here: write your answer as a message they will read later, short and plain, with the facts first. Never ask them a question you cannot wait for; if something needs their decision, say what you suggest. You cannot change anything directly: to suggest a change use propose_actions (it is shown to them to approve).${item.allowMarking ? ' The user allowed you to mark work by itself; marking is the only change you may make, and never show results to students.' : ''}`;

export async function runItem(item: AgendaItem, deps: RunnerDeps, store: AgendaStore = agendaStore(deps.kv)): Promise<{ ok: boolean; text: string }> {
  const now = (deps.now ?? (() => new Date()))();
  let ok = true; let text = '';
  try {
    text = (await deps.assist({ userId: item.userId, prompt: item.kind === 'brief' ? `${BRIEF_PROMPT}${item.prompt && item.prompt !== BRIEF_PROMPT ? `\nThey also asked: ${item.prompt}` : ''}` : item.prompt, toolNames: toolsFor(item), system: SYSTEM(item) })).trim();
    if (!text) { ok = false; text = 'I could not write anything this time.'; }
  } catch (e) { ok = false; text = `I could not do this: ${String((e as Error)?.message ?? e).slice(0, 200)}`; }
  // Plans the run proposed in the last minutes come with Do it / Cancel buttons.
  const waiting = await proposalStore(deps.kv).pending(item.userId, new Date(now.getTime() - 10 * 60_000), now).catch(() => []);
  const buttons = waiting.slice(0, 3).map((p) => [{ text: `✅ ${p.title.slice(0, 40)}`, callback_data: `pp:run:${p.id}` }, { text: '✖', callback_data: `pp:no:${p.id}` }]);
  const body = waiting.length ? `${text}\n\n${waiting.slice(0, 3).map((p) => planText(p)).join('\n\n')}` : text;
  const notice: Notice = { title: item.title, text: body, buttons };
  await notifyUser(item.userId, notice, deps.notify);
  const next = item.schedule.kind === 'once' ? null : nextRun(item.schedule, now, item.tz)?.toISOString() ?? null;
  const failures = ok ? 0 : item.failures + 1;
  // Three failures in a row switch a task off, so a broken one does not keep trying all week.
  await store.put({ ...item, runs: item.runs + 1, failures, lastRunAt: now.toISOString(), lastStatus: ok ? 'ok' : 'failed', lastSummary: text.slice(0, 200), nextRunAt: next, enabled: next !== null && failures < 3 });
  return { ok, text };
}

let running = false;
/** Looks for tasks that are due and runs each (a few at a time). */
export async function tickAgenda(deps: RunnerDeps): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const store = agendaStore(deps.kv);
    const due = await store.due((deps.now ?? (() => new Date()))());
    let n = 0;
    for (const item of due.slice(0, 20)) {
      const prefs = await notifyPrefs(deps.kv).get(item.userId).catch(() => null);
      void prefs;
      await runItem(item, deps, store).catch(() => undefined); n++;
    }
    return n;
  } finally { running = false; }
}

export function startAgenda(): () => void {
  if (process.env.NODE_ENV === 'test' || process.env.AGENDA_DISABLED === 'true') return () => undefined;
  const timer = setInterval(async () => {
    try {
      const [{ AiService }, live] = await Promise.all([import('../AiService.js'), import('./notify.js')]);
      const ai = AiService.getInstance();
      await tickAgenda({
        kv: appSettingKV(), notify: await live.liveNotifyDeps(),
        assist: async (o) => { const r: any = await (ai as any).generalAssist({ userId: o.userId, messages: [{ role: 'user', content: o.prompt }], planText: o.prompt, unattended: { toolNames: o.toolNames, system: o.system }, channel: 'web' }); return r?.content?.[0]?.text ?? ''; },
      });
    } catch { /* the next minute tries again */ }
  }, 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
