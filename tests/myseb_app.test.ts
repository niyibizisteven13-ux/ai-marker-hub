import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { isMySebHost, renderMySebShell } from '../server/services/mysebShell.js';

// MySEB as its own app: its own name, colour, icons and manifest, so installing it gives MySEB, not Bwenge.
test('the MySEB page shell carries MySEB’s own identity and drops Bwenge’s', () => {
  const html = '<html><head><title>Bwenge</title><meta name="description" content="Bwenge"><link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#060B12"><link rel="icon" href="/favicon.svg"></head><body></body></html>';
  const out = renderMySebShell(html, 'https://www.bwenge.space/');
  assert.match(out, /<title>MySEB Secure Exam Browser \| Live Rooms for Lecturers<\/title>/); assert.match(out, /rel="manifest" href="\/myseb\.webmanifest"/); assert.match(out, /theme-color" content="#0A1424"/);
  assert.match(out, /apple-mobile-web-app-title" content="MySEB"/); assert.match(out, /canonical" href="https:\/\/www\.bwenge\.space\/ms"/); assert.match(out, /og:image" content="https:\/\/www\.bwenge\.space\/myseb\/icon-512\.png"/);
  for (const gone of ['/manifest.webmanifest', '#060B12', 'href="/favicon.svg"', '<title>Bwenge</title>']) assert.ok(!out.includes(gone), gone);
  assert.equal((out.match(/rel="manifest"/g) ?? []).length, 1); assert.equal((out.match(/name="theme-color"/g) ?? []).length, 1);
});
test('a myseb.<domain> host opens the app at its root', () => { assert.equal(isMySebHost('myseb.bwenge.space'), true); assert.equal(isMySebHost('MySEB.example.com'), true); assert.equal(isMySebHost('www.bwenge.space'), false); assert.equal(isMySebHost('bwenge.space'), false); });
test('the MySEB manifest is installable: its own id, start page, colour and icons that exist', () => {
  const m = JSON.parse(readFileSync('public/myseb.webmanifest', 'utf8')); const main = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  assert.equal(m.name.startsWith('MySEB'), true); assert.equal(m.short_name, 'MySEB'); assert.equal(m.display, 'standalone'); assert.notEqual(m.id, main.id, 'a different app id: it installs next to Bwenge, not over it'); assert.match(m.start_url, /^\/ms/);
  assert.ok(m.icons.some((i: any) => i.sizes === '192x192') && m.icons.some((i: any) => i.sizes === '512x512' && i.purpose === 'maskable'));
  for (const i of [...m.icons, ...m.shortcuts.flatMap((s: any) => s.icons)]) assert.ok(existsSync(`public${i.src}`), i.src);
});
