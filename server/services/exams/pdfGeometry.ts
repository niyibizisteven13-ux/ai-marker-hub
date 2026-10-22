/**
 * Coordinate transforms from the recognition image back to the PDF.
 *
 * Recognition regions are normalised 0–1000 on the *processed* page image: the page as displayed
 * (PDF crop box with /Rotate applied, or the EXIF-oriented photo), scaled, then deskewed by rotating
 * about the centre with the canvas expanded. PDF drawing happens in unrotated user space with a
 * bottom-left origin inside the crop box. Each step is inverted explicitly; render scale and DPI cancel
 * out because everything passes through page fractions.
 */

export interface ProcessedGeometry {
  /** Processed (deskewed) image size in pixels. */
  width: number;
  height: number;
  /** Estimated skew; the image was rotated by −deskewDegrees (sharp convention: positive = clockwise). */
  deskewDegrees: number;
}

export interface PdfBox { x: number; y: number; width: number; height: number }

const DESKEW_MIN = 0.3;

/** Size of the image before deskewing, solved from the expanded canvas size. */
export function preDeskewSize(g: ProcessedGeometry): { width: number; height: number } {
  if (Math.abs(g.deskewDegrees) < DESKEW_MIN) return { width: g.width, height: g.height };
  const a = (Math.abs(g.deskewDegrees) * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a), det = c * c - s * s;
  return { width: (g.width * c - g.height * s) / det, height: (g.height * c - g.width * s) / det };
}

/** Normalised processed-image point (0–1000) → fraction of the displayed page (0–1, top-left origin). */
export function processedToViewed(x: number, y: number, g: ProcessedGeometry): { fx: number; fy: number } {
  const px = (x / 1000) * g.width, py = (y / 1000) * g.height;
  const pre = preDeskewSize(g);
  if (Math.abs(g.deskewDegrees) < DESKEW_MIN) return { fx: px / g.width, fy: py / g.height };
  // Forward: p' = R(θ)(p − c) + c' with θ = −deskew (clockwise-positive in y-down image coordinates).
  // Inverse: p = R(−θ)(p' − c') + c.
  const theta = (-g.deskewDegrees * Math.PI) / 180;
  const c = Math.cos(-theta), s = Math.sin(-theta);
  const dx = px - g.width / 2, dy = py - g.height / 2;
  const ox = c * dx - s * dy + pre.width / 2;
  const oy = s * dx + c * dy + pre.height / 2;
  return { fx: ox / pre.width, fy: oy / pre.height };
}

/** Fraction of the displayed page → PDF user space (bottom-left origin), honouring /Rotate. */
export function viewedToPdf(fx: number, fy: number, box: PdfBox, rotation: number): { x: number; y: number } {
  const r = ((rotation % 360) + 360) % 360;
  switch (r) {
    case 90: return { x: box.x + fy * box.width, y: box.y + fx * box.height };
    case 180: return { x: box.x + (1 - fx) * box.width, y: box.y + fy * box.height };
    case 270: return { x: box.x + (1 - fy) * box.width, y: box.y + (1 - fx) * box.height };
    default: return { x: box.x + fx * box.width, y: box.y + (1 - fy) * box.height };
  }
}

/** Displayed page size in points (width/height swap for 90° and 270°). */
export function viewedSize(box: PdfBox, rotation: number): { width: number; height: number } {
  const r = ((rotation % 360) + 360) % 360;
  return r === 90 || r === 270 ? { width: box.height, height: box.width } : { width: box.width, height: box.height };
}

/** Normalised processed-image point → PDF user space. */
export function regionPointToPdf(x: number, y: number, g: ProcessedGeometry, box: PdfBox, rotation: number) {
  const v = processedToViewed(x, y, g);
  return viewedToPdf(Math.min(1, Math.max(0, v.fx)), Math.min(1, Math.max(0, v.fy)), box, rotation);
}
