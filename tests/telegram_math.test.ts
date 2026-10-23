import test from 'node:test';
import assert from 'node:assert/strict';
import { latexToText } from '../server/services/telegram/math.ts';
import { markdownToHtml } from '../server/services/telegram/format.ts';

test('LaTeX becomes readable symbols for Telegram', () => {
  assert.equal(latexToText('x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}'), 'x = (-b ± √(b²-4ac))/(2a)');
  assert.equal(latexToText('E=mc^2'), 'E = mc²');
  assert.equal(latexToText('\\int_0^1 x^2\\,dx = \\frac{1}{3}'), '∫₀¹ x² dx = 1/3');
  assert.equal(latexToText('\\alpha_1 \\leq \\gamma^{n+1}'), 'α₁ ≤ γⁿ⁺¹');
  assert.equal(latexToText('\\text{Area} = \\pi r^2'), 'Area = π r²');
});

test('Telegram messages: inline and display maths converted, money left alone, HTML escaped', () => {
  const html = markdownToHtml('Roots of $ax^2+bx+c=0$:\n$$\nx = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\n$$\nIt costs $5 and $10. Also $a < b$ and $x_i$.');
  assert.match(html, /Roots of ax²\+bx\+c = 0:/);
  assert.match(html, /<pre>x = \(-b ± √\(b²-4ac\)\)\/\(2a\)<\/pre>/);
  assert.match(html, /It costs \$5 and \$10\./);
  assert.match(html, /a &lt; b/);
  assert.match(html, /xᵢ/);
  assert.doesNotMatch(html, /\\frac|\$\$/);
});
