import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikePayRef, normalizePayRef, payRef } from '../server/services/billing/payRef.js';

// The payment code a person quotes when paying by hand: the administrator types it to find them.
test('a payment code is short, readable, always the same for one account, and different for others', () => {
  const a = payRef('user-aaa');
  assert.match(a, /^BW-[A-HJKMNP-Z2-9]{6}$/, 'no 0, O, 1, I or L to mix up when read aloud');
  assert.equal(payRef('user-aaa'), a, 'stable: no storage needed');
  const many = new Set(Array.from({ length: 2000 }, (_, i) => payRef(`user-${i}`)));
  assert.ok(many.size > 1990, 'collisions are very rare');
  assert.notEqual(payRef('user-bbb'), a);
});

test('the administrator may type the code in any case, with or without the dash, and plain words are not mistaken for it', () => {
  const code = payRef('user-aaa');
  for (const typed of [code, code.toLowerCase(), code.replace('-', ''), `  ${code.toLowerCase()} `]) { assert.equal(looksLikePayRef(typed), true, typed); assert.equal(normalizePayRef(typed), code, typed); }
  for (const text of ['steven', 'a@b.rw', 'bw-12', 'bw-abcdefg', 'bwenge']) assert.equal(looksLikePayRef(text), false, text);
});
