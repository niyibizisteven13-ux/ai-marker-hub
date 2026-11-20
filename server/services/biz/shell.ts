import type { PublicBusiness } from './model.js';

/**
 * Link previews. WhatsApp, Facebook and search engines read a page's own HTML (they do not run the app), so for /b/<name> the server
 * writes the business's name, tagline and cover photo into the page head. Every value is escaped; nothing from a business is ever put in as HTML.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const CATEGORY_WORD: Record<string, string> = { shop: 'Shop', restaurant: 'Restaurant', salon: 'Salon', farm: 'Farm', services: 'Services', school: 'School', health: 'Health', transport: 'Transport', craft: 'Crafts', creator: 'Creator', profile: 'Profile', other: 'Business' };

export const THEME_COLOR: Record<string, string> = { gold: '#E9A23B', teal: '#0F9D8F', green: '#1E9E5A', blue: '#2F6FED', rose: '#DB4F8E', violet: '#7C5CF0', ink: '#0E1722' };

export function renderShell(html: string, b: PublicBusiness, origin: string): string {
  const base = origin.replace(/\/$/, ''); const isProfile = b.category === 'profile'; const url = `${base}/${isProfile ? 'p' : 'b'}/${encodeURIComponent(b.slug)}`;
  const title = isProfile ? `${b.name}${b.profile?.headline ? ` · ${b.profile.headline}` : ''} · Bwenge4profile` : `${b.name} · ${CATEGORY_WORD[b.category] ?? 'Business'} on Bwenge`;
  const desc = (isProfile ? (b.profile?.headline || b.tagline || b.about || `${b.name} on Bwenge4profile`) : (b.tagline || b.about || `${b.name} on Bwenge4biz`)).replace(/\s+/g, ' ').slice(0, 200);
  const img = [b.cover, b.logo].find((m) => m && m.kind === 'image');
  const image = img ? `${base}/api/biz/public/${encodeURIComponent(b.slug)}/media/${encodeURIComponent(img.id)}` : `${base}/icons-512.png`;
  const tags = [
    `<meta name="description" content="${esc(desc)}" />`, `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="${isProfile ? 'profile' : 'website'}" />`, `<meta property="og:site_name" content="${isProfile ? 'Bwenge4profile' : 'Bwenge4biz'}" />`, `<meta property="og:title" content="${esc(isProfile ? title.replace(/ · Bwenge4profile$/, '') : b.name)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`, `<meta property="og:url" content="${esc(url)}" />`, `<meta property="og:image" content="${esc(image)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ].join('\n    ');
  let out = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`);
  if (!/<title>/i.test(out)) out = out.replace('</head>', `<title>${esc(title)}</title></head>`);
  out = out.replace(/<meta\s+name=["']description["'][^>]*>\s*/i, '');
  // The business's own installable app: replace Bwenge's manifest and theme colour with the business's.
  out = out.replace(/<link\s+rel=["']manifest["'][^>]*>\s*/i, '').replace(/<meta\s+name=["']theme-color["'][^>]*>\s*/i, '');
  const own = `<link rel="manifest" href="/api/biz/public/${encodeURIComponent(b.slug)}/manifest.webmanifest" />\n    <meta name="theme-color" content="${esc(THEME_COLOR[b.theme] ?? '#0E1722')}" />\n    <meta name="apple-mobile-web-app-title" content="${esc(b.name.slice(0, 24))}" />\n    <link rel="apple-touch-icon" href="/api/biz/public/${encodeURIComponent(b.slug)}/icon.svg" />`;
  return out.replace('</head>', `    ${tags}\n    ${own}\n  </head>`);
}
