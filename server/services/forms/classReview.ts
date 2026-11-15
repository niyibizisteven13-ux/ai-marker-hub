/**
 * Looks across all the responses to a test for things a lecturer should check: answers that are nearly the same
 * as another student's, the same wrong answers, two students on one device, and a written answer in a very
 * different style from the same student's other answers.
 *
 * These are leads for a conversation, not findings. Two students who studied the same notes can write alike,
 * a lab shares one network, and people write differently when they are tired or sure. Nothing here changes a mark,
 * and there is deliberately no "written by AI" percentage: text detectors are not reliable enough to accuse anyone.
 */

export interface ReviewQuestion { id: string; label: string; kind: 'text' | 'long_text' | 'choice' | 'other' }
export interface ReviewResponse {
  id: string;
  /** Who it is: registration number, name or email (the same person's attempts share it). */
  who: string;
  submittedAt: number;
  answers: Record<string, unknown>;
  /** Ids of choice questions answered wrongly (from the answer key). */
  wrong?: Set<string>;
  device?: string;
  network?: string;
}
export type ReviewFlagCode = 'SIMILAR_ANSWER' | 'SHARED_WRONG_ANSWERS' | 'SAME_DEVICE' | 'SAME_NETWORK' | 'STYLE_SHIFT';
export interface ReviewFlag { code: ReviewFlagCode; level: 'review' | 'info'; message: string; questionId?: string; other?: string }

const MAX_RESPONSES = 400;
const norm = (s: unknown) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const words = (s: string) => (s ? s.split(' ') : []);
const shingles = (w: string[], n = 3) => { const out = new Set<string>(); for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' ')); return out; };
const jaccard = (a: Set<string>, b: Set<string>) => { if (!a.size || !b.size) return 0; let inter = 0; for (const x of a) if (b.has(x)) inter++; return inter / (a.size + b.size - inter); };
const name = (q: ReviewQuestion) => `"${q.label.slice(0, 60)}"`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

/** Four numbers that describe how someone writes: sentence length, word length, word variety, commas per sentence. */
export function styleOf(text: string) {
  const sentences = text.split(/[.!?]+\s|\n+/).map((s) => s.trim()).filter(Boolean);
  const w = words(norm(text));
  if (w.length < 40 || !sentences.length) return null;
  const first = w.slice(0, 100);
  return {
    sentenceLength: w.length / sentences.length,
    wordLength: mean(w.map((x) => x.length)),
    variety: new Set(first).size / first.length,
    commas: (text.match(/,/g)?.length ?? 0) / sentences.length,
  };
}

export function classReview(questions: ReviewQuestion[], responses: ReviewResponse[]): Record<string, ReviewFlag[]> {
  const out: Record<string, ReviewFlag[]> = {};
  const add = (id: string, f: ReviewFlag) => { (out[id] ??= []).push(f); };
  const list = responses.slice(0, MAX_RESPONSES);
  const differentPeople = (a: ReviewResponse, b: ReviewResponse) => a.who.toLowerCase() !== b.who.toLowerCase();

  // 1. Written answers that are nearly the same as another student's.
  for (const q of questions.filter((x) => x.kind === 'text' || x.kind === 'long_text')) {
    const sets = list.map((r) => { const w = words(norm(r.answers[q.id])); return w.length >= 20 ? shingles(w) : null; });
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if (!sets[i] || !sets[j] || !differentPeople(list[i], list[j])) continue;
      const s = jaccard(sets[i]!, sets[j]!);
      if (s >= 0.6) {
        add(list[i].id, { code: 'SIMILAR_ANSWER', level: 'review', questionId: q.id, other: list[j].who, message: `Answer to ${name(q)} is ${pct(s)} the same as ${list[j].who}'s.` });
        add(list[j].id, { code: 'SIMILAR_ANSWER', level: 'review', questionId: q.id, other: list[i].who, message: `Answer to ${name(q)} is ${pct(s)} the same as ${list[i].who}'s.` });
      }
    }
  }

  // 2. The same wrong answers: knowing the right answer can be shared by studying; the same mistakes rarely are.
  const choice = questions.filter((q) => q.kind === 'choice');
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (!a.wrong?.size || !b.wrong?.size || !differentPeople(a, b)) continue;
    const shared = choice.filter((q) => a.wrong!.has(q.id) && b.wrong!.has(q.id) && JSON.stringify(a.answers[q.id]) === JSON.stringify(b.answers[q.id]));
    if (shared.length >= 4 && shared.length / Math.min(a.wrong.size, b.wrong.size) >= 0.6) {
      add(a.id, { code: 'SHARED_WRONG_ANSWERS', level: 'review', other: b.who, message: `Gave the same wrong answer as ${b.who} on ${shared.length} questions.` });
      add(b.id, { code: 'SHARED_WRONG_ANSWERS', level: 'review', other: a.who, message: `Gave the same wrong answer as ${a.who} on ${shared.length} questions.` });
    }
  }

  // 3. One device used by two people; one network used by two or three people close together in time.
  const byDevice = new Map<string, ReviewResponse[]>();
  const byNet = new Map<string, ReviewResponse[]>();
  for (const r of list) {
    if (r.device) (byDevice.get(r.device) ?? byDevice.set(r.device, []).get(r.device)!).push(r);
    if (r.network) (byNet.get(r.network) ?? byNet.set(r.network, []).get(r.network)!).push(r);
  }
  for (const group of byDevice.values()) {
    const people = new Set(group.map((r) => r.who.toLowerCase()));
    if (people.size < 2) continue;
    for (const r of group) add(r.id, { code: 'SAME_DEVICE', level: 'review', message: `Sat this test on the same device as ${[...new Set(group.filter((x) => differentPeople(x, r)).map((x) => x.who))].join(', ')}.` });
  }
  for (const group of byNet.values()) {
    const people = new Set(group.map((r) => r.who.toLowerCase()));
    // A lab or a campus puts many people on one address: only a small group close together in time is worth a note.
    if (people.size < 2 || people.size > 3) continue;
    const times = group.map((r) => r.submittedAt);
    if (Math.max(...times) - Math.min(...times) > 30 * 60_000) continue;
    for (const r of group) add(r.id, { code: 'SAME_NETWORK', level: 'info', message: `Same network address as ${[...new Set(group.filter((x) => differentPeople(x, r)).map((x) => x.who))].join(', ')}, within 30 minutes.` });
  }

  // 4. A long written answer in a very different style from the same student's other long answers.
  const open = questions.filter((q) => q.kind === 'long_text' || q.kind === 'text');
  for (const r of list) {
    const styles = open.map((q) => ({ q, s: styleOf(String(r.answers[q.id] ?? '')) })).filter((x): x is { q: ReviewQuestion; s: NonNullable<ReturnType<typeof styleOf>> } => !!x.s);
    if (styles.length < 4) continue;
    for (const { q, s } of styles) {
      const others = styles.filter((x) => x.q !== q).map((x) => x.s);
      const off = (['sentenceLength', 'wordLength', 'variety', 'commas'] as const).filter((k) => {
        const xs = others.map((o) => o[k]);
        const floor = { sentenceLength: 3, wordLength: 0.25, variety: 0.05, commas: 0.5 }[k];
        return Math.abs(s[k] - mean(xs)) / Math.max(sd(xs), floor) >= 3;
      });
      if (off.length >= 3) add(r.id, { code: 'STYLE_SHIFT', level: 'info', questionId: q.id, message: `The answer to ${name(q)} is written very differently from this student's other answers (sentence length, word length and word variety).` });
    }
  }
  return out;
}
