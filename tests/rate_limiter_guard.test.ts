import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const limiterFile = path.join(repoRoot, 'production', 'rateLimiter.js');

test('rate limiter is gated by NODE_ENV and not hardcoded to bypass production', () => {
  const content = fs.readFileSync(limiterFile, 'utf8');
  assert.match(content, /process\.env\.NODE_ENV !== 'production'/, 'Production limiter should respect NODE_ENV rather than forcing bypass.');
  assert.doesNotMatch(content, /const isDev = true/, 'Rate limiter must not be hardcoded to bypass in production.');
});
