/**
 * The owner's own words for programs, shared by the server (assistant replies) and the screens (no Node imports, so it can run in the browser).
 * Every business names things differently: a restaurant for students sells a "Meal card" to "students" who show a "card"; a gym sells a "Membership"
 * to "members"; a salon sells "Packages" to "clients". Whatever the owner types is used as written; whatever they leave out falls back to plain words.
 */
export interface ProgramWordsInput {
  program?: string; programs?: string; member?: string; members?: string; pass?: string; use?: string; uses?: string; action?: string;
  idLabel?: string; askId?: boolean; allowOverride?: boolean;
}
export interface Words {
  program: string; programs: string; member: string; members: string; pass: string; use: string; uses: string; action: string;
  idLabel: string; askId: boolean; allowOverride: boolean;
}
export const DEFAULT_WORDS: Words = { program: 'program', programs: 'programs', member: 'member', members: 'members', pass: 'pass', use: 'use', uses: 'uses', action: 'Allowed', idLabel: 'ID number', askId: true, allowOverride: true };

/** A plain English plural, for when the owner gave one word and not its plural (they can always write the plural themselves). */
export function plural(w: string): string {
  const t = w.trim(); if (!t) return t;
  if (/[^aeiou]y$/i.test(t)) return t.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/i.test(t)) return t + 'es';
  return t + 's';
}
export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** The plain words in Kinyarwanda, for a business that has not named things itself and a visitor or owner who reads Kinyarwanda. */
export const RW_WORDS: Words = { program: 'porogaramu', programs: 'porogaramu', member: 'umunyamuryango', members: 'abanyamuryango', pass: 'ikarita', use: 'inshuro', uses: 'inshuro', action: 'Byemewe', idLabel: 'Nomero y’indangamuntu', askId: true, allowOverride: true };

export function wordsOf(t?: ProgramWordsInput | null, base: Words = DEFAULT_WORDS): Words {
  const x = t ?? {}; const w: Words = { ...base };
  for (const k of ['program', 'member', 'use'] as const) {
    const one = x[k]?.trim(); const many = x[`${k}s` as 'programs' | 'members' | 'uses']?.trim();
    if (one) w[k] = one; if (many) w[`${k}s` as 'programs' | 'members' | 'uses'] = many; else if (one) w[`${k}s` as 'programs' | 'members' | 'uses'] = plural(one);
  }
  if (x.pass?.trim()) w.pass = x.pass.trim(); if (x.action?.trim()) w.action = x.action.trim(); if (x.idLabel?.trim()) w.idLabel = x.idLabel.trim();
  w.askId = x.askId !== false; w.allowOverride = x.allowOverride !== false;
  return w;
}

/** Fills {program}, {Program} (first letter capital) and {PROGRAM} (all capitals) and the same for programs, member, members, pass, use, uses and action. */
export function fill(template: string, w: Words): string {
  return template.replace(/\{([A-Za-z]+)\}/g, (m, key: string) => {
    const lower = key.toLowerCase() as keyof Words; const v = w[lower]; if (typeof v !== 'string') return m;
    return key === key.toUpperCase() && key.length > 1 ? v.toUpperCase() : key[0] === key[0].toUpperCase() ? cap(v) : v;
  });
}
