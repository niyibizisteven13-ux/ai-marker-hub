/**
 * Recognition metrics against a ground-truth transcription.
 * CER = (S + D + I) / N over characters; WER is the same over words. Only meaningful when a correct
 * reference exists (evaluation sets), never for a new page.
 */

export interface EditCounts { substitutions: number; deletions: number; insertions: number; reference: number }

/** Minimum-edit alignment that also returns the S/D/I breakdown. */
export function editCounts<T>(ref: T[], hyp: T[]): EditCounts {
  const n = ref.length, m = hyp.length;
  // dp[i][j] = [cost, S, D, I]
  let prev: Array<[number, number, number, number]> = Array.from({ length: m + 1 }, (_, j) => [j, 0, 0, j]);
  for (let i = 1; i <= n; i++) {
    const cur: Array<[number, number, number, number]> = [[i, 0, i, 0]];
    for (let j = 1; j <= m; j++) {
      const same = ref[i - 1] === hyp[j - 1];
      const sub = prev[j - 1];
      const del = prev[j];
      const ins = cur[j - 1];
      const options: Array<[number, number, number, number]> = [
        [sub[0] + (same ? 0 : 1), sub[1] + (same ? 0 : 1), sub[2], sub[3]],
        [del[0] + 1, del[1], del[2] + 1, del[3]],
        [ins[0] + 1, ins[1], ins[2], ins[3] + 1],
      ];
      cur.push(options.reduce((a, b) => (b[0] < a[0] ? b : a)));
    }
    prev = cur;
  }
  const [, S, D, I] = prev[m];
  return { substitutions: S, deletions: D, insertions: I, reference: n };
}

export interface ErrorRate extends EditCounts { rate: number | null }

const normalizeSpace = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

export function characterErrorRate(reference: string, hypothesis: string): ErrorRate {
  const c = editCounts([...normalizeSpace(reference)], [...normalizeSpace(hypothesis)]);
  return { ...c, rate: c.reference ? (c.substitutions + c.deletions + c.insertions) / c.reference : null };
}

export function wordErrorRate(reference: string, hypothesis: string): ErrorRate {
  const words = (s: string) => normalizeSpace(s).split(' ').filter(Boolean);
  const c = editCounts(words(reference), words(hypothesis));
  return { ...c, rate: c.reference ? (c.substitutions + c.deletions + c.insertions) / c.reference : null };
}

/** Case/punctuation-insensitive similarity in [0, 1] (1 − normalised edit distance), for cross-checks. */
export function textSimilarity(a: string, b: string): number {
  const norm = (s: string) => s.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const x = [...norm(a)], y = [...norm(b)];
  if (!x.length && !y.length) return 1;
  const c = editCounts(x, y);
  return 1 - (c.substitutions + c.deletions + c.insertions) / Math.max(x.length, y.length);
}

/** Word-level alignment: for each hypothesis word, whether it matches the reference (match = correct). */
export function alignWords(ref: string[], hyp: string[]): { hypCorrect: boolean[]; missedReferenceWords: number } {
  const n = ref.length, m = hyp.length;
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    d[i][j] = Math.min(d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1), d[i - 1][j] + 1, d[i][j - 1] + 1);
  }
  const hypCorrect = new Array<boolean>(m).fill(false);
  let missed = 0;
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) { hypCorrect[j - 1] = ref[i - 1] === hyp[j - 1]; i--; j--; }
    else if (j > 0 && d[i][j] === d[i][j - 1] + 1) { hypCorrect[j - 1] = false; j--; }
    else { missed++; i--; }
  }
  return { hypCorrect, missedReferenceWords: missed };
}

export interface ReviewCalibration {
  /** Wrong words in unflagged elements / all words in unflagged elements: errors shown as reliable. */
  falseConfidenceRate: number | null;
  /** Wrong words in flagged elements / all wrong words: how many errors the review policy catches. */
  errorCapture: number | null;
  /** Words in flagged elements / all words: how much a reviewer has to check. */
  reviewLoad: number | null;
  wrongWords: number;
  words: number;
}

/**
 * Measures a review policy against a ground-truth transcription. `elements` are in reading order with
 * their recognised text and whether the policy flagged them.
 */
export function reviewCalibration(reference: string, elements: Array<{ text: string; flagged: boolean }>): ReviewCalibration {
  const words = (s: string) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const hyp: Array<{ w: string; flagged: boolean }> = elements.flatMap((e) => words(e.text).map((w) => ({ w, flagged: e.flagged })));
  const { hypCorrect } = alignWords(words(reference), hyp.map((h) => h.w));
  let unflagged = 0, unflaggedWrong = 0, flaggedCount = 0, wrong = 0, flaggedWrong = 0;
  hyp.forEach((h, k) => {
    const bad = !hypCorrect[k];
    if (bad) wrong++;
    if (h.flagged) { flaggedCount++; if (bad) flaggedWrong++; }
    else { unflagged++; if (bad) unflaggedWrong++; }
  });
  return {
    falseConfidenceRate: unflagged ? unflaggedWrong / unflagged : null,
    errorCapture: wrong ? flaggedWrong / wrong : null,
    reviewLoad: hyp.length ? flaggedCount / hyp.length : null,
    wrongWords: wrong, words: hyp.length,
  };
}
