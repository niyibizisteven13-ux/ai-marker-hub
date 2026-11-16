import test from 'node:test';
import assert from 'node:assert/strict';
import { helpFor, NOT_RULES, type HelpStudent } from '../src/utils/studentHelp.js';

// The help icon on a student's tile: only problems the lecturer can fix get a button; the others say what to tell the student.
const stu = (over: Partial<HelpStudent> = {}): HelpStudent => ({ student_name: 'Amy Uwase', status: 'IN_EXAM', pause_reason: null, end_reason: null, seen_ago: 2, client_type: 'mobile', live: { camera: 'on' }, ...over });

test('a student with nothing wrong has nothing to fix', () => {
  const h = helpFor(stu()); assert.equal(h.level, 'ok'); assert.deepEqual(h.can, []);
});

test('paused for a small reason: let them continue; paused by the lecturer: say so', () => {
  const a = helpFor(stu({ status: 'PAUSED', pause_reason: 'face_missing' }));
  assert.equal(a.level, 'fix'); assert.deepEqual(a.can, ['resume']); assert.match(a.why, /face left the camera/); assert.ok(!a.careful);
  const b = helpFor(stu({ status: 'PAUSED', pause_reason: 'teacher' }));
  assert.equal(b.title, 'Paused by you'); assert.deepEqual(b.can, ['resume']); assert.ok(!b.careful);
});

test('paused for something that looks like cheating can still be resumed, but the lecturer is asked to look first', () => {
  for (const r of ['screenshot', 'multiple_faces', 'forbidden_app', 'screen_recording', 'devtools']) {
    const h = helpFor(stu({ status: 'PAUSED', pause_reason: r })); assert.deepEqual(h.can, ['resume'], r); assert.equal(h.careful, true, r);
  }
});

test('connection lost: let them continue once they are back, and the student is told what to do', () => {
  const h = helpFor(stu({ status: 'LEFT', pause_reason: 'heartbeat_lost', seen_ago: 140 }));
  assert.equal(h.title, 'Connection lost'); assert.deepEqual(h.can, ['resume']); assert.match(h.why, /Last seen 2 min ago/); assert.match(h.tell!, /check your internet/);
});

test('ended by a rule: let back in (and the first name is used in what to tell them); ended normally: nothing to do', () => {
  const h = helpFor(stu({ status: 'ENDED', end_reason: 'visibility_hidden' }));
  assert.equal(h.level, 'fix'); assert.deepEqual(h.can, ['reinstate']); assert.match(h.why, /opened another app or tab/); assert.match(h.tell!, /^Amy, your teacher has let you back in/);
  assert.match(helpFor(stu({ status: 'ENDED', end_reason: 'visibility_hidden', reinstated_count: 2 })).why, /2 times/);
  for (const r of NOT_RULES) { const x = helpFor(stu({ status: 'ENDED', end_reason: r })); assert.equal(x.level, 'ok', r); assert.deepEqual(x.can, [], r); }
  assert.equal(helpFor(stu({ status: 'ENDED', end_reason: 'screenshot' })).careful, true, 'a disqualification for cheating-like reasons is flagged');
});

test('a student card waiting is the lecturer\'s to decide', () => {
  const h = helpFor(stu({ id_status: 'pending' })); assert.equal(h.level, 'fix'); assert.deepEqual(h.can, ['card']);
  assert.equal(helpFor(stu({ id_status: 'pending', status: 'ENDED', end_reason: 'time_up' })).level, 'ok');
});

test('problems only the student can fix get no button, only words to send', () => {
  const busy = helpFor(stu({ live: { camera: 'busy' } }));
  assert.equal(busy.level, 'info'); assert.deepEqual(busy.can, []); assert.match(busy.why, /one app/); assert.match(busy.tell!, /another app is using your camera/);
  const blocked = helpFor(stu({ live: { camera: 'denied' } })); assert.equal(blocked.level, 'info'); assert.match(blocked.tell!, /Settings → Apps → MySEB/);
  assert.equal(helpFor(stu({ live: { camera: 'on', screen_state: 'partial' } })).level, 'info');
  assert.equal(helpFor(stu({ live: { camera: 'on', screen_state: 'denied' } })).level, 'info');
});
