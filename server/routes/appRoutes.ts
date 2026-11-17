import { Router } from 'express';
import { APPS, PLATFORMS, count, isApp, isKind, isPlatform, isRepeat, siteBuild } from '../services/appDownloads.js';
import { FeedbackError, publicStats, submitFeedback, visitorKey } from '../services/appFeedback.js';

/**
 * /api/app (public)
 *   POST /count            { app, platform, kind }   count a press of "Install" or the browser's "installed" (the web app)
 *   GET  /go/:app/:platform                          count a download and send the person on to it (MySEB installers)
 *   GET  /stats                                      public numbers: downloads and the average rating of each app
 *   POST /feedback         { app, rating, ...survey } a rating and a short survey (anyone; protected against spam)
 *   GET  /version                                    the version of the running site, so open apps can say "a new version is ready"
 */
const router = Router();
const who = (req: any) => String(req.ip ?? req.socket?.remoteAddress ?? '');
/** Where each downloadable goes. Bwenge is the installable web app (nothing to download); MySEB has its own installers. */
const mysebUrl = (platform: string) => `/myseb/download?platform=${encodeURIComponent(platform)}`;

router.post('/count', async (req, res) => {
  const { app, platform, kind } = req.body ?? {};
  if (!isApp(app) || !isPlatform(platform) || !isKind(kind)) return res.status(400).json({ error: 'Unknown app, device or kind.', apps: APPS, platforms: PLATFORMS });
  if (!isRepeat(who(req), app, platform, kind)) await count(app, platform, kind).catch(() => undefined);
  res.json({ ok: true });
});

router.get('/go/:app/:platform', async (req, res) => {
  const { app, platform } = req.params;
  if (app !== 'myseb' || !isPlatform(platform)) return res.status(404).type('text').send('Unknown download.');
  if (!isRepeat(who(req), 'myseb', platform, 'click')) await count('myseb', platform, 'click').catch(() => undefined);
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(302, mysebUrl(platform));
});

router.get('/stats', async (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json(await publicStats().catch(() => ({ apps: null })));
});

router.post('/feedback', async (req, res) => {
  try {
    const r = await submitFeedback(req.body, visitorKey(who(req), String(req.headers['user-agent'] ?? '')));
    res.status(r.saved ? 201 : 200).json({ ok: true });
  } catch (e) {
    if (e instanceof FeedbackError) return res.status(e.status).json({ error: e.message });
    res.status(500).json({ error: 'Your feedback could not be saved. Please try again.' });
  }
});

router.get('/version', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ build: siteBuild() }); });

export default router;
