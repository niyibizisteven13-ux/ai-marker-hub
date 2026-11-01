/**
 * Appearance saved with the account (Settings → Appearance): mode, colour, colour style, background and the user's
 * own background picture. Only known fields are kept; the picture must be a small JPEG/PNG/WebP data URL.
 */
const SCENES = new Set(['none', 'image', 'aurora', 'dusk', 'mesh', 'grid', 'paper']);
const MAX_IMAGE_CHARS = 900_000;

export class AppearanceError extends Error {}

export function sanitizeAppearance(input: unknown): string {
  let v: any = input;
  if (typeof v === 'string') {
    if (v.length > MAX_IMAGE_CHARS + 2_000) throw new AppearanceError('The background picture is too large. Choose a smaller one.');
    try { v = JSON.parse(v); } catch { throw new AppearanceError('Invalid appearance setting.'); }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new AppearanceError('Invalid appearance setting.');
  const out: Record<string, unknown> = {
    mode: v.mode === 'light' || v.mode === 'system' ? v.mode : 'dark',
    color: typeof v.color === 'string' && /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : '#D97757',
    style: v.style === 'tinted' || v.style === 'vibrant' ? v.style : 'neutral',
    background: typeof v.background === 'string' && SCENES.has(v.background) ? v.background : 'none',
    veil: typeof v.veil === 'number' && Number.isFinite(v.veil) ? Math.min(0.95, Math.max(0.2, v.veil)) : 0.72,
  };
  if (v.image !== undefined && v.image !== null && v.image !== '') {
    if (typeof v.image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v.image)) throw new AppearanceError('The background must be a JPG, PNG or WebP picture.');
    if (v.image.length > MAX_IMAGE_CHARS) throw new AppearanceError('The background picture is too large. Choose a smaller one.');
    out.image = v.image;
  }
  if (out.background === 'image' && !out.image) out.background = 'none';
  return JSON.stringify(out);
}
