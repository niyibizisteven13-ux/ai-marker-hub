import test from 'node:test';
import assert from 'node:assert';
import { normalizePhone, maskPhone, sanitizeNext } from '../src/auth/validators';
import { dictionaries } from '../src/i18n/landing';

test('normalizePhone formats Rwandan numbers correctly', () => {
  assert.strictEqual(normalizePhone('0788123456'), '+250788123456');
  assert.strictEqual(normalizePhone('+250788123456'), '+250788123456');
  assert.strictEqual(normalizePhone('250788123456'), '+250788123456');
  assert.strictEqual(normalizePhone('12345'), null);
});

test('maskPhone masks middle digits correctly', () => {
  assert.strictEqual(maskPhone('+250788123456'), '+2507 ••• •• 56');
});

test('sanitizeNext prevents open redirects', () => {
  assert.strictEqual(sanitizeNext('/chat'), '/chat');
  assert.strictEqual(sanitizeNext('//evil.com'), null);
  assert.strictEqual(sanitizeNext('https://evil.com'), null);
  assert.strictEqual(sanitizeNext('/\\evil'), null);
  assert.strictEqual(sanitizeNext(null), null);
});

test('i18n dictionary key parity between EN, RW, and FR', () => {
  const enKeys = Object.keys(dictionaries.en).sort();
  const rwKeys = Object.keys(dictionaries.rw).sort();
  const frKeys = Object.keys(dictionaries.fr).sort();

  assert.deepStrictEqual(rwKeys, enKeys, 'RW keys must match EN keys');
  assert.deepStrictEqual(frKeys, enKeys, 'FR keys must match EN keys');
});
