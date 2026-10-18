import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTask, runEvaluation, wilsonInterval } from '../evals/runner.ts';

test('offline evaluation runs each synthetic dev task three times without calling a model', async () => {
  const result = await runEvaluation({ split: 'dev', report: false });

  assert.ok(result.tasks.length >= 15);
  assert.ok(result.tasks.every((task) => task.runs.length === 3));
  assert.equal(result.metrics.passCount, result.metrics.caseCount);
  assert.equal(result.metrics.instabilityRate, 0);
  assert.deepEqual(result.reportPaths, []);
});

test('retrieval grader detects a missing relevant passage', async () => {
  const observation = await evaluateTask({
    id: 'miss',
    capability: 'A',
    split: 'dev',
    language: 'EN',
    difficulty: 'easy',
    evaluator: {
      kind: 'retrieval',
      query: 'Rwanda GDP growth',
      chunks: [{ id: 'unrelated', text: 'School admission requirements.' }],
      relevantChunkIds: ['gdp'],
      topK: 1,
      minimumRecall: 1,
    },
  });

  assert.equal(observation.passed, false);
  assert.equal(observation.details.recallAtK, 0);
});

test('unanswerable retrieval task requires an empty result set', async () => {
  const observation = await evaluateTask({
    id: 'no-match',
    capability: 'A',
    split: 'dev',
    language: 'EN',
    difficulty: 'easy',
    evaluator: {
      kind: 'retrieval-no-match',
      query: 'How many quasar zephyrs orbited Kigali in 1982?',
      chunks: [
        { id: 'school', text: 'School enrollment and admission requirements.' },
        { id: 'budget', text: 'The annual budget funds roads and public services.' },
      ],
      topK: 2,
    },
  });

  assert.equal(observation.passed, true);
  assert.deepEqual(observation.details.retrievedChunkIds, []);
});

test('Wilson confidence interval is null for empty data and bounds a small sample', () => {
  assert.equal(wilsonInterval(0, 0), null);
  const interval = wilsonInterval(8, 8);
  assert.ok(interval);
  assert.ok(interval[0] < 1);
  assert.equal(interval[1], 1);
});
