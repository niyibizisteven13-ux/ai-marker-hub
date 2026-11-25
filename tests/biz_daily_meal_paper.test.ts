import assert from 'node:assert/strict';
import test from 'node:test';
import { dailyMealPaper } from '../server/services/biz/mealCard.js';

test('every date in a leap year has a distinct, repeatable whole-card background', () => {
  const dates = Array.from({ length: 366 }, (_, day) => new Date(Date.UTC(2028, 0, day + 1)).toISOString().slice(0, 10));
  const colors = dates.map(date => dailyMealPaper(date));
  assert.equal(new Set(colors).size, dates.length);
  assert.deepEqual(dates.map(date => dailyMealPaper(date)), colors);
  assert.notEqual(dailyMealPaper('2028-12-31'), dailyMealPaper('2029-01-01'));
  assert.notEqual(dailyMealPaper('2028-02-29', '#aabbcc'), dailyMealPaper('2028-02-29'));
});

test('the owner can enable daily shuffle, retain it across edits, and disable it again', async () => {
  const { cleanProgram } = await import('../server/services/biz/programs.js');
  const now = '2026-11-25T12:00:00Z';
  const plan = cleanProgram({ title: 'Meals', priceRwf: 30000 }, 'meal', now);
  assert(!('error' in plan));
  assert(!plan.shuffleCardColor);
  const enabled = cleanProgram({ shuffleCardColor: true }, 'meal', now, plan);
  assert(!('error' in enabled) && enabled.shuffleCardColor);
  const updated = cleanProgram({ title: 'Student meals' }, 'meal', now, enabled);
  assert(!('error' in updated) && updated.shuffleCardColor);
  const disabled = cleanProgram({ shuffleCardColor: false }, 'meal', now, updated);
  assert(!('error' in disabled) && !disabled.shuffleCardColor);
});
