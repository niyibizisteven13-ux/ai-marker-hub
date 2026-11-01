/**
 * Quiz marking for forms: each question with points and a correct answer is marked the moment a response arrives,
 * by comparing answers (no AI, so it is instant, free and the same every time).
 *
 * Choice questions: the chosen option must match. Checkboxes: the set of ticked options must match exactly.
 * Typed answers: compared ignoring case, spaces and accents; numbers compared as numbers; a key may list
 * alternatives separated by "|" (e.g. "4|four").
 */

export interface QuizItem { id: string; title: string; points: number; earned: number; correct: boolean; given: unknown; correctAnswer: unknown }
export interface QuizResult { score: number; maxScore: number; percent: number; items: QuizItem[] }

const fold = (v: unknown) => String(v ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const asNumber = (v: unknown) => { const s = String(v ?? '').replace(/,/g, '.').replace(/\s/g, ''); return s !== '' && Number.isFinite(Number(s)) ? Number(s) : null; };

function matches(given: unknown, key: unknown): boolean {
  if (Array.isArray(key)) {
    const want = new Set(key.map(fold).filter(Boolean));
    const got = new Set((Array.isArray(given) ? given : given === undefined || given === null || given === '' ? [] : [given]).map(fold).filter(Boolean));
    return want.size > 0 && want.size === got.size && [...want].every((x) => got.has(x));
  }
  if (given === undefined || given === null || given === '' || (Array.isArray(given) && !given.length)) return false;
  const answer = Array.isArray(given) ? given[0] : given;
  return String(key ?? '').split('|').some((alt) => {
    const a = asNumber(alt), b = asNumber(answer);
    if (a !== null && b !== null) return Math.abs(a - b) < 1e-9;
    return fold(alt) !== '' && fold(alt) === fold(answer);
  });
}

/** Marks one response against the form's answer key; null when the form is not a quiz or has no marked questions. */
export function gradeQuiz(schema: any, values: Record<string, unknown>): QuizResult | null {
  if (!schema?.isQuiz) return null;
  const list: any[] = Array.isArray(schema.fields) ? schema.fields : Array.isArray(schema.questions) ? schema.questions : [];
  const items: QuizItem[] = [];
  for (const [i, q] of list.entries()) {
    const points = Number(q?.points);
    const key = q?.correctAnswer;
    if (!(points > 0) || key === undefined || key === null || key === '' || (Array.isArray(key) && !key.length)) continue;
    const id = String(q.id ?? q.number ?? i + 1);
    const given = values[id];
    const correct = matches(given, key);
    items.push({ id, title: String(q.label ?? q.title ?? q.text ?? `Question ${i + 1}`), points, earned: correct ? points : 0, correct, given: given ?? null, correctAnswer: key });
  }
  if (!items.length) return null;
  const maxScore = items.reduce((a, x) => a + x.points, 0);
  const score = items.reduce((a, x) => a + x.earned, 0);
  return { score, maxScore, percent: maxScore ? Math.round((score / maxScore) * 1000) / 10 : 0, items };
}
