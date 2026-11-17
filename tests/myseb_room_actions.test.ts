import test from 'node:test';
import assert from 'node:assert/strict';
import { ATTEMPTS, SERIOUS, buildReport, decideStrikes, massDisconnect, minutesLeft, strikeScore, DEFAULT_RULES, EMPTY_USAGE, checkRoomAction, cleanRules, decide, describeRoomAction, roomActionFrom, type AgentRules, type StudentView } from '../server/services/mySebAgent.js';

// What the assistant may do in the room, and when it only practises or only watches. Pure: no database, no MySEB server.
const on = (over: Partial<AgentRules> = {}): AgentRules => ({ ...DEFAULT_RULES, on: true, ...over });
const stu = (over: Partial<StudentView> = {}): StudentView => ({ id: 's1', student_name: 'Amy', status: 'PAUSED', pause_reason: 'face_missing', seen_ago: 2, ...over });

test('the new rules are clamped and default to the careful side', () => {
  assert.equal(DEFAULT_RULES.level, 'assist'); assert.equal(DEFAULT_RULES.dryRun, false);
  const r = cleanRules({ level: 'sky' as any, dryRun: true, maxAddMinutes: 999, maxRoomPauses: -4 });
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

test('autopilot policy: warnings first, then what the lecturer chose; copy/paste attempts count only in threes', () => {
  assert.equal(cleanRules({ level: 'run' }).level, 'run'); assert.equal(DEFAULT_RULES.serious, 'flag', 'nobody is ended unless the lecturer chose it'); assert.equal(DEFAULT_RULES.seriousStrikes, 2);
  assert.equal(strikeScore(['screenshot']), 1); assert.equal(strikeScore(['screenshot', 'multiple_faces', 'blur']), 2);
  assert.equal(strikeScore(['paste', 'paste']), 0); assert.equal(strikeScore(['paste', 'copy', 'shortcut']), 1); assert.equal(strikeScore(['blur', 'face_missing', 'leave']), 0, 'small slips never count');
  for (const t of ['screenshot', 'screen_recording', 'forbidden_app', 'multiple_faces', 'devtools']) assert.ok(SERIOUS.has(t)); for (const t of ['blur', 'leave', 'face_missing', 'teacher', 'heartbeat_lost']) assert.ok(!SERIOUS.has(t) && !ATTEMPTS.has(t));
  const flag = on({ level: 'run', serious: 'flag', seriousStrikes: 2 }); const end = on({ level: 'run', serious: 'end', seriousStrikes: 2 });
  assert.equal(decideStrikes(end, 0), 'none'); assert.equal(decideStrikes(end, 1), 'warn'); assert.equal(decideStrikes(end, 2), 'end'); assert.equal(decideStrikes(flag, 2), 'flag'); assert.equal(decideStrikes(flag, 9), 'flag');
  assert.equal(decideStrikes(on({ serious: 'end', seriousStrikes: 1 }), 1), 'end', 'with one strike allowed there is no warning step');
});

test('a mass connection loss is a fault, not cheating; time left is read from the longest deadline', () => {
  const mk = (n: number, gone: number) => Array.from({ length: n }, (_, i) => stu({ id: `s${i}`, status: i < gone ? 'LEFT' : 'IN_EXAM', pause_reason: null, seen_ago: i < gone ? 60 : 2 }));
  assert.equal(massDisconnect(mk(10, 5)), true); assert.equal(massDisconnect(mk(10, 3)), false); assert.equal(massDisconnect(mk(3, 3)), false, 'too few students to call it a fault');
  assert.equal(massDisconnect([...mk(6, 0), ...Array.from({ length: 20 }, () => stu({ status: 'ENDED' }))]), false, 'finished students are not counted');
  const now = Date.parse('2026-11-17T10:00:00Z');
  assert.equal(minutesLeft(['2026-11-17T10:09:00Z', '2026-11-17T10:04:00Z'], now), 9); assert.equal(minutesLeft([null, undefined], now), null); assert.equal(minutesLeft(['2026-11-17T09:00:00Z'], now), 0);
});

test('the report: who took part, who to look at (most first), what the assistant did, and that signals are not proof', () => {
  const students = [
    { id: 'a', student_name: 'Amy', status: 'ENDED', end_reason: 'student', violation_count: 0, last_violation: null },
    { id: 'b', student_name: 'Ben', status: 'ENDED', end_reason: 'screenshot', violation_count: 3, last_violation: 'screenshot', reinstated_count: 0 },
    { id: 'c', student_name: 'Cy', status: 'ENDED', end_reason: 'time_up', violation_count: 1, last_violation: 'blur' },
  ];
  const text = buildReport('Biology', students, { serious: { b: 2 }, usage: { roomPauses: 0, addedMinutes: 5, notices: 3 }, log: [{ at: '', kind: 'resumed', text: '' }, { at: '', kind: 'warned', text: '' }, { at: '', kind: 'ended', text: '' }], counts: {}, rules: DEFAULT_RULES });
  assert.match(text, /Biology: final report/); assert.match(text, /3 students took part: 1 finished, 1 ran out of time, 1 had their test ended by a rule/);
  assert.ok(text.indexOf('Ben') < text.indexOf('Cy'), 'most flagged first'); assert.ok(!/- Amy/.test(text), 'nobody who was clean is listed');
  assert.match(text, /Ben: 3 signals.*2 serious.*test ended/); assert.match(text, /let 1 back in, warned 1, ended 1 test, added 5 minutes, sent 3 messages/);
  assert.match(text, /signals, not proof/); assert.match(text, /phone propped up/);
  assert.match(buildReport('X', [], { serious: {}, usage: EMPTY_USAGE, log: [], counts: {}, rules: DEFAULT_RULES }), /Nobody took part/);
});
