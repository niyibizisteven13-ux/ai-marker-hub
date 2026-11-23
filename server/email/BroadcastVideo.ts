import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import multer from 'multer';
import path from 'node:path';
import type { RequestHandler } from 'express';

export const broadcastVideoDirectory = path.resolve('data', 'broadcast-videos');
export const broadcastVideoRoute = '/email-video';
export const broadcastVideoPath = `/api/biz${broadcastVideoRoute}`;
export const broadcastVideoMaxBytes = 100 * 1024 * 1024;

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

const uploadVideo = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      mkdir(broadcastVideoDirectory, { recursive: true }).then(
        () => callback(null, broadcastVideoDirectory),
        (error) => callback(error, broadcastVideoDirectory),
      );
    },
    filename: (_req, _file, callback) => callback(null, `${randomUUID()}.upload`),
  }),
  limits: { fileSize: broadcastVideoMaxBytes + 1, files: 1, fields: 0 },
}).single('video');

export const receiveBroadcastVideo: RequestHandler = (req, res, next) => {
  uploadVideo(req, res, (error) => {
    if (error) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE';
      if (!(error instanceof multer.MulterError)) return next(error);
      return res.status(tooLarge ? 413 : 400).json({
        success: false,
        error: tooLarge ? 'The video must be 100 MB or smaller.' : 'Select one MP4 video to upload.',
      });
    }
    next();
  });
};

export const publishBroadcastVideo: RequestHandler = async (req, res, next) => {
  const file = req.file;
  if (!file) return res.status(400).json({ success: false, error: 'Select an MP4 video to upload.' });

  try {
    if (file.size > broadcastVideoMaxBytes) {
      return res.status(413).json({ success: false, error: "The video must be 100 MB or smaller." });
    }
    const handle = await open(file.path, 'r');
    const header = Buffer.alloc(12);
    const bytesRead = await handle.read(header).then((result) => result.bytesRead).finally(() => handle.close());
    if (bytesRead !== header.length || header.toString('ascii', 4, 8) !== 'ftyp' ||
        !/\.mp4$/i.test(file.originalname) || header.toString('ascii', 8, 12) === 'qt  ') {
      return res.status(400).json({ success: false, error: 'Select a valid MP4 video.' });
    }
    const publicUrl = new URL(process.env.APP_URL || 'https://www.bwenge.space');
    publicUrl.protocol = 'https:';
    const name = file.filename.replace(/\.upload$/, '.mp4');
    const url = new URL(`${broadcastVideoPath}/${name}`, publicUrl.origin).href;
    await rename(file.path, path.join(broadcastVideoDirectory, name));
    return res.status(201).json({ success: true, data: { url } });
  } catch (error) {
    return next(error);
  } finally {
    await unlink(file.path).catch(() => {});
  }
};
