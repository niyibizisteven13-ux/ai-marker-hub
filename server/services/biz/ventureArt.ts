import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import type { Art, VentureArt } from './venture.js';

/**
 * Draws the pictures of a venture page for ANY venture, on the server, with no browser and no system fonts: a logo (a monogram), a wide banner (the name, the aim and the products)
 * and one picture per product (its name and a line about it). The text is turned into vector shapes from the Inter font files that ship with the app, so it looks the same everywhere.
 * The 4biz page uses the hand-drawn art in server/assets/venture instead; this is what Bwenge AI draws for everyone else.
 */
const require = createRequire(import.meta.url);
type Weight = 'black' | 'bold' | 'semi' | 'med';
const FILES: Record<Weight, string> = { black: '900Black/Inter_900Black.ttf', bold: '700Bold/Inter_700Bold.ttf', semi: '600SemiBold/Inter_600SemiBold.ttf', med: '500Medium/Inter_500Medium.ttf' };
const fonts = new Map<Weight, any>();
const fontOf = (w: Weight) => { let f = fonts.get(w); if (!f) { f = require('fontkit').openSync(require.resolve(`@expo-google-fonts/inter/${FILES[w]}`)); fonts.set(w, f); } return f; };

interface Shaped { glyphs: Array<{ d: string; x: number }>; width: number; size: number; scale: number }
function shape(w: Weight, str: string, size: number, spacing = 0): Shaped {
  const f = fontOf(w); const run = f.layout(str); const scale = size / f.unitsPerEm; let x = 0; const glyphs: Shaped['glyphs'] = [];
  run.glyphs.forEach((g: any, i: number) => { glyphs.push({ d: g.path.toSVG(), x }); x += run.positions[i].xAdvance * scale + spacing; });
  return { glyphs, width: Math.max(0, x - spacing), size, scale };
}
/** Text as vector paths. `anchor` is where x sits; text wider than `maxWidth` is shrunk to fit. */
function text(w: Weight, str: string, size: number, x: number, y: number, o: { anchor?: 'start' | 'middle' | 'end'; spacing?: number; fill: string; maxWidth?: number; minSize?: number } ): { svg: string; width: number; size: number } {
  let sh = shape(w, str, size, o.spacing ?? 0);
  if (o.maxWidth && sh.width > o.maxWidth) sh = shape(w, str, Math.max(o.minSize ?? 8, size * (o.maxWidth / sh.width)), (o.spacing ?? 0) * (o.maxWidth / sh.width));
  const x0 = o.anchor === 'middle' ? x - sh.width / 2 : o.anchor === 'end' ? x - sh.width : x;
  return { size: sh.size, width: sh.width, svg: `<g transform="translate(${x0.toFixed(1)} ${y.toFixed(1)})" fill="${o.fill}">${sh.glyphs.map((g) => `<path transform="translate(${g.x.toFixed(1)} 0) scale(${sh.scale.toFixed(5)} ${(-sh.scale).toFixed(5)})" d="${g.d}"/>`).join('')}</g>` };
}
function wrap(w: Weight, str: string, size: number, maxWidth: number, maxLines: number): string[] {
  const words = str.split(/\s+/).filter(Boolean); const lines: string[] = []; let cur = '';
  for (const word of words) { const t = cur ? `${cur} ${word}` : word; if (shape(w, t, size).width <= maxWidth || !cur) cur = t; else { lines.push(cur); cur = word; } }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { const kept = lines.slice(0, maxLines); let last = kept[maxLines - 1]; while (last.length > 1 && shape(w, `${last}…`, size).width > maxWidth) last = last.slice(0, -1); kept[maxLines - 1] = `${last.replace(/[ ,.;:-]+$/, '')}…`; return kept; }
  return lines;
}
/** The first words of a line that fit, for the small caption under a name. */
const fitLine = (w: Weight, str: string, size: number, maxWidth: number) => wrap(w, str, size, maxWidth, 1)[0] ?? '';

/* ---------------------------------------------------------------- colours */
const NAVY = '#0B1420', DEEP = '#070D16';
const PALETTE: Record<string, { a: string; b: string; c: string }> = {
  gold: { a: '#F6B94A', b: '#E08C1E', c: '#4CE5D6' }, teal: { a: '#4CE5D6', b: '#1FB3A6', c: '#F6B94A' }, green: { a: '#5BE3A0', b: '#1E9E5A', c: '#F6B94A' }, blue: { a: '#7DB0FF', b: '#2F6FED', c: '#4CE5D6' },
  rose: { a: '#FF8DBB', b: '#DB4F8E', c: '#F6B94A' }, violet: { a: '#B49CFF', b: '#7C5CF0', c: '#4CE5D6' }, ink: { a: '#F6B94A', b: '#E08C1E', c: '#4CE5D6' },
};
const pal = (theme?: string) => PALETTE[theme ?? 'ink'] ?? PALETTE.ink;
const initial = (s: string) => (s.trim().match(/[\p{L}\p{N}]/u)?.[0] ?? '•').toUpperCase();

const defs = (p: ReturnType<typeof pal>, w: number, h: number) => `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${NAVY}"/><stop offset=".55" stop-color="#0E2233"/><stop offset="1" stop-color="${NAVY}"/></linearGradient>
  <radialGradient id="g1" cx=".1" cy="0" r=".7"><stop offset="0" stop-color="${p.a}" stop-opacity=".30"/><stop offset="1" stop-color="${p.a}" stop-opacity="0"/></radialGradient>
  <radialGradient id="g2" cx=".95" cy="1" r=".7"><stop offset="0" stop-color="${p.c}" stop-opacity=".26"/><stop offset="1" stop-color="${p.c}" stop-opacity="0"/></radialGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.a}"/><stop offset="1" stop-color="${p.b}"/></linearGradient>
  <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${p.a}"/><stop offset="1" stop-color="${p.c}"/></linearGradient>
  <linearGradient id="card" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".11"/><stop offset="1" stop-color="#fff" stop-opacity=".03"/></linearGradient>
  <pattern id="dots" width="34" height="34" patternUnits="userSpaceOnUse"><circle cx="17" cy="17" r="1.2" fill="#fff" fill-opacity=".10"/></pattern>
  <radialGradient id="fade" cx=".5" cy=".5" r=".7"><stop offset=".3" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <mask id="m"><rect width="${w}" height="${h}" fill="url(#fade)"/></mask>
</defs>`;
const backdrop = (p: ReturnType<typeof pal>, w: number, h: number) => `${defs(p, w, h)}<rect width="${w}" height="${h}" fill="url(#bg)"/><rect width="${w}" height="${h}" fill="url(#g1)"/><rect width="${w}" height="${h}" fill="url(#g2)"/><rect width="${w}" height="${h}" fill="url(#dots)" mask="url(#m)"/>`;
const svgOf = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

export interface ArtSpec { name: string; tagline: string; theme?: string; products: Array<{ name: string; description?: string }> }

/** A monogram logo: the first letter of the name on the brand navy. */
export function logoSvg(spec: ArtSpec): string {
  const p = pal(spec.theme); const ch = text('black', initial(spec.name), 330, 256, 372, { anchor: 'middle', fill: 'url(#gold)' });
  return svgOf(512, 512, `${defs(p, 512, 512)}<rect width="512" height="512" rx="112" fill="url(#bg)"/><rect width="512" height="512" rx="112" fill="url(#g1)"/><rect x="14" y="14" width="484" height="484" rx="100" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="3"/><rect x="170" y="408" width="172" height="12" rx="6" fill="url(#bar)"/>${ch.svg}`);
}

/** The wide banner: name and aim in the top centre (the page puts its own logo and name over the lower left, and a phone shows only the middle), the products as cards on either side. */
export function bannerSvg(spec: ArtSpec): string {
  const W = 2400, H = 600, p = pal(spec.theme); let o = backdrop(p, W, H);
  const name = spec.name.trim(); const first = name.slice(0, 1); const rest = name.slice(1);
  const wm = text('black', name, 190, W / 2, 255, { anchor: 'middle', fill: '#EAF0FA', spacing: -6, maxWidth: 760, minSize: 84 });
  // First letter in the accent: drawn over the white one.
  const fl = text('black', first, wm.size, W / 2 - wm.width / 2, 255, { anchor: 'start', fill: 'url(#gold)', spacing: -6 }); void rest;
  o += wm.svg + fl.svg + `<rect x="${W / 2 - 75}" y="283" width="150" height="6" rx="3" fill="url(#gold)"/>`;
  o += text('bold', spec.tagline.toUpperCase(), 40, W / 2, 352, { anchor: 'middle', fill: p.c, spacing: 7, maxWidth: 820, minSize: 22 }).svg;
  const items = spec.products.slice(0, 4); const left = items.slice(0, Math.ceil(items.length / 2)); const right = items.slice(Math.ceil(items.length / 2));
  const card = (it: { name: string; description?: string }, x: number, y: number) => {
    const nm = text('bold', it.name, 34, x + 126, y + 52, { fill: '#EAF0FA', maxWidth: 280, minSize: 20 }); const sub = it.description ? text('med', fitLine('med', it.description, 21, 280), 21, x + 126, y + 82, { fill: '#9AA9C4' }) : null;
    return `<rect x="${x}" y="${y}" width="440" height="108" rx="30" fill="url(#card)" stroke="#fff" stroke-opacity=".13"/><rect x="${x + 24}" y="${y + 14}" width="80" height="80" rx="24" fill="#fff" fill-opacity=".07" stroke="#fff" stroke-opacity=".12"/>${text('black', initial(it.name), 46, x + 64, y + 69, { anchor: 'middle', fill: 'url(#gold)' }).svg}${nm.svg}${sub?.svg ?? ''}`;
  };
  const rows = Math.max(left.length, right.length); const dy = (n: number) => ((rows - n) * 132) / 2;   // a shorter side is centred against the longer one
  left.forEach((it, i) => { o += card(it, 230 + (i % 2) * 50, 62 + dy(left.length) + i * 132); }); right.forEach((it, i) => { o += card(it, W - 230 - 440 - (i % 2) * 50, 62 + dy(right.length) + i * 132); });
  o += `<rect x="0" y="${H - 8}" width="${W}" height="8" fill="url(#bar)"/>`;
  return svgOf(W, H, o);
}

/** One product picture: the venture's name, the product's name big, and a line about it. */
export function productSvg(spec: ArtSpec, i: number): string {
  const W = 1200, H = 900, p = pal(spec.theme); const prod = spec.products[i]; let o = backdrop(p, W, H);
  o += `<rect x="56" y="48" width="64" height="64" rx="18" fill="url(#bg)" stroke="#fff" stroke-opacity=".14"/>${text('black', initial(spec.name), 40, 88, 94, { anchor: 'middle', fill: 'url(#gold)' }).svg}${text('bold', spec.name, 36, 140, 92, { fill: '#EAF0FA', maxWidth: 800, minSize: 22 }).svg}`;
  o += `<rect x="110" y="190" width="980" height="560" rx="44" fill="url(#card)" stroke="#fff" stroke-opacity=".14"/><rect x="160" y="238" width="132" height="132" rx="38" fill="url(#bg)" stroke="#fff" stroke-opacity=".16"/>${text('black', initial(prod.name), 86, 226, 332, { anchor: 'middle', fill: 'url(#gold)' }).svg}`;
  const lines = wrap('black', prod.name, 88, 860, 2); lines.forEach((l, k) => { o += text('black', l, 88, 160, 470 + k * 100, { fill: '#EAF0FA', spacing: -2, maxWidth: 860, minSize: 40 }).svg; });
  const top = 470 + lines.length * 100 + 14;
  o += `<rect x="160" y="${top - 52}" width="96" height="6" rx="3" fill="url(#gold)"/>`;
  if (prod.description) wrap('med', prod.description, 34, 860, 3).forEach((l, k) => { o += text('med', l, 34, 160, top + 20 + k * 50, { fill: '#B7C3DB' }).svg; });
  o += `<rect x="0" y="${H - 8}" width="${W}" height="8" fill="url(#bar)"/>`;
  return svgOf(W, H, o);
}

const hash = (parts: string[]) => createHash('sha1').update(parts.join('\u0001')).digest('hex').slice(0, 8);
/** Draws the whole set. File names carry a short fingerprint of what was drawn: the same words give the same names (so a second run uploads nothing), changed words replace the old pictures. */
export async function renderVentureArt(spec: ArtSpec, prefix = 'venture-'): Promise<VentureArt> {
  const fp = hash([spec.name, spec.tagline, spec.theme ?? '', ...spec.products.flatMap((p) => [p.name, p.description ?? ''])]);
  const jpg = (svg: string) => sharp(Buffer.from(svg), { density: 72 }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  const art = (name: string, data: Buffer): Art => ({ name: `${prefix}${name}-${fp}`, data });
  const logo = art('logo.png', await sharp(Buffer.from(logoSvg(spec))).png({ compressionLevel: 9 }).toBuffer()); logo.name = `${prefix}logo-${fp}.png`;
  const cover = art('banner.jpg', await jpg(bannerSvg(spec))); cover.name = `${prefix}banner-${fp}.jpg`;
  const products: Record<string, Art> = {}; for (const [i, p] of spec.products.entries()) { const a = art(`p${i}.jpg`, await jpg(productSvg(spec, i))); a.name = `${prefix}product${i + 1}-${fp}.jpg`; products[p.name] = a; }
  return { logo, cover, products, prefix };
}
