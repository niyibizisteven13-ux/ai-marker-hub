import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPool, normalizePicks, poolExcluded, poolGroups } from '../shared/formPool.js';

const qs = [
  ...Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, poolGroup: 'A' })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, poolGroup: 'B' })),
  { id: 'fixed1' }, { id: 'fixed2' },
];
const picks = { A: 4, B: 2 };
const kept = (seed: string) => qs.filter((q) => !poolExcluded(qs, picks, seed).has(q.id)).map((q) => q.id);

test('each student gets the requested number from each pool, plus every question outside a pool', () => {
  const k = kept('student-1');
  assert.equal(k.filter((x) => x.startsWith('a')).length, 4);
  assert.equal(k.filter((x) => x.startsWith('b')).length, 2);
  assert.ok(k.includes('fixed1') && k.includes('fixed2'));
});

test('the draw is repeatable for a seed and different between students', () => {
  assert.deepEqual(kept('s1'), kept('s1'));
  const draws = new Set(Array.from({ length: 30 }, (_, i) => kept(`student-${i}`).join(',')));
  assert.ok(draws.size > 20, `30 students got ${draws.size} different papers`);
  // Every question gets used about equally across many students (a fair draw, not always the first ones).
  const used: Record<string, number> = {};
  for (let i = 0; i < 400; i++) kept(`x${i}`).forEach((id) => { used[id] = (used[id] ?? 0) + 1; });
  for (let i = 0; i < 10; i++) assert.ok(used[`a${i}`] > 400 * 0.4 * 0.6 && used[`a${i}`] < 400 * 0.4 * 1.5, `a${i} used ${used[`a${i}`]} times`);
});

test('a pick larger than the pool means all of it; no picks means no change', () => {
  assert.equal(poolExcluded(qs, { A: 99 }, 's').size, 0);
  assert.equal(poolExcluded(qs, undefined, 's').size, 0);
  const schema = { fields: qs, poolPicks: { A: 4 } };
  assert.equal(applyPool(schema, 's').fields.length, qs.length - 6);
  assert.equal(applyPool({ fields: qs }, 's').fields.length, qs.length);
  // questions[] works too (older forms use number instead of id)
  assert.equal(applyPool({ questions: [{ number: 1, poolGroup: 'A' }, { number: 2, poolGroup: 'A' }, { number: 3 }], poolPicks: { A: 1 } }, 's').questions.length, 2);
});

test('picks are cleaned: only known pools, whole numbers at least 1', () => {
  assert.deepEqual(normalizePicks({ A: 3.6, B: 0, Z: 5, C: 'x' }, qs), { A: 4 });
  assert.deepEqual(poolGroups(qs), [{ group: 'A', count: 10 }, { group: 'B', count: 6 }]);
  assert.deepEqual(normalizePicks(null), {});
});

test('marking only counts the questions the student was given (the server repeats the draw from the seed)', async () => {
  const { gradeQuiz } = await import('../server/services/forms/quiz.js');
  const { validateSubmission } = await import('../server/services/forms/validation.js');
  const fields = Array.from({ length: 6 }, (_, i) => ({ id: `q${i}`, type: 'radio', label: `Q${i}`, options: ['A', 'B'], required: true, points: 2, correctAnswer: 'A', poolGroup: 'P' }));
  const schema = { isQuiz: true, fields, poolPicks: { P: 3 } };
  const given = applyPool(schema, 'student-7');
  assert.equal(given.fields.length, 3);
  const answers = Object.fromEntries(given.fields.map((f: any) => [f.id, 'A']));
  // The student answered only what they were given: valid, and every answer is right.
  const ok = validateSubmission(given, answers);
  assert.equal('error' in ok ? 'x' : 'ok', 'ok', 'questions they were not given are not required');
  const graded = gradeQuiz(given, answers)!;
  assert.deepEqual([graded.score, graded.maxScore, graded.percent], [6, 6, 100], 'out of the 3 given, not all 6');
  // A different seed gives a different paper, and answers to questions outside it are not stored or marked.
  const other = applyPool(schema, 'student-8');
  assert.notDeepEqual(other.fields.map((f: any) => f.id), given.fields.map((f: any) => f.id));
  const v = validateSubmission(other, { ...answers });
  if (!('error' in v)) assert.ok(Object.keys(v.values).every((id) => other.fields.some((f: any) => f.id === id)), 'answers outside the paper are dropped');
});
