export function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export function autoDetectQuad(srcCanvas: HTMLCanvasElement) {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const ctx = srcCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas context unavailable');
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  function gradAt(x: number, y: number) {
    if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) return 0;
    const gx = gray[y * w + x + 1] - gray[y * w + x - 1];
    const gy = gray[(y + 1) * w + x] - gray[(y - 1) * w + x];
    return Math.sqrt(gx * gx + gy * gy);
  }

  const bandFrac = 0.12;
  const thresh = 28;
  const minInset = 0.02;

  function scanSide(axis: 'x' | 'y', fromStart: boolean) {
    const bandCenter = axis === 'x' ? Math.floor(h / 2) : Math.floor(w / 2);
    const bandHalf = Math.floor((axis === 'x' ? h : w) * bandFrac / 2);
    const limit = axis === 'x' ? w : h;
    const start = fromStart ? Math.floor(limit * minInset) : Math.floor(limit * (1 - minInset));
    const step = fromStart ? 1 : -1;
    let hitCount = 0;
    for (let i = start; fromStart ? i < limit * 0.5 : i > limit * 0.5; i += step) {
      let sum = 0;
      let n = 0;
      for (let b = -bandHalf; b <= bandHalf; b += 2) {
        const x = axis === 'x' ? i : bandCenter + b;
        const y = axis === 'x' ? bandCenter + b : i;
        sum += gradAt(x, y);
        n++;
      }
      const avg = n ? sum / n : 0;
      if (avg > thresh) {
        hitCount++;
        if (hitCount >= 3) return i - step * 2;
      } else {
        hitCount = 0;
      }
    }
    return fromStart ? Math.floor(limit * minInset) : Math.floor(limit * (1 - minInset));
  }

  const left = clamp(scanSide('x', true), 0, w * 0.4);
  const right = clamp(scanSide('x', false), w * 0.6, w);
  const top = clamp(scanSide('y', true), 0, h * 0.4);
  const bottom = clamp(scanSide('y', false), h * 0.6, h);

  return {
    tl: { x: left, y: top },
    tr: { x: right, y: top },
    br: { x: right, y: bottom },
    bl: { x: left, y: bottom },
  };
}

export function applyFilter(imageData: ImageData, mode: 'color' | 'gray' | 'bw') {
  if (mode === 'color') return imageData;
  const d = imageData.data;
  if (mode === 'gray') {
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    return imageData;
  }
  if (mode === 'bw') {
    const w = imageData.width;
    const h = imageData.height;
    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      gray[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
    const blockSize = Math.max(8, Math.floor(Math.min(w, h) / 48));
    const bw = Math.ceil(w / blockSize);
    const bh = Math.ceil(h / blockSize);
    const blockAvg = new Float32Array(bw * bh);
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        let sum = 0;
        let n = 0;
        const x0 = bx * blockSize;
        const y0 = by * blockSize;
        for (let y = y0; y < Math.min(h, y0 + blockSize); y++) {
          for (let x = x0; x < Math.min(w, x0 + blockSize); x++) {
            sum += gray[y * w + x];
            n++;
          }
        }
        blockAvg[by * bw + bx] = n ? sum / n : 255;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const bx = Math.min(bw - 1, Math.floor(x / blockSize));
        const by = Math.min(bh - 1, Math.floor(y / blockSize));
        const local = blockAvg[by * bw + bx];
        const p = y * w + x;
        const val = gray[p] > local - 12 ? 255 : 0;
        const idx = p * 4;
        d[idx] = d[idx + 1] = d[idx + 2] = val;
      }
    }
    return imageData;
  }
  return imageData;
}
