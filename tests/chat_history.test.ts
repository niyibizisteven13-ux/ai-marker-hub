import test from 'node:test';
import assert from 'node:assert/strict';
import { fitHistory, sanitizeHistory, MAX_HISTORY_TURNS } from '../server/services/ai/chatHistory.ts';

const turn = (i: number, len = 50) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', text: `turn ${i} `.padEnd(len, 'x') });

test('a short conversation is kept word for word', () => {
  const h = Array.from({ length: 30 }, (_, i) => turn(i));
  assert.deepEqual(fitHistory(h), h);
});

test('a long conversation keeps recent turns and condenses the start, so the first request is not forgotten', () => {
  const h = [{ role: 'user' as const, text: 'Mark these with the S4 maths scheme; give part marks where the method is right.' }, ...Array.from({ length: 199 }, (_, i) => turn(i + 1, 2_000))];
  const out = fitHistory(h, { budget: 40_000 });
  const total = out.reduce((n, t) => n + t.text.length, 0);
  assert.ok(total < 40_000 + 16_000 + 2_500, `fits the budget (${total})`);
  assert.equal(out.at(-1)!.text, h.at(-1)!.text, 'last turn kept as is');
  assert.equal(out[0].role, 'user');
  assert.match(out[0].text, /Earlier in this conversation/);
  assert.match(out[0].text, /part marks where the method is right/, 'the first request survives in the note');
});

test('one very long turn is trimmed in the middle and the last exchange is always kept', () => {
  const big = 'A'.repeat(50_000) + 'END';
  const out = fitHistory([{ role: 'user', text: 'hi' }, { role: 'assistant', text: big }], { budget: 1_000, perTurn: 10_000 });
  assert.equal(out.length, 2);
  assert.ok(out[1].text.length < 10_200);
  assert.ok(out[1].text.endsWith('END'));
  assert.match(out[1].text, /characters of this message left out/);
});

test('sanitizeHistory drops unknown roles, empty and non-string turns, and caps the count', () => {
  const raw = [{ role: 'system', text: 'x' }, { role: 'user', text: '' }, { role: 'user', text: 5 }, null, { role: 'assistant', text: 'ok' }, ...Array.from({ length: MAX_HISTORY_TURNS + 10 }, (_, i) => turn(i))];
  const out = sanitizeHistory(raw);
  assert.equal(out.length, MAX_HISTORY_TURNS);
  assert.ok(out.every((t) => t.role === 'user' || t.role === 'assistant'));
  assert.deepEqual(sanitizeHistory('nope'), []);
});
