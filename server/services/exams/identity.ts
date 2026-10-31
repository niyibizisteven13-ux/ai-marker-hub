import type { DocumentResult } from '../documents/pipeline.js';

/**
 * The name and number a student wrote at the top of their paper ("Name: Uwase Aline", "Reg no: 2024/015",
 * "Amazina: …", "Nom : …"). Read from the transcription that marking already makes, so it costs no extra AI call.
 */
export interface PaperIdentity { name: string | null; id: string | null }

const NAME_LABEL = String.raw`(?:full\s+names?|student'?s?\s+names?|candidate'?s?\s+names?|names?|noms?(?:\s+et\s+pr[ée]noms?)?|pr[ée]noms?|amazina|izina)`;
const ID_LABEL = String.raw`(?:reg(?:istration)?\.?\s*(?:no|number|n[°o])\.?|student\s*(?:id|no|number)\.?|candidate\s*(?:id|no|number)\.?|index\s*(?:no|number)\.?|roll\s*(?:no|number)\.?|admission\s*(?:no|number)\.?|matricule|id\s*(?:no|number)?\.?|n[°o]\s*(?:d'?)?(?:inscription|matricule)?|nimero)`;
const OTHER_LABEL = String.raw`(?:class|classe|level|school|[ée]cole|date|subject|course|module|section|stream|ishuri|umwaka|year|signature|sign|marks?|total|score|teacher|${ID_LABEL}|${NAME_LABEL})`;
const LABEL_AT = (label: string) => new RegExp(String.raw`(?:^|[\s|,;(])${label}\s*[:.\-–=]\s*`, 'gi');

/** Values written after a label on one line, up to the next label. */
function valuesAfter(line: string, label: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(LABEL_AT(label))) {
    const rest = line.slice(m.index! + m[0].length);
    const next = new RegExp(String.raw`(?:^|[\s|,;(])${OTHER_LABEL}\s*[:.\-–=]`, 'i').exec(rest);
    out.push((next ? rest.slice(0, next.index) : rest).trim());
  }
  return out;
}

export function cleanName(raw: string): string | null {
  const v = raw.replace(/[_.…]{2,}/g, ' ').replace(/\s+/g, ' ').replace(/^[\s:,;\-–]+|[\s:,;\-–.]+$/g, '').trim();
  if (!v || /illegible|\?|\[|\d/.test(v)) return null;
  if (!/^[\p{L}][\p{L}'’.\- ]{1,59}$/u.test(v)) return null;
  if ((v.match(/\p{L}/gu) ?? []).length < 3) return null;
  return v;
}

export function cleanId(raw: string): string | null {
  const v = raw.replace(/\s+/g, '').replace(/[_.…]{2,}/g, '').replace(/^[:\-–.]+|[:\-–.,;]+$/g, '');
  if (!v || /illegible|\?/.test(v) || !/\d/.test(v)) return null;
  const id = v.replace(/[\/\\]/g, '-');
  return /^[A-Za-z0-9][\w.-]{1,39}$/.test(id) ? id.toUpperCase() : null;
}

/** Name and number from the top part of the first page; null for anything not written or not readable. */
export function identityFromPaper(result: Pick<DocumentResult, 'pages'>): PaperIdentity {
  const first = [...result.pages].sort((a, b) => a.page - b.page)[0];
  if (!first) return { name: null, id: null };
  const byId = new Map(first.elements.map((e) => [e.id, e]));
  const ordered = first.readingOrder.length ? first.readingOrder.map((id) => byId.get(id)!).filter(Boolean) : first.elements;
  // The header: upper part of the page, written before the answers start.
  const top = ordered.filter((e) => !e.crossedOut && (e.region?.y0 ?? 0) <= 450).slice(0, 12);
  let name: string | null = null;
  let id: string | null = null;
  for (const e of top) {
    for (const line of e.text.split(/\r?\n/)) {
      if (!name) for (const v of valuesAfter(line, NAME_LABEL)) { name = cleanName(v); if (name) break; }
      if (!id) for (const v of valuesAfter(line, ID_LABEL)) { id = cleanId(v); if (id) break; }
    }
    if (name && id) break;
  }
  return { name, id };
}

/** Ids made up by the platform or from a generic file name (STUDENT1, C001, Student_3_Page_1.jpg): the paper's own wins. */
export function isPlaceholderId(candidateId: string, identity: string): boolean {
  return identity === 'assigned' || (identity === 'filename' && /^(?:STUDENT|STD|S)\d{1,4}$/i.test(candidateId));
}
