import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAnswerChecks, tooFast } from '../server/services/mySebAnswerChecks.js';
import { buildReview } from '../server/services/mySebReview.js';
import { buildReport, DEFAULT_RULES, EMPTY_USAGE } from '../server/services/mySebAgent.js';

// Answer-pattern checks for a test taken in the live room: matched to students by the name typed in the quiz, never blamed when unclear.
const fields = [
  { id: 'name', label: 'Full name', type: 'text' },
  ...Array.from({ length: 6 }, (_, i) => ({ id: `q${i}`, label: `Question ${i}`, type: 'radio', options: ['A', 'B', 'C', 'D'], correctAnswer: 'A', points: 1 })),
];
const schema = { isQuiz: true, fields };
const resp = (id: string, name: string, answers: Record<string, string>, device?: string) => ({ id, createdAt: '2026-11-17T09:30:00Z', data: JSON.stringify({ name, ...answers, ...(device ? { _device: { id: device } } : {}) }) });
const wrongSame = { q0: 'B', q1: 'C', q2: 'D', q3: 'B', q4: 'C', q5: 'A' };
const live = (id: string, name: string, minutes = 40) => ({ id, student_name: name, status: 'ENDED', end_reason: 'student', started_at: '2026-11-17T09:00:00Z', ended_at: new Date(Date.parse('2026-11-17T09:00:00Z') + minutes * 60_000).toISOString() });

test('the same wrong answers on several questions are flagged on both students, matched by name (in any order or case)', () => {
  const rows = [resp('r1', 'Amy Uwase', wrongSame), resp('r2', 'ben HABIMANA', wrongSame), resp('r3', 'Cy Mugisha', { q0: 'A', q1: 'A', q2: 'A', q3: 'A', q4: 'A', q5: 'A' })];
  const a = computeAnswerChecks(schema, rows, [live('s1', 'Uwase Amy'), live('s2', 'Ben Habimana'), live('s3', 'Cy Mugisha')]);
  assert.match(a.byStudent.s1[0].message, /same wrong answer as ben HABIMANA on \d+ questions/); assert.ok(a.byStudent.s2); assert.equal(a.byStudent.s3, undefined, 'Cy is not flagged');
  assert.deepEqual(a.unmatched, []);
});

test('when the name does not point to exactly one student the flag is listed on its own, not blamed on anyone', () => {
  const rows = [resp('r1', 'Amy Uwase', wrongSame), resp('r2', 'Ben Habimana', wrongSame)];
  const twins = computeAnswerChecks(schema, rows, [live('s1', 'Amy Uwase'), live('s9', 'amy uwase'), live('s2', 'Ben Habimana')]);
  assert.equal(twins.byStudent.s1, undefined); assert.equal(twins.byStudent.s9, undefined); assert.ok(twins.byStudent.s2);
  assert.ok(twins.unmatched.some((u) => u.name === 'Amy Uwase'), 'Amy is listed, with no student attached');
  const none = computeAnswerChecks(schema, rows, [live('s1', 'Somebody Else')]);
  assert.deepEqual(none.byStudent, {}); assert.equal(none.unmatched.length, 2);
});

test('one device used by two people is flagged; finishing far faster than a real class is flagged; small classes are not judged on speed', () => {
  const dev = computeAnswerChecks(schema, [resp('r1', 'Amy', { q0: 'A' }, 'dev-1'), resp('r2', 'Ben', { q0: 'A' }, 'dev-1')], [live('s1', 'Amy'), live('s2', 'Ben')]);
  assert.ok(dev.byStudent.s1.some((f) => /same device as Ben/.test(f.message)));
  const durations = [...Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, ms: (38 + i) * 60_000 })), { id: 'fast', ms: 6 * 60_000 }];
  const fast = tooFast(durations); assert.deepEqual(fast.map((f) => f.id), ['fast']); assert.equal(Math.round(fast[0].medianMs / 60_000), 42);
  assert.deepEqual(tooFast(durations.slice(0, 5)), [], 'fewer than 8 finished: no judgement'); assert.deepEqual(tooFast(durations.map((d) => ({ ...d, ms: d.ms / 10 }))), [], 'a short test (typical time under 5 minutes): no judgement');
  const students = [...Array.from({ length: 9 }, (_, i) => live(`s${i}`, `S${i}`, 38 + i)), live('fast', 'Fay', 6)];
  const a = computeAnswerChecks(schema, [], students);
  assert.match(a.byStudent.fast[0].message, /Finished in 6 min; the class took about 42 min/);
});

test('answer flags bring a student into the review queue, with the explanation in their timeline, and into the report', () => {
  const rep = { exam: { status: 'ended' }, students: [{ id: 's1', student_name: 'Amy', status: 'ENDED', end_reason: 'student', violation_count: 0, started_at: '2026-11-17T09:00:00Z', ended_at: '2026-11-17T09:40:00Z' }, { id: 's2', student_name: 'Cy', status: 'ENDED', end_reason: 'student', violation_count: 0 }], events: [] };
  const answers = { byStudent: { s1: [{ code: 'SHARED_WRONG_ANSWERS', message: 'Gave the same wrong answer as Ben on 5 questions.' }] }, unmatched: [], checked: 2 };
  assert.equal(buildReview(rep, {}, {}, [], undefined as any).length, 0, 'nothing without any signal');
  const items = buildReview(rep, {}, {}, [], answers);
  assert.deepEqual(items.map((i) => i.name), ['Amy']); assert.equal(items[0].timeline[0].kind, 'answers'); assert.match(items[0].timeline[0].words, /^Answer check: Gave the same wrong answer as Ben/); assert.deepEqual(items[0].answerFlags, ['Gave the same wrong answer as Ben on 5 questions.']);
  const text = buildReport('Biology', rep.students as any, { serious: {}, usage: EMPTY_USAGE, log: [], counts: {}, rules: DEFAULT_RULES }, ['Amy: Gave the same wrong answer as Ben on 5 questions.']);
  assert.match(text, /Answers to check[^\n]*\n- Amy: Gave the same wrong answer as Ben on 5 questions\./);
  assert.ok(!/Answers to check/.test(buildReport('Biology', rep.students as any, { serious: {}, usage: EMPTY_USAGE, log: [], counts: {}, rules: DEFAULT_RULES })));
});
