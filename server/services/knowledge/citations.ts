import type { KnowledgePassage } from '../ai/types.js';

/**
 * Maps a retrieved DocumentChunk to the passage the chat cites: file name or repository path, page,
 * sheet/slide, knowledge base, and a link that opens the original (for users allowed to retrieve it).
 */
export function toKnowledgePassage(h: { chunk: any; score?: number; text?: string; title?: string; publisher?: string; year?: number; page?: number; table?: string; url?: string }): KnowledgePassage {
  let meta: any = {};
  try { meta = h.chunk?.metadata ? JSON.parse(h.chunk.metadata) : {}; } catch { meta = {}; }
  const c = h.chunk ?? {};
  return {
    text: c.text || h.text || '',
    title: c.title || h.title || meta.path || c.sourceFilename,
    publisher: c.publisher || h.publisher || c.knowledgeBase?.name,
    year: c.year || h.year,
    page: c.page || h.page || c.pageNumber || meta.page || undefined,
    table: c.table || h.table || (meta.sheet ? `Sheet ${meta.sheet}${meta.section ? `, ${meta.section}` : ''}` : meta.slide ? `Slide ${meta.slide}` : undefined),
    url: c.url || h.url || meta.sourceUrl,
    score: h.score,
    fileId: typeof meta.fileId === 'string' ? meta.fileId : undefined,
    path: typeof meta.path === 'string' ? meta.path : undefined,
  };
}
