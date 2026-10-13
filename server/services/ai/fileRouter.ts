import { Router } from 'express';
import type { Request, Response } from 'express';
import { FileStore, FileStoreError } from './files/FileStore.js';

export interface FileRouterOptions {
  /** Return the signed-in user's id from your auth middleware (for non-signed URLs). */
  getUserId?: (req: Request) => string | undefined;
}

const INLINE_OK = /^image\/(png|jpeg|svg\+xml)$/;

/**
 * GET /:id?exp=&sig=   -> signed URL (used by <a href> and <img>)
 * GET /:id             -> session auth, owner only
 * Mount at /api/files. Everything except PNG/JPEG/SVG is forced to download, and SVG is sandboxed by CSP.
 */
export function createFileRouter(store: FileStore, opts: FileRouterOptions = {}): Router {
  const router = Router();
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { exp, sig } = req.query as { exp?: string; sig?: string };
      let file;
      if (exp && sig) file = await store.readSigned(id, exp, sig);
      else {
        const userId = opts.getUserId?.(req);
        if (!userId) { res.status(401).json({ error: 'unauthorized' }); return; }
        file = await store.read(id, userId);
      }
      const { meta, data } = file;
      const mime = meta.mime.split(';')[0].trim();
      const inline = INLINE_OK.test(mime);
      res.setHeader('Content-Type', meta.mime);
      res.setHeader('Content-Length', String(data.length));
      res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${meta.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.status(200).end(data);
    } catch (e) {
      if (e instanceof FileStoreError) {
        const status = { not_found: 404, forbidden: 403, bad_signature: 403, expired: 410, too_large: 413 }[e.code];
        res.status(status).json({ error: e.code });
        return;
      }
      res.status(500).json({ error: 'server_error' });
    }
  });
  return router;
}
