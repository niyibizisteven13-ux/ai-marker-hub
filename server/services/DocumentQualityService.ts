import sharp from 'sharp';
import { PDFParse } from 'pdf-parse';
import { AiService } from './AiService.js';
import logger from '../utils/logger.js';

export interface QualityCheckResult {
  ok: boolean;
  correctedBuffer?: Buffer;
  reason?: string;
  /** True when the page was allowed through but looks unusually sparse
   *  (e.g. a short answer on an otherwise blank page). Lets callers give
   *  the teacher a confirm-not-reject prompt instead of a hard rejection,
   *  since a sparse page is often a valid submission, not a bad photo. */
  sparseWarning?: boolean;
}

// Legibility gating is a cheap yes/no classification, not reasoning — it
// should never run on Sonnet. AiService.analyzeImage defaults to Sonnet
// when no model is given, so every call from this service passes this
// explicitly. Hardcoded here (rather than imported from AiService) since
// MODELS is not currently exported from that module; if it is exported
// later, switch this to `MODELS.HAIKU`.
const LEGIBILITY_CHECK_MODEL = 'claude-haiku-4-5-20251001';

// Local, zero-cost thresholds. Kept as named constants rather than inline
// magic numbers so they can be tuned from real rejection-rate data once
// this runs against actual scanned scripts, without hunting through the
// method bodies below.
const MIN_DIMENSION_PX = 300;
const DARK_MEAN_THRESHOLD = 15;
const BLANK_MEAN_THRESHOLD = 248;
const BLANK_STDEV_THRESHOLD = 6;
const LOW_CONTRAST_STDEV_THRESHOLD = 5;
// Below this, a Laplacian-convolved image has too little edge energy to
// contain readable strokes — the classic "blurry photo" signature.
const BLUR_VARIANCE_THRESHOLD = 4;

export class DocumentQualityService {
  private static instance: DocumentQualityService;
  private aiService = AiService.getInstance();

  private constructor() {}

  public static getInstance(): DocumentQualityService {
    if (!DocumentQualityService.instance) {
      DocumentQualityService.instance = new DocumentQualityService();
    }
    return DocumentQualityService.instance;
  }

  /**
   * Cheap edge-energy estimate used as a blur proxy: convert to grayscale,
   * convolve with a Laplacian kernel (a discrete second-derivative /
   * edge-detection filter), then measure the variance of the result. A
   * sharp photo has strong edges everywhere text exists, so the Laplacian
   * output has high variance; a blurry photo smooths those edges away, so
   * the variance collapses toward zero. This is the same signal
   * OpenCV's cv2.Laplacian(...).var() gives, computed with sharp alone so
   * no extra dependency or sandbox call is needed for this cheap a check.
   */
  private async computeBlurVariance(buffer: Buffer): Promise<number | null> {
    try {
      const edges = await sharp(buffer)
        .grayscale()
        .convolve({
          width: 3,
          height: 3,
          kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0],
        })
        .toBuffer();

      const stats = await sharp(edges).stats();
      const channel = stats.channels[0];
      return channel ? channel.stdev ** 2 : null;
    } catch (err: any) {
      logger.warn('Blur variance computation failed, skipping blur check:', err.message);
      return null;
    }
  }

  /**
   * Fast local quality checks using sharp statistics (0 API cost).
   * Deliberately conservative about hard-rejecting: anything ambiguous is
   * left for the AI legibility pass, which can actually look at content
   * rather than pixel statistics.
   */
  public async checkLocalQuality(buffer: Buffer): Promise<{ pass: boolean; reason?: string; sparseWarning?: boolean }> {
    if (!buffer || buffer.length === 0) {
      return { pass: false, reason: 'File is empty.' };
    }

    let metadata;
    try {
      metadata = await sharp(buffer).metadata();
    } catch (err: any) {
      // A buffer that sharp can't even decode is corrupt/truncated — this
      // is a real reject, unlike a small-but-valid file size, which is
      // not a reliable corruption signal on its own and was removed as a
      // check (a tightly-cropped, low-detail JPEG can legitimately be a
      // few KB and still be perfectly legible).
      return { pass: false, reason: 'File could not be read as a valid image — it may be corrupted or incomplete.' };
    }

    if (!metadata.width || !metadata.height) {
      return { pass: false, reason: 'Could not parse image dimensions.' };
    }

    if (metadata.width < MIN_DIMENSION_PX || metadata.height < MIN_DIMENSION_PX) {
      return { pass: false, reason: `Resolution too low for accurate grading (minimum ${MIN_DIMENSION_PX}x${MIN_DIMENSION_PX}px).` };
    }

    const stats = await sharp(buffer).stats();
    const channels = stats.channels;
    if (!channels || channels.length === 0) {
      return { pass: true };
    }

    const avgMean = channels.reduce((acc, c) => acc + c.mean, 0) / channels.length;
    const avgStdev = channels.reduce((acc, c) => acc + c.stdev, 0) / channels.length;

    if (avgMean < DARK_MEAN_THRESHOLD) {
      return { pass: false, reason: 'Photo is pitch dark or underexposed. Please retake in good lighting.' };
    }

    // A page that is mostly blank/white can mean two very different
    // things: an overexposed/washed-out photo (genuinely bad), or a
    // short answer on an otherwise empty page (a valid submission).
    // Luminance statistics alone can't tell these apart, so this is no
    // longer a hard rejection — it's passed through with a warning flag
    // so the caller can ask the teacher to confirm rather than forcing a
    // retake of a photo that may already be fine.
    if (avgMean > BLANK_MEAN_THRESHOLD && avgStdev < BLANK_STDEV_THRESHOLD) {
      return { pass: true, sparseWarning: true };
    }

    if (avgStdev < LOW_CONTRAST_STDEV_THRESHOLD) {
      return { pass: false, reason: 'Photo lacks sufficient contrast and detail — likely overexposed, washed out, or blank.' };
    }

    const blurVariance = await this.computeBlurVariance(buffer);
    if (blurVariance !== null && blurVariance < BLUR_VARIANCE_THRESHOLD) {
      return { pass: false, reason: 'Photo appears blurry or out of focus. Please hold the camera steady and retake.' };
    }

    return { pass: true };
  }

  /**
   * Quick structural sanity check for PDF uploads: confirms the file
   * actually parses as a PDF and contains at least one page, so a
   * truncated upload (e.g. a network drop mid-transfer) is caught here —
   * cheaply and with a clear message — rather than surfacing later as an
   * opaque failure deep inside HighVolumeBatchService.
   */
  public async checkPdfIntegrity(buffer: Buffer): Promise<{ pass: boolean; reason?: string }> {
    try {
      const parser = new PDFParse({ data: buffer as unknown as Uint8Array });
      const info = await parser.getText();
      const pageCount = (info as any)?.pages?.length ?? (info as any)?.numpages ?? undefined;
      if (typeof pageCount === 'number' && pageCount < 1) {
        return { pass: false, reason: 'PDF appears to have no pages.' };
      }
      return { pass: true };
    } catch (err: any) {
      logger.info('PDF integrity check failed:', err.message);
      return { pass: false, reason: 'PDF could not be read — it may be corrupted or incomplete. Please re-upload.' };
    }
  }

  /**
   * Fast AI legibility check. Explicitly pinned to Haiku — this is a
   * binary classification, not a reasoning task, and running it on
   * Sonnet (AiService.analyzeImage's default) would silently multiply
   * cost on every single page of every batch for no quality benefit.
   */
  public async checkAiLegibility(buffer: Buffer, mimeType: string = 'image/jpeg'): Promise<{ pass: boolean; reason?: string }> {
    try {
      const prompt = `Analyze this document photo for academic grading suitability. Is the handwriting or text unblurred, legible, and sufficiently complete to evaluate? Respond in JSON ONLY with shape: {"pass": boolean, "reason": "short explanation"}`;

      const response = await this.aiService.analyzeImage({
        base64: buffer.toString('base64'),
        mediaType: mimeType,
        question: prompt,
        model: LEGIBILITY_CHECK_MODEL,
      });

      const parsed = this.aiService.parseModelJson(response || '{}');
      if (parsed.pass === false) {
        return {
          pass: false,
          reason: parsed.reason || 'Image is blurry, cut-off, or unreadable.',
        };
      }

      return { pass: true };
    } catch (err: any) {
      logger.warn('AI legibility check encountered error, allowing image through:', err.message);
      return { pass: true };
    }
  }

  /**
   * Applies auto-orientation, contrast normalization, and edge sharpening.
   */
  public async enhanceImage(buffer: Buffer): Promise<Buffer> {
    try {
      return await sharp(buffer)
        .rotate() // Auto-rotate based on EXIF
        .normalize() // Stretch luminance across full 0-255 spectrum
        .sharpen() // Sharpen soft edges
        .jpeg({ quality: 90 })
        .toBuffer();
    } catch (err: any) {
      logger.warn('Sharp image enhancement failed, using original buffer:', err.message);
      return buffer;
    }
  }

  /**
   * Unified document pipeline: Local Check -> (PDF integrity | AI Quality
   * Gate + Auto-Correction). Every accepted image path returns a
   * corrected buffer; every rejected path returns a specific, actionable
   * reason the caller can relay straight back to the teacher.
   */
  public async prepareScannedPage(buffer: Buffer, mimeType: string = 'image/jpeg'): Promise<QualityCheckResult> {
    if (mimeType === 'application/pdf') {
      const pdfResult = await this.checkPdfIntegrity(buffer);
      if (!pdfResult.pass) {
        logger.info('Document rejected by PDF integrity check:', pdfResult.reason);
        return { ok: false, reason: pdfResult.reason };
      }
      return { ok: true, correctedBuffer: buffer };
    }

    // Step 1: Local Sharp Fast Checks (0 API Cost) — dimensions, exposure,
    // contrast, blur.
    const localResult = await this.checkLocalQuality(buffer);
    if (!localResult.pass) {
      logger.info('Document rejected by Local Quality Check:', localResult.reason);
      return { ok: false, reason: localResult.reason };
    }

    // Step 2: Fast AI Legibility Check (Haiku). A sparse-but-locally-valid
    // page still goes through this — the model can tell a genuinely blank
    // scan apart from a short answer on mostly-empty space far better than
    // pixel statistics can.
    const aiResult = await this.checkAiLegibility(buffer, mimeType);
    if (!aiResult.pass) {
      logger.info('Document rejected by AI Legibility Gate:', aiResult.reason);
      return { ok: false, reason: aiResult.reason };
    }

    // Step 3: Auto-Correction
    const correctedBuffer = await this.enhanceImage(buffer);
    logger.info('Document successfully passed Quality Gate & Image Auto-Correction');

    return {
      ok: true,
      correctedBuffer,
      sparseWarning: localResult.sparseWarning,
    };
  }
}