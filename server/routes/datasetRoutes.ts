import { Router } from 'express';
import { z } from 'zod';
import { nisrPipeline } from '../services/AiService.js';
import { buildStatsQuery } from '../services/ai/artifacts/statsArtifacts.js';
import logger from '../utils/logger.js';

/**
 * Read-only NISR dataset endpoints (mounted behind requireAuth). Responses are computed in code from the
 * indexed files and always include source metadata; no model is called here.
 */
const router = Router();

const field = z.string().trim().min(1).max(200).optional();
const querySchema = z.object({
  datasetId: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{1,80}$/).optional(),
  indicator: field,
  geography: field,
  period: field,
  chartType: z.enum(['bar', 'line', 'pie', 'scatter', 'histogram']).optional(),
  limit: z.number().int().min(1).max(5000).optional(),
}).strict().refine((q) => q.datasetId || q.indicator, { message: 'datasetId or indicator is required' });

router.get('/nisr/datasets', async (req, res) => {
  const index = await nisrPipeline.loadIndex();
  res.json({
    indexVersion: index?.indexVersion ?? null,
    builtAt: index?.builtAt ?? null,
    datasets: (index?.datasets ?? []).filter((d) => d.ingestion.status === 'indexed').map((d) => ({
      id: d.id, title: d.title, organization: d.organization, referencePeriod: d.referencePeriod,
      geographicCoverage: d.geographicCoverage, publicationDate: d.publicationDate, sourceUrl: d.sourceUrl,
      license: d.license, units: d.units, recordCount: d.ingestion.recordCount, passageCount: d.ingestion.passageCount,
    })),
    requestId: (req as any).requestId,
  });
});

router.get('/nisr/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 500) : '';
  if (!q) return res.status(400).json({ error: 'q is required', code: 'INVALID_REQUEST', requestId: (req as any).requestId });
  const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 25);
  try {
    const hits = await nisrPipeline.search(q, limit);
    res.json({
      hits: hits.map((h) => ({ kind: h.kind, text: h.text, score: h.score, citation: h.citation })),
      warnings: hits.length ? [] : ['No indexed NISR source matches this query.'],
      requestId: (req as any).requestId,
    });
  } catch (err) {
    logger.error('[NISR] search failed', { requestId: (req as any).requestId, errorType: (err as Error)?.name });
    res.status(500).json({ error: 'Dataset search failed.', code: 'INTERNAL_ERROR', requestId: (req as any).requestId });
  }
});

router.post('/nisr/query', async (req, res) => {
  const parsed = querySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), code: 'INVALID_REQUEST', requestId: (req as any).requestId });
  }
  try {
    const result = await buildStatsQuery(nisrPipeline, parsed.data);
    res.json({ ...result, requestId: (req as any).requestId });
  } catch (err) {
    logger.error('[NISR] query failed', { requestId: (req as any).requestId, errorType: (err as Error)?.name });
    res.status(500).json({ error: 'Dataset query failed.', code: 'INTERNAL_ERROR', requestId: (req as any).requestId });
  }
});

export default router;
