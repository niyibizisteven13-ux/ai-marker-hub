import katex from 'katex';
import type { RecognizedElement, RecognizedPage, Region } from './recognize.js';
import { textSimilarity } from './metrics.js';

/**
 * Deterministic and independent checks on a recognised page. Each check looks at a different aspect
 * (geometry, LaTeX syntax, table shape, an independent OCR reading), so agreement means something;
 * none of them can prove a transcription matches the handwriting, so they only add or clear flags.
 */

export interface IndependentOcrResult { text: string; confidence: number }
/** Independent OCR on a cropped region (e.g. Tesseract). Reliable for print, weak for handwriting. */
export type IndependentOcr = (png: Buffer) => Promise<IndependentOcrResult>;

export interface ElementChecks {
  region: 'ok' | 'invalid';
  latex?: { valid: boolean; error?: string };
  table?: { rows: number; columns: number[]; consistent: boolean };
  ocr?: { status: 'corroborated' | 'conflict' | 'inconclusive'; similarity: number; ocrConfidence: number; ocrText: string };
}

export interface VerifiedElement extends RecognizedElement {
  checks: ElementChecks;
  flags: string[];
  needsReview: boolean;
}

export function validRegion(r: Region): boolean {
  return [r.x0, r.y0, r.x1, r.y1].every((v) => Number.isFinite(v) && v >= 0 && v <= 1000) && r.x1 > r.x0 && r.y1 > r.y0;
}

export function checkLatex(latex: string): { valid: boolean; error?: string } {
  try {
    katex.renderToString(latex, { throwOnError: true, strict: 'ignore', trust: false, maxSize: 50, maxExpand: 200 });
    return { valid: true };
  } catch (e) {
    return { valid: false, error: String((e as Error).message).replace(/^KaTeX parse error:\s*/, '').slice(0, 200) };
  }
}

export function checkTable(table: string[][]): { rows: number; columns: number[]; consistent: boolean } {
  const columns = [...new Set(table.map((r) => r.length))];
  return { rows: table.length, columns, consistent: columns.length === 1 && table.length > 0 };
}

const ILLEGIBLE = /\[illegible\]/i;

/** Thresholds for treating independent OCR as evidence. Below the confidence floor the OCR result is ignored. */
export const OCR_CONFIDENCE_FLOOR = 70;
export const OCR_AGREE = 0.8;
export const OCR_CONFLICT = 0.5;

export async function verifyPage(
  page: RecognizedPage,
  opts: { cropper?: (r: Region) => Promise<Buffer>; ocr?: IndependentOcr; maxOcrRegions?: number; signal?: AbortSignal } = {},
): Promise<{ elements: VerifiedElement[]; readingOrder: string[]; pageFlags: string[] }> {
  const pageFlags: string[] = [];
  const ids = new Set(page.elements.map((e) => e.id));
  const order = page.readingOrder.filter((id) => ids.has(id));
  const missing = page.elements.filter((e) => !order.includes(e.id)).map((e) => e.id);
  if (missing.length) pageFlags.push(`Reading order did not include ${missing.join(', ')}; appended in detected order.`);
  const readingOrder = [...order, ...missing];
  let ocrBudget = opts.maxOcrRegions ?? 40;

  const elements: VerifiedElement[] = [];
  for (const e of page.elements) {
    if (opts.signal?.aborted) throw opts.signal.reason;
    const flags: string[] = [];
    const checks: ElementChecks = { region: validRegion(e.region) ? 'ok' : 'invalid' };
    if (checks.region === 'invalid') flags.push('Location on the page is invalid; the original region cannot be shown.');
    if (e.legibility !== 'clear') flags.push(`Model marked this ${e.legibility === 'unclear' ? 'unclear' : 'partly unclear'}.`);
    if (e.uncertainSpans.length) flags.push(`${e.uncertainSpans.length} ambiguous reading(s): ${e.uncertainSpans.slice(0, 3).map((u) => `"${u.text}" (or ${u.alternatives.slice(0, 3).map((a) => `"${a}"`).join(', ') || 'unknown'})`).join('; ')}.`);
    if (ILLEGIBLE.test(e.text)) flags.push('Contains text the model could not read.');
    if (e.latex) {
      checks.latex = checkLatex(e.latex);
      if (!checks.latex.valid) flags.push(`Recognised equation is not valid LaTeX (${checks.latex.error}).`);
    } else if (e.type === 'equation') flags.push('Equation has no LaTeX transcription.');
    if (e.table) {
      checks.table = checkTable(e.table);
      if (!checks.table.consistent) flags.push(`Table rows have different numbers of cells (${checks.table.columns.join(', ')}); the structure may be wrong.`);
    } else if (e.type === 'table') flags.push('Table has no cell structure.');

    // Independent OCR only for text-like regions with a valid location.
    if (opts.ocr && opts.cropper && checks.region === 'ok' && ocrBudget > 0 && e.text.trim().length >= 3 && ['heading', 'paragraph', 'list_item', 'marginal_note', 'page_number', 'header_footer', 'other'].includes(e.type)) {
      ocrBudget--;
      try {
        const r = await opts.ocr(await opts.cropper(e.region));
        const similarity = Number(textSimilarity(e.text, r.text).toFixed(3));
        const status = r.confidence < OCR_CONFIDENCE_FLOOR ? 'inconclusive' : similarity >= OCR_AGREE ? 'corroborated' : similarity < OCR_CONFLICT ? 'conflict' : 'inconclusive';
        checks.ocr = { status, similarity, ocrConfidence: Math.round(r.confidence), ocrText: r.text.trim().slice(0, 500) };
        if (status === 'conflict') flags.push(`An independent OCR read this region differently ("${r.text.trim().slice(0, 80)}").`);
      } catch {
        pageFlags.push(`Independent OCR failed for ${e.id}.`);
      }
    }
    elements.push({ ...e, checks, flags, needsReview: flags.length > 0 });
  }
  return { elements, readingOrder, pageFlags };
}
