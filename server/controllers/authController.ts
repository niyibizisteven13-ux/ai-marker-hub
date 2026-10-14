import { Request, Response } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';
import { writeAuditLog } from '../../production/auth.js';
import { getGoogleAuthUrl, verifyGoogleCode, isInAppBrowser } from '../auth/googleAuth.js';
import { normalizeEmail, createEmailCode, verifyEmailCode } from '../auth/emailCode.js';
import { getEmailSender, getVerificationEmailContent, getDevOutbox } from '../email/EmailSender.js';
import { sanitizeNext } from '../auth/sanitizeNext.js';

const JWT_SECRET = process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
  ? process.env.JWT_SECRET
  : 'ai-studio-default-jwt-secret-key-min-32-chars';
const ACCESS_TOKEN_TTL = '15m';

function buildAuthenticatedUser(user: any) {
  const role = user.email?.toLowerCase().trim() === 'niyibizisteven13@gmail.com' ? 'ADMIN' : (user.role || 'user');
  return {
    id: user.id,
    name: user.name || user.email?.split('@')[0] || 'User',
    email: user.email,
    avatarUrl: user.avatarUrl,
    role: role.toLowerCase(),
    locale: user.settings?.preferredLanguage || 'en',
  };
}

function setRefreshCookie(res: Response, refreshToken: string) {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieName = isProd ? '__Host-session' : 'session';
  res.cookie(cookieName, refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
}

function clearRefreshCookie(res: Response) {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieName = isProd ? '__Host-session' : 'session';
  res.clearCookie(cookieName, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
  });
}

// ── Google Auth ──────────────────────────────────────────────

export async function googleStart(req: Request, res: Response) {
  try {
    const userAgent = req.headers['user-agent'] || '';
    if (isInAppBrowser(userAgent)) {
      return res.json({ blocked: 'in_app_browser' });
    }

    const nextUrl = (req.query.next as string) || '/chat';
    const { authUrl, state, nonce, verifier, sanitizedNext } = getGoogleAuthUrl(nextUrl);

    // Store state, nonce, verifier in a signed HttpOnly cookie valid for 10 minutes
    const cookieData = JSON.stringify({ state, nonce, verifier, next: sanitizedNext });
    const isProd = process.env.NODE_ENV === 'production';

    res.cookie('google_auth_state', cookieData, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/api/auth/google',
      maxAge: 10 * 60 * 1000,
    });

    return res.redirect(302, authUrl);
  } catch (err: any) {
    console.error('Google start error:', err);
    return res.redirect(302, '/?auth_error=google_failed');
  }
}

export async function googleCallback(req: Request, res: Response) {
  const { code, state, error } = req.query;
  const postLoginRoute = process.env.POST_LOGIN_ROUTE || '/chat';

  if (error || !code || !state) {
    return res.redirect(302, `/?auth_error=google_cancelled`);
  }

  try {
    const rawCookie = req.cookies?.google_auth_state;
    if (!rawCookie) {
      return res.redirect(302, `/?auth_error=google_failed`);
    }

    res.clearCookie('google_auth_state', { path: '/api/auth/google' });
    const cookieParsed = JSON.parse(rawCookie);

    if (cookieParsed.state !== state) {
      return res.redirect(302, `/?auth_error=google_failed`);
    }

    const googleUser = await verifyGoogleCode(code as string, cookieParsed.verifier, cookieParsed.nonce);

    if (!googleUser.emailVerified) {
      return res.redirect(302, `/?auth_error=google_unverified`);
    }

    const normalizedEmail = normalizeEmail(googleUser.email);

    // Check if identity exists by google sub
    let identity = await prisma.identity.findUnique({
      where: {
        provider_providerUserId: {
          provider: 'google',
          providerUserId: googleUser.sub,
        },
      },
      include: { user: { include: { settings: true, subscription: true } } },
    });

    let user: any;
    let isNewUser = false;

    if (identity) {
      user = identity.user;
    } else {
      // Check if user exists by email
      user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        include: { settings: true, subscription: true },
      });

      if (user) {
        // Link google identity to existing user
        await prisma.identity.create({
          data: {
            userId: user.id,
            provider: 'google',
            providerUserId: googleUser.sub,
          },
        });
      } else {
        // Create new user
        isNewUser = true;
        const randomPasswordHash = await crypto.randomBytes(32).toString('hex');
        user = await prisma.user.create({
          data: {
            name: googleUser.name,
            email: normalizedEmail,
            passwordHash: randomPasswordHash,
            avatarUrl: googleUser.picture,
            settings: { create: { preferredLanguage: 'en' } },
          },
          include: { settings: true, subscription: true },
        });

        await prisma.identity.create({
          data: {
            userId: user.id,
            provider: 'google',
            providerUserId: googleUser.sub,
          },
        });
      }
    }

    if (user.disabledAt) {
      return res.redirect(302, `/?auth_error=google_failed`);
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Create session
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
        ip: req.ip || null,
        expiresAt,
        absoluteExpiresAt,
      },
    });

    setRefreshCookie(res, refreshToken);
    await writeAuditLog(user.id, 'LOGIN_GOOGLE', 'User', user.id, { email: normalizedEmail });

    const safeNext = sanitizeNext(cookieParsed.next, postLoginRoute);
    return res.redirect(302, isNewUser ? `${safeNext}?welcome=1` : safeNext);
  } catch (err: any) {
    console.error('Google callback error:', err);
    const errCode = err.message?.includes('unverified') ? 'google_unverified' : 'google_failed';
    return res.redirect(302, `/?auth_error=${errCode}`);
  }
}

// ── Email Passwordless Auth ──────────────────────────────────

// In-memory rate limiter store for email starts (max 3 per 15 mins per email)
const emailStartRateLimit = new Map<string, { count: number; resetAt: number }>();

export async function emailStart(req: Request, res: Response) {
  try {
    const { email, locale } = req.body || {};
    if (typeof email !== 'string') {
      return res.status(400).json({ error: { code: 'invalid_email' } });
    }

    const normalized = normalizeEmail(email);
    if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return res.status(400).json({ error: { code: 'invalid_email' } });
    }

    // Rate limit check: max 3 per 15 min per email
    const now = Date.now();
    const entry = emailStartRateLimit.get(normalized);
    if (entry && entry.resetAt > now && entry.count >= 3) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ error: { code: 'rate_limited', retryAfter: 60 } });
    }

    if (!entry || entry.resetAt <= now) {
      emailStartRateLimit.set(normalized, { count: 1, resetAt: now + 15 * 60 * 1000 });
    } else {
      entry.count += 1;
    }

    // Check if user is disabled
    const existingUser = await prisma.user.findUnique({ where: { email: normalized } });
    if (existingUser?.disabledAt) {
      // Uniform response for anti-enumeration
      return res.status(202).json({ ok: true, retryAfter: 30 });
    }

    const code = await createEmailCode(normalized, req.ip);
    const emailContent = getVerificationEmailContent(code, locale);
    const emailSender = getEmailSender();

    await emailSender.send({
      to: normalized,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    });

    await writeAuditLog(existingUser?.id || 'system', 'CODE_SENT', 'Email', null, { emailHash: crypto.createHash('sha256').update(normalized).digest('hex') });

    return res.status(202).json({ ok: true, retryAfter: 30 });
  } catch (err: any) {
    console.error('Email start error:', err);
    return res.status(500).json({ error: { code: 'server_error' } });
  }
}

export async function emailVerify(req: Request, res: Response) {
  try {
    const { email, code } = req.body || {};
    if (typeof email !== 'string' || typeof code !== 'string') {
      return res.status(400).json({ error: { code: 'code_invalid' } });
    }

    const normalized = normalizeEmail(email);
    const isValid = await verifyEmailCode(normalized, code);

    if (!isValid) {
      return res.status(400).json({ error: { code: 'code_invalid' } });
    }

    let user = await prisma.user.findUnique({
      where: { email: normalized },
      include: { settings: true, subscription: true },
    });

    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      const defaultName = normalized.split('@')[0] || 'User';
      const randomPasswordHash = await crypto.randomBytes(32).toString('hex');

      user = await prisma.user.create({
        data: {
          name: defaultName.charAt(0).toUpperCase() + defaultName.slice(1),
          email: normalized,
          passwordHash: randomPasswordHash,
          emailVerifiedAt: new Date(),
          settings: { create: { preferredLanguage: 'en' } },
        },
        include: { settings: true, subscription: true },
      });

      await prisma.identity.create({
        data: {
          userId: user.id,
          provider: 'email',
          providerUserId: normalized,
        },
      });
    } else {
      if (user.disabledAt) {
        return res.status(400).json({ error: { code: 'code_invalid' } });
      }

      // Ensure email identity exists
      const existingIdentity = await prisma.identity.findUnique({
        where: {
          provider_providerUserId: {
            provider: 'email',
            providerUserId: normalized,
          },
        },
      });

      if (!existingIdentity) {
        await prisma.identity.create({
          data: {
            userId: user.id,
            provider: 'email',
            providerUserId: normalized,
          },
        });
      }

      if (!user.emailVerifiedAt) {
        await prisma.user.update({
          where: { id: user.id },
          data: { emailVerifiedAt: new Date(), lastLoginAt: new Date() },
        });
      }
    }

    // Create session
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
        ip: req.ip || null,
        expiresAt,
        absoluteExpiresAt,
      },
    });

    setRefreshCookie(res, refreshToken);
    await writeAuditLog(user.id, 'LOGIN_EMAIL', 'User', user.id, { email: normalized });

    const accessToken = jwt.sign(
      { userId: user.id, email: user.email, role: user.role || 'user' },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_TTL, algorithm: 'HS256', issuer: 'bwenge', audience: 'bwenge-web' }
    );

    return res.json({
      accessToken,
      expiresIn: 900,
      isNewUser,
      user: buildAuthenticatedUser(user),
    });
  } catch (err: any) {
    console.error('Email verify error:', err);
    return res.status(500).json({ error: { code: 'server_error' } });
  }
}

// ── Common Auth Endpoints ────────────────────────────────────

export async function getMe(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ error: { code: 'unauthorized' } });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { settings: true, subscription: true },
    });

    if (!user || user.disabledAt) {
      return res.status(401).json({ error: { code: 'unauthorized' } });
    }

    return res.json({ user: buildAuthenticatedUser(user) });
  } catch (err: any) {
    return res.status(500).json({ error: { code: 'server_error' } });
  }
}

export async function logout(req: Request, res: Response) {
  try {
    const isProd = process.env.NODE_ENV === 'production';
    const cookieName = isProd ? '__Host-session' : 'session';
    const refreshToken = req.cookies?.[cookieName] || req.body?.refreshToken;

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

export async function patchMe(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ error: { code: 'unauthorized' } });
    }

    const { name, locale } = req.body || {};
    const updateData: any = {};
    if (typeof name === 'string' && name.trim().length >= 1) {
      updateData.name = name.trim().substring(0, 100);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: { settings: true, subscription: true },
    });

    if (typeof locale === 'string' && ['en', 'rw', 'fr'].includes(locale.toLowerCase())) {
      await prisma.userSettings.upsert({
        where: { userId },
        update: { preferredLanguage: locale.toLowerCase() },
        create: { userId, preferredLanguage: locale.toLowerCase() },
      });
      updatedUser.settings = await prisma.userSettings.findUnique({ where: { userId } });
    }

    return res.json({ user: buildAuthenticatedUser(updatedUser) });
  } catch (err: any) {
    return res.status(500).json({ error: { code: 'server_error' } });
  }
}

export async function getSessions(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: { code: 'unauthorized' } });

    const sessions = await prisma.refreshSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, userAgent: true, ip: true, createdAt: true, lastUsedAt: true },
      orderBy: { lastUsedAt: 'desc' },
    });

    return res.json({ sessions });
  } catch (err: any) {
    return res.status(500).json({ error: { code: 'server_error' } });
  }
}

export async function revokeSession(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.userId;
    const sessionId = req.params.id;
    if (!userId) return res.status(401).json({ error: { code: 'unauthorized' } });

    await prisma.refreshSession.updateMany({
      where: { id: sessionId, userId },
      data: { revokedAt: new Date() },
    });

    return res.status(204).end();
  } catch (err: any) {
    return res.status(500).json({ error: { code: 'server_error' } });
  }
}

export async function refreshTokenHandler(req: Request, res: Response) {
  try {
    const isProd = process.env.NODE_ENV === 'production';
    const cookieName = isProd ? '__Host-session' : 'session';
    const refreshToken = req.cookies?.[cookieName] || req.body?.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({ error: { code: 'unauthorized' } });
    }

    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const session = await prisma.refreshSession.findUnique({
      where: { tokenHash },
      include: { user: { include: { settings: true, subscription: true } } },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.disabledAt) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: { code: 'TOKEN_EXPIRED' } });
    }

    await prisma.refreshSession.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });

    const accessToken = jwt.sign(
      { userId: session.user.id, role: session.user.email?.toLowerCase().trim() === 'niyibizisteven13@gmail.com' ? 'ADMIN' : session.user.role },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_TTL }
    );

    return res.json({
      accessToken,
      expiresIn: 900,
      user: buildAuthenticatedUser(session.user),
    });
  } catch (err: any) {
    console.error('Refresh token error:', err);
    return res.status(401).json({ error: { code: 'TOKEN_EXPIRED' } });
  }
}

export async function devOutboxHandler(req: Request, res: Response) {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).end();
  }
  return res.json({ outbox: getDevOutbox() });
}
