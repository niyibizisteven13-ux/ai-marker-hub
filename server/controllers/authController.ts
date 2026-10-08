import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../db.js';
import { writeAuditLog } from '../../production/auth.js';

const JWT_SECRET = (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32)
  ? process.env.JWT_SECRET
  : 'ai-studio-default-jwt-secret-key-min-32-chars';
const ACCESS_TOKEN_TTL = '15m';
const BCRYPT_ROUNDS = 12;

// In-memory failed login tracking for per-account lockout: email + IP -> { count, resetAt }
const failedLogins = new Map<string, { count: number; resetAt: number }>();

function cleanupFailedLogins() {
  const now = Date.now();
  for (const [key, val] of failedLogins.entries()) {
    if (val.resetAt <= now) failedLogins.delete(key);
  }
}
setInterval(cleanupFailedLogins, 5 * 60 * 1000).unref();

function buildAuthenticatedUser(user: any) {
  const role = user.email?.toLowerCase().trim() === 'niyibizisteven13@gmail.com' ? 'ADMIN' : (user.role || 'INSTRUCTOR');
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    settings: user.settings,
    role,
    subscription: user.subscription?.status === 'ACTIVE'
      ? { planType: user.subscription.planType, status: user.subscription.status }
      : undefined,
  };
}

function setRefreshCookie(res: Response, refreshToken: string) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('bwenge_rt', refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
}

function clearRefreshCookie(res: Response) {
  const isProd = process.env.NODE_ENV === 'production';
  res.clearCookie('bwenge_rt', {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/api/auth',
  });
}

export async function register(req: Request, res: Response) {
  try {
    const { name, email, password } = req.body || {};
    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'All fields are required.' });
    }
    const normalizedName = name.trim();
    if (normalizedName.length < 2 || normalizedName.length > 100) {
      return res.status(400).json({ error: 'Name must be between 2 and 100 characters.' });
    }
    const normalizedEmail = email.toLowerCase().trim();
    if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (password.length < 10 || password.length > 128) {
      return res.status(400).json({ error: 'Password must be at least 10 characters.' });
    }

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      // Generic response or 409
      return res.status(409).json({ error: 'Email already registered.' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const newUser = await prisma.user.create({
      data: {
        name: normalizedName,
        email: normalizedEmail,
        passwordHash,
        settings: { create: {} },
      },
      include: { settings: true, subscription: true },
    });

    const userRole = newUser.email?.toLowerCase().trim() === 'niyibizisteven13@gmail.com' ? 'ADMIN' : (newUser.role || 'INSTRUCTOR');
    const accessToken = jwt.sign(
      { userId: newUser.id, email: newUser.email, role: userRole },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_TTL, algorithm: 'HS256', issuer: 'bwenge', audience: 'bwenge-web' }
    );

    // Issue refresh token
    const refreshTokenBytes = crypto.randomBytes(32);
    const refreshToken = refreshTokenBytes.toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const familyId = crypto.randomUUID();

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days sliding
    const absoluteExpiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days absolute

    await prisma.refreshSession.create({
      data: {
        userId: newUser.id,
        familyId,
        tokenHash,
        userAgent: req.headers['user-agent'] || null,
        ip: req.ip || null,
        expiresAt,
        absoluteExpiresAt,
      },
    });

    setRefreshCookie(res, refreshToken);
    await writeAuditLog(newUser.id, 'LOGIN', 'User', newUser.id, { email: normalizedEmail });

    return res.status(201).json({
      accessToken,
      expiresIn: 900,
      user: buildAuthenticatedUser(newUser),
    });
  } catch (err: any) {
    console.error('Register failed:', err);
    return res.status(500).json({ error: 'Failed to create user account.' });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const ip = req.ip || 'unknown';
    const lockoutKey = `${normalizedEmail}:${ip}`;

    cleanupFailedLogins();
    const lockoutEntry = failedLogins.get(lockoutKey);
    if (lockoutEntry && lockoutEntry.count >= 5 && lockoutEntry.resetAt > Date.now()) {
      const retryAfterSeconds = Math.ceil((lockoutEntry.resetAt - Date.now()) / 1000);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    }

    let user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { settings: true, subscription: true },
    });

    const genericError = 'Email or password is incorrect.';
    if (!user) {
      recordFailure(lockoutKey);
      await writeAuditlogFailed(normalizedEmail, ip, req.headers['user-agent']);
      return res.status(401).json({ error: genericError });
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      recordFailure(lockoutKey);
      await writeAuditlogFailed(normalizedEmail, ip, req.headers['user-agent']);
      return res.status(401).json({ error: genericError });
    }

    if (normalizedEmail === 'niyibizisteven13@gmail.com' && user.role !== 'ADMIN') {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { role: 'ADMIN' },
        include: { settings: true, subscription: true },
      });
    }

    // Clear lockout on success
    failedLogins.delete(lockoutKey);

    const userRole = user.email?.toLowerCase().trim() === 'niyibizisteven13@gmail.com' ? 'ADMIN' : (user.role || 'INSTRUCTOR');
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email, role: userRole },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_TTL, algorithm: 'HS256', issuer: 'bwenge', audience: 'bwenge-web' }
    );

    const refreshTokenBytes = crypto.randomBytes(32);
    const refreshToken = refreshTokenBytes.toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const familyId = crypto.randomUUID();

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const absoluteExpiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    await prisma.refreshSession.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash,
        userAgent: req.headers['user-agent'] || null,
        ip,
        expiresAt,
        absoluteExpiresAt,
      },
    });

    setRefreshCookie(res, refreshToken);
    await writeAuditLog(user.id, 'LOGIN', 'User', user.id, { email: normalizedEmail });

    return res.json({
      accessToken,
      expiresIn: 900,
      user: buildAuthenticatedUser(user),
    });
  } catch (err: any) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Authentication failed.' });
  }
}

function recordFailure(key: string) {
  const existing = failedLogins.get(key);
  const now = Date.now();
  if (!existing || existing.resetAt <= now) {
    failedLogins.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
  } else {
    existing.count += 1;
  }
}

async function writeAuditlogFailed(email: string, ip: string, userAgent?: string) {
  // Hash email for privacy in audit logs
  const emailHash = crypto.createHash('sha256').update(email).digest('hex');
  await writeAuditLog('system', 'LOGIN_FAILED', 'User', null, { emailHash, ip, userAgent });
}

export async function refresh(req: Request, res: Response) {
  try {
    // CSRF check for cookie endpoints: require X-Requested-With and Origin matching APP_URL in production
    const requestedWith = req.headers['x-requested-with'];
    if (requestedWith !== 'bwenge') {
      return res.status(403).json({ error: 'Forbidden request.' });
    }

    const refreshToken = req.cookies?.bwenge_rt || req.body?.refreshToken;
    if (!refreshToken) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'No refresh token provided.', code: 'NO_TOKEN' });
    }

    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const session = await prisma.refreshSession.findUnique({
      where: { tokenHash },
      include: { user: { include: { settings: true, subscription: true } } },
    });

    if (!session) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Invalid session.', code: 'INVALID_TOKEN' });
    }

    // Reuse detection
    if (session.revokedAt) {
      // Revoke whole token family!
      await prisma.refreshSession.updateMany({
        where: { familyId: session.familyId },
        data: { revokedAt: new Date() },
      });
      await writeAuditLog(session.userId, 'TOKEN_REUSE', 'RefreshSession', session.id, { familyId: session.familyId });
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Security alert: token reuse detected.', code: 'TOKEN_REUSE' });
    }

    const now = new Date();
    if (session.expiresAt < now || session.absoluteExpiresAt < now) {
      await prisma.refreshSession.update({
        where: { id: session.id },
        data: { revokedAt: now },
      });
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Session expired.', code: 'TOKEN_EXPIRED' });
    }

    // Rotate refresh token
    const newRefreshBytes = crypto.randomBytes(32);
    const newRefreshToken = newRefreshBytes.toString('base64url');
    const newTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');

    const newExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Revoke old session and create new one in same family
    await prisma.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: now },
    });

    const newSession = await prisma.refreshSession.create({
      data: {
        userId: session.userId,
        familyId: session.familyId,
        tokenHash: newTokenHash,
        userAgent: req.headers['user-agent'] || session.userAgent,
        ip: req.ip || session.ip,
        expiresAt: newExpiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
      },
    });

    // Update replacedById on old session
    await prisma.refreshSession.update({
      where: { id: session.id },
      data: { replacedById: newSession.id },
    });

    const sessionUserRole = session.user.email?.toLowerCase().trim() === 'niyibizisteven13@gmail.com' ? 'ADMIN' : (session.user.role || 'INSTRUCTOR');
    const accessToken = jwt.sign(
      { userId: session.user.id, email: session.user.email, role: sessionUserRole },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_TTL, algorithm: 'HS256', issuer: 'bwenge', audience: 'bwenge-web' }
    );

    setRefreshCookie(res, newRefreshToken);

    return res.json({
      accessToken,
      expiresIn: 900,
      user: buildAuthenticatedUser(session.user),
    });
  } catch (err: any) {
    console.error('Refresh error:', err);
    clearRefreshCookie(res);
    return res.status(500).json({ error: 'Token refresh failed.' });
  }
}

export async function logout(req: Request, res: Response) {
  try {
    const refreshToken = req.cookies?.bwenge_rt || req.body?.refreshToken;
    if (refreshToken) {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const session = await prisma.refreshSession.findUnique({ where: { tokenHash } });
      if (session && !session.revokedAt) {
        await prisma.refreshSession.update({
          where: { id: session.id },
          data: { revokedAt: new Date() },
        });
        await writeAuditLog(session.userId, 'LOGOUT', 'RefreshSession', session.id);
      }
    }
    clearRefreshCookie(res);
    return res.status(204).end();
  } catch (err) {
    clearRefreshCookie(res);
    return res.status(204).end();
  }
}

export async function logoutAll(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated.' });

    await prisma.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await writeAuditLog(userId, 'LOGOUT_ALL', 'User', userId);
    clearRefreshCookie(res);
    return res.status(204).end();
  } catch (err: any) {
    console.error('Logout all error:', err);
    return res.status(500).json({ error: 'Failed to log out all devices.' });
  }
}

export async function getMe(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { settings: true, subscription: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ user: buildAuthenticatedUser(user) });
  } catch (err: any) {
    console.error('GetMe error:', err);
    res.status(500).json({ error: 'Failed to fetch user data.' });
  }
}
