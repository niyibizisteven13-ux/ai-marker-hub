import test from 'node:test';
import assert from 'node:assert/strict';
import { getFileUrlSecret, getJwtSecret } from '../server/auth/secrets.js';

test('production requires configured JWT and file URL secrets', () => {
  assert.throws(() => getJwtSecret({ NODE_ENV: 'production' }), /JWT_SECRET must be configured/);
  assert.throws(() => getFileUrlSecret({ NODE_ENV: 'production' }), /FILE_URL_SECRET must be configured/);
  assert.equal(getJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'configured-jwt-secret-with-at-least-32-chars' }), 'configured-jwt-secret-with-at-least-32-chars');
});

test('non-production secret fallbacks are random and stable only for the process', () => {
  const jwtSecret = getJwtSecret({ NODE_ENV: 'test' });
  const fileUrlSecret = getFileUrlSecret({ NODE_ENV: 'test' });
  assert.equal(jwtSecret.length, 64);
  assert.equal(fileUrlSecret.length, 64);
  assert.equal(getJwtSecret({ NODE_ENV: 'test' }), jwtSecret);
  assert.equal(getFileUrlSecret({ NODE_ENV: 'test' }), fileUrlSecret);
  assert.notEqual(jwtSecret, fileUrlSecret);
});
