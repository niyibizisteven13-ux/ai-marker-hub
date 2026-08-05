export function dist(p1: { x: number; y: number }, p2: { x: number; y: number }) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

export function quadWidthHeight(q: Record<'tl' | 'tr' | 'br' | 'bl', { x: number; y: number }>) {
  const wTop = dist(q.tl, q.tr);
  const wBot = dist(q.bl, q.br);
  const hLeft = dist(q.tl, q.bl);
  const hRight = dist(q.tr, q.br);
  return { w: Math.max(wTop, wBot), h: Math.max(hLeft, hRight) };
}

function solveLinear(A: number[][], b: number[]) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    [M[col], M[piv]] = [M[piv], M[col]];
    const pv = M[col][col] || 1e-12;
    for (let c2 = col; c2 <= n; c2++) M[col][c2] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c2 = col; c2 <= n; c2++) M[r][c2] -= f * M[col][c2];
    }
  }
  return M.map((row) => row[n]);
}

export function computeHomography(srcQuad: { x: number; y: number }[], dstQuad: { x: number; y: number }[]) {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = srcQuad[i];
    const { x: u, y: v } = dstQuad[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinear(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function warpQuadToRect(srcCanvas: HTMLCanvasElement, quad: Record<'tl' | 'tr' | 'br' | 'bl', { x: number; y: number }>, outW: number, outH: number) {
  const dstRect = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH },
  ];
  const srcPts = [quad.tl, quad.tr, quad.br, quad.bl];
  const H = computeHomography(dstRect, srcPts);

  const sctx = srcCanvas.getContext('2d');
  if (!sctx) throw new Error('Source canvas context missing');
  const srcData = sctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
  const sw = srcCanvas.width;
  const sh = srcCanvas.height;

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('Destination canvas context missing');
  const outData = octx.createImageData(outW, outH);

  const [a, bb, c, dd, e, f, g, h, i] = H;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const denom = g * x + h * y + i;
      const sx = (a * x + bb * y + c) / denom;
      const sy = (dd * x + e * y + f) / denom;
      const di = (y * outW + x) * 4;

      if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) {
        outData.data[di] = 255;
        outData.data[di + 1] = 255;
        outData.data[di + 2] = 255;
        outData.data[di + 3] = 255;
        continue;
      }

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      for (let ch = 0; ch < 3; ch++) {
        const p00 = srcData.data[(y0 * sw + x0) * 4 + ch];
        const p10 = srcData.data[(y0 * sw + x0 + 1) * 4 + ch];
        const p01 = srcData.data[((y0 + 1) * sw + x0) * 4 + ch];
        const p11 = srcData.data[((y0 + 1) * sw + x0 + 1) * 4 + ch];
        const top = p00 * (1 - fx) + p10 * fx;
        const bot = p01 * (1 - fx) + p11 * fx;
        outData.data[di + ch] = top * (1 - fy) + bot * fy;
      }
      outData.data[di + 3] = 255;
    }
  }

  octx.putImageData(outData, 0, 0);
  return out;
}

export function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
