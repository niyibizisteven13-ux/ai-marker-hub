/**
 * Appearance (Settings → Appearance): light, dark or the device's setting; a colour like Chrome's colour themes
 * (a preset or any custom colour), plain or tinted backgrounds, and an optional background (a built-in scene or
 * the user's own picture). Applied as CSS variables on <html>, so every part of the app changes at once.
 */

export type ThemeMode = 'dark' | 'light' | 'system';
export type ColorStyle = 'neutral' | 'tinted' | 'vibrant';

export interface Appearance {
  mode: ThemeMode;
  /** Base colour, #rrggbb. */
  color: string;
  style: ColorStyle;
  /** 'none', a built-in scene id, or 'image' (the user's picture in `image`). */
  background: string;
  /** The user's own picture as a data URL (resized before saving). */
  image?: string;
  /** How strongly the background is veiled behind text, 0.3 (picture shows) – 0.9 (mostly colour). */
  veil: number;
}

export const DEFAULT_APPEARANCE: Appearance = { mode: 'dark', color: '#D97757', style: 'neutral', background: 'none', veil: 0.72 };

/** Chrome-like colour choices. */
export const PRESET_COLORS: Array<{ id: string; name: string; color: string }> = [
  { id: 'clay', name: 'Bwenge clay', color: '#D97757' },
  { id: 'green', name: 'Green', color: '#1E9E5A' },
  { id: 'teal', name: 'Teal', color: '#0F9D8F' },
  { id: 'cyan', name: 'Cyan', color: '#0EA5C6' },
  { id: 'blue', name: 'Blue', color: '#2F6FED' },
  { id: 'indigo', name: 'Indigo', color: '#5B5BD6' },
  { id: 'violet', name: 'Violet', color: '#8B5CF6' },
  { id: 'pink', name: 'Pink', color: '#DB4F8E' },
  { id: 'red', name: 'Red', color: '#D93F3F' },
  { id: 'orange', name: 'Orange', color: '#EA7A1A' },
  { id: 'gold', name: 'Gold', color: '#C9A227' },
  { id: 'grey', name: 'Grey', color: '#71717A' },
];

/** Built-in backgrounds (drawn with gradients, so they load instantly and look sharp at any size). */
export const SCENES: Array<{ id: string; name: string; css: (c: string, dark: boolean) => string }> = [
  { id: 'aurora', name: 'Aurora', css: (c, d) => `radial-gradient(60% 50% at 15% 10%, ${alpha(c, d ? 0.45 : 0.35)}, transparent 70%), radial-gradient(50% 45% at 85% 20%, ${alpha(shift(c, 40), d ? 0.35 : 0.28)}, transparent 70%), radial-gradient(70% 60% at 50% 100%, ${alpha(shift(c, -50), d ? 0.3 : 0.22)}, transparent 70%)` },
  { id: 'dusk', name: 'Dusk', css: (c, d) => `linear-gradient(160deg, ${alpha(c, d ? 0.38 : 0.26)} 0%, transparent 45%), linear-gradient(330deg, ${alpha(shift(c, 180), d ? 0.25 : 0.18)} 0%, transparent 55%)` },
  { id: 'mesh', name: 'Mesh', css: (c, d) => `radial-gradient(at 0% 0%, ${alpha(c, d ? 0.4 : 0.3)} 0, transparent 50%), radial-gradient(at 100% 0%, ${alpha(shift(c, 60), d ? 0.3 : 0.24)} 0, transparent 50%), radial-gradient(at 100% 100%, ${alpha(shift(c, -60), d ? 0.32 : 0.24)} 0, transparent 50%), radial-gradient(at 0% 100%, ${alpha(shift(c, 120), d ? 0.25 : 0.2)} 0, transparent 50%)` },
  { id: 'grid', name: 'Grid', css: (c, d) => `linear-gradient(${alpha(c, d ? 0.12 : 0.1)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(c, d ? 0.12 : 0.1)} 1px, transparent 1px), radial-gradient(70% 60% at 50% 0%, ${alpha(c, d ? 0.3 : 0.2)}, transparent 70%)` },
  { id: 'paper', name: 'Paper', css: (c, d) => `radial-gradient(${alpha(d ? '#ffffff' : '#000000', d ? 0.05 : 0.06)} 1px, transparent 1.5px) 0 0 / 18px 18px, linear-gradient(180deg, ${alpha(c, d ? 0.18 : 0.12)}, transparent 60%)` },
];

/* ---------------------------------------------------------------- colour maths ---------------------------------------------------------------- */

type RGB = [number, number, number];
const clamp = (n: number, a = 0, b = 1) => Math.min(b, Math.max(a, n));
export const isHex = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);
const rgb = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const hex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return hex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as RGB); };
export function alpha(c: string, a: number) { const [r, g, b] = rgb(c); return `rgb(${r} ${g} ${b} / ${a})`; }

function toHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return hex([f(0) * 255, f(8) * 255, f(4) * 255]);
}
/** The same colour at a given lightness (so it reads well on dark or light backgrounds). */
const withLightness = (c: string, l: number) => { const [h, s] = toHsl(rgb(c)); return fromHsl(h, s, l); };
/** The colour with its hue turned (for scene accents). */
function shift(c: string, deg: number) { const [h, s, l] = toHsl(rgb(c)); return fromHsl((h + deg + 360) % 360, s, l); }
const luminance = (c: string) => { const [r, g, b] = rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

/* ---------------------------------------------------------------- palette ---------------------------------------------------------------- */

const DARK_BASE = { bg: '#262624', panel: '#30302E', panelHover: '#363634', panel2: '#1F1E1D', sunken: '#141413', text: '#FAF9F5', muted: '#C2C0B6', faint: '#9C9A92', ws: '#0F1012', wsCard: '#16171B', wsHover: '#191A1F', wsSunken: '#111216', wsText: '#ECECEE', invert: '#ECECEE' };
const LIGHT_BASE = { bg: '#F7F6F2', panel: '#FFFFFF', panelHover: '#F3F2EE', panel2: '#EFEDE7', sunken: '#E8E5DE', text: '#1F1E1D', muted: '#46443F', faint: '#6E6B64', ws: '#F5F5F3', wsCard: '#FFFFFF', wsHover: '#F2F2EF', wsSunken: '#ECECE8', wsText: '#1B1C1F', invert: '#1F1E1D' };

export function isDark(a: Appearance): boolean {
  if (a.mode === 'system') return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return a.mode !== 'light';
}

/** CSS variables for an appearance. */
export function paletteFor(a: Appearance): Record<string, string> {
  const dark = isDark(a);
  const base = isHex(a.color) ? a.color : DEFAULT_APPEARANCE.color;
  const original = base.toLowerCase() === '#d97757';
  // Accent: readable on the mode's background (a lighter tone on dark, a deeper one on light).
  const brand = original && dark ? '#D97757' : withLightness(base, dark ? clamp(toHsl(rgb(base))[2], 0.52, 0.66) : clamp(toHsl(rgb(base))[2], 0.36, 0.48));
  const soft = original && dark ? '#F0A586' : dark ? withLightness(brand, 0.74) : withLightness(brand, 0.34);
  const strong = original && dark ? '#C96A4C' : mix(brand, dark ? '#000000' : '#000000', 0.12);
  const on = luminance(brand) > 0.45 ? '#141413' : '#FFFFFF';
  const B = dark ? DARK_BASE : LIGHT_BASE;
  // How much of the colour goes into the backgrounds: none (neutral), a hint (tinted), clearly coloured (vibrant).
  const t = a.style === 'vibrant' ? (dark ? 0.16 : 0.12) : a.style === 'tinted' ? (dark ? 0.07 : 0.05) : 0;
  const tint = (c: string, k = 1) => (t ? mix(c, base, t * k) : c);
  return {
    '--brand': brand, '--brand-soft': soft, '--brand-strong': strong, '--brand-on': on,
    '--app-bg': tint(B.bg), '--app-panel': tint(B.panel, 0.8), '--app-panel-hover': tint(B.panelHover, 0.8), '--app-panel-2': tint(B.panel2, 1.1), '--app-sunken': tint(B.sunken, 1.2),
    '--app-text': B.text, '--app-muted': B.muted, '--app-faint': B.faint,
    '--ws-bg': tint(B.ws), '--ws-card': tint(B.wsCard, 0.8), '--ws-card-hover': tint(B.wsHover, 0.8), '--ws-sunken': tint(B.wsSunken), '--ws-text': B.wsText, '--invert-bg': B.invert,
    '--app-line': dark ? 'rgb(255 255 255 / 0.10)' : 'rgb(20 18 14 / 0.12)',
    // Settings and other older screens read these.
    '--accent': brand, '--on-accent': on, '--accent-text': dark ? soft : brand,
    '--bg': tint(B.ws), '--surface': tint(B.wsCard, 0.8), '--surface-2': tint(B.panel2, 1.1), '--text': B.text, '--muted': B.faint,
    '--line': dark ? 'rgb(255 255 255 / 0.09)' : 'rgb(20 18 14 / 0.12)', '--hover': dark ? 'rgb(255 255 255 / 0.04)' : 'rgb(20 18 14 / 0.04)',
  };
}

/** The background layer: a scene or the user's picture, under a veil of the theme's background colour. */
export function backgroundFor(a: Appearance): string | null {
  if (!a.background || a.background === 'none') return null;
  const dark = isDark(a);
  const p = paletteFor(a);
  const veil = clamp(a.veil ?? 0.72, 0.2, 0.95);
  if (a.background === 'image') {
    if (!a.image || !/^data:image\/(jpeg|png|webp);base64,/.test(a.image)) return null;
    return `linear-gradient(${alpha(p['--app-bg'], veil)}, ${alpha(p['--app-bg'], veil)}), url("${a.image}")`;
  }
  const scene = SCENES.find((s) => s.id === a.background);
  return scene ? `${scene.css(isHex(a.color) ? a.color : DEFAULT_APPEARANCE.color, dark)}, linear-gradient(${p['--app-bg']}, ${p['--app-bg']})` : null;
}

const KEY = 'bwenge.appearance';

export function normalizeAppearance(v: unknown): Appearance {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Appearance>;
  return {
    mode: o.mode === 'light' || o.mode === 'system' ? o.mode : 'dark',
    color: isHex(o.color) ? o.color : DEFAULT_APPEARANCE.color,
    style: o.style === 'tinted' || o.style === 'vibrant' ? o.style : 'neutral',
    background: typeof o.background === 'string' && (o.background === 'image' || o.background === 'none' || SCENES.some((s) => s.id === o.background)) ? o.background : 'none',
    ...(typeof o.image === 'string' && o.image.startsWith('data:image/') ? { image: o.image } : {}),
    veil: typeof o.veil === 'number' && Number.isFinite(o.veil) ? clamp(o.veil, 0.2, 0.95) : DEFAULT_APPEARANCE.veil,
  };
}

export function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalizeAppearance(JSON.parse(raw));
    // Before themes existed only light/dark was stored.
    const dark = localStorage.getItem('darkMode');
    return { ...DEFAULT_APPEARANCE, mode: dark === 'false' ? 'light' : 'dark' };
  } catch { return DEFAULT_APPEARANCE; }
}

export function saveAppearanceLocally(a: Appearance) {
  try { localStorage.setItem(KEY, JSON.stringify(a)); localStorage.setItem('darkMode', String(isDark(a))); } catch { /* private mode */ }
}

/** Applies an appearance to the page now. */
export function applyAppearance(a: Appearance) {
  const root = document.documentElement;
  const dark = isDark(a);
  for (const [k, v] of Object.entries(paletteFor(a))) root.style.setProperty(k, v);
  root.classList.toggle('dark', dark);
  root.classList.toggle('theme-light', !dark);
  const bgLayer = backgroundFor(a);
  if (bgLayer) root.style.setProperty('--app-image', bgLayer); else root.style.removeProperty('--app-image');
  root.classList.toggle('has-app-image', !!bgLayer);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', paletteFor(a)['--app-bg']);
}

/** Removes the theme (signed out: the public pages keep their own look). */
export function clearAppearance() {
  const root = document.documentElement;
  for (const k of Object.keys(paletteFor(DEFAULT_APPEARANCE))) root.style.removeProperty(k);
  root.style.removeProperty('--app-image');
  root.classList.remove('theme-light', 'has-app-image');
}

/** Resizes a picture the user chose to at most 1920 px wide as JPEG, so it stays small enough to keep with the account. */
export async function pictureToBackground(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp|gif|bmp)/.test(file.type)) throw new Error('Choose a JPG, PNG or WebP picture.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Choose a picture under 15 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('This picture could not be opened.')); i.src = url; });
    for (const [w, q] of [[1920, 0.82], [1600, 0.75], [1280, 0.7]] as const) {
      const scale = Math.min(1, w / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', q);
      if (data.length < 700_000) return data;
    }
    throw new Error('This picture is too detailed to use as a background. Try a smaller one.');
  } finally { URL.revokeObjectURL(url); }
}
