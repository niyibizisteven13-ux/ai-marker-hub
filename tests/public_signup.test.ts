import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicSignupAllowed } from '../server/auth/publicSignup.js';

test('public signup is disabled by default in production and can be explicitly controlled', () => {
  assert.equal(isPublicSignupAllowed({ NODE_ENV: 'production' }), false);
  assert.equal(isPublicSignupAllowed({ NODE_ENV: 'production', ALLOW_PUBLIC_SIGNUP: 'false' }), false);
  assert.equal(isPublicSignupAllowed({ NODE_ENV: 'production', ALLOW_PUBLIC_SIGNUP: 'true' }), true);
  assert.equal(isPublicSignupAllowed({ NODE_ENV: 'development' }), true);
});
