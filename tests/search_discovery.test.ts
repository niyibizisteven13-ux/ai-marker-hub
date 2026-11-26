import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { newBusiness, publicView } from '../server/services/biz/model.js';
import { renderShell } from '../server/services/biz/shell.js';
import { renderSearchPage, renderSitemap, SITE_ORIGIN } from '../server/services/searchDiscovery.js';

const base = readFileSync('index.html', 'utf8');
const id = '12345678-1234-5678-9123-123456789abc';
const updated = new Date('2026-11-26T10:42:00Z');

test('discovery sitemap lists distinct canonical public routes and validates entries', () => {
  const profile = { slug: 'demo-person', category: 'profile', updated };
  const xml = renderSitemap([profile, profile, { slug: 'demo-cafe', category: 'restaurant', updated },
    { slug: '<script>', category: 'shop', updated }], [{ id, updated }, { id: '../private', updated }]);
  assert.match(xml, /\/p\/demo-person<\/loc><lastmod>2026-11-26<\/lastmod>/);
  assert.match(xml, /\/b\/demo-cafe<\/loc>/);
  assert.ok(xml.includes(SITE_ORIGIN + '/research?paper=' + id));
  assert.equal(xml.match(/\/p\/demo-person<\/loc>/g)?.length, 1);
  assert.doesNotMatch(xml, /<script>|private/);
});

test('business shell removes homepage metadata and escapes owner text', () => {
  const business = publicView(newBusiness('id', 'owner', 'A <Cafe> $&', 'demo-cafe', 'restaurant', updated.toISOString()));
  business.contact.address = 'Kigali & Kimihurura';
  business.hours = [{ day: 'mon', open: '09:00', close: '18:00' }, { day: 'sun', open: '00:00', close: '00:00', closed: true }];
  const html = renderShell(base, business, SITE_ORIGIN);
  assert.equal(html.match(/rel="canonical"/g)?.length, 1);
  assert.equal(html.match(/property="og:title"/g)?.length, 1);
  assert.ok(html.includes(SITE_ORIGIN + '/b/demo-cafe'));
  assert.ok(html.includes('A &lt;Cafe&gt; $&amp;'));
  assert.doesNotMatch(html, /SoftwareApplication|Explore Rwanda’s data/);
  assert.match(html, /"@type":"Restaurant"/);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /<address>Kigali &amp; Kimihurura<\/address>/);
  assert.match(html, /Monday: 09:00–18:00/);
  assert.match(html, /Sunday: Closed/);
  assert.match(html, /"openingHoursSpecification":\[\{"@type":"OpeningHoursSpecification","dayOfWeek":"https:\/\/schema.org\/Monday"/);
  assert.doesNotMatch(html, /schema.org\/Sunday/);
});

test('research paper preview replaces site metadata and keeps a crawlable abstract', () => {
  const html = renderSearchPage(base, { title: 'A "study" <A>', description: 'A & B', path: '/research?paper=' + id }, '<article><h1>Public paper</h1><p>Public abstract</p></article>');
  assert.match(html, /<title>A &quot;study&quot; &lt;A&gt;<\/title>/);
  assert.equal(html.match(/rel="canonical"/g)?.length, 1);
  assert.match(html, /<div id="root"><article>/);
  assert.doesNotMatch(html, /Explore Rwanda’s data/);
});

test('a public profile exposes a name, handle, headline and bio for name searches', () => {
  const profile = publicView(newBusiness('id', 'owner', 'Niyibizi Steven', 'niyibizisteven', 'profile', updated.toISOString()));
  profile.about = 'Works on digital tools for education and research.';
  const html = renderShell(base, profile, SITE_ORIGIN);
  assert.match(html, /<title>Niyibizi Steven · Founder of Bwenge.space · Bwenge4Profile<\/title>/);
  assert.match(html, /<meta name="description" content="Niyibizi Steven · Founder of Bwenge.space · Works on digital tools/);
  assert.match(html, /"alternateName":"niyibizisteven"/);
  assert.match(html, /<h1>Niyibizi Steven<\/h1><p>Founder of Bwenge.space<\/p>/);
});
