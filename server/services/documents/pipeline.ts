import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { ProviderAdapter } from '../ai/providers/types.js';
import { loadPages } from './pages.js';
import { cropRegion, preprocessPage, type PageQuality } from './preprocess.js';
import { recognizePage, type Region } from './recognize.js';
import { ocrLanguagesFromEnv, reviewThreshold, summarize, verifyPage, type IndependentOcr, type ReviewThreshold, type VerifiedElement } from './verify.js';
import { mergeTileReadings, planTiles, shouldTile, tileToPage, type TileElement, type TilingMode } from './tiling.js';
import { checkMath, collectAssignments } from './mathcheck.js';

/**
 * Scan → page images → preprocessing → layout + handwriting recognition (vision model) →
 * structure + independent checks → structured, source-linked result with review flags.
 */

export const PIPELINE_VERSION = 'bwenge-docai-1.1.0';

export interface ProcessedPage {
  page: number;
  source: 'recognition' | 'pdf_text_layer';
  width: number;
  height: number;
  deskewDegrees: number;
  transforms: string[];
  quality: PageQuality;
  elements: Array<VerifiedElement & { cropFileId?: string }>;
  readingOrder: string[];
  languages: string[];
  notes: string[];
  needsReview: boolean;
  /** Close-up pass statistics when the page was tiled. */
  tiling?: { tiles: number; replaced: number; agreed: number; added: number; duplicatesRemoved: number };
}

export interface DocumentResult {
  pipelineVersion: string;
  file: { name: string; sha256: string; format: 'pdf' | 'image'; totalPages: number };
  pages: ProcessedPage[];
  needsReview: boolean;
  model: string | null;
  usage: { input: number; output: number };
  limitations: string[];
}

export interface PipelineDeps {
  adapter: ProviderAdapter;
  model: string;
  fallbackModel?: string | null;
  ocr?: IndependentOcr;
  /** Stores a review crop and returns its id (FileStore). */
  storeCrop?: (png: Buffer, name: string) => Promise<string>;
}

export interface PipelineOptions {
  languageHint?: string;
  /** Run recognition even on PDF pages that have a text layer (e.g. typed pages with handwritten notes). */
  forceRecognition?: boolean;
  crossCheck?: boolean;
  maxPages?: number;
  /** auto (default): tile pages that the full-page pass would downscale by ≥1.35×. */
  tiling?: TilingMode;
  maxTilesPerPage?: number;
  reviewThreshold?: ReviewThreshold;
  ocrLanguages?: string[];
  signal?: AbortSignal;
  progress?: (stage: string, percent: number) => Promise<void>;
}

/** Long side sent to the vision model for the full-page pass; dense pages are also read in tiles. */
export const MODEL_MAX_SIDE = 2000;

function textLayerElements(text: string): VerifiedElement[] {
  return text.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).map((t, i) => ({
    id: `t${i + 1}`, type: 'paragraph' as const, text: t, latex: null, table: null, region: { x0: 0, y0: 0, x1: 1000, y1: 1000 },
    legibility: 'clear' as const, uncertainSpans: [], crossedOut: false, handwritten: false, language: 'unknown',
    checks: { region: 'ok' as const }, signals: [], uncertainty: 'low' as const, flags: [], needsReview: false,
  }));
}

export async function processDocument(data: Buffer, filename: string, deps: PipelineDeps, opts: PipelineOptions = {}): Promise<DocumentResult> {
  const { pages: src, format, totalPages } = await loadPages(data, filename, { maxPages: opts.maxPages, pdfScale: Number(process.env.DOC_PDF_SCALE) > 0 ? Number(process.env.DOC_PDF_SCALE) : 3 });
  const threshold = opts.reviewThreshold ?? reviewThreshold();
  const tilingMode: TilingMode = opts.tiling ?? ((process.env.DOC_TILING as TilingMode) || 'auto');
  const usage = { input: 0, output: 0 };
  const pages: ProcessedPage[] = [];
  const limitations = new Set<string>([
    'Transcriptions are produced by an AI vision model. Check flagged regions against the original crop before relying on them.',
    'The model\'s legibility labels are its own judgement, not calibrated probabilities.',
  ]);
  let usedModel = false;
  const cropSources = new Map<number, Buffer>();

  for (const [i, sp] of src.entries()) {
    if (opts.signal?.aborted) throw opts.signal.reason;
    await opts.progress?.(`page ${sp.page} of ${src.length}: preprocessing`, Math.round((i / src.length) * 90) + 5);
    // Keep up to 4000 px so tiles can read small handwriting at (near) native resolution.
    const pre = await preprocessPage(sp.image, { maxSide: 4000 });

    if (sp.textLayer.length >= 200 && !opts.forceRecognition) {
      limitations.add('Pages with a PDF text layer were read from that layer, not recognised; handwritten notes added on top of typed pages are not captured unless recognition is forced.');
      pages.push({
        page: sp.page, source: 'pdf_text_layer', width: pre.width, height: pre.height, deskewDegrees: 0, transforms: ['Used the PDF text layer.'],
        quality: pre.quality, elements: textLayerElements(sp.textLayer), readingOrder: [], languages: [], notes: [], needsReview: false,
      });
      continue;
    }

    await opts.progress?.(`page ${sp.page} of ${src.length}: recognising`, Math.round((i / src.length) * 90) + 10);
    const modelImage = await sharp(pre.processed).resize({ width: MODEL_MAX_SIDE, height: MODEL_MAX_SIDE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    const r = await recognizePage(deps.adapter, modelImage, 'image/jpeg', sp.page, { model: deps.model, fallbackModel: deps.fallbackModel, languageHint: opts.languageHint, signal: opts.signal });
    usedModel = true;
    usage.input += r.usage.input;
    usage.output += r.usage.output;
    let recognized = r.page;
    let preSignals: Record<string, import('./verify.js').UncertaintySignal[]> = {};
    let alternates: Record<string, Array<{ source: 'full_page' | 'tile'; text: string }>> = {};
    let tiling: ProcessedPage['tiling'];

    if (shouldTile(pre.width, pre.height, tilingMode, MODEL_MAX_SIDE)) {
      const tiles = planTiles(pre.width, pre.height, { maxTiles: opts.maxTilesPerPage ?? (Number(process.env.DOC_MAX_TILES_PER_PAGE) || 4) });
      const tileEls: TileElement[] = [];
      for (const t of tiles) {
        if (opts.signal?.aborted) throw opts.signal.reason;
        await opts.progress?.(`page ${sp.page} of ${src.length}: close-up ${t.index + 1} of ${tiles.length}`, Math.round((i / src.length) * 90) + 12);
        const crop = await sharp(pre.processed).extract({ left: t.x, top: t.y, width: t.width, height: t.height })
          .resize({ width: MODEL_MAX_SIDE, height: MODEL_MAX_SIDE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
        const tr = await recognizePage(deps.adapter, crop, 'image/jpeg', sp.page, {
          model: deps.model, fallbackModel: deps.fallbackModel, languageHint: opts.languageHint, signal: opts.signal,
          context: `This image is a close-up tile (row ${t.row + 1}, column ${t.col + 1}) of the page. Coordinates are relative to this tile. Text cut off at the tile edge: transcribe only what is visible and mark it partly_unclear.`,
        });
        usage.input += tr.usage.input;
        usage.output += tr.usage.output;
        for (const e of tr.page.elements) tileEls.push({ tile: t, element: { ...e, region: tileToPage(e.region, t, pre.width, pre.height) } });
      }
      const merged = mergeTileReadings(recognized, tileEls, tiles);
      recognized = { ...recognized, elements: merged.elements, readingOrder: merged.readingOrder };
      preSignals = merged.signals;
      alternates = merged.alternates;
      tiling = merged.stats;
    }

    await opts.progress?.(`page ${sp.page} of ${src.length}: checking`, Math.round((i / src.length) * 90) + 15);
    // Regions refer to the image the model saw (preprocessed, deskewed), so crops come from that image.
    const cropper = (region: Region) => cropRegion(pre.processed, region);
    const v = await verifyPage(recognized, {
      cropper, ocr: opts.crossCheck === false ? undefined : deps.ocr, ocrLanguages: opts.ocrLanguages ?? ocrLanguagesFromEnv(),
      pageQualityWarnings: pre.quality.warnings, threshold, preSignals, alternates, signal: opts.signal,
    });
    const quality = pre.quality;
    pages.push({
      page: sp.page, source: 'recognition', width: pre.width, height: pre.height, deskewDegrees: pre.deskewDegrees, transforms: pre.transforms, quality,
      elements: v.elements.map((e) => ({ ...e, id: `p${sp.page}-${e.id}` })), readingOrder: v.readingOrder.map((id) => `p${sp.page}-${id}`),
      languages: r.page.languages, notes: [...r.page.notes, ...v.pageFlags, ...quality.warnings], needsReview: false, ...(tiling ? { tiling } : {}),
    });
    cropSources.set(sp.page, pre.processed);
  }

  // Arithmetic consistency across the whole document (algebraic check, separate from transcription checks).
  const all = pages.flatMap((p) => p.elements);
  const { vars, conflicts } = collectAssignments(all.map((e) => ({ id: e.id, text: e.text })));
  if (conflicts.length) limitations.add(`Some variables have different values in different places (${conflicts.slice(0, 5).join(', ')}); they were not used in arithmetic checks.`);
  for (const p of pages) {
    p.elements = p.elements.map((e) => {
      if (!/=/.test(e.text) && !e.latex) return e;
      let m = checkMath(e.text, vars);
      if (m.status === 'not_checkable' && e.latex) m = checkMath(e.latex, vars);
      if (m.status === 'not_checkable') return e;
      const signals = m.status === 'inconsistent'
        ? [...e.signals, { source: 'math_inconsistent' as const, severity: 'medium' as const, detail: `Arithmetic does not add up (${m.checks.filter((c) => !c.ok).map((c) => `${c.expression}: ${Number(c.left.toFixed(6))} ≠ ${Number(c.right.toFixed(6))}`).join('; ')}). ${m.note}` }]
        : e.signals;
      return summarize({ ...e, mathCheck: m, signals }, threshold);
    });
  }

  // Crops for everything that needs review, and page-level review status.
  for (const p of pages) {
    const img = cropSources.get(p.page);
    if (img && deps.storeCrop) {
      for (const e of p.elements) {
        if (e.needsReview && e.checks.region === 'ok') {
          e.cropFileId = await deps.storeCrop(await cropRegion(img, e.region), `page${p.page}-${e.id.replace(/^p\d+-/, '')}.png`).catch(() => undefined);
        }
      }
    }
    p.needsReview = p.elements.some((e) => e.needsReview) || (p.source === 'recognition' && p.quality.warnings.length > 0);
  }
  if (totalPages > src.length) limitations.add(`Only the first ${src.length} of ${totalPages} pages were processed.`);
  if (pages.some((p) => p.source === 'recognition' && !p.tiling && Math.max(p.width, p.height) > MODEL_MAX_SIDE)) limitations.add(`Pages larger than ${MODEL_MAX_SIDE} px were read at reduced size without close-up tiles (tiling was off or not needed by the auto rule).`);
  if (pages.some((p) => p.tiling)) limitations.add('Dense pages were also read in overlapping close-up tiles. Where the two readings differ the element is flagged; the close-up reading is used when the element lies inside one tile, and the other reading is kept as an alternate.');
  limitations.add(`Review policy: elements with ${threshold === 'medium' ? 'any' : 'high-severity'} uncertainty signals are flagged (DOC_REVIEW_THRESHOLD). Calibrate this on real handwriting with npm run eval:documents.`);
  return {
    pipelineVersion: PIPELINE_VERSION,
    file: { name: filename.replace(/[^\w.\- ]/g, '_').slice(0, 120), sha256: createHash('sha256').update(data).digest('hex'), format, totalPages },
    pages, needsReview: pages.some((p) => p.needsReview), model: usedModel ? deps.model : null, usage, limitations: [...limitations],
  };
}

/** Final text per element: an instructor/user correction wins over the model reading. */
export function finalText(e: { id: string; text: string }, corrections: Array<{ elementId: string; text: string }>): string {
  const c = [...corrections].reverse().find((x) => x.elementId === e.id);
  return c ? c.text : e.text;
}

/** Plain transcription in reading order, with page markers. */
export function documentText(result: DocumentResult, corrections: Array<{ elementId: string; text: string }> = []): string {
  return result.pages.map((p) => {
    const byId = new Map(p.elements.map((e) => [e.id, e]));
    const order = p.readingOrder.length ? p.readingOrder.map((id) => byId.get(id)!).filter(Boolean) : p.elements;
    return `--- Page ${p.page} ---\n${order.map((e) => (e.crossedOut ? `~~${finalText(e, corrections)}~~` : finalText(e, corrections))).join('\n\n')}`;
  }).join('\n\n');
}
