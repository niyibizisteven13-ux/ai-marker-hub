import { useEffect, useState } from 'react';
import { APP_DOWNLOAD_URL } from '../config';

export function QrCard({ qrTitle }: { qrTitle: string }) {
  const [svgContent, setSvgContent] = useState<string>('');

  useEffect(() => {
    const n = 29;
    let seed = 20261010;
    let out = '';
    function rnd() {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    function fin(x: number, y: number) {
      out += `<rect x="${x}" y="${y}" width="7" height="7" rx="1.2" fill="currentColor"/><rect x="${x + 1}" y="${
        y + 1
      }" width="5" height="5" rx=".8" fill="var(--surface)"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx=".5" fill="currentColor"/>`;
    }
    fin(0, 0);
    fin(n - 7, 0);
    fin(0, n - 7);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if ((x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8)) continue;
        if (x >= 10 && x <= 18 && y >= 10 && y <= 18) continue;
        if (rnd() > 0.52) {
          out += `<rect x="${x}" y="${y}" width="1" height="1" fill="currentColor"/>`;
        }
      }
    }
    out += `<g transform="translate(11.1 11) scale(.013)"><rect width="528" height="536" rx="100" fill="#0B1420"/><g transform="translate(0,536) scale(0.1,-0.1)"><path d="M2455 4433 c-22 -2 -134 -20 -250 -39 -192 -32 -218 -38 -315 -83 -58 -26 -125 -56 -150 -66 -69 -29 -235 -143 -335 -231 -193 -168 -263 -255 -405 -499 -12 -22 -39 -63 -58 -92 -34 -50 -55 -115 -116 -353 -51 -196 -59 -467 -21 -709 34 -220 146 -516 245 -647 21 -27 50 -75 65 -105 31 -60 224 -267 290 -310 22 -15 51 -39 65 -53 13 -15 40 -37 60 -48 19 -12 65 -41 102 -65 65 -42 269 -130 353 -152 77 -19 271 -60 370 -77 122 -21 297 -14 413 16 42 10 119 26 171 35 89 16 285 81 360 119 68 35 217 146 281 208 36 35 82 75 101 90 20 15 51 50 69 77 26 42 37 51 61 51 20 0 34 -8 46 -27 15 -23 19 -59 23 -238 8 -303 1 -297 283 -297 200 -1 226 6 249 69 10 31 12 200 11 860 -2 886 -1 865 -53 893 -14 7 -288 10 -867 10 l-846 0 -41 -23 c-63 -35 -67 -49 -64 -242 3 -143 6 -175 21 -198 34 -52 47 -54 397 -60 361 -6 475 -19 516 -58 33 -31 32 -84 -2 -130 -14 -19 -39 -61 -54 -95 -63 -138 -245 -301 -445 -398 -207 -101 -206 -101 -455 -100 -256 1 -301 9 -490 87 -169 71 -241 127 -370 287 -24 30 -59 71 -77 90 -29 32 -67 92 -124 195 -43 78 -99 309 -109 454 -12 164 -5 235 49 444 57 223 102 303 265 468 221 225 295 275 503 338 160 49 208 55 392 47 161 -6 293 -27 526 -81 121 -29 132 -30 145 -6 17 34 23 112 11 156 -9 32 -44 73 -175 207 -180 181 -273 250 -361 267 -60 12 -204 19 -260 14z" fill="url(#goldGrad)"/><path d="M3440 4423 c-143 -6 -165 -39 -84 -128 53 -58 147 -212 176 -287 17 -44 22 -90 29 -258 5 -113 15 -227 22 -255 11 -46 15 -50 50 -58 52 -13 78 1 119 61 18 27 93 115 167 196 74 80 151 172 172 204 20 31 78 99 129 151 93 94 182 216 194 267 9 34 -19 75 -57 85 -95 25 -521 35 -917 22z" fill="url(#tealGrad)"/></g></g>`;
    setSvgContent(out);
  }, []);

  return (
    <div className="qr">
      <p>{qrTitle}</p>
      <svg
        viewBox="0 0 29 29"
        shapeRendering="crispEdges"
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />
    </div>
  );
}
