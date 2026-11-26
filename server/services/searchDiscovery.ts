export const SITE_ORIGIN = 'https://bwenge.space';
const slugPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const paperIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export const escapeMarkup = (text: string) => text.replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function clearPageMetadata(html: string) {
  return html
    .replace(/<title>[\s\S]*?<\/title>\s*/gi, '')
    .replace(/<link\b[^>]*\brel=["']canonical["'][^>]*>\s*/gi, '')
    .replace(/<meta\b[^>]*\b(?:name|property)=["'](?:description|og:[^"']+|twitter:[^"']+)["'][^>]*>\s*/gi, '')
    .replace(/<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>\s*/gi, '');
}

export function renderSearchPage(html: string, page: { title: string; description: string; path: string }, body = '') {
  const title = escapeMarkup(page.title);
  const description = escapeMarkup(page.description);
  const canonical = escapeMarkup(SITE_ORIGIN + page.path);
  const head = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`,
    `<link rel="canonical" href="${canonical}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Bwenge.space">',
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:url" content="${canonical}">`,
    '<meta name="twitter:card" content="summary">',
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
  ].join('\n');
  const output = clearPageMetadata(html).replace('</head>', () => head + '\n</head>');
  return body ? output.replace('<div id="root"></div>', () => `<div id="root">${body}</div>`) : output;
}

export const publicPages = {
  '/discover': { title: 'Discover Businesses, People and Research | Bwenge.space', description: 'Find public businesses, professional profiles, published research and MySEB on Bwenge.space.' },
  '/about': { title: 'About Bwenge.space', description: 'Learn about Bwenge.space and its connected tools for education, research and business.' },
  '/our-story': { title: 'Our Story | Bwenge.space', description: 'Read how Bwenge.space began and why it builds tools for education, research and business.' },
  '/myseb': { title: 'MySEB Downloads for Students | Bwenge.space', description: 'Find the MySEB student app and instructions for opening an exam link from your lecturer.' },
  '/terms': { title: 'Terms of Service | Bwenge.space', description: 'Read the terms that apply when you use Bwenge.space.' },
  '/privacy': { title: 'Privacy Policy | Bwenge.space', description: 'Read how Bwenge.space handles information and protects user privacy.' },
  '/get-app': { title: 'Download Bwenge and MySEB Apps | Bwenge.space', description: 'Find Bwenge installation instructions and MySEB downloads for supported devices.' },
  '/research': { title: 'Bwenge4Research | Public Research Library', description: 'Browse published research articles, working papers, preprints and reports from the Bwenge4Research community.' },
} as const;

type SitemapRow = { slug: string | null; category: string | null; updated: Date };
type ResearchSitemapRow = { id: string | null; updated: Date };
const date = (value?: Date) => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : undefined;

export function renderSitemap(businesses: SitemapRow[], papers: ResearchSitemapRow[]): string {
  const entries = new Map<string, string | undefined>();
  for (const path of ['/', ...Object.keys(publicPages), '/ms']) entries.set(path, undefined);
  for (const { slug, category, updated } of businesses) {
    if (slug && slugPattern.test(slug)) entries.set(`/${category === 'profile' ? 'p' : 'b'}/${slug}`, date(updated));
  }
  for (const { id, updated } of papers) {
    if (id && paperIdPattern.test(id)) entries.set('/research?paper=' + id, date(updated));
  }
  const urls = [...entries].slice(0, 45_000).map(([path, updated]) =>
    `<url><loc>${escapeMarkup(SITE_ORIGIN + path)}</loc>${updated ? `<lastmod>${updated}</lastmod>` : ''}</url>`);
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join('\n') + '\n</urlset>\n';
}

const sitemapCacheKey = 'search:public-sitemap:v1';

export async function refreshPublicSitemap() {
  const { invalidate } = await import('./cache/redis.js');
  await invalidate(sitemapCacheKey);
}

export async function publicSitemap() {
  const { cached } = await import('./cache/redis.js');
  return cached(sitemapCacheKey, 60_000, async () => {
    const { prisma } = await import('../db.js');
    const [businesses, papers] = await Promise.all([
      prisma.$queryRaw<SitemapRow[]>`
        SELECT value->>'slug' AS slug, value->>'category' AS category, "updatedAt" AS updated
        FROM "AppSetting"
        WHERE key LIKE 'biz:%' AND value->'published' = 'true'::jsonb
          AND value->>'suspended' IS NULL
        ORDER BY key LIMIT 40000`,
      prisma.$queryRaw<ResearchSitemapRow[]>`
        SELECT substring(key from 20) AS id, "updatedAt" AS updated
        FROM "AppSetting" WHERE key LIKE 'research-published:%'
        ORDER BY key LIMIT 4995`,
    ]);
    return renderSitemap(businesses, papers);
  });
}

export async function publishedResearchSummary(id: string) {
  if (!paperIdPattern.test(id)) return null;
  const { prisma } = await import('../db.js');
  const rows = await prisma.$queryRaw<Array<{ title: string | null; authors: string | null; abstract: string | null }>>`
    SELECT value->>'title' AS title, value->>'authors' AS authors, value->>'abstract' AS abstract
    FROM "AppSetting" WHERE key = ${'research-published:' + id} LIMIT 1`;
  const paper = rows[0];
  return paper?.title && paper?.abstract ? { title: paper.title, authors: paper.authors ?? '', abstract: paper.abstract } : null;
}

type DirectoryRow = { key: string; slug: string | null; category: string | null; name: string | null };

export async function publicDirectory(search: string, after: string) {
  const { prisma } = await import('../db.js');
  const rows = await prisma.$queryRaw<DirectoryRow[]>`
    SELECT key, value->>'slug' AS slug, value->>'category' AS category,
      COALESCE(value->>'name', value->>'title') AS name
    FROM "AppSetting"
    WHERE key > ${after} AND (
      (key LIKE 'biz:%' AND value->'published' = 'true'::jsonb AND value->>'suspended' IS NULL
        AND value->>'slug' ~ '^[a-z0-9][a-z0-9-]{0,63}$')
      OR key ~ '^research-published:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    )
    AND NOT EXISTS (
      SELECT 1 FROM regexp_split_to_table(lower(${search}::text), '[[:space:]]+') AS term(word)
      WHERE strpos(lower(concat_ws(' ', value->>'name', value->>'slug', value->>'title', value->>'authors',
        value->>'category', value->>'tagline', value->>'address', value->'profile'->>'location',
        value->'profile'->>'headline', value->>'discipline', value->>'keywords')), term.word) = 0
    )
    ORDER BY key LIMIT 51`;
  const visible = rows.slice(0, 50);
  return {
    next: rows.length > 50 ? visible.at(-1)?.key : undefined,
    entries: visible.flatMap(row => {
      if (!row.name) return [];
      if (row.slug && slugPattern.test(row.slug)) return [{
        name: row.name,
        kind: row.category === 'profile' ? 'Bwenge4Profile' : 'Bwenge4Biz',
        path: (row.category === 'profile' ? '/p/' : '/b/') + row.slug,
      }];
      const id = row.key.slice('research-published:'.length);
      return paperIdPattern.test(id) ? [{ name: row.name, kind: 'Bwenge4Research', path: '/research?paper=' + id }] : [];
    }),
  };
}
