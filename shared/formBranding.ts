/**
 * How a form looks to the people who fill it in: a template, light or dark page, a header style, a font, and the
 * owner's logo, banner and page background. Shared by the form builder, the public form page and the server.
 */

export type FormMode = 'light' | 'dark';
export type HeaderStyle = 'bar' | 'band' | 'banner';
export type FormFont = 'sans' | 'serif' | 'rounded' | 'mono';

export interface FormBranding {
  template: string;
  mode: FormMode;
  header: HeaderStyle;
  font: FormFont;
  /** Small square logo shown in the header (data URL or https URL). */
  logoUrl?: string;
  /** Wide picture across the top of the form, used when header = 'banner'. */
  bannerUrl?: string;
  /** Picture behind the whole page. */
  backgroundUrl?: string;
  /** A soft colour wash behind the page when there is no picture. */
  wash: boolean;
}

export const DEFAULT_BRANDING: FormBranding = { template: 'night', mode: 'dark', header: 'bar', font: 'sans', wash: true };

/** Ready-made looks: each sets the page, header and font; the colour comes from the form's theme colour. */
export const FORM_TEMPLATES: Array<{ id: string; name: string; description: string; color: string; branding: Omit<FormBranding, 'template' | 'logoUrl' | 'bannerUrl' | 'backgroundUrl'> }> = [
  { id: 'night', name: 'Night', description: 'Dark, calm and focused.', color: '#D97757', branding: { mode: 'dark', header: 'bar', font: 'sans', wash: true } },
  { id: 'classic', name: 'Classic', description: 'White cards on a light page, like a paper form.', color: '#2F6FED', branding: { mode: 'light', header: 'bar', font: 'sans', wash: false } },
  { id: 'campus', name: 'Campus', description: 'School colours in a bold header band with your logo.', color: '#1E7A4F', branding: { mode: 'light', header: 'band', font: 'sans', wash: true } },
  { id: 'official', name: 'Official', description: 'Serif type for letters, consent slips and notices.', color: '#1F3A68', branding: { mode: 'light', header: 'band', font: 'serif', wash: false } },
  { id: 'event', name: 'Event', description: 'A big picture on top for invitations and sign-ups.', color: '#DB4F8E', branding: { mode: 'light', header: 'banner', font: 'rounded', wash: true } },
  { id: 'studio', name: 'Studio', description: 'Dark with a colourful header band.', color: '#8B5CF6', branding: { mode: 'dark', header: 'band', font: 'rounded', wash: true } },
  { id: 'minimal', name: 'Minimal', description: 'No decoration, just the questions.', color: '#3F3F46', branding: { mode: 'light', header: 'bar', font: 'sans', wash: false } },
  { id: 'code', name: 'Lab', description: 'Monospace type for science and computing.', color: '#0F9D8F', branding: { mode: 'dark', header: 'band', font: 'mono', wash: true } },
];

export const FONT_STACKS: Record<FormFont, string> = {
  sans: "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
  rounded: "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Varela Round', system-ui, sans-serif",
  mono: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
};

/** Largest picture kept in a form (data URLs are stored in the form itself so anyone with the link can see them). */
export const MAX_FORM_IMAGE_CHARS = 1_500_000;

const okImage = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= MAX_FORM_IMAGE_CHARS && (/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v) || /^https:\/\/[^\s"'<>()]+$/.test(v) || /^\/api\/files\/[0-9a-f-]{36}$/i.test(v));

/** Keeps only known fields with safe values (used by the server before saving, and by the page before showing). */
export function normalizeBranding(input: unknown): FormBranding {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: FormBranding = {
    template: typeof o.template === 'string' && FORM_TEMPLATES.some((t) => t.id === o.template) ? o.template : 'custom',
    mode: o.mode === 'light' ? 'light' : 'dark',
    header: o.header === 'band' || o.header === 'banner' ? o.header : 'bar',
    font: o.font === 'serif' || o.font === 'rounded' || o.font === 'mono' ? o.font : 'sans',
    wash: o.wash !== false,
  };
  if (!input || typeof input !== 'object') return { ...DEFAULT_BRANDING };
  if (okImage(o.logoUrl)) out.logoUrl = o.logoUrl;
  if (okImage(o.bannerUrl)) out.bannerUrl = o.bannerUrl;
  if (okImage(o.backgroundUrl)) out.backgroundUrl = o.backgroundUrl;
  if (out.header === 'banner' && !out.bannerUrl) out.header = 'band';
  return out;
}
