/**
 * Arithmetic consistency checks on transcribed mathematics. This is *algebraic* verification and is kept
 * separate from *transcription* verification: an inconsistency means either the writer made an
 * arithmetic error or a number was misread, and a consistent result does not prove the reading is right.
 *
 * Supports numbers (1,234.5 / 12.5% / thousands separators), + − × · * ÷ / ^, parentheses and variables
 * with a single known value. Uses its own parser; nothing is evaluated with eval().
 */

type Vars = Map<string, number>;

class ParseError extends Error {}

function tokenize(src: string): string[] {
  const s = src
    .replace(/\\times|\\cdot|×|·|∗/g, '*').replace(/\\div|÷/g, '/').replace(/−|–/g, '-')
    .replace(/\\left|\\right|\\,|\\;|\\!/g, '').replace(/\{|\}/g, (m) => (m === '{' ? '(' : ')'))
    .replace(/(\d),(\d{3})(?!\d)/g, '$1$2');
  const tokens = s.match(/\d+(?:\.\d+)?%?|[A-Za-z][A-Za-z0-9_]*|\\frac|[()+\-*/^]|\S/g) ?? [];
  return tokens;
}

/** Recursive-descent evaluator. Returns null if the expression uses unknown variables or functions. */
export function evaluate(expr: string, vars: Vars = new Map()): number | null {
  let tokens: string[];
  try { tokens = tokenize(expr); } catch { return null; }
  let i = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++];
  // Implicit multiplication: "2P", "2(3)", "P Q"
  const startsFactor = (t?: string) => !!t && (/^\d/.test(t) || /^[A-Za-z]/.test(t) || t === '(' || t === '\\frac');
  function primary(): number {
    const t = take();
    if (t === undefined) throw new ParseError('end');
    if (t === '(') { const v = sum(); if (take() !== ')') throw new ParseError(')'); return v; }
    if (t === '-') return -factor();
    if (t === '+') return factor();
    if (t === '\\frac') { const a = primary(); const b = primary(); return a / b; }
    if (/^\d/.test(t)) return t.endsWith('%') ? Number(t.slice(0, -1)) / 100 : Number(t);
    if (/^[A-Za-z]/.test(t)) {
      if (!vars.has(t)) throw new ParseError(`unknown ${t}`);
      return vars.get(t)!;
    }
    throw new ParseError(`unexpected ${t}`);
  }
  function factor(): number {
    const base = primary();
    if (peek() === '^') { take(); return base ** factor(); }
    return base;
  }
  function product(): number {
    let v = factor();
    for (;;) {
      const t = peek();
      if (t === '*' || t === '/') { take(); const r = factor(); v = t === '*' ? v * r : v / r; }
      else if (startsFactor(t)) v *= factor();
      else return v;
    }
  }
  function sum(): number {
    let v = product();
    while (peek() === '+' || peek() === '-') { const t = take(); const r = product(); v = t === '+' ? v + r : v - r; }
    return v;
  }
  // "200 x 5" and "P x Q" are common handwriting for multiplication: a lone x between two operands is ×
  // unless x is itself a known variable.
  const operand = (t?: string) => !!t && (/^\d/.test(t) || /^[A-Za-z]/.test(t) || t === '(' || t === ')');
  if (!vars.has('x')) tokens = tokens.map((t, k) => (t === 'x' && k > 0 && operand(tokens[k - 1]) && tokens[k - 1] !== '(' && operand(tokens[k + 1]) && tokens[k + 1] !== ')' ? '*' : t));
  try {
    const v = sum();
    if (i !== tokens.length) return null;
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

const decimals = (s: string) => {
  const m = /\d+\.(\d+)/.exec(s.replace(/,/g, ''));
  return m ? m[1].length : 0;
};

/** Equal up to the precision the writer used on the stated side (e.g. "= 3.33" for 10/3). */
function agrees(stated: number, statedText: string, computed: number): boolean {
  const d = decimals(statedText);
  const tol = d > 0 ? 0.5 * 10 ** -d + 1e-12 : Math.max(1e-9, Math.abs(computed) * 1e-9);
  return Math.abs(stated - computed) <= tol;
}

export interface Assignment { name: string; value: number; source: string }

const ASSIGN = /(?:^|[\s,;(])([A-Za-z][A-Za-z0-9_]{0,5})\s*=\s*(-?\d[\d,]*(?:\.\d+)?%?)(?![\d.]*\s*[*×x·/+^(-]\s*\d)/g;

/** Collects variables assigned a single numeric value across the document; conflicting values are dropped. */
export function collectAssignments(texts: Array<{ id: string; text: string }>): { vars: Vars; conflicts: string[]; assignments: Assignment[] } {
  const seen = new Map<string, Set<number>>();
  const assignments: Assignment[] = [];
  for (const { id, text } of texts) {
    for (const m of text.replace(/−/g, '-').matchAll(ASSIGN)) {
      const raw = m[2].replace(/,/g, '');
      const v = raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw);
      if (!Number.isFinite(v)) continue;
      if (!seen.has(m[1])) seen.set(m[1], new Set());
      seen.get(m[1])!.add(v);
      assignments.push({ name: m[1], value: v, source: id });
    }
  }
  const vars: Vars = new Map();
  const conflicts: string[] = [];
  for (const [k, vs] of seen) {
    if (vs.size === 1) vars.set(k, [...vs][0]);
    else conflicts.push(k);
  }
  return { vars, conflicts, assignments };
}

const NUM = String.raw`\(?\s*-?\d[\d,]*(?:\.\d+)?%?\s*\)?`;
const OP = String.raw`\s*(?:[+\-*/×÷·^]|\bx\b)\s*`;
const TRAILING_NUMERIC = new RegExp(`${NUM}(?:${OP}${NUM})*\s*$`);
const LEADING_NUMERIC = new RegExp(`^\s*${NUM}(?:${OP}${NUM})*`);

export interface MathCheck {
  status: 'consistent' | 'inconsistent' | 'not_checkable';
  checks: Array<{ expression: string; left: number; right: number; ok: boolean }>;
  note?: string;
}

/**
 * Checks every "a = b (= c …)" chain in a line where both sides can be evaluated
 * (numbers, or variables with one known value elsewhere in the document).
 */
export function checkMath(text: string, vars: Vars = new Map()): MathCheck {
  const checks: MathCheck['checks'] = [];
  const lines = text.replace(/\\\\/g, '\n').split(/\n|;|,(?!\d{3})|\bthen\b|\bso\b|\btherefore\b|∴/i);
  for (const line of lines) {
    if (!line.includes('=')) continue;
    const parts = line.split(/=/).map((p) => p.replace(/^[^\dA-Za-z(\\−-]+|[^\d%A-Za-z)}]+$/g, '').trim()).filter(Boolean);
    if (parts.length < 2) continue;
    // In prose ("Revenue is 200 × 5 = 1000 francs") fall back to the numeric expression next to the "=".
    const values = parts.map((p, k) => {
      const v = evaluate(p, vars);
      if (v !== null) return { text: p, v };
      const chunk = (k > 0 ? LEADING_NUMERIC.exec(p)?.[0] : TRAILING_NUMERIC.exec(p)?.[0])?.trim();
      return chunk && /\d/.test(chunk) ? { text: chunk, v: evaluate(chunk, vars) } : { text: p, v: null };
    });
    for (let k = 1; k < values.length; k++) {
      const a = values[k - 1];
      const b = values[k];
      if (a.v === null || b.v === null) continue;
      // A bare assignment ("P = 200") is a definition, not something to check.
      if (/^[A-Za-z][A-Za-z0-9_]*$/.test(a.text) && /^-?\d[\d,]*(\.\d+)?%?$/.test(b.text) && values.length === 2) continue;
      const statedIsNumber = /^-?\d[\d,]*(\.\d+)?%?$/.test(b.text);
      const ok = statedIsNumber ? agrees(b.v, b.text, a.v) : agrees(a.v, a.text, b.v) || Math.abs(a.v - b.v) <= 1e-9 * Math.max(1, Math.abs(a.v));
      checks.push({ expression: `${a.text} = ${b.text}`, left: a.v, right: b.v, ok });
    }
  }
  if (!checks.length) return { status: 'not_checkable', checks };
  const bad = checks.filter((c) => !c.ok);
  return {
    status: bad.length ? 'inconsistent' : 'consistent', checks,
    note: bad.length ? 'Either the writer made an arithmetic error or a number was misread; compare with the original.' : 'The arithmetic is consistent; this does not prove the numbers were read correctly.',
  };
}
