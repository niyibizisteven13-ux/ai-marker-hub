import { Router, Request, Response, NextFunction } from 'express';
import { login, register, refresh, logout, logoutAll, getMe } from '../controllers/authController.js';
import { authLimiter } from '../../production/rateLimiter.js';
import { requireAuth } from '../../production/auth.js';

const router = Router();

const logErrors = (name: string, h: any) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await h(req, res, next);
    } catch (err: any) {
      console.error(`[AUTH ${name}]`, err?.code, err?.message, err?.stack);
      if (!res.headersSent) res.status(500).json({ error: err?.message || 'failed' });
    }
  };

router.post('/signup', authLimiter, logErrors('signup', register));
router.post('/register', authLimiter, logErrors('register', register));
router.post('/login', authLimiter, logErrors('login', login));
router.post('/refresh', authLimiter, logErrors('refresh', refresh));
router.post('/logout', logErrors('logout', logout));
router.post('/logout-all', requireAuth, logErrors('logoutAll', logoutAll));
router.get('/me', requireAuth, logErrors('getMe', getMe));

export default router;
