export interface EvidenceCitationValidation {
  valid: boolean;
  citedChunkIds: string[];
  invalidChunkIds: string[];
}

export function validateEvidenceCitations(answer: string, allowedChunkIds: string[]): EvidenceCitationValidation {
  const allowed = new Set(allowedChunkIds);
  const citations = [...answer.matchAll(/\[EVIDENCE:([^\]]+)\]/g)].map((match) => match[1].trim());
  const citedChunkIds = [...new Set(citations.filter((id) => allowed.has(id)))];
  const invalidChunkIds = [...new Set(citations.filter((id) => !allowed.has(id)))];
  return {
    valid: citedChunkIds.length > 0 && invalidChunkIds.length === 0,
    citedChunkIds,
    invalidChunkIds,
  };
}
