import { finalText, type DocumentResult } from '../documents/pipeline.js';
import { questionKey, type MarkingScheme } from './scheme.js';
import type { ReviewFlag } from './types.js';

/**
 * Deterministic answer-to-question matching from the labels candidates write ("2(b)", "Q3", "a)", "(ii)").
 * Unlabelled elements continue the current question, also across pages. When a label is ambiguous (e.g.
 * "1" while the scheme marks 1(a) and 1(b) separately) the element is linked to every candidate question
 * and the marker decides, with a review flag when its evidence disagrees. Nothing is attached silently.
 */

export interface MatchedElement {
  id: string;
  page: number;
  type: string;
  text: string;
  originalText: string;
  corrected: boolean;
  crossedOut: boolean;
  needsReview: boolean;
  uncertainty: 'low' | 'medium' | 'high';
  signals: string[];
  alternates: string[];
  label: string | null;
  questionIds: string[];
  how: 'labelled' | 'continued' | 'unassigned';
  region: { x0: number; y0: number; x1: number; y1: number };
  regionValid: boolean;
  mathNote: string | null;
}

export interface QuestionMatch { questionId: string; elementIds: string[]; pages: number[]; flags: ReviewFlag[] }

export interface MatchResult { elements: MatchedElement[]; questions: Record<string, QuestionMatch>; unassigned: string[] }

const ROMAN = '(?:viii|vii|iii|vi|iv|ix|ii|i|v|x)';
const WORDS = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const MAIN = new RegExp(String.raw`^\s*(?:(?:question|qn|q|exercise|exercice|ikibazo)\s*\.?\s*(\d{1,3}|${WORDS})|(\d{1,3})(?=\s*(?:\.(?!\d)|\)|\(?[a-h]\)|[a-h][.)])))\s*(?:[.)]\s*)?(?:\(?([a-h])\)|([a-h])[.)])?\s*(?:\((${ROMAN})\)|(${ROMAN})\))?\s*[:.)\-–]?\s*`, 'i');
const SUB = /^\s*(?:\(([a-h])\)|([a-h])[.)])\s+/i;
const ROM = new RegExp(String.raw`^\s*(?:\((${ROMAN})\)|(${ROMAN})\))\s*`, 'i');

/** Reads a question label at the start of an element. Exported for tests. */
export function readLabel(text: string): { main?: string; sub?: string; rom?: string } | null {
  let m = MAIN.exec(text);
  if (m) {
    const main = questionKey(m[1] ?? m[2]);
    return { main, sub: (m[3] ?? m[4])?.toLowerCase(), rom: (m[5] ?? m[6])?.toLowerCase() };
  }
  if ((m = SUB.exec(text))) return { sub: (m[1] ?? m[2]).toLowerCase() };
  if ((m = ROM.exec(text))) return { rom: (m[1] ?? m[2]).toLowerCase() };
  return null;
}

export function matchAnswers(doc: DocumentResult, corrections: Array<{ elementId: string; text: string }>, scheme: MarkingScheme): MatchResult {
  const byKey = new Map(scheme.questions.map((q) => [questionKey(q.number), q.id]));
  const keys = [...byKey.keys()];
  const resolve = (main: string | null, sub: string | null, rom: string | null): string[] => {
    if (!main && !sub) return [];
    const parts = [main, sub, rom].filter(Boolean) as string[];
    for (let n = parts.length; n >= 1; n--) {
      const k = parts.slice(0, n).join('.');
      if (byKey.has(k)) return [byKey.get(k)!];
      // A label above the scheme's level (e.g. "1" with 1.a and 1.b in the scheme): every child is a candidate.
      const children = keys.filter((x) => x.startsWith(`${k}.`));
      if (children.length) return children.map((c) => byKey.get(c)!);
    }
    return [];
  };

  const elements: MatchedElement[] = [];
  let main: string | null = null, sub: string | null = null, rom: string | null = null;
  let current: string[] = [];
  for (const p of doc.pages) {
    const byId = new Map(p.elements.map((e) => [e.id, e]));
    const ordered = p.readingOrder.length ? p.readingOrder.map((id) => byId.get(id)!).filter(Boolean) : p.elements;
    for (const e of ordered) {
      const text = finalText(e, corrections);
      const lab = readLabel(text);
      let how: MatchedElement['how'] = current.length ? 'continued' : 'unassigned';
      let label: string | null = null;
      if (lab && !e.crossedOut) {
        if (lab.main) { main = lab.main; sub = lab.sub ?? null; rom = lab.rom ?? null; }
        else if (lab.sub) { sub = lab.sub; rom = null; }
        else if (lab.rom) rom = lab.rom;
        const ids = resolve(main, sub, rom);
        if (ids.length) { current = ids; how = 'labelled'; label = [main, sub, rom].filter(Boolean).join('.'); }
      }
      elements.push({
        id: e.id, page: p.page, type: e.type, text, originalText: e.text, corrected: text !== e.text, crossedOut: e.crossedOut,
        needsReview: e.needsReview, uncertainty: e.uncertainty, signals: e.signals.map((s) => s.source), alternates: (e.alternateReadings ?? []).map((a) => a.text),
        label, questionIds: how === 'unassigned' ? [] : [...current], how, region: e.region, regionValid: e.checks.region === 'ok' && p.source === 'recognition',
        mathNote: e.mathCheck?.status === 'inconsistent' ? e.mathCheck.note ?? 'arithmetic does not add up' : null,
      });
    }
  }

  const questions: Record<string, QuestionMatch> = {};
  for (const q of scheme.questions) {
    const mine = elements.filter((e) => e.questionIds.includes(q.id));
    const flags: ReviewFlag[] = [];
    if (!mine.length) flags.push({ code: 'no_answer_found', severity: 'medium', detail: `No answer labelled ${q.number} was found.` });
    else if (mine.every((e) => e.crossedOut)) flags.push({ code: 'multiple_attempts', severity: 'medium', detail: `Only crossed-out work was found for ${q.number}.` });
    // Separate runs of the same question (the candidate came back to it later) may be two attempts.
    const runs = elements.reduce((n, e, i) => n + (e.questionIds.includes(q.id) && e.how === 'labelled' && (i === 0 || !elements[i - 1].questionIds.includes(q.id)) ? 1 : 0), 0);
    if (runs > 1) flags.push({ code: 'multiple_attempts', severity: 'medium', detail: `${q.number} is answered in ${runs} separate places; check which attempt counts.` });
    if (mine.length && mine.every((e) => e.questionIds.length > 1)) flags.push({ code: 'mapping_uncertain', severity: 'medium', detail: `The answer is labelled only with the main question number, so it was matched to ${q.number} by content.` });
    questions[q.id] = { questionId: q.id, elementIds: mine.map((e) => e.id), pages: [...new Set(mine.map((e) => e.page))], flags };
  }
  return { elements, questions, unassigned: elements.filter((e) => e.how === 'unassigned').map((e) => e.id) };
}
