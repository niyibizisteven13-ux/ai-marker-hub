import sharp from 'sharp';

/**
 * Deterministic page preprocessing. The original image is always kept; processed versions are
 * alternatives, and every transform is recorded so results can be traced back to the scan.
 *
 * - orientation from EXIF, then grayscale + contrast normalisation (no binarisation for the model:
 *   faint pencil and coloured marks survive better in grayscale)
 * - skew estimated with a projection profile over Otsu-thresholded ink pixels, then corrected
 * - quality signals (resolution, contrast, sharpness) produce warnings, not hard failures
 */

export interface PageQuality {
  width: number;
  height: number;
  /** Rough DPI if the page is A4/Letter-sized; null when the aspect ratio is not page-like. */
  estimatedDpi: number | null;
  contrast: number;
  sharpness: number;
  /** Edge steepness at the ink, relative to ink/paper contrast (about 0.8 sharp, below 0.45 blurred). Does not depend on how much is written. */
  edgeSharpness?: number;
  warnings: string[];
}

/**
 * How steeply ink meets paper: the mean gradient at ink edges divided by the ink/paper contrast. Sharp writing
 * jumps from ink to paper in a pixel or two; blurred writing fades over many. Unlike whole-page edge variance,
 * a nearly blank page with a few clean lines does not look blurred.
 */
export async function edgeSharpness(image: Buffer): Promise<number> {
  const g = await sharp(image).grayscale().resize({ width: 1200, fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  const w = g.info.width, h = g.info.height;
  const v = new Uint8Array(g.data.buffer, g.data.byteOffset, g.data.length);
  const thr = otsuThreshold(v);
  let ink = 0, paper = 0, inkN = 0, paperN = 0;
  for (const x of v) { if (x < thr) { ink += x; inkN++; } else { paper += x; paperN++; } }
  if (!inkN || !paperN) return 1;
  const contrast = paper / paperN - ink / inkN;
  if (contrast < 1) return 1;
  let s = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const m = Math.hypot(v[i + 1] - v[i - 1], v[i + w] - v[i - w]);
    if (m > contrast * 0.1) { s += m; n++; }
  }
  return n ? Math.round(((s / n) / contrast) * 100) / 100 : 1;
}

export interface PreprocessResult {
  /** Grayscale, contrast-normalised, deskewed PNG used for recognition. */
  processed: Buffer;
  /** EXIF-oriented original (lossless PNG) kept as evidence and for crops. */
  original: Buffer;
  width: number;
  height: number;
  deskewDegrees: number;
  otsuThreshold: number;
  transforms: string[];
  quality: PageQuality;
}

/** Otsu's threshold over a 256-bin histogram. */
export function otsuThreshold(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; threshold = t; }
  }
  return threshold;
}

/**
 * Estimates text skew in degrees using sharp's rotation convention (positive = content rotated clockwise).
 * Projection profile: for each candidate angle, project ink pixels onto the rotated y-axis and score the
 * sharpness of row histograms (sum of squared bin counts); straight text lines give the sharpest profile.
 */
export function estimateSkew(gray: Uint8Array, width: number, height: number, threshold: number, maxDegrees = 15): number {
  const xs: number[] = [];
  const ys: number[] = [];
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 60_000)));
  // Ignore a border band: page edges, scanner background and rotation borders are long straight
  // lines that would dominate the profile and pull the estimate towards 0°.
  const mx = Math.floor(width * 0.04);
  const my = Math.floor(height * 0.04);
  for (let y = my; y < height - my; y += step) {
    for (let x = mx; x < width - mx; x += step) {
      if (gray[y * width + x] < threshold) { xs.push(x); ys.push(y); }
    }
  }
  if (xs.length < 50) return 0;
  const cx = width / 2;
  const cy = height / 2;
  const score = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    const s = Math.sin(a), c = Math.cos(a);
    const bins = new Map<number, number>();
    for (let i = 0; i < xs.length; i++) {
      // Bin width equals the sampling step; finer bins would favour 0° because grid-sampled points
      // then fall into every step-th bin only (an aliasing artefact).
      const yy = Math.round((-(xs[i] - cx) * s + (ys[i] - cy) * c) / step);
      bins.set(yy, (bins.get(yy) ?? 0) + 1);
    }
    let sq = 0;
    for (const v of bins.values()) sq += v * v;
    return sq;
  };
  let best = 0, bestScore = score(0);
  for (let d = -maxDegrees; d <= maxDegrees; d += 0.5) { const s = score(d); if (s > bestScore) { bestScore = s; best = d; } }
  const coarse = best;
  for (let d = coarse - 0.5; d <= coarse + 0.5; d += 0.1) { const s = score(d); if (s > bestScore) { bestScore = s; best = d; } }
  return Math.round(best * 10) / 10;
}

export async function preprocessPage(input: Buffer, opts: { maxSide?: number; deskew?: boolean } = {}): Promise<PreprocessResult> {
  const maxSide = opts.maxSide ?? 2400;
  const transforms: string[] = [];
  // Transparent areas become white paper so they are not mistaken for ink.
  const original = await sharp(input, { limitInputPixels: 80_000_000 }).rotate().flatten({ background: '#ffffff' }).png().toBuffer();
  transforms.push('Applied EXIF orientation; flattened any transparency onto white.');
  const meta = await sharp(original).metadata();
  const w0 = meta.width ?? 0;
  const h0 = meta.height ?? 0;

  let pipeline = sharp(original).grayscale();
  if (Math.max(w0, h0) > maxSide) {
    pipeline = pipeline.resize({ width: w0 >= h0 ? maxSide : undefined, height: h0 > w0 ? maxSide : undefined, fit: 'inside' });
    transforms.push(`Downscaled so the longest side is ${maxSide}px (original ${w0}×${h0}).`);
  }
  let gray = await pipeline.normalise().png().toBuffer();
  transforms.push('Converted to grayscale and stretched contrast (normalise).');

  // Skew estimated on a small copy for speed.
  const small = await sharp(gray).resize({ width: 800, fit: 'inside', withoutEnlargement: true }).removeAlpha().extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  const raw = new Uint8Array(small.data.buffer, small.data.byteOffset, small.data.length);
  const thr = otsuThreshold(raw);
  let deskew = 0;
  if (opts.deskew !== false) {
    deskew = estimateSkew(raw, small.info.width, small.info.height, thr);
    if (Math.abs(deskew) >= 0.3) {
      gray = await sharp(gray).rotate(-deskew, { background: { r: 255, g: 255, b: 255 } }).flatten({ background: '#ffffff' }).png().toBuffer();
      transforms.push(`Deskewed by ${(-deskew).toFixed(1)}° (projection-profile estimate ${deskew.toFixed(1)}°).`);
    } else transforms.push(`No deskew needed (estimate ${deskew.toFixed(1)}°).`);
  }
  const pm = await sharp(gray).metadata();

  // Quality signals.
  // Ink-vs-paper contrast on the original (before normalisation): mean of paper pixels minus mean of ink
  // pixels, split by Otsu. Global standard deviation would mostly measure how much of the page is ink.
  const o = await sharp(original).grayscale().resize({ width: 800, fit: 'inside', withoutEnlargement: true }).removeAlpha().extractChannel(0).raw().toBuffer();
  const ov = new Uint8Array(o.buffer, o.byteOffset, o.length);
  const othr = otsuThreshold(ov);
  let inkSum = 0, inkN = 0, paperSum = 0, paperN = 0;
  for (const v of ov) { if (v < othr) { inkSum += v; inkN++; } else { paperSum += v; paperN++; } }
  const contrast = inkN && paperN ? Math.round((paperSum / paperN - inkSum / inkN) * 10) / 10 : 0;
  const lap = await sharp(original).grayscale().resize({ width: 1200, fit: 'inside', withoutEnlargement: true })
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 }).stats();
  const sharpness = Math.round(lap.channels[0].stdev ** 2);
  const aspect = Math.max(w0, h0) / Math.max(1, Math.min(w0, h0));
  const estimatedDpi = aspect > 1.25 && aspect < 1.5 ? Math.round(Math.min(w0, h0) / 8.27) : null;
  const warnings: string[] = [];
  if (estimatedDpi !== null && estimatedDpi < 150) warnings.push(`Low resolution (about ${estimatedDpi} DPI for an A4 page). Small or faint handwriting may be misread; rescan at 300 DPI or more if possible.`);
  if (Math.min(w0, h0) < 600) warnings.push(`Very small image (${w0}×${h0}px). Recognition will be unreliable.`);
  if (inkN / Math.max(1, ov.length) < 0.0005) warnings.push('The page looks blank.');
  else if (contrast < 60) warnings.push(`Low contrast between ink and paper (${contrast} grey levels).`);
  // Blur is judged at the ink edges, relative to contrast, and only when ink and paper are well separated.
  const edge = contrast >= 40 && inkN / Math.max(1, ov.length) >= 0.0005 ? await edgeSharpness(original) : 1;
  if (contrast >= 40 && edge < 0.45) warnings.push('The image looks blurred (low edge sharpness); characters may be ambiguous.');
  if (Math.abs(deskew) >= 10) warnings.push(`The page was strongly tilted (${deskew.toFixed(1)}°).`);

  // Poor scans are cleaned up for reading (the original is kept for crops and the marked PDF):
  // local contrast (CLAHE) evens out phone-camera shadows and lifts faint pencil; an unsharp mask
  // restores edges on blurred pages. Clean, sharp pages are left as they are.
  const blank = inkN / Math.max(1, ov.length) < 0.0005;
  const blurred = contrast >= 40 && edge < 0.45;
  const faint = !blank && contrast < 60;
  if (faint || blurred) {
    let fix = sharp(gray);
    if (faint) fix = fix.clahe({ width: 64, height: 64, maxSlope: 3 });
    if (blurred) fix = fix.sharpen({ sigma: 1.2, m1: 0.5, m2: 3 });
    gray = await fix.png().toBuffer();
    transforms.push(`Cleaned up for reading:${faint ? ' local contrast (CLAHE) for faint ink or uneven lighting;' : ''}${blurred ? ' sharpened (unsharp mask) for blur;' : ''} the original is kept for review.`);
  }

  return {
    processed: gray, original, width: pm.width ?? 0, height: pm.height ?? 0, deskewDegrees: deskew, otsuThreshold: thr, transforms,
    quality: { width: w0, height: h0, estimatedDpi, contrast, sharpness, edgeSharpness: edge, warnings },
  };
}

/** Crops a region given in normalised 0–1000 coordinates (with padding) and returns a PNG. */
export async function cropRegion(image: Buffer, region: { x0: number; y0: number; x1: number; y1: number }, pad = 12): Promise<Buffer> {
  const m = await sharp(image).metadata();
  const W = m.width ?? 0, H = m.height ?? 0;
  const left = Math.max(0, Math.floor((region.x0 / 1000) * W) - pad);
  const top = Math.max(0, Math.floor((region.y0 / 1000) * H) - pad);
  const right = Math.min(W, Math.ceil((region.x1 / 1000) * W) + pad);
  const bottom = Math.min(H, Math.ceil((region.y1 / 1000) * H) + pad);
  return sharp(image).extract({ left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }).png().toBuffer();
}
