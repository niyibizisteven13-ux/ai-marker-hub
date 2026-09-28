import logger from '../utils/logger.js';

export interface PageGroupingMeta {
  totalPages: number;
  detectedStudentsCount: number;
  groupings: Array<{
    studentId: string;
    studentName?: string;
    pageIndices: number[];
    confidence: 'high' | 'medium' | 'low';
  }>;
  unassignedPages: number[];
}

export class PageGroupingService {
  private static instance: PageGroupingService;

  private constructor() {}

  public static getInstance(): PageGroupingService {
    if (!PageGroupingService.instance) {
      PageGroupingService.instance = new PageGroupingService();
    }
    return PageGroupingService.instance;
  }

  public async groupPagesForBatch(batchId: string, pages: Array<{ pageIndex: number; text: string; imageUrl?: string }>): Promise<PageGroupingMeta> {
    logger.info(`[PageGroupingService] Grouping ${pages.length} pages for batch ${batchId}`);

    const groupings: PageGroupingMeta['groupings'] = [];
    const unassignedPages: number[] = [];

    // Simple heuristic / LLM stub for student ID and page matching
    // In production, uses vision model to inspect student ID headers & multi-page sequences
    const studentMap = new Map<string, { name?: string; pages: number[]; confidence: 'high' | 'medium' | 'low' }>();

    for (const page of pages) {
      const match = page.text.match(/(?:ID|Student)[:\s#]*([A-Z0-9\-]+)/i);
      const nameMatch = page.text.match(/(?:Name|Student Name)[:\s]*([A-Za-z\s]+)/i);

      if (match) {
        const studentId = match[1].trim();
        const studentName = nameMatch ? nameMatch[1].trim() : undefined;

        if (!studentMap.has(studentId)) {
          studentMap.set(studentId, { name: studentName, pages: [], confidence: 'high' });
        }
        studentMap.get(studentId)!.pages.push(page.pageIndex);
      } else {
        unassignedPages.push(page.pageIndex);
      }
    }

    for (const [studentId, data] of studentMap.entries()) {
      groupings.push({
        studentId,
        studentName: data.name,
        pageIndices: data.pages,
        confidence: data.confidence,
      });
    }

    const meta: PageGroupingMeta = {
      totalPages: pages.length,
      detectedStudentsCount: groupings.length,
      groupings,
      unassignedPages,
    };

    logger.info(`[PageGroupingService] Successfully grouped pages: ${groupings.length} students detected, ${unassignedPages.length} unassigned.`);
    return meta;
  }
}
