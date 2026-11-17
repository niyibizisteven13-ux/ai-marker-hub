import { test as baseTest } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminTools } from '../server/services/ai/tools/adminTools.js';
import { agendaTools } from '../server/services/ai/tools/agendaTools.js';
import { buildToolkit } from '../server/services/ai/tools/index.js';
import type { ToolServices } from '../server/services/ai/types.js';

// The owner's tools only work for the administrator; plans and schedules are scoped to the user and need PostgreSQL (CI has it).
const ctx = (userId: string) => ({ userId, files: {} as any, services: {} });
const decided: any[] = [];
const admin: ToolServices['admin'] = {
  isAdmin: async (id) => id === 'boss',
  pendingPayments: async () => [{ id: 'r1', name: 'Amy', email: 'amy@x.rw', plan: 'MONTH', note: 'paid 5pm', createdAt: '2026-11-17T10:00:00Z' }],
  decidePayment: async (id, approve, by) => { decided.push({ id, approve, by }); return { ok: true, text: `${approve ? 'Approved' : 'Rejected'}: Amy` }; },
  overview: async () => ({ users: 120, newUsers7d: 9, pendingPayments: 1, liveExams: null, liveStudents: null, subscribers: 4 }),
};

baseTest('the owner tools refuse everyone but the administrator, on every call', async () => {
  const tools = adminTools({ admin }); const by = (n: string) => tools.find((t) => t.definition.name === n)!;
  for (const n of ['admin_pending_payments', 'admin_decide_payment', 'admin_overview']) {
    const r: any = await by(n).execute({ id: 'r1', approve: true }, ctx('lecturer'));
    assert.ok(r.isError || /only available to the platform administrator/.test(r.text), n); assert.match(r.text, /administrator/);
  }
  assert.deepEqual(decided, [], 'nothing was decided for a lecturer');
  assert.match(((await by('admin_pending_payments').execute({}, ctx('boss'))) as any).text, /Amy <amy@x.rw> wants a month[\s\S]*money must be seen/);
  await by('admin_decide_payment').execute({ id: 'r1', approve: true }, ctx('boss')); assert.deepEqual(decided, [{ id: 'r1', approve: true, by: 'boss' }]);
  assert.match(((await by('admin_overview').execute({}, ctx('boss'))) as any).text, /Users: 120 \(\+9 this week\)[\s\S]*unknown/);
  assert.deepEqual(adminTools({}), [], 'no owner tools without the service');
});

baseTest('the toolkit has the agenda tools for everyone and the owner tools only where the service exists', () => {
  const names = (s: ToolServices) => buildToolkit(s).names();
  for (const n of ['schedule_task', 'list_agenda', 'cancel_task', 'propose_actions', 'run_proposal', 'undo_proposal', 'list_proposals', 'notify_settings']) assert.ok(names({}).includes(n), n);
  assert.ok(!names({}).includes('admin_overview')); assert.ok(names({ admin }).includes('admin_overview'));
  assert.equal(agendaTools({}).length, 8);
});

const NO_PG = !process.env.DATABASE_URL && 'needs PostgreSQL (DATABASE_URL); CI provides it';
const test = (name: string, fn: () => Promise<void>) => baseTest(name, { skip: NO_PG }, fn);
const exp = process.env.DATABASE_URL ? await import('../server/db.js') : null;
const me = `ag-${randomUUID().slice(0, 8)}`; const other = `ag-${randomUUID().slice(0, 8)}`;
const calls: string[] = [];
const services: ToolServices = { agenda: { has: (t) => t !== 'nope', exec: async (u, t, i) => { calls.push(`${u} ${t} ${JSON.stringify(i)}`); return { ok: true, text: 'ok' }; } } };
baseTest.after(async () => { if (exp) await (exp.prisma as any).appSetting.deleteMany({ where: { OR: [{ key: { contains: me } }, { key: { contains: other } }] } }); });
const tool = (n: string) => agendaTools(services).find((t) => t.definition.name === n)!;

test('schedule, list, pause and delete a task; bad times and zones are refused with a reason', async () => {
  const add: any = await tool('schedule_task').execute({ title: 'Morning brief', kind: 'brief', when: 'daily', time: '07:00' }, ctx(me));
  assert.ok(!add.isError); assert.match(add.text, /Scheduled "Morning brief"/);
  const id = /id ([0-9a-f-]{36})/.exec(add.text)![1];
  assert.match(((await tool('list_agenda').execute({}, ctx(me))) as any).text, /Morning brief/);
  assert.match(((await tool('list_agenda').execute({}, ctx(other))) as any).text, /No scheduled tasks/, 'someone else sees nothing');
  assert.ok(((await tool('schedule_task').execute({ title: 'x', when: 'daily', time: '25:99' }, ctx(me))) as any).isError);
  assert.ok(((await tool('schedule_task').execute({ title: 'x', when: 'daily', time: '07:00', timezone: 'Mars/Base' }, ctx(me))) as any).isError);
  assert.match(((await tool('cancel_task').execute({ id, action: 'pause' }, ctx(me))) as any).text, /Paused/);
  assert.ok(((await tool('cancel_task').execute({ id, action: 'delete' }, ctx(other))) as any).isError, 'not theirs');
  assert.match(((await tool('cancel_task').execute({ id, action: 'delete' }, ctx(me))) as any).text, /Deleted/);
});

test('a plan is saved first, runs only after the yes, can be undone, and is private to its owner', async () => {
  const steps = [{ tool: 'publish_form', input: { id: 'f1' }, label: 'Open the quiz', undo: { tool: 'publish_form', input: { id: 'f1', open: false }, label: 'Close it again' } }];
  assert.ok(((await tool('propose_actions').execute({ title: 'Open', steps: [{ tool: 'nope', input: {}, label: 'x' }] }, ctx(me))) as any).isError);
  assert.ok(((await tool('propose_actions').execute({ title: 'Open', steps: [{ tool: 'run_python', input: {}, label: 'x' }] }, ctx(me))) as any).isError);
  const made: any = await tool('propose_actions').execute({ title: 'Open the quiz', steps }, ctx(me));
  assert.match(made.text, /Nothing has been done/); const id = /id ([0-9a-f-]{36})/.exec(made.text)![1];
  assert.deepEqual(calls, []);
  assert.match(((await tool('run_proposal').execute({ id }, ctx(me))) as any).text, /not confirmed yet/, 'not in the same breath');
  await new Promise((r) => setTimeout(r, 4100));
  assert.ok(((await tool('run_proposal').execute({ id }, ctx(other))) as any).isError, 'not theirs');
  assert.match(((await tool('run_proposal').execute({ id }, ctx(me))) as any).text, /Done\./); assert.deepEqual(calls, [`${me} publish_form {"id":"f1"}`]);
  assert.match(((await tool('undo_proposal').execute({ id }, ctx(me))) as any).text, /Undone/); assert.equal(calls.length, 2);
  assert.match(((await tool('list_proposals').execute({}, ctx(me))) as any).text, /No plans are waiting/);
});

test('alert choices are saved per person', async () => {
  assert.match(((await tool('notify_settings').execute({}, ctx(me))) as any).text, /Live-room alerts: on/);
  assert.match(((await tool('notify_settings').execute({ liveAlerts: false }, ctx(me))) as any).text, /Live-room alerts: off/);
  assert.match(((await tool('notify_settings').execute({}, ctx(other))) as any).text, /Live-room alerts: on/);
});
