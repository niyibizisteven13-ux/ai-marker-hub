import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMarking } from '../server/services/exams/benchmark.js';
test('benchmark separates abstention, error, agreement and unflagged errors', () => {
  const base = { paperId: 'anonymous-1', category: 'handwriting', maxMarks: 5, teacherMarks: 3, flagged: false };
  const report = evaluateMarking([{ ...base, questionId: '1', aiMarks: 3 }, { ...base, questionId: '2', aiMarks: 1 }, { ...base, questionId: '3', aiMarks: null }]);
  assert.equal(report.overall.exactAgreement, 0.5);
  assert.equal(report.overall.meanAbsoluteError, 1);
  assert.equal(report.overall.abstained, 1);
  assert.equal(report.overall.unflaggedErrors, 1);
  assert.throws(() => evaluateMarking([{ ...base, questionId: '1', aiMarks: 8 }]));
});
