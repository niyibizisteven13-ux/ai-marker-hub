import { CHOICE_KINDS, normalizeFields, readSchema, type Field } from './model.js';
import { checkDefinition } from './validation.js';

/**
 * Pre-publication review: a checklist of definite errors and suggestions, and a readiness score
 *   Q = 0.25 C + 0.20 V + 0.20 L + 0.20 P + 0.15 A   (each 0–100)
 * C completeness, V validation coverage, L logical consistency, P privacy and consent, A accessibility and wording.
 * The score is a quality checklist, not a guarantee of scientific validity or legal compliance; critical issues are
 * listed separately whatever the score. Wording checks are heuristics: two similar questions may be intentional.
 */

export type Level = 'critical' | 'error' | 'warning' | 'suggestion';
export interface Finding { level: Level; area: 'completeness' | 'validation' | 'logic' | 'privacy' | 'wording'; question?: string; finding: string; recommendation: string }
export interface Review { score: number; parts: { completeness: number; validation: number; logic: number; privacy: number; accessibility: number }; ready: boolean; findings: Finding[]; questions: number; sections: number }

const PII = /\b(full\s+name|your\s+name|first\s+name|surname|last\s+name|phone|telephone|mobile|e-?mail|address|national\s+id|id\s+number|passport|date\s+of\s+birth|birth\s*date|student\s+(?:id|number)|reg(?:istration)?\s*(?:no|number))\b/i;
const SENSITIVE = /\b(hiv|aids|religio\w*|ethnic\w*|tribe|sexual|disabilit\w*|criminal|mental\s+health|pregnan\w*|political\s+(?:party|affiliation))\b/i;
const CONSENT = /\b(consent|agree to (?:take part|participate)|voluntary|confidential|privacy|data will be used|anonymous)\b/i;
const NUMERIC_WORDS = /\b(how\s+many|how\s+much|age|amount|number\s+of|years?\s+of|income|expenditure|price|cost|hours|salary|rwf|frw|kg|km)\b/i;
const LEADING = /^(don'?t you|wouldn'?t you|isn'?t it|do you agree that|surely|why do you (?:love|like))/i;
const BARREL = /\b(and|or)\b/i;

export function reviewForm(schemaInput: unknown): Review {
  const s = readSchema(schemaInput);
  const fields = normalizeFields(s);
  const def = checkDefinition(s);
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);
  const q = (f: Field) => f.label.slice(0, 80);

  // Completeness
  let c = 100;
  if (!String(s.title ?? '').trim() || /^untitled/i.test(String(s.title))) { c -= 25; add({ level: 'error', area: 'completeness', finding: 'The form has no title.', recommendation: 'Give it a clear title that says what it is for.' }); }
  if (!String(s.description ?? '').trim()) { c -= 20; add({ level: 'warning', area: 'completeness', finding: 'There is no introduction.', recommendation: 'Explain who should answer, why, and how long it takes.' }); }
  if (!fields.length) c = 0;
  for (const f of fields) {
    if (CHOICE_KINDS.has(f.kind) && f.options.length >= 2 && !f.allowOther && !f.options.some((o) => /\b(other|none|not applicable|n\/a|prefer not)\b/i.test(o)) && f.options.length < 12 && /\b(which|what)\b/i.test(f.label)) {
      c -= 4; add({ level: 'suggestion', area: 'completeness', question: q(f), finding: 'No "Other" or "None" option.', recommendation: 'Add "Other (please specify)" if the list may not cover every answer.' });
    }
  }
  // Validation coverage
  let v = 100;
  const numeric = fields.filter((f) => f.kind === 'number');
  for (const f of numeric) if (f.min === undefined || f.max === undefined) { v -= 12; add({ level: 'warning', area: 'validation', question: q(f), finding: 'A number without a minimum and maximum.', recommendation: 'Add realistic limits (for example age 16–100) to catch typing mistakes.' }); }
  for (const f of fields) {
    if (f.kind === 'text' && NUMERIC_WORDS.test(f.label) && !/\bname\b/i.test(f.label)) { v -= 10; add({ level: 'warning', area: 'validation', question: q(f), finding: 'Looks like a number but accepts any text.', recommendation: 'Make it a Number question (with a unit and limits) so it can be analysed.' }); }
    if (f.kind === 'text' && /\be-?mail\b/i.test(f.label)) { v -= 8; add({ level: 'warning', area: 'validation', question: q(f), finding: 'An email address in a plain text question.', recommendation: 'Use the Email question type so addresses are checked.' }); }
    if (f.kind === 'text' && /\b(phone|telephone|mobile)\b/i.test(f.label)) { v -= 8; add({ level: 'warning', area: 'validation', question: q(f), finding: 'A phone number in a plain text question.', recommendation: 'Use the Phone question type so numbers are checked.' }); }
  }
  if (fields.length && !fields.some((f) => f.required)) { v -= 15; add({ level: 'warning', area: 'validation', finding: 'No question is required.', recommendation: 'Mark the questions you cannot analyse without as required.' }); }
  // Logic
  let l = 100;
  for (const e of def.errors) { l -= 25; add({ level: 'error', area: 'logic', finding: e, recommendation: 'Fix this before publishing.' }); }
  const seen = new Map<string, string>();
  for (const f of fields) {
    const k = f.label.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (seen.has(k)) { l -= 5; add({ level: 'suggestion', area: 'logic', question: q(f), finding: 'The same question appears twice.', recommendation: 'Keep both only if repeating it is intentional (for example a validated scale).' }); }
    seen.set(k, f.id);
  }
  // Privacy and consent
  let p = 100;
  const pii = fields.filter((f) => f.kind === 'email' || f.kind === 'tel' || PII.test(f.label));
  const sensitive = fields.filter((f) => SENSITIVE.test(f.label));
  const consent = CONSENT.test(String(s.description ?? '')) || fields.some((f) => CONSENT.test(f.label));
  if ((pii.length || s.collectEmail) && !consent) { p -= 50; add({ level: 'critical', area: 'privacy', finding: `The form collects personal information (${pii.slice(0, 3).map((f) => `"${q(f)}"`).join(', ') || 'email addresses'}) without saying how it is used.`, recommendation: 'Add a short consent and privacy statement in the introduction (purpose, who sees the answers, how long they are kept), or a consent question.' }); }
  if (sensitive.length) { p -= 20; add({ level: sensitive.length && !consent ? 'critical' : 'warning', area: 'privacy', question: q(sensitive[0]), finding: 'Sensitive personal information is asked.', recommendation: 'Only ask it if the study needs it, make it optional with "Prefer not to say", and explain the safeguards.' }); }
  if (pii.length > 3) { p -= 10; add({ level: 'suggestion', area: 'privacy', finding: `${pii.length} questions collect identifying details.`, recommendation: 'Collect only what you need; anonymous responses are often enough for research.' }); }
  // Accessibility and wording
  let a = 100;
  for (const f of fields) {
    const words = f.label.split(/\s+/).length;
    if (words > 30) { a -= 6; add({ level: 'suggestion', area: 'wording', question: q(f), finding: `Long question (${words} words).`, recommendation: 'Shorten it or move details into the description.' }); }
    if (LEADING.test(f.label.trim())) { a -= 8; add({ level: 'warning', area: 'wording', question: q(f), finding: 'Leading wording suggests an answer.', recommendation: 'Rephrase neutrally, for example "How satisfied are you with …?".' }); }
    if (f.kind !== 'checkbox' && /\?\s*$/.test(f.label) && BARREL.test(f.label) && /\b(and|or)\b.*\b(and|or|is|are|was|were)\b/i.test(f.label) && (/\b(satisf|agree|rate|good|affordable|easy|quality)\w*\b.*\b(and)\b/i.test(f.label))) {
      a -= 8; add({ level: 'warning', area: 'wording', question: q(f), finding: 'May ask two things at once (double-barrelled).', recommendation: 'Split it into two questions so each answer means one thing.' });
    }
    if (f.kind === 'linear_scale' && !(readSchema(schemaInput).fields ?? []).find((x: any) => String(x.id) === f.id && x.scaleMinLabel && x.scaleMaxLabel)) { a -= 4; add({ level: 'suggestion', area: 'wording', question: q(f), finding: 'The scale ends have no labels.', recommendation: 'Label both ends (for example "Very dissatisfied" and "Very satisfied").' }); }
    if (f.kind === 'radio' && f.options.length > 12) { a -= 4; add({ level: 'suggestion', area: 'wording', question: q(f), finding: `${f.options.length} options in a list.`, recommendation: 'Use a dropdown for long lists.' }); }
  }
  if (fields.length > 40) { a -= 10; add({ level: 'suggestion', area: 'wording', finding: `${fields.length} questions; long forms lose respondents.`, recommendation: 'Remove questions you will not analyse, or split the form into sections.' }); }

  const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));
  const parts = { completeness: clamp(c), validation: clamp(v), logic: clamp(l), privacy: clamp(p), accessibility: clamp(a) };
  const score = clamp(0.25 * parts.completeness + 0.2 * parts.validation + 0.2 * parts.logic + 0.2 * parts.privacy + 0.15 * parts.accessibility);
  const order: Record<Level, number> = { critical: 0, error: 1, warning: 2, suggestion: 3 };
  findings.sort((x, y) => order[x.level] - order[y.level]);
  const sections = new Set(fields.map((f) => f.section).filter(Boolean)).size;
  return { score, parts, ready: !findings.some((f) => f.level === 'critical' || f.level === 'error'), findings, questions: fields.length, sections };
}
