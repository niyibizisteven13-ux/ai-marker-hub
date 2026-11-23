import path from 'node:path';
import type { RequestHandler } from 'express';

export const broadcastVideoDirectory = path.resolve('data', 'broadcast-videos');
export const broadcastVideoRoute = '/email-video';
export const broadcastVideoPath = `/api/biz${broadcastVideoRoute}`;
export const broadcastVideoMaxBytes = 20 * 1024 * 1024;

export const serveBroadcastVideo: RequestHandler = (req, res, next) => {
  const name = req.params.name;
  if (typeof name !== 'string' || !/^[a-f0-9-]{36}\.mp4$/.test(name)) {
    res.sendStatus(404);
    return;
  }
  res.type('video/mp4');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.sendFile(name, { root: broadcastVideoDirectory, maxAge: '1d' }, (error) => {
    if (!error) return;
    if (!res.headersSent && (error as { status?: number }).status === 404) {
      res.sendStatus(404);
      return;
    }
    next(error);
  });
};
