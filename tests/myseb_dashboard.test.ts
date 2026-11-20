// The lecturer's MySEB dashboard: one overview call with their own rooms and tests only, and the agent beside it is told it is in the dashboard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const { prisma } = await import('../server/db.js');
const { buildOverview } = await import('../server/routes/mySebDashboardRoutes.js');
const { MYSEB_DASHBOARD_NOTE } = await import('../server/services/ai/mysebDashboardNote.js');
const { needsPlatformTools } = await import('../server/services/ai/platformIntent.js');
const db = prisma as any;

const newUser = async () => { const id = `u-${randomUUID()}`; await db.user.create({ data: { id, email: `${id}@test.local`, name: 'Aline Uwase', passwordHash: 'x', role: 'INSTRUCTOR' } }); return id; };
const newForm = (userId: string, title: string, requireMyseb: boolean) => db.applicationForm.create({ data: { id: randomUUID(), userId, title, schema: JSON.stringify({ type: 'object', exam: { requireMyseb } }) } });

test('the overview lists only my own tests, marks which have a live room, counts them, and never shows another lecturer\'s', async () => {
  const me = await newUser(); const other = await newUser();
  await newForm(me, 'Midterm', true); await newForm(me, 'Practice quiz', false); await newForm(other, 'Someone else\'s exam', true);
  const o = await buildOverview(me, 'INSTRUCTOR');
  assert.deepEqual(o.forms.map((f) => [f.title, f.mySeb]).sort(), [['Midterm', true], ['Practice quiz', false]]);
  assert.equal(o.totals.forms, 2); assert.equal(o.totals.rooms, 1); assert.equal(o.rooms.length, 1); assert.equal(o.rooms[0].title, 'Midterm'); assert.match(o.rooms[0].link, /^\/live\/form\/[0-9a-f-]{36}$/);
  assert.ok(!JSON.stringify(o).includes('Someone else'), 'another lecturer\'s exam is not here');
  assert.deepEqual(Object.keys(o.access).sort(), ['charging', 'exempt', 'hasAccess', 'monthActive', 'monthUntil', 'tests']);
  assert.equal(o.totals.liveRooms, 0); assert.equal(o.totals.studentsIn, 0, 'no students yet');
  const empty = await buildOverview(await newUser(), 'INSTRUCTOR'); assert.deepEqual([empty.totals.forms, empty.totals.rooms, empty.rooms.length], [0, 0, 0]);
});

test('a message from the dashboard is told where it is and reaches the MySEB tools', () => {
  assert.match(MYSEB_DASHBOARD_NOTE, /live_room_status/); assert.match(MYSEB_DASHBOARD_NOTE, /list_live_rooms/); assert.match(MYSEB_DASHBOARD_NOTE, /launch_test/); assert.match(MYSEB_DASHBOARD_NOTE, /only when they asked/);
  assert.equal(needsPlatformTools(`${MYSEB_DASHBOARD_NOTE}\n\nhow is it going`), true, 'a plain question from the dashboard still gets the platform tools');
});
