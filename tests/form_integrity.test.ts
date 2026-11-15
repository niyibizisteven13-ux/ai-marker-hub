import test from 'node:test';
import assert from 'node:assert/strict';
import { integrityFlags, sanitizeReport } from '../shared/formIntegrity.js';

const labels = { q1: 'Explain photosynthesis', q2: 'Name the capital' };
const open = new Set(['q1', 'q2']);
const base = { v: 1 as const, seconds: 600, awayCount: 0, awaySeconds: 0, fields: {} };

test('sanitizeReport keeps only known fields and bounded numbers', () => {
  const r = sanitizeReport({ seconds: -5, awayCount: 1e12, fields: { q1: { typed: 10, pasted: 2, blocked: 1, length: 12, evil: 'x' }, nope: { typed: 1 } }, extra: 'x' }, new Set(['q1']))!;
  assert.equal(r.seconds, 0);
  assert.equal(r.awayCount, 10000);
  assert.deepEqual(Object.keys(r.fields), ['q1']);
  assert.deepEqual(r.fields.q1, { typed: 10, pasted: 2, blocked: 1, length: 12 });
  assert.equal(sanitizeReport('x', new Set()), null);
});

test('a calm, typed-by-hand response has no flags', () => {
  const f = integrityFlags({ ...base, fields: { q1: { typed: 300, pasted: 0, blocked: 0, length: 280 } } }, { labels, openIds: open, questionCount: 5, expected: true });
  assert.deepEqual(f, []);
});

test('pasting, blocked pasting, answers longer than what was typed, leaving the page and speed are flagged', () => {
  const f = integrityFlags({ v: 1, seconds: 4, awayCount: 4, awaySeconds: 90, fields: {
    q1: { typed: 5, pasted: 1, blocked: 0, length: 400 },
    q2: { typed: 0, pasted: 2, blocked: 2, length: 0 },
  } }, { labels, openIds: open, questionCount: 6, expected: true });
  const codes = f.map((x) => `${x.code}${x.fieldId ? `:${x.fieldId}` : ''}`).sort();
  assert.deepEqual(codes, ['LEFT_PAGE', 'PASTED:q1', 'PASTE_BLOCKED:q2', 'TOO_FAST']);
  assert.match(f.find((x) => x.code === 'PASTE_BLOCKED')!.message, /Name the capital/);
  assert.ok(f.filter((x) => x.level === 'review').length >= 3);
});

test('a long answer with little typing and no paste is flagged (autofill, voice-to-text, or a modified page)', () => {
  const f = integrityFlags({ ...base, fields: { q1: { typed: 20, pasted: 0, blocked: 0, length: 300 } } }, { labels, openIds: open, questionCount: 2, expected: true });
  assert.deepEqual(f.map((x) => x.code), ['TYPED_LESS_THAN_ANSWER']);
});

test('a response sent without the form page is noted, and nothing is flagged when protection is off', () => {
  assert.deepEqual(integrityFlags(null, { labels, openIds: open, questionCount: 2, expected: true }).map((x) => x.code), ['NO_SIGNALS']);
  assert.deepEqual(integrityFlags(null, { labels, openIds: open, questionCount: 2, expected: false }), []);
});
