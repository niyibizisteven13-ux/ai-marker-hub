import test from 'node:test';
import assert from 'node:assert/strict';

import { chatSchema, validate } from '../server/middleware/validation.ts';

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

test('chatSchema accepts learning modes and the page a message comes from', () => {
  chatSchema.parse({ query: 'Explain fractions', learning: { mode: 'socratic', topic: 'fractions' } });
  chatSchema.parse({ query: 'Hola', learning: { mode: 'roleplay', character: 'a vendor', language: 'Spanish', level: 'A2' } });
  chatSchema.parse({ query: 'Add a question about age', surface: 'form', surfaceId: 'f-1' });
  assert.throws(() => chatSchema.parse({ query: 'x', learning: { mode: 'hack' } }));
  assert.throws(() => chatSchema.parse({ query: 'x', surface: 'admin' }));
});


test('invalid chat input returns structured validation issues after the Zod upgrade', () => {
  let status = 0;
  let body: any;
  let nextCalled = false;
  const response = { status(code: number) { status = code; return this; }, json(value: unknown) { body = value; return this; } };
  validate(chatSchema)({ body: { query: 42 } } as any, response as any, () => { nextCalled = true; });
  assert.equal(status, 400);
  assert.equal(nextCalled, false);
  assert.equal(body.error, 'Validation failed');
  assert.ok(body.details.some((issue: any) => issue.path.includes('query')));
});
