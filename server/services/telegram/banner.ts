import fs from 'node:fs';
import path from 'node:path';
import { svgToPng } from '../ai/drawing/rasterize.js';
import type { Lang } from './ui.js';

/**
 * The welcome banner shown above the home menu: brand mark, name, tagline and four feature tiles with
 * line icons (drawn as vectors, so they look the same on every phone, unlike emoji). Rendered once per
 * language; the Telegram file_id is cached after the first upload so later /start calls send no bytes.
 */

const W = 1280;
const H = 640;

// Lucide-style 24px line icons.
const ICONS: Record<string, string> = {
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  mark: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  library: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
};

const TEXT: Record<Lang, { tagline: string; tiles: [string, string][] }> = {
  en: { tagline: 'Your education, research & data companion', tiles: [['chart', 'Charts & files'], ['mark', 'Mark exams'], ['scan', 'Scan papers'], ['library', 'Ask my library']] },
  rw: { tagline: 'Mugenzi wawe mu burezi, ubushakashatsi n’imibare', tiles: [['chart', 'Ibishushanyo'], ['mark', 'Gukosora'], ['scan', 'Scan impapuro'], ['library', 'Isomero']] },
  fr: { tagline: 'Votre compagnon : éducation, recherche et données', tiles: [['chart', 'Graphiques'], ['mark', 'Corriger'], ['scan', 'Scanner'], ['library', 'Bibliothèque']] },
};

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let logoHref: string | null | undefined;
function logo(): string | null {
  if (logoHref !== undefined) return logoHref;
  try {
    const svg = fs.readFileSync(path.join(process.cwd(), 'src', 'assets', 'bwenge-logo.svg'));
    logoHref = `data:image/svg+xml;base64,${svg.toString('base64')}`;
  } catch {
    logoHref = null;
  }
  return logoHref;
}

export function bannerSvg(lang: Lang): string {
  const t = TEXT[lang] ?? TEXT.en;
  const tileW = 260;
  const gap = 20;
  const x0 = (W - (tileW * 4 + gap * 3)) / 2;
  const accents = ['#D97757', '#5DCAA5', '#E8B04B', '#7EA6F2'];
  const tiles = t.tiles.map(([icon, label], i) => {
    const x = x0 + i * (tileW + gap);
    // Inter averages ~0.56 em per character; shrink long labels to fit beside the icon.
    const size = Math.min(23, Math.floor((tileW - 94 - 18) / (label.length * 0.56)));
    return `<g transform="translate(${x} 452)">
  <rect width="${tileW}" height="112" rx="22" fill="#ffffff" fill-opacity="0.045" stroke="#ffffff" stroke-opacity="0.10"/>
  <rect x="22" y="28" width="56" height="56" rx="16" fill="${accents[i]}" fill-opacity="0.14"/>
  <g transform="translate(36 42) scale(1.17)" fill="none" stroke="${accents[i]}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</g>
  <text x="94" y="64" font-family="Inter" font-size="${size}" font-weight="600" fill="#FAF9F5">${xml(label)}</text>
</g>`;
  }).join('\n');
  const mark = logo()
    ? `<image href="${logo()}" x="${W / 2 - 52}" y="70" width="104" height="106"/>`
    : `<rect x="${W / 2 - 52}" y="70" width="104" height="104" rx="26" fill="#0B1420"/><text x="${W / 2}" y="142" text-anchor="middle" font-family="Inter" font-size="56" font-weight="700" fill="#F6B94A">B</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1B1A19"/><stop offset="1" stop-color="#262624"/></linearGradient>
  <radialGradient id="glowA" cx="0.85" cy="0.05" r="0.55"><stop offset="0" stop-color="#D97757" stop-opacity="0.28"/><stop offset="1" stop-color="#D97757" stop-opacity="0"/></radialGradient>
  <radialGradient id="glowB" cx="0.08" cy="1" r="0.6"><stop offset="0" stop-color="#5DCAA5" stop-opacity="0.18"/><stop offset="1" stop-color="#5DCAA5" stop-opacity="0"/></radialGradient>
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#ffffff" stroke-opacity="0.035"/></pattern>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#grid)"/>
<rect width="${W}" height="${H}" fill="url(#glowA)"/>
<rect width="${W}" height="${H}" fill="url(#glowB)"/>
${mark}
<text x="${W / 2}" y="262" text-anchor="middle" font-family="Inter" font-size="76" font-weight="700" fill="#FAF9F5" letter-spacing="-1.5">Bwenge AI</text>
<text x="${W / 2}" y="318" text-anchor="middle" font-family="Inter" font-size="28" fill="#C2C0B6">${xml(t.tagline)}</text>
<rect x="${W / 2 - 28}" y="358" width="56" height="4" rx="2" fill="#D97757"/>
${tiles}
</svg>`;
}

const png = new Map<Lang, Buffer>();
const fileIds = new Map<Lang, string>();

export function bannerPng(lang: Lang): Buffer {
  let b = png.get(lang);
  if (!b) {
    b = svgToPng(bannerSvg(lang), { width: W, background: '#1B1A19' }).data;
    png.set(lang, b);
  }
  return b;
}

/** Cached Telegram file_id of the uploaded banner, so it is sent by reference after the first time. */
export const bannerFileId = (lang: Lang) => fileIds.get(lang);
export const rememberBannerFileId = (lang: Lang, id: string | undefined) => { if (id) fileIds.set(lang, id); };
