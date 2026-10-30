import fs from 'node:fs';
import path from 'node:path';
import { svgToPng } from '../ai/drawing/rasterize.js';
import type { Lang } from './ui.js';

/**
 * The welcome banner shown above the home menu: brand mark, name, tagline and six feature tiles laid out like
 * the menu buttons below it, each with an app-style icon (white line icon on a gradient tile, drawn as vectors so
 * it looks the same on every phone, unlike emoji). Rendered once per language; the Telegram file_id is cached
 * after the first upload so later /start calls send no bytes.
 */

const W = 1280;
const H = 720;

// Lucide-style 24px line icons.
const ICONS: Record<string, string> = {
  mark: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  transcribe: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  library: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  files: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
};
// Each feature keeps its colour everywhere: [light, dark] ends of the tile gradient.
const TONES: Record<string, [string, string]> = {
  mark: ['#F0956F', '#C25A3A'], scan: ['#6FA8FF', '#3B6FD8'], chart: ['#F5C451', '#D08F1F'],
  transcribe: ['#B79CFF', '#7C5BE0'], library: ['#5FD3A8', '#2E9C74'], files: ['#9AA5B8', '#5E687B'],
};

type Tile = [keyof typeof ICONS, string, string];
const TEXT: Record<Lang, { tagline: string; tiles: Tile[] }> = {
  en: { tagline: 'Your education, research & data companion', tiles: [
    ['mark', 'Mark exams', 'Red pen + Excel results'], ['scan', 'Scan papers', 'One tap per page'], ['chart', 'Charts & files', 'Excel, Word, PDF, slides'],
    ['transcribe', 'Transcribe', 'Handwriting to text'], ['library', 'Ask my library', 'Answers with sources'], ['files', 'My files', 'Everything you made'],
  ] },
  rw: { tagline: 'Mugenzi wawe mu burezi, ubushakashatsi n’imibare', tiles: [
    ['mark', 'Gukosora', 'Ikaramu itukura + Excel'], ['scan', 'Sikana', 'Gukanda rimwe ku rupapuro'], ['chart', 'Ibishushanyo', 'Excel, Word, PDF'],
    ['transcribe', 'Kwandika', 'Intoki zihinduka inyandiko'], ['library', 'Isomero', 'Ibisubizo n’aho byavuye'], ['files', 'Dosiye zanjye', 'Ibyo wakoze byose'],
  ] },
  fr: { tagline: 'Votre compagnon : éducation, recherche et données', tiles: [
    ['mark', 'Corriger', 'Stylo rouge + résultats Excel'], ['scan', 'Scanner', 'Une touche par page'], ['chart', 'Graphiques', 'Excel, Word, PDF, diapos'],
    ['transcribe', 'Transcrire', 'Manuscrit vers texte'], ['library', 'Bibliothèque', 'Réponses avec sources'], ['files', 'Mes fichiers', 'Tout ce que vous avez créé'],
  ] },
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
  const cols = 3;
  const tileW = 360;
  const tileH = 128;
  const gap = 24;
  const x0 = (W - (tileW * cols + gap * (cols - 1))) / 2;
  const y0 = 352;
  const textW = tileW - 116 - 20;
  // One size for every label and one for every caption (Inter averages ~0.56 em per character), so the grid reads evenly.
  const labelSize = Math.min(27, ...t.tiles.map(([, l]) => Math.floor(textW / (l.length * 0.58))));
  const subSize = Math.min(18, ...t.tiles.map(([, , d]) => Math.floor(textW / (d.length * 0.52))));
  const defs = Object.entries(TONES).map(([k, [a, b]]) => `<linearGradient id="t-${k}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`).join('');
  const tiles = t.tiles.map(([icon, label, sub], i) => {
    const x = x0 + (i % cols) * (tileW + gap);
    const y = y0 + Math.floor(i / cols) * (tileH + gap);
    return `<g transform="translate(${x} ${y})">
  <rect width="${tileW}" height="${tileH}" rx="26" fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.10"/>
  <rect x="24" y="${(tileH - 72) / 2 + 3}" width="72" height="72" rx="20" fill="#000000" fill-opacity="0.25"/>
  <rect x="24" y="${(tileH - 72) / 2}" width="72" height="72" rx="20" fill="url(#t-${icon})"/>
  <rect x="24" y="${(tileH - 72) / 2}" width="72" height="36" rx="20" fill="#ffffff" fill-opacity="0.10"/>
  <g transform="translate(42 ${(tileH - 72) / 2 + 18}) scale(1.5)" fill="none" stroke="#ffffff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</g>
  <text x="116" y="${tileH / 2 - 4}" font-family="Inter" font-size="${labelSize}" font-weight="600" fill="#FAF9F5">${xml(label)}</text>
  <text x="116" y="${tileH / 2 + 26}" font-family="Inter" font-size="${subSize}" fill="#A9A79F">${xml(sub)}</text>
</g>`;
  }).join('\n');
  const mark = logo()
    ? `<image href="${logo()}" x="${W / 2 - 44}" y="48" width="88" height="90"/>`
    : `<rect x="${W / 2 - 44}" y="48" width="88" height="88" rx="22" fill="#0B1420"/><text x="${W / 2}" y="108" text-anchor="middle" font-family="Inter" font-size="48" font-weight="700" fill="#F6B94A">B</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#161514"/><stop offset="1" stop-color="#24231F"/></linearGradient>
  <radialGradient id="glowA" cx="0.85" cy="0.02" r="0.55"><stop offset="0" stop-color="#D97757" stop-opacity="0.30"/><stop offset="1" stop-color="#D97757" stop-opacity="0"/></radialGradient>
  <radialGradient id="glowB" cx="0.08" cy="1" r="0.6"><stop offset="0" stop-color="#6FA8FF" stop-opacity="0.14"/><stop offset="1" stop-color="#6FA8FF" stop-opacity="0"/></radialGradient>
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#ffffff" stroke-opacity="0.03"/></pattern>
  ${defs}
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#grid)"/>
<rect width="${W}" height="${H}" fill="url(#glowA)"/>
<rect width="${W}" height="${H}" fill="url(#glowB)"/>
${mark}
<text x="${W / 2}" y="214" text-anchor="middle" font-family="Inter" font-size="68" font-weight="700" fill="#FAF9F5" letter-spacing="-1.5">Bwenge AI</text>
<text x="${W / 2}" y="264" text-anchor="middle" font-family="Inter" font-size="26" fill="#C2C0B6">${xml(t.tagline)}</text>
<rect x="${W / 2 - 24}" y="298" width="48" height="4" rx="2" fill="#D97757"/>
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
