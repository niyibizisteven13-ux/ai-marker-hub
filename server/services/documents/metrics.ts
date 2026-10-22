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
