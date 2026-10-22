import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { ProviderAdapter } from '../ai/providers/types.js';
import { loadPages } from './pages.js';
import { cropRegion, preprocessPage, type PageQuality } from './preprocess.js';
import { recognizePage, type Region } from './recognize.js';
import { verifyPage, type IndependentOcr, type VerifiedElement } from './verify.js';

/**
 * Scan → page images → preprocessing → layout + handwriting recognition (vision model) →
 * structure + independent checks → structured, source-linked result with review flags.
 */

export const PIPELINE_VERSION = 'bwenge-docai-1.0.0';

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
  signal?: AbortSignal;
  progress?: (stage: string, percent: number) => Promise<void>;
}

/** Long side sent to the vision model; larger pages are downscaled (tiling is not implemented). */
const MODEL_MAX_SIDE = 2000;

function textLayerElements(text: string): VerifiedElement[] {
  return text.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).map((t, i) => ({
    id: `t${i + 1}`, type: 'paragraph' as const, text: t, latex: null, table: null, region: { x0: 0, y0: 0, x1: 1000, y1: 1000 },
    legibility: 'clear' as const, uncertainSpans: [], crossedOut: false, handwritten: false,
    checks: { region: 'ok' as const }, flags: [], needsReview: false,
  }));
}

export async function processDocument(data: Buffer, filename: string, deps: PipelineDeps, opts: PipelineOptions = {}): Promise<DocumentResult> {
  const { pages: src, format, totalPages } = await loadPages(data, filename, { maxPages: opts.maxPages });
  const usage = { input: 0, output: 0 };
  const pages: ProcessedPage[] = [];
  const limitations = new Set<string>([
    'Transcriptions are produced by an AI vision model. Check flagged regions against the original crop before relying on them.',
    'The model\'s legibility labels are its own judgement, not calibrated probabilities.',
  ]);
  let usedModel = false;

  for (const [i, sp] of src.entries()) {
    if (opts.signal?.aborted) throw opts.signal.reason;
    await opts.progress?.(`page ${sp.page} of ${src.length}: preprocessing`, Math.round((i / src.length) * 90) + 5);
    const pre = await preprocessPage(sp.image);

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

    await opts.progress?.(`page ${sp.page} of ${src.length}: checking`, Math.round((i / src.length) * 90) + 15);
    // Regions refer to the image the model saw (preprocessed, deskewed), so crops come from that image.
    const cropper = (region: Region) => cropRegion(pre.processed, region);
    const v = await verifyPage(r.page, { cropper, ocr: opts.crossCheck === false ? undefined : deps.ocr, signal: opts.signal });
    const elements: ProcessedPage['elements'] = [];
    for (const e of v.elements) {
      let cropFileId: string | undefined;
      if (e.needsReview && e.checks.region === 'ok' && deps.storeCrop) {
        cropFileId = await deps.storeCrop(await cropper(e.region), `page${sp.page}-${e.id}.png`).catch(() => undefined);
      }
      elements.push({ ...e, id: `p${sp.page}-${e.id}`, ...(cropFileId ? { cropFileId } : {}) });
    }
    const quality = pre.quality;
    pages.push({
      page: sp.page, source: 'recognition', width: pre.width, height: pre.height, deskewDegrees: pre.deskewDegrees, transforms: pre.transforms, quality,
      elements, readingOrder: v.readingOrder.map((id) => `p${sp.page}-${id}`), languages: r.page.languages, notes: [...r.page.notes, ...v.pageFlags, ...quality.warnings],
      needsReview: elements.some((e) => e.needsReview) || quality.warnings.length > 0,
    });
  }
  if (totalPages > src.length) limitations.add(`Only the first ${src.length} of ${totalPages} pages were processed.`);
  if (pages.some((p) => p.source === 'recognition')) limitations.add('Very large pages are downscaled to 2000 px on the long side before recognition; tiny handwriting may lose detail (tiling is not implemented).');
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
