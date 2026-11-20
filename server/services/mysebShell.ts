/**
 * MySEB as its own app: the page shell for /ms (and for the root of a myseb.<domain> host) carries MySEB's own name, colour, icon and manifest, so
 * "Add to home screen" installs MySEB, not Bwenge, and a shared link shows MySEB. Nothing here comes from a user.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const MYSEB_COLOR = '#0A1424';
export const isMySebHost = (host: string) => /^myseb\./i.test(host);

export function renderMySebShell(html: string, origin: string): string {
  const base = origin.replace(/\/$/, ''); const title = 'MySEB: secure exams for lecturers';
  const desc = 'Run secure exams from your phone or computer: lock students into the test, watch the live room and get the results.';
  const tags = [
    `<meta name="description" content="${esc(desc)}" />`, `<link rel="canonical" href="${esc(`${base}/ms`)}" />`,
    `<meta property="og:type" content="website" />`, `<meta property="og:site_name" content="MySEB" />`, `<meta property="og:title" content="${esc(title)}" />`, `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${esc(`${base}/ms`)}" />`, `<meta property="og:image" content="${esc(`${base}/myseb/icon-512.png`)}" />`, `<meta name="twitter:card" content="summary" />`,
    `<link rel="manifest" href="/myseb.webmanifest" />`, `<meta name="theme-color" content="${MYSEB_COLOR}" />`, `<meta name="apple-mobile-web-app-capable" content="yes" />`, `<meta name="apple-mobile-web-app-title" content="MySEB" />`,
    `<link rel="icon" type="image/svg+xml" href="/myseb/icon.svg" />`, `<link rel="apple-touch-icon" href="/myseb/icon-192.png" />`,
  ].join('\n    ');
  let out = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`);
  if (!/<title>/i.test(out)) out = out.replace('</head>', `<title>${esc(title)}</title></head>`);
  out = out.replace(/<meta\s+name=["']description["'][^>]*>\s*/i, '').replace(/<link\s+rel=["']manifest["'][^>]*>\s*/i, '').replace(/<meta\s+name=["']theme-color["'][^>]*>\s*/i, '')
    .replace(/<link\s+rel=["']icon["'][^>]*>\s*/gi, '').replace(/<link\s+rel=["']apple-touch-icon["'][^>]*>\s*/gi, '').replace(/<meta\s+name=["']apple-mobile-web-app-title["'][^>]*>\s*/i, '').replace(/<meta\s+name=["']apple-mobile-web-app-capable["'][^>]*>\s*/i, '');
  return out.replace('</head>', `    ${tags}\n  </head>`);
}
