/**
 * How Bwenge lays out a worked maths solution. Added to the system prompt only when the message is maths, so
 * other answers are not shaped like a solution. LaTeX is the source format everywhere: the web renders it with
 * KaTeX and the Telegram bot converts it to readable symbols (see telegram/math.ts), so no plain-text copy of
 * each formula is written.
 */

const MATH_HINT = /(\\frac|\\int|\\sqrt|\\sum|\$[^$\n]+\$|\b(solve|equation|integrat\w*|differentiat\w*|derivative|dy\/dx|limit|simplify|factori[sz]e|expand|prove|matrix|eigen\w*|polynomial|quadratic|logarithm|trigonometr\w*|exact (?:equation|differential)|integrating factor|ode|probability|calculate|evaluate|inequalit\w*)\b|\by'|\d\s*[x-z]\s*[\^²³]|[a-z]\^\d|[=<>]\s*-?\d)/i;

export const looksMathematical = (text: string) => MATH_HINT.test(text);

export function mathStyle(channel: 'web' | 'telegram'): string {
  return `[Maths answers]
Lay out a worked solution so it reads cleanly on a phone:
- Inline maths in $...$ (for example $t^3$, $e^{-y}$, $M_y = 0$). Display maths as $$...$$ on ONE line, with a blank line before and after it. Never put $$ alone on a line, and never put words inside $$...$$; use one formula per display block.
- Inside maths use braces for powers and subscripts: $e^{-y}$, $x_{12}$, never $e^-y$.
- Structure for each problem:
  Part X: the problem in $...$
  Method: one sentence.
  Each transformation as its own $$...$$ line, with one short line of explanation between steps.
  Final: the answer as $$...$$.
  Check: one line that verifies the answer (substitute back, differentiate, or test a value).
- Several problems: one "Part" heading each, in order.${channel === 'telegram' ? '\n- This is Telegram: the bot converts the LaTeX to readable symbols itself, so do not add a plain-text or "Unicode:" copy of formulas.' : ''}`;
}
