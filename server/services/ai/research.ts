/**
 * Questions that need research: current facts (news, prices, who holds an office, latest versions), or an
 * explicit ask to research, look something up or cite sources. They go to the tool agent, which searches the
 * public library and the web and cites what it used, instead of plain chat answering from memory.
 */

const ASKS_RESEARCH = /\b(research|look (?:it |this )?up|search (?:for|the web|online|the internet)|find (?:me )?(?:sources?|articles?|papers?|studies|evidence|references?)|with (?:sources|citations|references)|cite|citations?|references?|according to|sources?)\b|\b(shakisha|ubushakashatsi|amasoko|recherche|cherche|sources?|références?|selon)\b/i;
const CURRENT = /\b(latest|current(?:ly)?|recent(?:ly)?|today|this (?:week|month|year)|right now|news|update[sd]?|as of|price|prices|cost of|exchange rate|weather|score|results? of the|election|who is the (?:current )?(?:president|minister|ceo|head|leader|governor|mayor)|20(?:2[4-9]|3\d))\b|\b(uyu munsi|vuba aha|amakuru mashya|aujourd'hui|actuel(?:le)?|récent|dernières? nouvelles)\b/i;

export function needsResearch(message: string): boolean {
  const text = message.trim();
  if (text.length < 8) return false;
  return ASKS_RESEARCH.test(text) || CURRENT.test(text);
}
