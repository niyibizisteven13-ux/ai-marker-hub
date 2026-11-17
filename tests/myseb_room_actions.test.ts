import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, EMPTY_USAGE, checkRoomAction, cleanRules, decide, describeRoomAction, roomActionFrom, type AgentRules, type StudentView } from '../server/services/mySebAgent.js';

// What the assistant may do in the room, and when it only practises or only watches. Pure: no database, no MySEB server.
const on = (over: Partial<AgentRules> = {}): AgentRules => ({ ...DEFAULT_RULES, on: true, ...over });
const stu = (over: Partial<StudentView> = {}): StudentView => ({ id: 's1', student_name: 'Amy', status: 'PAUSED', pause_reason: 'face_missing', seen_ago: 2, ...over });

test('the new rules are clamped and default to the careful side', () => {
  assert.equal(DEFAULT_RULES.level, 'assist'); assert.equal(DEFAULT_RULES.dryRun, false);
  const r = cleanRules({ level: 'run' as any, dryRun: true, maxAddMinutes: 999, maxRoomPauses: -4 });
  assert.equal(r.level, 'assist', 'an unknown level is ignored'); assert.equal(r.dryRun, true); assert.equal(r.maxAddMinutes, 60); assert.equal(r.maxRoomPauses, 0);
  assert.equal(cleanRules({ level: 'watch' }).level, 'watch');
  assert.equal(cleanRules({ maxAddMinutes: 0 }).maxAddMinutes, 1);
});

test('watch mode never lets anyone back in or ends a test: it tells the lecturer instead', () => {
  const watch = on({ level: 'watch' });
  const d = decide(stu(), watch, 99, 0); assert.equal(d.action, 'needs_you'); assert.match((d as any).why, /watch mode/);
  assert.equal(decide(stu(), watch, 5, 0).action, 'wait', 'it still waits as usual');
  const end = decide(stu(), on({ level: 'watch', endAfterMax: true }), 99, 2); assert.equal(end.action, 'needs_you');
  assert.equal(decide(stu(), on(), 99, 0).action, 'resume', 'assist mode is unchanged');
});

test('the assistant\'s own room actions stay inside the lecturer\'s limits, checked in code', () => {
  const ok = (a: any, rules = on(), usage = EMPTY_USAGE) => checkRoomAction(rules, usage, a, 'agent');
  assert.equal(ok({ action: 'pause_room' }).ok, true);
  assert.equal(ok({ action: 'pause_room' }, on(), { ...EMPTY_USAGE, roomPauses: 2 }).ok, false, 'two pauses is the limit');
  assert.equal(ok({ action: 'pause_room' }, on({ maxRoomPauses: 0 })).ok, false);
  assert.equal(ok({ action: 'add_time', minutes: 10 }).ok, true);
  const over: any = ok({ action: 'add_time', minutes: 10 }, on(), { ...EMPTY_USAGE, addedMinutes: 10 }); assert.equal(over.ok, false); assert.match(over.reason, /limit of 15 minutes/);
  assert.equal(ok({ action: 'add_time', minutes: 61 }).ok, false); assert.equal(ok({ action: 'add_time', minutes: 1.5 }).ok, false); assert.equal(ok({ action: 'add_time', minutes: 0 }).ok, false);
  assert.equal(ok({ action: 'notice', text: 'Hi' }, on(), { ...EMPTY_USAGE, notices: 20 }).ok, false);
  assert.equal(ok({ action: 'notice', text: '  ' }).ok, false);
  assert.equal(ok({ action: 'pause_room' }, { ...on(), on: false }).ok, false, 'off means off');
  assert.equal((ok({ action: 'pause_room' }, on({ level: 'watch' })) as any).reason.includes('watch mode'), true);
});

test('the lecturer is not held to the assistant\'s limits, only to what MySEB accepts', () => {
  const lec = (a: any, rules = on({ level: 'watch' }), usage = { roomPauses: 9, addedMinutes: 99, notices: 99 }) => checkRoomAction(rules, usage, a, 'lecturer');
  assert.equal(lec({ action: 'pause_room' }).ok, true); assert.equal(lec({ action: 'add_time', minutes: 45 }).ok, true); assert.equal(lec({ action: 'notice', text: 'x' }).ok, true);
  assert.equal(lec({ action: 'add_time', minutes: 90 }).ok, false); assert.equal(lec({ action: 'add_time', minutes: 0 }).ok, false); assert.equal(lec({ action: 'notice', text: '' }).ok, false);
  assert.equal(checkRoomAction({ ...DEFAULT_RULES, on: false }, EMPTY_USAGE, { action: 'resume_room' }, 'lecturer').ok, true, 'works even with the assistant off');
});

test('room actions from a request body: only the four known actions, cleaned', () => {
  assert.deepEqual(roomActionFrom({ action: 'pause_room', reason: 'power cut' }), { action: 'pause_room', reason: 'power cut' });
  assert.deepEqual(roomActionFrom({ action: 'resume_room' }), { action: 'resume_room' });
  assert.deepEqual(roomActionFrom({ action: 'add_time', minutes: '10', studentId: 's1' }), { action: 'add_time', minutes: 10, studentId: 's1' });
  assert.deepEqual(roomActionFrom({ action: 'notice', text: `  ${'x'.repeat(400)}  ` }), { action: 'notice', text: 'x'.repeat(300), studentId: undefined });
  for (const bad of [null, {}, { action: 'end_all' }, { action: 'add_time', minutes: 'x' }, { action: 'notice', text: '' }, { action: 'notice' }]) assert.equal(roomActionFrom(bad), null);
  assert.equal(describeRoomAction({ action: 'add_time', minutes: 1 }), 'add 1 minute for everyone still in the test');
  assert.match(describeRoomAction({ action: 'notice', text: 'Hello', studentId: 's' }), /tell one student: "Hello"/);
});
