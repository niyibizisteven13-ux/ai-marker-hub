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

const blankPage = (inkN: number, total: number) => inkN / Math.max(1, total) < 0.0005;

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


/** A small grayscale copy of an image as raw bytes. */
async function smallGray(image: Buffer, side: number) {
  const r = await sharp(image).grayscale().resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.length), w: r.info.width, h: r.info.height };
}

/**
 * Phone photos show the paper on a desk. Finds the largest bright region (the paper) on a small copy and returns its box in 0–1 coordinates,
 * or null when the image is already (nearly) all paper, the bright region is not paper-like, or nothing separates paper from background.
 * Only a clear gain is taken: cropping must remove at least 12% of the area, and never cut into the paper.
 */
/** @see findPage */
export function findPageBox(gray: Uint8Array, w: number, h: number) { return findPage(gray, w, h)?.box ?? null; }
export interface FoundPage { box: { x0: number; y0: number; x1: number; y1: number }; /** 1 = paper, on the same small grid (w × h) the search ran on. */ mask: Uint8Array; w: number; h: number }
export function findPage(gray: Uint8Array, w: number, h: number): FoundPage | null {
  const thr = otsuThreshold(gray);
  if (thr < 60) return null;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = gray[i] > thr ? 1 : 0;
  // Ink inside the paper must not split it: close small holes by treating a pixel as paper if most of its 7x7 neighbourhood is.
  const r = 3;
  const closed = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let n = 0, t = 0;
    for (let dy = -r; dy <= r; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -r; dx <= r; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; t++; n += mask[yy * w + xx]; } }
    closed[y * w + x] = n / t > 0.4 ? 1 : 0;
  }
  // Largest connected component (4-neighbour flood fill).
  const seen = new Uint8Array(w * h);
  let best = { n: 0, x0: 0, y0: 0, x1: 0, y1: 0, start: -1 };
  const stack: number[] = [];
  for (let i = 0; i < closed.length; i++) {
    if (!closed[i] || seen[i]) continue;
    let n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!; const x = c % w, y = (c - x) / w; n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && closed[c - 1] && !seen[c - 1]) { seen[c - 1] = 1; stack.push(c - 1); }
      if (x < w - 1 && closed[c + 1] && !seen[c + 1]) { seen[c + 1] = 1; stack.push(c + 1); }
      if (y > 0 && closed[c - w] && !seen[c - w]) { seen[c - w] = 1; stack.push(c - w); }
      if (y < h - 1 && closed[c + w] && !seen[c + w]) { seen[c + w] = 1; stack.push(c + w); }
    }
    if (n > best.n) best = { n, x0, y0, x1, y1, start: i };
  }
  const boxArea = (best.x1 - best.x0 + 1) * (best.y1 - best.y0 + 1);
  const frac = boxArea / (w * h);
  if (frac < 0.25 || frac > 0.88) return null;                 // tiny region: not the paper; nearly everything: nothing to crop
  if (best.n / boxArea < 0.75) return null;                      // a ragged shape is not a sheet of paper
  const pad = 0.012;
  // The edge of a sheet on a desk is a sharp step; a shadow across a page is a smooth gradient. Only a sharp edge is the edge of a sheet,
  // so a shadowed page is never mistaken for paper-on-desk and cropped through its writing.
  {
    const inC = new Uint8Array(w * h); const stk = [best.start]; inC[best.start] = 1;
    while (stk.length) { const c = stk.pop()!; const x = c % w;
      if (x > 0 && closed[c - 1] && !inC[c - 1]) { inC[c - 1] = 1; stk.push(c - 1); }
      if (x < w - 1 && closed[c + 1] && !inC[c + 1]) { inC[c + 1] = 1; stk.push(c + 1); }
      if (c >= w && closed[c - w] && !inC[c - w]) { inC[c - w] = 1; stk.push(c - w); }
      if (c < w * h - w && closed[c + w] && !inC[c + w]) { inC[c + w] = 1; stk.push(c + w); } }
    let g = 0, n = 0;
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (inC[i] && (!inC[i - 1] || !inC[i + 1] || !inC[i - w] || !inC[i + w])) {
        g += Math.max(Math.abs(gray[i + 2] - gray[i - 2]), Math.abs(gray[i + 2 * w] - gray[i - 2 * w])) / 4; n++;
      }
    }
    if (n < 20 || g / n < 20) return null;
  }
  // The paper itself, as a mask: the component that was largest.
  const paperMask = new Uint8Array(w * h);
  const st = [best.start]; paperMask[best.start] = 1;
  while (st.length) {
    const c = st.pop()!; const x = c % w;
    if (x > 0 && closed[c - 1] && !paperMask[c - 1]) { paperMask[c - 1] = 1; st.push(c - 1); }
    if (x < w - 1 && closed[c + 1] && !paperMask[c + 1]) { paperMask[c + 1] = 1; st.push(c + 1); }
    if (c >= w && closed[c - w] && !paperMask[c - w]) { paperMask[c - w] = 1; st.push(c - w); }
    if (c < w * h - w && closed[c + w] && !paperMask[c + w]) { paperMask[c + w] = 1; st.push(c + w); }
  }
  return { box: { x0: Math.max(0, best.x0 / w - pad), y0: Math.max(0, best.y0 / h - pad), x1: Math.min(1, (best.x1 + 1) / w + pad), y1: Math.min(1, (best.y1 + 1) / h + pad) }, mask: paperMask, w, h };
}

/**
 * How unevenly the paper is lit: the spread of the paper brightness across a coarse grid (a shadow or a lamp on one side of the page).
 * 0 = even; above about 0.2 the page has a visible shadow or gradient.
 */
export function unevenLighting(gray: Uint8Array, w: number, h: number, grid = 8): number {
  const cells: number[] = [];
  for (let gy = 0; gy < grid; gy++) for (let gx = 0; gx < grid; gx++) {
    const vals: number[] = [];
    for (let y = Math.floor((gy * h) / grid); y < Math.floor(((gy + 1) * h) / grid); y++) for (let x = Math.floor((gx * w) / grid); x < Math.floor(((gx + 1) * w) / grid); x++) vals.push(gray[y * w + x]);
    if (!vals.length) continue;
    vals.sort((a, b) => a - b);
    cells.push(vals[Math.floor(vals.length * 0.9)]);              // the paper in that cell (ink is dark and rare)
  }
  if (cells.length < 4) return 0;
  const hi = Math.max(...cells), lo = Math.min(...cells);
  return hi > 0 ? Math.round(((hi - lo) / hi) * 100) / 100 : 0;
}

/**
 * Evens out shadows and gradients: every pixel is divided by the local paper brightness (a heavy blur of the page with the ink
 * removed by a grey closing), so paper becomes white everywhere and pencil in a shadow keeps its contrast.
 */
export async function flattenLighting(gray: Buffer): Promise<Buffer> {
  const m = await sharp(gray).metadata();
  const W = m.width ?? 0, H = m.height ?? 0;
  // Background (paper brightness) on a small copy: a maximum filter removes the ink, a blur smooths the result, then it is scaled back up.
  const sm = await sharp(gray).removeAlpha().extractChannel(0).resize({ width: 192, height: 192, fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const sw = sm.info.width, sh = sm.info.height, sv = new Uint8Array(sm.data.buffer, sm.data.byteOffset, sm.data.length);
  const mx = new Uint8Array(sv.length);
  const rad = 2;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let m = 0;
    for (let dy = -rad; dy <= rad; dy++) { const yy = y + dy; if (yy < 0 || yy >= sh) continue; for (let dx = -rad; dx <= rad; dx++) { const xx = x + dx; if (xx < 0 || xx >= sw) continue; const v = sv[yy * sw + xx]; if (v > m) m = v; } }
    mx[y * sw + x] = m;
  }
  // Smooth with a small box blur (done by hand: it keeps the values exact, with no colour-space conversion).
  const smooth = Buffer.alloc(mx.length);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let t = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= sh) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= sw) continue; t += mx[yy * sw + xx]; n++; } }
    smooth[y * sw + x] = Math.round(t / n);
  }
  // Scale back up with bilinear interpolation, by hand for the same reason.
  const bg = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) {
    const fy = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / H - 0.5)); const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(sw - 1, Math.max(0, ((x + 0.5) * sw) / W - 0.5)); const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const top = smooth[y0 * sw + x0] * (1 - tx) + smooth[y0 * sw + x1] * tx, bot = smooth[y1 * sw + x0] * (1 - tx) + smooth[y1 * sw + x1] * tx;
      bg[y * W + x] = Math.round(top * (1 - ty) + bot * ty);
    }
  }
  const src = await sharp(gray).removeAlpha().extractChannel(0).raw().toBuffer();
  const out = Buffer.alloc(src.length);
  for (let i = 0; i < src.length; i++) {
    const b = Math.max(40, bg[i]);
    const v = (src[i] * 255) / b;
    out[i] = v > 255 ? 255 : v;
  }
  return sharp(out, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
}

/** Strength of horizontal text lines: row-profile sharpness over column-profile sharpness. About 1 for an upright page, well below 1 when the page is on its side. */
export function uprightness(gray: Uint8Array, w: number, h: number, threshold: number): number {
  const rows = new Float64Array(h), cols = new Float64Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (gray[y * w + x] < threshold) { rows[y]++; cols[x]++; }
  const spread = (a: Float64Array) => { let m = 0; for (const v of a) m += v; m /= a.length || 1; let s = 0; for (const v of a) s += (v - m) ** 2; return Math.sqrt(s / (a.length || 1)) / (m || 1); };
  const r = spread(rows), c = spread(cols);
  return c > 0 ? Math.round((r / c) * 100) / 100 : 1;
}

export async function preprocessPage(input: Buffer, opts: { maxSide?: number; deskew?: boolean; cropPage?: boolean; flattenLighting?: boolean } = {}): Promise<PreprocessResult> {
  const maxSide = opts.maxSide ?? 2400;
  const transforms: string[] = [];
  // Transparent areas become white paper so they are not mistaken for ink.
  const original0 = await sharp(input, { limitInputPixels: 80_000_000 }).rotate().flatten({ background: '#ffffff' }).png().toBuffer();
  transforms.push('Applied EXIF orientation; flattened any transparency onto white.');
  // A phone photo of a sheet on a desk: keep only the sheet.
  let original = original0;
  let paper: { found: FoundPage; box: { x0: number; y0: number; x1: number; y1: number } } | null = null;
  if (opts.cropPage !== false) {
    const sg = await smallGray(original0, 200);
    const found = findPage(sg.data, sg.w, sg.h);
    const box = found?.box;
    if (found && box) {
      const om = await sharp(original0).metadata();
      const ow = om.width ?? 0, oh = om.height ?? 0;
      const left = Math.round(box.x0 * ow), top = Math.round(box.y0 * oh);
      const width = Math.max(1, Math.round(box.x1 * ow) - left), height = Math.max(1, Math.round(box.y1 * oh) - top);
      original = await sharp(original0).extract({ left, top, width, height }).png().toBuffer();
      paper = { found, box };
      transforms.push(`Cropped to the sheet of paper (removed the desk or background around it; ${ow}×${oh} → ${width}×${height}).`);
    }
  }
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

  // The desk showing in the corners of a tilted sheet would look like ink to the skew search: paint it white on this working copy only.
  if (paper) {
    const { found, box } = paper;
    const gm = await sharp(gray).metadata(); const gw = gm.width ?? 0, gh = gm.height ?? 0;
    const cx0 = Math.max(0, Math.floor(box.x0 * found.w)), cy0 = Math.max(0, Math.floor(box.y0 * found.h));
    const cw = Math.max(1, Math.min(found.w - cx0, Math.ceil((box.x1 - box.x0) * found.w))), ch = Math.max(1, Math.min(found.h - cy0, Math.ceil((box.y1 - box.y0) * found.h)));
    const sub = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) sub[y * cw + x] = found.mask[(cy0 + y) * found.w + cx0 + x] ? 255 : 0;
    const big = await sharp(Buffer.from(sub), { raw: { width: cw, height: ch, channels: 1 } }).resize({ width: gw, height: gh, fit: 'fill', kernel: 'nearest' }).raw().toBuffer();
    const g = await sharp(gray).removeAlpha().extractChannel(0).raw().toBuffer();
    let changed = 0;
    for (let i = 0; i < g.length; i++) if (!big[i]) { g[i] = 255; changed++; }
    if (changed) {
      gray = await sharp(g, { raw: { width: gw, height: gh, channels: 1 } }).png().toBuffer();
      transforms.push('Painted the desk outside the sheet white so it is not read as writing.');
    }
  }

  // Shadows and a lamp on one side of the page: even them out before reading, so pencil in the shadow is not lost.
  let lightingSpread = 0;
  if (opts.flattenLighting !== false) {
    const lg = await smallGray(gray, 160);
    lightingSpread = unevenLighting(lg.data, lg.w, lg.h);
    if (lightingSpread >= 0.2) {
      gray = await flattenLighting(gray);
      transforms.push(`Evened out uneven lighting (shadow or gradient across the paper: ${Math.round(lightingSpread * 100)}%).`);
    }
  }

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
  if (!blankPage(inkN, ov.length) && uprightness(raw, small.info.width, small.info.height, thr) < 0.55) warnings.push('The page may be on its side or upside down. Rotate the photo so the writing runs left to right and take it again if the text comes out wrong.');
  if (lightingSpread >= 0.2) warnings.push(`There is a shadow or uneven light across the page (${Math.round(lightingSpread * 100)}%); it was evened out, but retaking the photo in even light reads better.`);
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
