import { Router } from 'express';
import { prisma } from '../db.js';
import {
  publicReleaseId, publicReleaseKey, publicReleasePath, publicReleaseSchema, publishedAppPolicy,
} from '../services/featurePublicRelease.js';

const router = Router();

router.get('/:id/:document(frame)?', async (req, res, next) => {
  const id = publicReleaseId.safeParse(req.params.id);
  res.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  });
  if (!id.success) return res.sendStatus(404);
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: publicReleaseKey(id.data) } });
    const release = publicReleaseSchema.safeParse(row?.value);
    if (!release.success) return res.sendStatus(404);
    if (req.params.document === 'frame') {
      return res.set('Content-Security-Policy', publishedAppPolicy).type('html').send(release.data.html);
    }
    res.set('Content-Security-Policy', "default-src 'none'; frame-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
    return res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Published Bwenge app</title><style>body{margin:0;display:grid;grid-template-rows:auto 1fr;height:100dvh;font:14px system-ui}header{padding:.65rem 1rem;background:#f5f5fa;color:#25253a}iframe{width:100%;height:100%;border:0}</style></head><body><header>Published with Bwenge App Builder</header><iframe title="Published app" src="${publicReleasePath(id.data)}/frame" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe></body></html>`);
  } catch (error) { next(error); }
});

export default router;
