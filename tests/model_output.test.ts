import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyModelOutputError, nonEmptyModelText } from '../server/services/ai/modelOutput.js';

test('empty model summaries and translations produce retryable errors, not canned success', () => {
  for (const value of ['', ' \n ', null, undefined, { text: 'not a string' }]) {
    assert.equal(nonEmptyModelText(value), null);
  }
  assert.deepEqual(emptyModelOutputError('summary'), {
    success: false,
    error: { code: 'EMPTY_MODEL_OUTPUT', message: 'Summarization returned no text. Please retry.' },
    retryable: true,
  });
  assert.deepEqual(emptyModelOutputError('translation'), {
    success: false,
    error: { code: 'EMPTY_MODEL_OUTPUT', message: 'Translation returned no text. Please retry.' },
    retryable: true,
  });
});

test('non-empty model output is returned exactly after trimming', () => {
  assert.equal(nonEmptyModelText('  Verified response.  '), 'Verified response.');
});
