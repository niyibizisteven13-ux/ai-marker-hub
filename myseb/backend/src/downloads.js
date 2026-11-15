import { Router } from 'express';

export const files = { windows: 'MySEB-win.exe', mac: 'MySEB-mac.dmg', linux: 'MySEB-linux.AppImage', android: 'MySEB.apk' };
const labels = { windows: 'Windows (.exe)', mac: 'Mac (.dmg)', linux: 'Linux (.AppImage)', android: 'Android (.apk)', ios: 'iPhone / iPad' };
export function device(ua = '') {
  if (/iphone|ipad|ipod/i.test(ua) || /macintosh.*mobile/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  if (/windows/i.test(ua)) return 'windows';
  if (/macintosh|mac os/i.test(ua)) return 'mac';
  if (/linux|x11/i.test(ua) && !/cros/i.test(ua)) return 'linux';
  return '';
}
export function releaseLinks(releases) {
  const links = {};
  for (const release of releases) {
    if (release.draft || release.prerelease || !release.tag_name?.startsWith('myseb-v')) continue;
    for (const [platform, name] of Object.entries(files)) {
      const asset = release.assets?.find(a => a.name === name && a.size > 0 && a.state === 'uploaded');
      if (!links[platform] && asset) links[platform] = asset.browser_download_url;
    }
  }
  return links;
}
function httpsUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
let cached = {}, expires = 0;
async function links() {
  if (Date.now() >= expires) {
    try {
      const response = await fetch('https://api.github.com/repos/niyibizisteven13-ux/ai-marker-hub/releases?per_page=100', {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MySEB-downloads' }, signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`Release lookup: ${response.status}`);
      cached = releaseLinks(await response.json());
      expires = Date.now() + 300_000;
    } catch (error) { console.error(error.message); expires = Date.now() + 30_000; }
  }
  const result = { ...cached };
  for (const platform of Object.keys(labels)) {
    const name = platform === 'mac' ? 'MAC' : platform.toUpperCase();
    const override = httpsUrl(process.env[`MYSEB_DL_${name}`]);
    if (override) result[platform] = override;
  }
  // iOS must use Apple's distribution, never an APK or an unsigned IPA.
  if (result.ios && !['apps.apple.com', 'testflight.apple.com'].includes(new URL(result.ios).hostname)) delete result.ios;
  return result;
}
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const downloadRouter = Router();
downloadRouter.get('/', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store').vary('User-Agent');
    const requested = typeof req.query.platform === 'string' ? req.query.platform : '';
    if (requested && !Object.hasOwn(labels, requested)) return res.status(400).type('text').send('Unknown device.');
    const mine = requested || device(req.get('user-agent'));
    const available = await links();
    if (mine && available[mine] && req.query.choose !== '1') return res.redirect(302, available[mine]);
    const notice = mine === 'ios' && !available.ios
      ? 'The iPhone and iPad app is not available yet. Please use a supported computer or Android device.'
      : mine && !available[mine] ? `The ${labels[mine]} installer is not published yet. Please try again later or choose another available device.`
      : 'Choose your device to download MySEB.';
    const buttons = Object.entries(labels).map(([key, label]) => available[key]
      ? `<a href="?platform=${key}">Download for ${escape(label)}</a>`
      : `<div class="unavailable">${escape(label)} — not available yet</div>`).join('');
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'").type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Get MySEB</title><style>body{font-family:system-ui;max-width:480px;margin:40px auto;padding:24px;color:#222}a,.unavailable{display:block;margin:12px 0;padding:16px;border-radius:12px}a{background:#b4502f;color:white;text-decoration:none;font-weight:700}.unavailable{background:#f1f1f1;color:#666}p{line-height:1.6}</style><h1>Get MySEB</h1><p>${escape(notice)}</p>${buttons}<p>Install the app, open it, then enter the code from your lecturer. Your browser may ask you to confirm the download. Android may ask you to allow installation from this source.</p></html>`);
  } catch (error) { next(error); }
});
