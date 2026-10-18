export interface EvidenceCitationValidation {
  valid: boolean;
  citedChunkIds: string[];
  invalidChunkIds: string[];
}

export function validateEvidenceCitations(answer: string, allowedChunkIds: string[]): EvidenceCitationValidation {
  const allowed = new Set(allowedChunkIds.map((id) => id.trim()));
  const citations = [...answer.matchAll(/\[EVIDENCE:([^\]]+)\]/gi)]
    .flatMap((match) => match[1].split(/[;,]/).map((id) => id.trim()).filter(Boolean))
    .map((id) => id.replace(/^\s*['\"]|['\"]\s*$/g, ''));

  const citedChunkIds = [...new Set(citations.filter((id) => allowed.has(id)))];
  const invalidChunkIds = [...new Set(citations.filter((id) => !allowed.has(id)))];
  return {
    valid: citedChunkIds.length > 0 && invalidChunkIds.length === 0,
    citedChunkIds,
    invalidChunkIds,
  };
}
