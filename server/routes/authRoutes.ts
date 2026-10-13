import { Router, Request, Response, NextFunction } from 'express';
import {
  googleStart,
  googleCallback,
  emailStart,
  emailVerify,
  getMe,
  logout,
  patchMe,
  getSessions,
  revokeSession,
  devOutboxHandler,
} from '../controllers/authController.js';
import { authLimiter } from '../../production/rateLimiter.js';
import { requireAuth } from '../../production/auth.js';

const router = Router();

const logErrors = (name: string, h: any) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await h(req, res, next);
    } catch (err: any) {
      console.error(`[AUTH ${name}]`, err?.code, err?.message, err?.stack);
      if (!res.headersSent) res.status(500).json({ error: { code: 'server_error', message: err?.message } });
    }
  };

router.get('/google/start', authLimiter, logErrors('googleStart', googleStart));
router.get('/google/callback', logErrors('googleCallback', googleCallback));
router.post('/email/start', authLimiter, logErrors('emailStart', emailStart));
router.post('/email/verify', authLimiter, logErrors('emailVerify', emailVerify));

router.get('/me', requireAuth, logErrors('getMe', getMe));
router.post('/logout', logErrors('logout', logout));
router.patch('/me', requireAuth, logErrors('patchMe', patchMe));

router.get('/sessions', requireAuth, logErrors('getSessions', getSessions));
router.delete('/sessions/:id', requireAuth, logErrors('revokeSession', revokeSession));

router.get('/__dev/outbox', logErrors('devOutbox', devOutboxHandler));

export default router;
