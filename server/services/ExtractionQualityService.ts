const ACCEPTED_OCR_FALLBACK_WARNING = 'PDF text layer was empty or near-empty';

export function getDocumentExtractionIssue(text: string, warnings: string[]): string | null {
  const blockingWarning = warnings.find((warning) => !warning.startsWith(ACCEPTED_OCR_FALLBACK_WARNING));
  if (blockingWarning) return `Could not fully extract the document: ${blockingWarning}`;

  const cleanText = text.trim();
  if (cleanText.length < 10) return 'No readable text was extracted from the document.';

  const invalidCharacters = cleanText.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/g)?.length || 0;
  if (invalidCharacters / cleanText.length > 0.005) {
    return 'Extracted text contains too many invalid or replacement characters to index safely.';
  }
  return null;
}

export function splitDocumentIntoChunks(text: string, chunkSize: number, overlap: number): string[] {
  const cleanText = text.trim();
  if (!cleanText) return [];

  const safeChunkSize = Math.max(100, Math.floor(chunkSize));
  const safeOverlap = Math.min(Math.max(0, Math.floor(overlap)), safeChunkSize - 1);
  const chunks: string[] = [];
  let start = 0;

  while (start < cleanText.length) {
    let end = Math.min(start + safeChunkSize, cleanText.length);
    if (end < cleanText.length) {
      const minimumBoundary = start + Math.floor(safeChunkSize * 0.7);
      const newlineBoundary = cleanText.lastIndexOf('\n', end);
      const wordBoundary = cleanText.lastIndexOf(' ', end);
      if (newlineBoundary >= minimumBoundary) end = newlineBoundary;
      else if (wordBoundary >= minimumBoundary) end = wordBoundary;
    }

    const chunk = cleanText.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= cleanText.length) break;
    start = Math.max(start + 1, end - safeOverlap);
  }
  return chunks;
}
