import { Router } from 'express';
import { releaseCatalog, files } from './downloads.js';

export function versionOf(tag) { return /^myseb-v(\d+\.\d+\.\d+)$/.exec(String(tag))?.[1] ?? null; }
export function newer(a, b) {
  if (!/^\d+\.\d+\.\d+$/.test(a) || !/^\d+\.\d+\.\d+$/.test(b)) return false;
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i]; }
  return false;
}
function safeAsset(asset) {
  if (!asset || asset.state !== 'uploaded' || !(asset.size > 0)) return null;
  try { const u = new URL(asset.browser_download_url); return u.protocol === 'https:' && u.hostname === 'github.com' && u.pathname.startsWith('/niyibizisteven13-ux/ai-marker-hub/releases/download/') ? u.href : null; } catch { return null; }
}
export function stableReleases(releases) {
  return releases.filter(r => !r.draft && !r.prerelease && versionOf(r.tag_name)).sort((a, b) => newer(versionOf(a.tag_name), versionOf(b.tag_name)) ? -1 : newer(versionOf(b.tag_name), versionOf(a.tag_name)) ? 1 : 0);
}
export function updateFor(releases, platform, current) {
  if (!Object.hasOwn(files, platform)) return { available: false };
  const release = stableReleases(releases).find(r => safeAsset(r.assets?.find(a => a.name === files[platform])) && (platform !== 'android' || r.assets?.some(a => a.name === 'MySEB-android-update.json' && safeAsset(a))));
  if (!release) return { available: false };
  const version = versionOf(release.tag_name);
  return { available: newer(version, current), version, downloadUrl: safeAsset(release.assets.find(a => a.name === files[platform])) };
}
export const updateRouter = Router();
updateRouter.get('/check', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const platform = String(req.query.platform ?? ''), current = String(req.query.version ?? '');
  if (!Object.hasOwn(files, platform) || !/^\d+\.\d+\.\d+$/.test(current)) return res.status(400).json({ error: 'Invalid device or version.' });
  res.json(updateFor(await releaseCatalog(), platform, current));
});
// electron-updater uses a generic feed, avoiding dependence on unrelated release tags in this repository.
// Installers have versioned names, so a new release cannot change the file an older manifest points to.
updateRouter.get('/:asset', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const name = String(req.params.asset);
  if (!/^(?:latest(?:-mac|-linux)?\.yml|MySEB-\d+\.\d+\.\d+-(?:win\.exe|mac\.zip|linux\.AppImage)(?:\.blockmap)?)$/.test(name)) return res.status(404).end();
  const asset = stableReleases(await releaseCatalog()).flatMap(r => r.assets ?? []).find(a => a.name === name && safeAsset(a));
  if (!asset) return res.status(404).json({ error: 'Update not published for this device yet.' });
  res.redirect(302, safeAsset(asset));
});
