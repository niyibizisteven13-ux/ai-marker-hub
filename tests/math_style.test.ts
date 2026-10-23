import test from 'node:test';
import assert from 'node:assert/strict';
import { looksMathematical, mathStyle } from '../server/services/prompts/mathStyle.ts';

test('maths layout rules are added for maths questions only', () => {
  for (const q of ["Solve (t^3 + e^y) y' = 3t^2", 'integrate x^2 from 0 to 1', 'Find the derivative of sin x', 'What is $\\frac{1}{2}$ of 8?']) assert.ok(looksMathematical(q), q);
  for (const q of ['Hello, how are you?', 'Mark these scripts', 'Create a survey about campus services']) assert.ok(!looksMathematical(q), q);
  assert.match(mathStyle('telegram'), /\$\$\.\.\.\$\$ on ONE line/);
  assert.match(mathStyle('telegram'), /do not add a plain-text or "Unicode:" copy/);
  assert.doesNotMatch(mathStyle('web'), /Unicode/);
});
