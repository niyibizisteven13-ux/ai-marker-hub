/**
 * Question pools: the form creator puts questions in a named pool ("A") and says how many each student gets
 * ("10 of the 30 in pool A"). The draw depends only on a seed, so the same student always gets the same questions
 * (a refresh does not redraw) and the server can repeat the draw to grade only what the student was given.
 * Questions without a pool are always included.
 */

export interface PoolQuestion { id?: unknown; number?: unknown; poolGroup?: unknown }

const qid = (q: PoolQuestion, i: number) => String(q.id ?? q.number ?? i + 1);
const groupOf = (q: PoolQuestion) => (typeof q.poolGroup === 'string' ? q.poolGroup.trim().slice(0, 30) : '');

/** FNV-1a hash of a text, as a 32-bit number. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The pools in a form and how many questions each has. */
export function poolGroups(questions: PoolQuestion[]): Array<{ group: string; count: number }> {
  const out = new Map<string, number>();
  questions.forEach((q) => { const g = groupOf(q); if (g) out.set(g, (out.get(g) ?? 0) + 1); });
  return [...out].map(([group, count]) => ({ group, count }));
}

/** Keeps only sane picks: a whole number from 1 up to the pool's size (more than the pool means "all of it"). */
export function normalizePicks(input: unknown, questions: PoolQuestion[] = []): Record<string, number> {
  const out: Record<string, number> = {};
  if (!input || typeof input !== 'object') return out;
  const known = new Set(poolGroups(questions).map((g) => g.group));
  for (const [g, v] of Object.entries(input as Record<string, unknown>)) {
    const group = g.trim().slice(0, 30);
    if (!group || (questions.length && !known.has(group))) continue;
    if (typeof v === 'number' && Number.isFinite(v) && v >= 1) out[group] = Math.min(Math.round(v), 500);
  }
  return out;
}

/** Ids of the questions this student does NOT get. */
export function poolExcluded(questions: PoolQuestion[], picks: Record<string, number> | undefined, seed: string): Set<string> {
  const out = new Set<string>();
  if (!picks) return out;
  const groups = new Map<string, string[]>();
  questions.forEach((q, i) => { const g = groupOf(q); if (g && picks[g]) (groups.get(g) ?? groups.set(g, []).get(g)!).push(qid(q, i)); });
  for (const [g, ids] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const k = Math.min(picks[g], ids.length);
    if (k >= ids.length) continue;
    const next = rng(hashSeed(`${seed}|${g}`));
    const order = [...ids];
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    order.slice(k).forEach((id) => out.add(id));
  }
  return out;
}

/** The form as one student sees it: the questions they were not given are gone. */
export function applyPool<T extends { fields?: any; questions?: any; poolPicks?: unknown }>(schema: T, seed: string): T {
  const list: PoolQuestion[] = Array.isArray(schema.fields) ? schema.fields : Array.isArray(schema.questions) ? schema.questions : [];
  const picks = schema.poolPicks && typeof schema.poolPicks === 'object' ? (schema.poolPicks as Record<string, number>) : undefined;
  if (!picks || !Object.keys(picks).length) return schema;
  const gone = poolExcluded(list, picks, seed);
  if (!gone.size) return schema;
  const keep = (arr: any) => (Array.isArray(arr) ? arr.filter((q: PoolQuestion, i: number) => !gone.has(qid(q, i))) : arr);
  return { ...schema, fields: keep(schema.fields), questions: keep(schema.questions) };
}
