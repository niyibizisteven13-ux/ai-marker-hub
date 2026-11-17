import test from 'node:test';
import assert from 'node:assert/strict';
import { agendaStore, memoryKV, newItem, outbox } from '../server/services/agenda/store.js';
import { notifyUser, type NotifyDeps } from '../server/services/agenda/notify.js';
import { runItem, tickAgenda, toolsFor, UNATTENDED_TOOLS, type RunnerDeps } from '../server/services/agenda/runner.js';
import { proposalStore } from '../server/services/agenda/proposals.js';
import { buildSchedule } from '../server/services/agenda/schedule.js';

const sched = (when: 'daily' | 'once', now: Date) => { const r = buildSchedule({ when, time: '07:00', at: '2026-11-18T08:00:00Z' }, now); assert.ok(r.ok); return (r as any).schedule; };
function fakes(over: Partial<NotifyDeps> = {}) {
  const sent: Array<{ via: string; text: string; kb?: unknown }> = []; const kv = memoryKV();
  const notify: NotifyDeps = {
    kv, telegramChat: async () => 'chat1', sendTelegram: async (_c, html, kb) => { sent.push({ via: 'telegram', text: html, kb }); },
    email: async () => 'a@b.c', sendEmail: async (_t, s, t) => { sent.push({ via: 'email', text: `${s}\n${t}` }); return true; }, ...over,
  };
  return { sent, kv, notify };
}

test('a notice goes to Telegram first, then email, and waits in the outbox when neither works', async () => {
  const a = fakes(); assert.equal(await notifyUser('u1', { title: 'T', text: 'x < y', buttons: [[{ text: 'Go', callback_data: 'pp:run:1' }]] }, a.notify), 'telegram');
  assert.match(a.sent[0].text, /<b>T<\/b>[\s\S]*x &lt; y/); assert.ok(a.sent[0].kb);
  const b = fakes({ telegramChat: async () => null }); assert.equal(await notifyUser('u1', { title: 'T', text: 'x' }, b.notify), 'email');
  const c = fakes({ telegramChat: async () => { throw new Error('down'); }, email: async () => null }); assert.equal(await notifyUser('u1', { title: 'T', text: 'later' }, c.notify), 'outbox');
  const d = fakes({ telegramChat: async () => null, sendEmail: async () => false }); assert.equal(await notifyUser('u1', { title: 'T', text: 'later' }, d.notify), 'outbox');
  assert.equal((await outbox(c.kv).take('u1'))[0].text, 'later'); assert.deepEqual(await outbox(c.kv).take('u1'), [], 'told once');
});

test('a due task runs as its owner with the safe tools, tells them, and sets the next time', async () => {
  const f = fakes(); const now = new Date('2026-11-17T04:00:00Z'); const store = agendaStore(f.kv);
  const item = newItem({ userId: 'u1', title: 'Morning brief', prompt: '', schedule: sched('daily', now), kind: 'brief' }, now); await store.put(item);
  let seen: any;
  const deps: RunnerDeps = { kv: f.kv, notify: f.notify, now: () => new Date('2026-11-17T05:01:00Z'), assist: async (o) => { seen = o; return 'Two students need you.'; } };
  assert.equal(await tickAgenda({ ...deps, now: () => new Date('2026-11-17T04:30:00Z') }), 0, 'not yet');
  assert.equal(await tickAgenda(deps), 1);
  assert.equal(seen.userId, 'u1'); assert.match(seen.prompt, /morning brief/i); assert.deepEqual(seen.toolNames, UNATTENDED_TOOLS);
  assert.match(f.sent[0].text, /Two students need you/);
  const after = (await store.get('u1', item.id))!;
  assert.equal(after.runs, 1); assert.equal(after.lastStatus, 'ok'); assert.ok(Date.parse(after.nextRunAt!) > Date.parse('2026-11-17T05:01:00Z')); assert.ok(after.enabled);
  assert.equal(await tickAgenda(deps), 0, 'it does not run twice for the same time');
});

test('what an unattended run may use: nothing that changes things, marking only when the owner allowed it', () => {
  for (const t of ['publish_form', 'release_task_results', 'release_exam_results', 'live_room_student', 'change_exam_mark', 'run_proposal', 'run_python', 'live_room_settings', 'launch_test']) assert.ok(!UNATTENDED_TOOLS.includes(t), `${t} is not allowed unattended`);
  assert.ok(!toolsFor({ allowMarking: false }).includes('mark_task')); assert.ok(toolsFor({ allowMarking: true }).includes('mark_task'));
  assert.ok(!toolsFor({ allowMarking: true }).includes('release_task_results'));
});

test('a once-only task ends, a failing task is switched off after three failures, and plans it made come with buttons', async () => {
  const f = fakes(); const now = new Date('2026-11-17T04:00:00Z'); const store = agendaStore(f.kv);
  const once = newItem({ userId: 'u1', title: 'Remind', prompt: 'check hand-ins', schedule: sched('once', now) }, now);
  await runItem(once, { kv: f.kv, notify: f.notify, now: () => now, assist: async () => 'ok' }, store);
  const o = (await store.get('u1', once.id))!; assert.equal(o.enabled, false); assert.equal(o.nextRunAt, null);
  let item = newItem({ userId: 'u1', title: 'Broken', prompt: 'x', schedule: sched('daily', now) }, now);
  for (let i = 0; i < 3; i++) { await runItem(item, { kv: f.kv, notify: f.notify, now: () => now, assist: async () => { throw new Error('model down'); } }, store); item = (await store.get('u1', item.id))!; }
  assert.equal(item.failures, 3); assert.equal(item.enabled, false); assert.equal(item.lastStatus, 'failed');
  assert.match(f.sent.at(-1)!.text, /model down/);
  const p = await proposalStore(f.kv).create('u1', 'Close the quiz', [{ tool: 'task_settings', input: { id: 't' }, label: 'Close the task' }], now);
  const good = newItem({ userId: 'u1', title: 'Brief', prompt: 'x', schedule: sched('daily', now) }, now);
  await runItem(good, { kv: f.kv, notify: f.notify, now: () => now, assist: async () => 'One task is overdue.' }, store);
  const last = f.sent.at(-1)!; assert.match(last.text, /Close the task/); assert.match(JSON.stringify(last.kb), new RegExp(`pp:run:${p.id}`)); assert.match(JSON.stringify(last.kb), new RegExp(`pp:no:${p.id}`));
});
