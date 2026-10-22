import katex from 'katex';
import type { RecognizedElement, RecognizedPage, Region } from './recognize.js';
import { textSimilarity } from './metrics.js';
import type { MathCheck } from './mathcheck.js';

/**
 * Deterministic and independent checks on a recognised page, combined into explicit uncertainty
 * signals. No single source (least of all the model's own legibility label) decides on its own:
 * each signal carries a severity, and a configurable review threshold turns signals into a decision.
 * OCR disagreement is a signal to look, never proof that either reading is wrong.
 */

export interface IndependentOcrResult { text: string; confidence: number }
/** Independent OCR on a cropped region (e.g. Tesseract). Reliable for print, weak for handwriting. */
export type IndependentOcr = (png: Buffer) => Promise<IndependentOcrResult>;

export type SignalSource =
  | 'model_legibility' | 'model_ambiguity' | 'illegible_marker' | 'page_quality'
  | 'tile_disagreement' | 'tile_only' | 'ocr_conflict' | 'latex_invalid' | 'table_inconsistent'
  | 'region_invalid' | 'math_inconsistent';

export interface UncertaintySignal { source: SignalSource; severity: 'medium' | 'high'; detail: string }

export interface ElementChecks {
  region: 'ok' | 'invalid';
  latex?: { valid: boolean; error?: string };
  table?: { rows: number; columns: number[]; consistent: boolean };
  ocr?: { status: 'corroborated' | 'conflict' | 'inconclusive' | 'unsupported_language'; similarity?: number; ocrConfidence?: number; ocrText?: string; language?: string };
}

export interface VerifiedElement extends RecognizedElement {
  checks: ElementChecks;
  /** Arithmetic consistency (algebraic check), kept separate from transcription checks. */
  mathCheck?: MathCheck;
  /** Other readings of the same region (e.g. the full-page reading when a tile reading was used). */
  alternateReadings?: Array<{ source: 'full_page' | 'tile'; text: string }>;
  signals: UncertaintySignal[];
  uncertainty: 'low' | 'medium' | 'high';
  /** Human-readable reasons (one per signal). */
  flags: string[];
  needsReview: boolean;
}

export type ReviewThreshold = 'medium' | 'high';

export function reviewThreshold(): ReviewThreshold {
  return process.env.DOC_REVIEW_THRESHOLD === 'high' ? 'high' : 'medium';
}

/** Recomputes level, flags and the review decision from the element's signals. */
export function summarize<T extends Pick<VerifiedElement, 'signals'>>(e: T, threshold: ReviewThreshold = 'medium'): T & Pick<VerifiedElement, 'uncertainty' | 'flags' | 'needsReview'> {
  const uncertainty = e.signals.some((s) => s.severity === 'high') ? 'high' : e.signals.length ? 'medium' : 'low';
  return { ...e, uncertainty, flags: e.signals.map((s) => s.detail), needsReview: threshold === 'medium' ? uncertainty !== 'low' : uncertainty === 'high' };
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

/** Maps Tesseract language codes to the short codes the recogniser reports. */
export function ocrLanguagesFromEnv(): string[] {
  const map: Record<string, string> = { eng: 'en', fra: 'fr', kin: 'rw', swa: 'sw' };
  return (process.env.TESSERACT_LANG ?? 'eng').split('+').map((l) => map[l.trim()] ?? l.trim());
}

const TEXT_TYPES = new Set(['heading', 'paragraph', 'list_item', 'marginal_note', 'page_number', 'header_footer', 'other']);

export async function verifyPage(
  page: RecognizedPage,
  opts: {
    cropper?: (r: Region) => Promise<Buffer>;
    ocr?: IndependentOcr;
    /** Languages the OCR engine has data for; other languages are "unsupported", not evidence. */
    ocrLanguages?: string[];
    maxOcrRegions?: number;
    pageQualityWarnings?: string[];
    threshold?: ReviewThreshold;
    /** Signals found earlier (e.g. tile disagreement), by element id. */
    preSignals?: Record<string, UncertaintySignal[]>;
    alternates?: Record<string, Array<{ source: 'full_page' | 'tile'; text: string }>>;
    signal?: AbortSignal;
  } = {},
): Promise<{ elements: VerifiedElement[]; readingOrder: string[]; pageFlags: string[] }> {
  const pageFlags: string[] = [];
  const ids = new Set(page.elements.map((e) => e.id));
  const order = page.readingOrder.filter((id) => ids.has(id));
  const missing = page.elements.filter((e) => !order.includes(e.id)).map((e) => e.id);
  if (missing.length) pageFlags.push(`Reading order did not include ${missing.join(', ')}; appended in detected order.`);
  const readingOrder = [...order, ...missing];
  let ocrBudget = opts.maxOcrRegions ?? 40;
  const ocrLangs = new Set(opts.ocrLanguages ?? ['en']);
  const quality = (opts.pageQualityWarnings ?? []).filter((w) => /resolution|small image|blurred|contrast/i.test(w));

  const elements: VerifiedElement[] = [];
  for (const e of page.elements) {
    if (opts.signal?.aborted) throw opts.signal.reason;
    const signals: UncertaintySignal[] = [...(opts.preSignals?.[e.id] ?? [])];
    const add = (source: SignalSource, severity: 'medium' | 'high', detail: string) => signals.push({ source, severity, detail });
    const checks: ElementChecks = { region: validRegion(e.region) ? 'ok' : 'invalid' };
    if (checks.region === 'invalid') add('region_invalid', 'medium', 'Location on the page is invalid; the original region cannot be shown.');
    if (e.legibility === 'unclear') add('model_legibility', 'high', 'Model marked this unclear.');
    else if (e.legibility === 'partly_unclear') add('model_legibility', 'medium', 'Model marked this partly unclear.');
    if (e.uncertainSpans.length) add('model_ambiguity', 'medium', `${e.uncertainSpans.length} ambiguous reading(s): ${e.uncertainSpans.slice(0, 3).map((u) => `"${u.text}" (or ${u.alternatives.slice(0, 3).map((a) => `"${a}"`).join(', ') || 'unknown'})`).join('; ')}.`);
    if (ILLEGIBLE.test(e.text)) add('illegible_marker', 'high', 'Contains text the model could not read.');
    if (e.handwritten && quality.length) add('page_quality', 'medium', `Page quality: ${quality.join(' ')}`);
    if (e.latex) {
      checks.latex = checkLatex(e.latex);
      if (!checks.latex.valid) add('latex_invalid', 'medium', `Recognised equation is not valid LaTeX (${checks.latex.error}).`);
    } else if (e.type === 'equation') add('latex_invalid', 'medium', 'Equation has no LaTeX transcription.');
    if (e.table) {
      checks.table = checkTable(e.table);
      if (!checks.table.consistent) add('table_inconsistent', 'medium', `Table rows have different numbers of cells (${checks.table.columns.join(', ')}); the structure may be wrong.`);
    } else if (e.type === 'table') add('table_inconsistent', 'medium', 'Table has no cell structure.');

    if (opts.ocr && opts.cropper && checks.region === 'ok' && e.text.trim().length >= 3 && TEXT_TYPES.has(e.type)) {
      const lang = (e.language || 'unknown').toLowerCase();
      if (!ocrLangs.has(lang)) {
        checks.ocr = { status: 'unsupported_language', language: lang };
      } else if (ocrBudget > 0) {
        ocrBudget--;
        try {
          const r = await opts.ocr(await opts.cropper(e.region));
          const similarity = Number(textSimilarity(e.text, r.text).toFixed(3));
          const status = r.confidence < OCR_CONFIDENCE_FLOOR ? 'inconclusive' : similarity >= OCR_AGREE ? 'corroborated' : similarity < OCR_CONFLICT ? 'conflict' : 'inconclusive';
          checks.ocr = { status, similarity, ocrConfidence: Math.round(r.confidence), ocrText: r.text.trim().slice(0, 500), language: lang };
          if (status === 'conflict') add('ocr_conflict', 'medium', `An independent OCR read this region differently ("${r.text.trim().slice(0, 80)}"); this is a reason to look, not proof that either reading is wrong.`);
        } catch {
          pageFlags.push(`Independent OCR failed for ${e.id}.`);
        }
      }
    }
    const alternateReadings = opts.alternates?.[e.id];
    elements.push(summarize({ ...e, checks, signals, ...(alternateReadings ? { alternateReadings } : {}), uncertainty: 'low', flags: [], needsReview: false }, opts.threshold));
  }
  return { elements, readingOrder, pageFlags };
}
