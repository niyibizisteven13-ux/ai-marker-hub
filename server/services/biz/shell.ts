import type { PublicBusiness } from './model.js';
import { profileSearch } from './profileSearch.js';
import { clearPageMetadata, escapeMarkup as esc } from '../searchDiscovery.js';

/**
 * Link previews. WhatsApp, Facebook and search engines read a page's own HTML (they do not run the app), so for /b/<name> the server
 * writes the business's name, tagline and cover photo into the page head. Every value is escaped; nothing from a business is ever put in as HTML.
 */
export const CATEGORY_WORD: Record<string, string> = { shop: 'Shop', restaurant: 'Restaurant', salon: 'Salon', farm: 'Farm', services: 'Services', school: 'School', health: 'Health', transport: 'Transport', craft: 'Crafts', creator: 'Creator', profile: 'Profile', other: 'Business' };

export const THEME_COLOR: Record<string, string> = { gold: '#E9A23B', teal: '#0F9D8F', green: '#1E9E5A', blue: '#2F6FED', rose: '#DB4F8E', violet: '#7C5CF0', ink: '#0E1722' };

export function renderShell(html: string, b: PublicBusiness, origin: string): string {
  const base = origin.replace(/\/$/, ''); const isProfile = b.category === 'profile';; const url = `${base}/${isProfile ? 'p' : 'b'}/${encodeURIComponent(b.slug)}`;
  const profile = isProfile ? profileSearch(b) : null;
  const title = profile?.title ?? `${b.name} · ${CATEGORY_WORD[b.category] ?? 'Business'} on Bwenge`;
  const desc = profile?.description ?? (b.tagline || b.about || `${b.name} on Bwenge4Biz`).replace(/\s+/g, ' ').slice(0, 200);
  const img = (isProfile ? [b.logo, b.cover] : [b.cover, b.logo]).find((m) => m && m.kind === 'image');
  const image = img ? `${base}/api/biz/public/${encodeURIComponent(b.slug)}/media/${encodeURIComponent(img.id)}` : `${base}/icons-512.png`;
  const entity = { name: b.name, url, ...(img ? { image } : {}),
    ...(b.about ? { description: b.about } : {}) };
  const data = isProfile
    ? { '@context': 'https://schema.org', '@type': 'ProfilePage', url, mainEntity: { '@type': 'Person', ...entity, alternateName: b.slug, description: desc } }
    : { '@context': 'https://schema.org', '@type': b.category === 'restaurant' ? 'Restaurant' : 'Organization', ...entity };
  const structured = JSON.stringify(data).replace(/</g, '\\u003c');
  const tags = [
    `<title>${esc(title)}</title>`, `<meta name="description" content="${esc(desc)}" />`, `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="${isProfile ? 'profile' : 'website'}" />`, `<meta property="og:site_name" content="${isProfile ? 'Bwenge4Profile' : 'Bwenge4Biz'}" />`, `<meta property="og:title" content="${esc(profile?.title ?? b.name)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`, `<meta property="og:url" content="${esc(url)}" />`, `<meta property="og:image" content="${esc(image)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<script type="application/ld+json">${structured}</script>`,
  ].join('\n    ');
  let out = clearPageMetadata(html);
  // The business's own installable app: replace Bwenge's manifest and theme colour with the business's.
  out = out.replace(/<link\s+rel=["']manifest["'][^>]*>\s*/i, '').replace(/<meta\s+name=["']theme-color["'][^>]*>\s*/i, '');
  out = out.replace(/<link\s+rel=["']apple-touch-icon["'][^>]*>\s*/gi, '');
  const own = `<link rel="manifest" href="/api/biz/public/${encodeURIComponent(b.slug)}/manifest.webmanifest" />\n    <meta name="theme-color" content="${esc(THEME_COLOR[b.theme] ?? '#0E1722')}" />\n    <meta name="apple-mobile-web-app-title" content="${esc((b.appName || b.name).slice(0, 24))}" />\n    <link rel="apple-touch-icon" href="/api/biz/public/${encodeURIComponent(b.slug)}/icon-192.png${b.appIcon || b.logo ? `?v=${encodeURIComponent((b.appIcon ?? b.logo)!.id)}` : ''}" />`;
  const shell = out.replace('</head>', () => `    ${tags}\n    ${own}\n  </head>`);
  // Public text also appears in the React page. It is available immediately to clients without JavaScript.
  const about = b.about ? `<p>${esc(b.about)}</p>` : '';
  const headline = profile?.headline ?? b.tagline;
  const tagline = headline ? `<p>${esc(headline)}</p>` : '';
  const details = profile?.details.length ? `<p>${esc(profile.details.join(' · '))}</p>` : '';
  const preview = `<main><h1>${esc(b.name)}</h1>${tagline}${about}${details}</main>`;
  return shell.replace('<div id="root"></div>', () => `<div id="root">${preview}</div>`);
}
