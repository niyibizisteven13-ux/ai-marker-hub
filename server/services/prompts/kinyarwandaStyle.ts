/**
 * Lightweight language detection plus the style instructions injected into
 * system prompts. Detection is a heuristic over very common function words.
 * It is cheap and runs on every request, but it is NOT a language-ID model.
 * Replace it with a proper detector if you see misclassifications in your logs.
 */

export type QueryLanguage = 'rw' | 'fr' | 'other';

// Common Kinyarwanda function words, greetings and question words.
// Two-letter words (ni, na, mu, ku) are included but only count together
// with other markers (see detectLanguage).
const RW_MARKERS = new Set([
  'ni', 'na', 'mu', 'ku', 'nta', 'ntabwo', 'kandi', 'cyangwa', 'ariko', 'kuko', 'ngo', 'niba',
  'none', 'ese', 'mbese', 'murakoze', 'urakoze', 'mwaramutse', 'mwiriwe', 'muraho', 'amakuru',
  'yego', 'oya', 'ndashaka', 'nshaka', 'nigute', 'gute', 'ikihe', 'ryari', 'angahe', 'nde',
  'iki', 'uko', 'ibyo', 'iyo', 'uyu', 'uwo', 'byose', 'cyane', 'neza', 'ndabizi', 'sinzi',
  'ubu', 'ejo', 'muri', 'kuri',
]);

const FR_MARKERS = new Set([
  'le', 'la', 'les', 'des', 'est', 'une', 'un', 'pour', 'dans', 'que', 'qui', 'pas', 'sur',
  'avec', 'et', 'du', 'au', 'je', 'nous', 'vous', 'ce', 'cette', 'comment', 'quel', 'quelle',
  'quels', 'bonjour', 'merci', 'peux', 'puis', 'faire', 'sont', 'ont',
]);

export function detectLanguage(text: string): QueryLanguage {
  const tokens = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .match(/[\p{L}]+/gu) ?? [];
  if (tokens.length === 0) return 'other';

  let rw = 0;
  let fr = 0;
  for (const token of tokens) {
    if (RW_MARKERS.has(token)) rw++;
    if (FR_MARKERS.has(token)) fr++;
  }

  // Require at least two markers so one stray word ("ni", "si") cannot flip the language.
  if (rw >= 2 && rw / tokens.length >= 0.2 && rw >= fr) return 'rw';
  if (fr >= 2 && fr / tokens.length >= 0.2) return 'fr';
  return 'other';
}

const BASE_LANGUAGE_RULE =
  'LANGUAGE RULE: Reply in the same language the user wrote in (Kinyarwanda, French or English). ' +
  'If the user mixes languages, you may mix in the same way, but never switch language on your own.';

const KINYARWANDA_STYLE_RULES = `KINYARWANDA STYLE GUIDE
The user is writing in Kinyarwanda. Reply in natural, everyday Kinyarwanda, as an educated Rwandan would write it.
- Do NOT translate word-for-word from English. Decide what you want to say, then say it the way a Kinyarwanda speaker would, with the sentence order and phrasing that feels natural.
- Prefer short, clear sentences over long chained ones.
- Match the user's level of formality. Use a warm, respectful register by default, and greet back if the user greets.
- For technical, school, legal or business terms, use the word Rwandans normally use, including common French or English loanwords. Do not invent stiff new words. If you are not sure of the Kinyarwanda term, write the English or French term and add a short explanation once.
- Keep names, figures, dates, currency (RWF), units and the exact titles of laws or articles unchanged from the source.
- Use ONLY facts from the provided context or well-established general knowledge. If the context does not contain the answer, say so plainly in Kinyarwanda rather than guessing.
- If the retrieved context is in English or French, answer from it but write the answer in Kinyarwanda.`;

/**
 * Builds the language block appended to system prompts.
 * @param exemplars Optional short examples of GOOD Kinyarwanda written or approved by native speakers
 *                  (for example, the approved items from your admin dataset curator). They teach tone,
 *                  not content, so keep them short and varied.
 */
export function buildLanguageBlock(language: QueryLanguage, exemplars?: string): string {
  if (language !== 'rw') return BASE_LANGUAGE_RULE;
  const trimmed = exemplars?.trim();
  const exemplarBlock = trimmed
    ? `\n\nREFERENCE EXAMPLES of natural Kinyarwanda (imitate the tone and phrasing, not the content):\n${trimmed}`
    : '';
  return `${BASE_LANGUAGE_RULE}\n\n${KINYARWANDA_STYLE_RULES}${exemplarBlock}`;
}