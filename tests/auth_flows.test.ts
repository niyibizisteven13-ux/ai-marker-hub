import test from 'node:test';
import assert from 'node:assert';
import { sanitizeNext } from '../server/auth/sanitizeNext.js';
import { normalizeEmail, generateCode, computeCodeHash } from '../server/auth/emailCode.js';
import { isInAppBrowser, generatePKCE } from '../server/auth/googleAuth.js';

test('sanitizeNext allows valid relative paths and rejects dangerous values', () => {
  assert.strictEqual(sanitizeNext('/chat'), '/chat');
  assert.strictEqual(sanitizeNext('/profile/settings?tab=general'), '/profile/settings?tab=general');
  assert.strictEqual(sanitizeNext('//evil.com'), '/chat');
  assert.strictEqual(sanitizeNext('https://evil.com'), '/chat');
  assert.strictEqual(sanitizeNext('/\\evil'), '/chat');
  assert.strictEqual(sanitizeNext(null), '/chat');
});

test('normalizeEmail normalizes and lowercases correctly', () => {
  assert.strictEqual(normalizeEmail('  TEST.User+1@Gmail.COM  '), 'test.user+1@gmail.com');
});

test('generateCode produces a 6-digit string', () => {
  const code = generateCode();
  assert.strictEqual(code.length, 6);
  assert.match(code, /^\d{6}$/);
});

test('computeCodeHash produces HMAC-SHA256 buffer', () => {
  const hash = computeCodeHash('test@example.com', '123456');
  assert.strictEqual(hash.length, 32); // SHA-256 digest length
});

test('isInAppBrowser detects common in-app browsers', () => {
  assert.strictEqual(isInAppBrowser('Mozilla/5.0 ... FBAV/300.0.0.0'), true);
  assert.strictEqual(isInAppBrowser('Mozilla/5.0 ... Instagram'), true);
  assert.strictEqual(isInAppBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'), false);
});

test('generatePKCE produces valid verifier and challenge', () => {
  const pkce = generatePKCE();
  assert.ok(pkce.verifier.length > 30);
  assert.ok(pkce.challenge.length > 30);
});
