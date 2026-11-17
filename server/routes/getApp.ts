import { Router } from 'express';

/**
 * /get-app: where the landing page's QR code and "Download the app" button lead. This is the Bwenge app (not MySEB, the student exam app).
 *  - an Android phone is sent straight to the Bwenge APK (it downloads at once);
 *  - anything else gets a short page: the Android link, and for iPhone and computers the honest way to have Bwenge on the home screen.
 * The APK is the "apk-latest" release of this repository unless BWENGE_APK_URL names another HTTPS address.
 */
export const DEFAULT_APK_URL = 'https://github.com/niyibizisteven13-ux/ai-marker-hub/releases/download/apk-latest/Bwenge.apk';

export function apkUrl(env: NodeJS.ProcessEnv = process.env): string {
  const v = String(env.BWENGE_APK_URL ?? '').trim();
  return /^https:\/\/[^\s]+$/i.test(v) ? v : DEFAULT_APK_URL;
}
export type Device = 'android' | 'ios' | 'other';
export const deviceOf = (ua: string): Device => (/android/i.test(ua) ? 'android' : /iphone|ipad|ipod/i.test(ua) ? 'ios' : 'other');

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** The page for devices that cannot take the APK. Plain HTML, no scripts. */
export function chooserPage(device: Device, apk: string, site = 'https://www.bwenge.space'): string {
  const steps = device === 'ios'
    ? 'On your iPhone: open <b>bwenge.space</b> in Safari, tap the <b>Share</b> button, then <b>Add to Home Screen</b>. Bwenge opens like an app.'
    : 'On a computer: open <b>bwenge.space</b> in Chrome or Edge and choose <b>Install</b> in the address bar (or browser menu → Install Bwenge). On a phone you can also use <b>Add to Home Screen</b>.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Get Bwenge</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1420;color:#fff;font:16px/1.5 system-ui,sans-serif;padding:20px}main{max-width:420px;width:100%}h1{font-size:1.5rem;margin:0 0 6px}p{color:#b9c3d6;margin:8px 0}a.btn{display:flex;align-items:center;justify-content:center;min-height:52px;margin:14px 0;border-radius:14px;background:#f6b94a;color:#000;font-weight:600;text-decoration:none}section{margin-top:18px;padding:14px;border:1px solid #243349;border-radius:14px;background:#111c2b}small{color:#8795ad}</style></head><body><main>
<h1>Get Bwenge</h1><p>Mark, make quizzes and explore your data.</p>
<section><b>Android</b><p>Download the app and open it. If Android asks, allow installs from this source.</p><a class="btn" href="${esc(apk)}">Download for Android</a></section>
<section><b>${device === 'ios' ? 'iPhone and iPad' : 'iPhone, iPad and computers'}</b><p>${steps}</p></section>
<p><small>There is no separate iPhone or computer app yet. Taking an exam with MySEB? Use the link your lecturer gave you. <a style="color:#f6b94a" href="${esc(site)}">Open Bwenge on the web</a></small></p></main></body></html>`;
}

export function createGetAppRouter(env: NodeJS.ProcessEnv = process.env): Router {
  const r = Router();
  r.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const apk = apkUrl(env); const device = deviceOf(String(req.headers['user-agent'] ?? ''));
    if (device === 'android') return res.redirect(302, apk);
    res.type('html').send(chooserPage(device, apk));
  });
  return r;
}
export default createGetAppRouter();
