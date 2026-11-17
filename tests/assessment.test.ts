import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ASSESSMENT, gradeOf, normalizeAssessment, report, scaledMark } from '../shared/assessment.js';

test('the settings are read carefully: only known kinds, sensible marks, a pass mark between 1 and 100', () => {
  assert.deepEqual(normalizeAssessment(undefined), DEFAULT_ASSESSMENT);
  assert.deepEqual(normalizeAssessment({ kind: 'cat', title: '  CAT   1 ', outOf: 20, passPercent: 40, aiMarking: true }), { kind: 'CAT', title: 'CAT 1', outOf: 20, passPercent: 40, aiMarking: true });
  assert.equal(normalizeAssessment({ kind: 'homework' }).kind, 'QUIZ'); assert.equal(normalizeAssessment({ outOf: 0 }).outOf, null); assert.equal(normalizeAssessment({ outOf: 5000 }).outOf, null);
  assert.equal(normalizeAssessment({ outOf: '' }).outOf, null); assert.equal(normalizeAssessment({ outOf: null }).outOf, null); assert.equal(normalizeAssessment({ passPercent: 0 }).passPercent, 50); assert.equal(normalizeAssessment({ passPercent: 101 }).passPercent, 50);
  assert.equal(normalizeAssessment({ aiMarking: 'yes' }).aiMarking, false, 'only a real true switches AI marking on');
  assert.equal(normalizeAssessment({ title: 'x'.repeat(200) }).title.length, 60);
});

test('grades follow the scale and the boundaries belong to the higher grade', () => {
  assert.deepEqual([100, 80, 79.9, 70, 60, 50, 49.9, 40, 39.9, 0].map((p) => gradeOf(p).grade), ['A', 'A', 'B', 'B', 'C', 'D', 'E', 'E', 'F', 'F']);
  assert.equal(gradeOf(NaN).grade, 'F'); assert.equal(gradeOf(85).remark, 'Excellent');
});

test('a CAT is reported out of a round mark to the nearest half, with percent, grade and pass or fail', () => {
  assert.equal(scaledMark(7, 9, 20), 15.5); assert.equal(scaledMark(5, 10, 20), 10); assert.equal(scaledMark(1, 3, 10), 3.5); assert.equal(scaledMark(7, 9, null), 7);
  const cat = { ...DEFAULT_ASSESSMENT, kind: 'CAT' as const, outOf: 20, passPercent: 50 };
  const r = report(7, 9, cat);
  assert.deepEqual([r.percent, r.mark, r.outOf, r.grade, r.passed], [77.8, 15.5, 20, 'B', true]);
  assert.equal(report(4, 10, cat).passed, false); assert.equal(report(5, 10, cat).passed, true, 'exactly the pass mark passes');
  assert.deepEqual(report(0, 0, cat).percent, 0);
});
