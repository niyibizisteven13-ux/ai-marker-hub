import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFallbackMarkResults, buildFallbackChatReply } from '../src/utils/aiFallback.ts';

test('buildFallbackMarkResults returns structured fallback marks when AI is unavailable', () => {
  const examPaper = {
    questions: [
      { id: 'q1', number: 'Q1', maxMarks: 6, modelAnswer: 'Newton second law' },
    ],
  };

  const studentScript = {
    answers: [{ questionId: 'q1', answerText: 'I used Newtons law to solve it.' }],
  };

  const results = buildFallbackMarkResults(examPaper, studentScript);

  assert.equal(results.length, 1);
  assert.equal(results[0].questionNumber, 'Q1');
  assert.equal(results[0].flag, 'needs_teacher_review');
  assert.ok(results[0].feedbackToStudent.includes('manually'));
});

test('buildFallbackChatReply produces a helpful offline response', () => {
  const reply = buildFallbackChatReply('How do I grade this answer?');
  assert.match(reply, /offline|temporarily unavailable|review/i);
});
