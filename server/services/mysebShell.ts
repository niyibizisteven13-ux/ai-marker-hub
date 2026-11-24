/**
 * MySEB as its own app: the page shell for /ms (and for the root of a myseb.<domain> host) carries MySEB's own name, colour, icon and manifest, so
 * "Add to home screen" installs MySEB, not Bwenge, and a shared link shows MySEB. Nothing here comes from a user.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const MYSEB_COLOR = '#0A1424';
export const isMySebHost = (host: string) => /^myseb\./i.test(host);

export function renderMySebShell(html: string, origin: string): string {
  const base = origin.replace(/\/$/, ''); const title = 'MySEB Secure Exam Browser | Live Rooms for Lecturers';
  const desc = 'MySEB helps lecturers run secure online tests, view live student status, track exits, review session timelines and results, and create tests with Bwenge AI. Device controls vary.';
  const schema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'MySEB',
    url: `${base}/ms`,
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Android, Windows, macOS, Linux, Web browser',
    description: desc,
    featureList: [
      'Secure test sessions that record when a student leaves and can pause the session',
      'Live exam rooms with student status for lecturers',
      'Bwenge assistant for creating tests, running rooms and reviewing results',
      'An event timeline for each student to support lecturer review',
      'Installable student app for supported devices',
    ],
  });
  const tags = [
    `<script type="application/ld+json">${schema}</script>`,
    `<meta name="description" content="${esc(desc)}" />`, `<link rel="canonical" href="${esc(`${base}/ms`)}" />`,
    `<meta property="og:type" content="website" />`, `<meta property="og:site_name" content="MySEB" />`, `<meta property="og:title" content="${esc(title)}" />`, `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${esc(`${base}/ms`)}" />`, `<meta property="og:image" content="${esc(`${base}/myseb/icon-512.png`)}" />`, `<meta name="twitter:card" content="summary" />`, `<meta name="twitter:title" content="${esc(title)}" />`, `<meta name="twitter:description" content="${esc(desc)}" />`,
    `<link rel="manifest" href="/myseb.webmanifest" />`, `<meta name="theme-color" content="${MYSEB_COLOR}" />`, `<meta name="apple-mobile-web-app-capable" content="yes" />`, `<meta name="apple-mobile-web-app-title" content="MySEB" />`,
    `<link rel="icon" type="image/svg+xml" href="/myseb/icon.svg" />`, `<link rel="apple-touch-icon" href="/myseb/icon-192.png" />`,
  ].join('\n    ');
  let out = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`);
  if (!/<title>/i.test(out)) out = out.replace('</head>', `<title>${esc(title)}</title></head>`);
  out = out.replace(/<script\s+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>\s*/i, '').replace(/<meta\s+name=["']description["'][^>]*>\s*/i, '').replace(/<link\s+rel=["']manifest["'][^>]*>\s*/i, '').replace(/<meta\s+name=["']theme-color["'][^>]*>\s*/i, '')
    .replace(/<link\s+rel=["']icon["'][^>]*>\s*/gi, '').replace(/<link\s+rel=["']apple-touch-icon["'][^>]*>\s*/gi, '').replace(/<meta\s+name=["']apple-mobile-web-app-title["'][^>]*>\s*/i, '').replace(/<meta\s+name=["']apple-mobile-web-app-capable["'][^>]*>\s*/i, '');
  return out.replace('</head>', `    ${tags}\n  </head>`);
}
