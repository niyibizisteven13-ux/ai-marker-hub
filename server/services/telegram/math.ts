/**
 * LaTeX → readable Unicode for Telegram, which renders no maths. The AI writes standard LaTeX ($…$ inline,
 * $$…$$ display, as on the web where KaTeX renders it); here x^2 becomes x², \frac{a+b}{2} becomes (a+b)/2,
 * \sqrt{x} becomes √x and Greek letters and operators become their symbols. Unknown commands keep their name
 * without the backslash, so nothing turns into unreadable markup.
 */

const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ',
  phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  pm: '±', mp: '∓', times: '×', cdot: '·', div: '÷', ast: '∗', circ: '∘', bullet: '•',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝',
  ll: '≪', gg: '≫', infty: '∞', partial: '∂', nabla: '∇', degree: '°',
  to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐', leftrightarrow: '↔', Leftrightarrow: '⇔', implies: '⇒', iff: '⇔', mapsto: '↦',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', supset: '⊃', cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅',
  forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨', wedge: '∧', vee: '∨', angle: '∠', perp: '⊥', parallel: '∥',
  sum: 'Σ', prod: 'Π', int: '∫', iint: '∬', oint: '∮', ldots: '…', cdots: '⋯', dots: '…', vdots: '⋮',
  langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', prime: '′', hbar: 'ħ', ell: 'ℓ',
  quad: '  ', qquad: '    ', ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ', '{': '{', '}': '}', '%': '%', '$': '$', '&': '&', '#': '#', '_': '_',
  lbrace: '{', rbrace: '}', backslash: '\\', mid: '|', vert: '|', Vert: '‖',
};
const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'exp', 'lim', 'max', 'min', 'det', 'gcd', 'mod', 'deg']);
const TEXT_ARG = new Set(['text', 'textrm', 'textbf', 'textit', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'operatorname', 'boldsymbol', 'bm', 'mbox', 'mathbb', 'mathcal', 'vec', 'hat', 'bar', 'overline', 'underline', 'tilde', 'dot', 'ddot']);
const DROP = new Set(['left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'displaystyle', 'textstyle', 'limits', 'nolimits']);

const SUP: Record<string, string> = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', x: 'ˣ', y: 'ʸ', k: 'ᵏ', m: 'ᵐ', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', t: 'ᵗ', T: 'ᵀ', '°': '°', '′': '′', '∘': '°' };
const SUB: Record<string, string> = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', n: 'ₙ', m: 'ₘ', o: 'ₒ', r: 'ᵣ', t: 'ₜ', x: 'ₓ' };

/** Wraps in parentheses when the expression is more than one simple term. */
const group = (s: string) => (/^(?:\d+(?:[.,]\d+)?|\p{L}′?|[∞°])$/u.test(s) || /^\([^()]*\)$/.test(s) ? s : `(${s})`);
const script = (s: string, map: Record<string, string>, mark: string) => {
  const t = s.trim();
  if (t && [...t].every((c) => map[c])) return [...t].map((c) => map[c]).join('');
  return `${mark}${group(t)}`;
};

export function latexToText(tex: string): string {
  let i = 0;
  const src = tex;
  /** Reads one argument: a {group}, a \command or a single character. */
  const arg = (): string => {
    while (src[i] === ' ') i++;
    if (src[i] === '{') {
      let depth = 0; const start = ++i;
      for (; i < src.length; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { if (depth === 0) break; depth--; }
      }
      return latexToText(src.slice(start, i++));
    }
    if (src[i] === '\\') { const save = i; const c = command(); return c || src.slice(save, i); }
    return src[i++] ?? '';
  };
  const optional = (): string | null => {
    if (src[i] !== '[') return null;
    const end = src.indexOf(']', i);
    if (end < 0) return null;
    const v = latexToText(src.slice(i + 1, end)); i = end + 1; return v;
  };
  const command = (): string => {
    i++; // backslash
    let name = '';
    if (/[a-zA-Z]/.test(src[i] ?? '')) { while (/[a-zA-Z]/.test(src[i] ?? '')) name += src[i++]; } else name = src[i++] ?? '';
    if (name === '\\') return '\n';
    if (DROP.has(name)) return '';
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') { const a = arg(); const b = arg(); return `${group(a)}/${group(b)}`; }
    if (name === 'binom') { const a = arg(); const b = arg(); return `C(${a}, ${b})`; }
    if (name === 'sqrt') { const n = optional(); const x = arg(); return `${n ? script(n, SUP, '') : ''}√${group(x)}`; }
    if (TEXT_ARG.has(name)) return arg();
    if (FUNCTIONS.has(name)) return name;
    if (name in SYMBOLS) return SYMBOLS[name];
    if (name === 'begin' || name === 'end') { arg(); return ''; }
    return name;
  };
  let out = '';
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') out += command();
    else if (c === '^') { i++; out += script(arg(), SUP, '^'); }
    else if (c === '_') { i++; const a = arg(); out += /(lim|max|min|sup|inf)$/.test(out) ? `[${a.trim()}] ` : script(a, SUB, '_'); }
    else if (c === '{') out += arg();
    else if (c === '}') i++;
    else if (c === '&') { out += ' '; i++; }
    else if (c === '~') { out += ' '; i++; }
    else { out += c; i++; }
  }
  return out.replace(/[ \t]{2,}/g, ' ').replace(/ ?([=<>≤≥≠≈±×÷→⇒]) ?/g, ' $1 ').replace(/[ \t]+\n|\n[ \t]+/g, '\n').trim();
}

/** Finds inline $…$ and \(…\) maths in a line; `wrap` receives the converted text. Money ("$5 and $10") is left alone. */
export function inlineMath(text: string, wrap: (math: string) => string = (m) => m): string {
  return text
    .replace(/\\\((.+?)\\\)/g, (_, m) => wrap(latexToText(m)))
    .replace(/(^|[^\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (all, pre, m) => (/[\\^_{}=+\-*/<>a-zA-Z]/.test(m) ? `${pre}${wrap(latexToText(m))}` : all));
}

/** A display-maths block ($$…$$ or \[…\]), or null when the block is something else. */
export function displayMath(block: string): string | null {
  const m = /^\s*(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])\s*$/.exec(block);
  return m ? latexToText(m[1] ?? m[2]) : null;
}
