import test from 'node:test';
import assert from 'node:assert/strict';

import { chatSchema } from '../server/middleware/validation.ts';

test('chatSchema accepts undefined sentinel values produced by FormData', () => {
  assert.doesNotThrow(() => {
    chatSchema.parse({
      query: 'hello',
      activeFormId: 'undefined',
      provider: 'undefined',
      attachmentIds: 'undefined',
    });
  });
});
