import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReview, type StoredDecision } from '../server/services/mySebReview.js';

// The review queue: who is flagged, in what order, what happened, and what the lecturer decided. Pure: no database, no server.
const stu = (id: string, name: string, over: any = {}) => ({ id, student_name: name, status: 'ENDED', end_reason: 'student', violation_count: 0, reinstated_count: 0, deadline_at: null, ...over });
const ev = (sid: string, type: string, min: number) => ({ session_id: sid, type, created_at: `2026-11-17T09:${String(min).padStart(2, '0')}:00.000Z` });
const rep = (students: any[], events: any[], status = 'active') => ({ exam: { status }, students, events });

test('only people worth a look are queued, most serious first, with their timeline in order and what the assistant did', () => {
  const students = [stu('a', 'Amy'), stu('b', 'Ben', { end_reason: 'screenshot', violation_count: 3 }), stu('c', 'Cy', { violation_count: 3 }), stu('d', 'Dee', { violation_count: 1 }), stu('e', 'Eli', { reinstated_count: 1 })];
  const events = [ev('b', 'blur', 1), ev('b', 'screenshot', 3), ev('b', 'devtools', 2), ev('c', 'blur', 1), ev('c', 'leave', 2), ev('c', 'face_missing', 3), ev('d', 'blur', 1), ev('e', 'reinstated', 5)];
  const items = buildReview(rep(students, events), {}, { b: 2 }, [{ at: '2026-11-17T09:02:30.000Z', kind: 'warned', student: 'Ben', text: 'Warning sent: opened developer tools' }, { at: '2026-11-17T09:02:40.000Z', kind: 'needs_you', student: 'Ben', text: 'not shown' }]);
  assert.deepEqual(items.map((i) => i.name), ['Ben', 'Cy', 'Eli'], 'Amy (clean) and Dee (one small slip) are not queued; Ben first');
  const ben = items[0];
  assert.deepEqual(ben.timeline.map((t) => t.type), ['blur', 'devtools', 'warned', 'screenshot'], 'in time order, with the assistant\'s own actions among them');
  assert.equal(ben.strikes, 2); assert.equal(ben.evidence, 2); assert.equal(ben.decision, 'open'); assert.equal(ben.ended?.words, 'tried a screenshot');
  assert.ok(ben.canRestore, 'ended by a rule while the test is open'); assert.ok(!items[1].canRestore, 'Cy was not ended');
  assert.equal(ben.timeline.find((t) => t.type === 'devtools')!.kind, 'serious'); assert.equal(ben.timeline.find((t) => t.type === 'blur')!.kind, 'small');
  assert.equal(items[2].timeline[0].kind, 'lecturer', 'a let-back-in is shown as the lecturer\'s own');
});

test('decisions are kept per student, decided ones move down, and a closed test cannot give time back', () => {
  const students = [stu('b', 'Ben', { end_reason: 'screenshot', violation_count: 3 }), stu('c', 'Cy', { end_reason: 'devtools', violation_count: 3 })];
  const events = [ev('b', 'screenshot', 1), ev('c', 'devtools', 1), ev('c', 'devtools', 2)];
  const d: Record<string, StoredDecision> = { c: { decision: 'dismissed', note: 'It was a school app', at: 'x', by: 'u', gaveMinutes: 10 } };
  const items = buildReview(rep(students, events), d, {});
  assert.deepEqual(items.map((i) => [i.name, i.decision]), [['Ben', 'open'], ['Cy', 'dismissed']], 'what still needs a decision comes first');
  assert.equal(items[1].note, 'It was a school app'); assert.equal(items[1].gaveMinutes, 10);
  const closed = buildReview(rep(students, events, 'ended'), {}, {});
  assert.ok(closed.every((i) => !i.canRestore), 'after the test is closed nobody can be let back in (unless their own time is left)');
  const left = buildReview(rep([{ ...students[0], deadline_at: new Date(Date.now() + 600_000).toISOString() }], events, 'ended'), {}, {});
  assert.ok(left[0].canRestore, 'but a student whose own time has not run out still can');
});
