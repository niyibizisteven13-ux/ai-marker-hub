import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { SharedRateLimitStore } from '../server/services/cache/redis.js';
import { getJwtSecret } from '../server/auth/secrets.js';

// Counts are shared by every server through Redis when REDIS_URL is set (see server/services/cache/redis.ts).
const store = (name) => new SharedRateLimitStore(name);

const isDev = process.env.NODE_ENV !== 'production';
const emailKey = (req) => {
  const email = typeof req.body?.email === 'string'
    ? req.body.email.trim().toLowerCase().normalize('NFKC')
    : '';
  return `email:${email || 'invalid'}`;
};

const otpLimit = (name, limit, keyGenerator) => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit,
  store: store(name),
  ...(keyGenerator ? { keyGenerator } : {}),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', retryAfter: 900 } },
});

export const litronEnrollLimiter = otpLimit('litron-enroll', 20);

/**
 * The signed-in user behind a request (their access token, checked), so limits count per person. A whole school
 * often reaches the site from one network address; counting by address alone locks every teacher out at once.
 */
export function userKey(req) {
  const h = req.get?.('authorization');
  const token = h?.startsWith('Bearer ') ? h.slice(7).trim() : null;
  if (!token) return null;
  try {
    const d = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'], issuer: 'bwenge', audience: 'bwenge-web' });
    return d && typeof d === 'object' && typeof d.userId === 'string' ? `user:${d.userId}` : null;
  } catch { return null; }
}

/**
 * The live room (MySEB). A room with hundreds of live students sends thousands of small set-up messages, and a class of hundreds on one
 * school network reports every few seconds from a single address, so the general limits below would refuse them. These paths have their
 * own limits (liveRoomLimiter for the lecturer, studentLiveLimiter for each student's MySEB session).
 */
export const LIVE_PATH = /^\/api\/(?:myseb\/live\/|(?:forms|assignments)\/[^/]+\/myseb\/)/;
const QUIZ_RESULT_PATH = /^\/api\/forms\/[^/]+\/quiz-result\/?(?:\?|$)/;
// A video player asks for its file in many pieces: a business page's photos and videos must not use up the allowance of everything else (see bizMediaLimiter).
const BIZ_MEDIA_PATH = /^\/api\/biz\/public\/[^/]+\/media\//;

export const generalLimiter = isDev
  ? (req, res, next) => next()
  : rateLimit({
      store: store('general'),
      windowMs: 15 * 60 * 1000,
      // Per signed-in person; per network address for everything else.
      limit: (req) => (userKey(req) ? 1500 : 600),
      keyGenerator: (req) => userKey(req) ?? ipKeyGenerator(req.ip ?? ''),
      // Staying signed in has its own limits (authLimiter) and must never be refused by this one. Live rooms have their own (below).
      skip: (req) => (req.originalUrl || '').startsWith('/api/auth/refresh') || LIVE_PATH.test(req.originalUrl || '') || QUIZ_RESULT_PATH.test(req.originalUrl || '') || BIZ_MEDIA_PATH.test(req.originalUrl || ''),
      standardHeaders: true,
      legacyHeaders: false,
    });

const sessionCookie = (req) => req.cookies?.['__Host-session'] || req.cookies?.session || '';

/**
 * "Stay signed in" (POST /api/auth/refresh). The app calls it on every page load and every few minutes, so it is
 * counted per browser session (the session cookie, which is a 256-bit secret and cannot be guessed), with a
 * generous cap per network address on top. It used to allow 10 per 15 minutes per address: a school network or a
 * few reloads used that up, the refusal looked like "signed out", and people were sent back to the login page.
 */
const refreshPerSession = rateLimit({
  store: store('auth-refresh-session'),
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 1000 : 120,
  keyGenerator: (req) => {
    const c = sessionCookie(req);
    return c ? `s:${createHash('sha256').update(c).digest('hex').slice(0, 32)}` : `ip:${ipKeyGenerator(req.ip ?? '')}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in checks. Wait a moment and try again.', code: 'RATE_LIMITED' },
});
const refreshPerAddress = rateLimit({
  store: store('auth-refresh-ip'),
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 10_000 : 3000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in checks from this network. Wait a moment and try again.', code: 'RATE_LIMITED' },
});
export const authLimiter = [refreshPerAddress, refreshPerSession];

export const otpRequestIpLimiter = otpLimit('otp-request-ip', 20);
export const otpRequestEmailLimiter = otpLimit('otp-request-email', 3, emailKey);
export const otpVerifyIpLimiter = otpLimit('otp-verify-ip', 30);
export const otpVerifyEmailLimiter = otpLimit('otp-verify-email', 10, emailKey);

export const gradingLimiter = isDev
  ? (req, res, next) => next()
  : rateLimit({
      store: store('grading'),
      windowMs: 15 * 60 * 1000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false,
    });

export const publicFormSubmitLimiter = isDev
  ? (req, res, next) => next()
  : rateLimit({
      store: store('form-submit'),
      windowMs: 15 * 60 * 1000,
      // A whole lab or campus can sit behind one address: raise this (FORM_SUBMIT_MAX) before a big exam.
      max: Number(process.env.FORM_SUBMIT_MAX) > 0 ? Number(process.env.FORM_SUBMIT_MAX) : 60,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many form submissions from this network. Please wait and try again.' },
    });

// Assignment hand-ins: a whole class often shares one school network (one address), so the cap is per link
// and network together, and high enough for a large class handing in and re-handing in near the deadline.
export const assignmentSubmitLimiter = isDev
  ? (req, res, next) => next()
  : rateLimit({
      store: store('assignment-submit'),
      windowMs: 15 * 60 * 1000,
      max: 400,
      keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}:${String(req.params?.token ?? '').slice(0, 40)}`,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many hand-ins from this network just now. Wait a minute and try again.' },
    });

export const batchGradingLimiter = isDev
  ? (req, res, next) => next()
  : rateLimit({
      store: store('batch-grading'),
      windowMs: 15 * 60 * 1000,
      max: 6,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many batch grading uploads from this network. Please wait and try again.' },
    });

/** The lecturer's live room: counted per signed-in person, generous enough for 500 live students (set-up messages, pictures, updates). */
export const liveRoomLimiter = isDev
  ? (req, res, next) => next()
  : rateLimit({
      store: store('live-room'),
      windowMs: 15 * 60 * 1000,
      limit: (req) => (userKey(req) ? (Number(process.env.LIVE_ROOM_MAX) > 0 ? Number(process.env.LIVE_ROOM_MAX) : 40_000) : 600),
      keyGenerator: (req) => userKey(req) ?? ipKeyGenerator(req.ip ?? ''),
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'The live room is asking for too much. Wait a moment.', code: 'RATE_LIMITED' },
    });

/** A student's page in the live room: counted per MySEB session, never per network address (a whole class can share one). */
export const studentLiveLimiter = isDev
  ? (req, res, next) => next()
  : rateLimit({
      store: store('student-live'),
      windowMs: 15 * 60 * 1000,
      limit: (req) => (req.myseb?.sessionId ? (Number(process.env.STUDENT_LIVE_MAX) > 0 ? Number(process.env.STUDENT_LIVE_MAX) : 4000) : 20_000),
      keyGenerator: (req) => (req.myseb?.sessionId ? `sid:${String(req.myseb.sessionId).slice(0, 60)}` : `ip:${ipKeyGenerator(req.ip ?? '')}`),
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Slow down for a moment.', code: 'RATE_LIMITED' },
    });

/** Photos and videos of public business pages: one video is many requests (a player reads it in pieces and seeks), so the limit is high, and per network address. */
export const bizMediaLimiter = isDev
  ? (req, res, next) => next()
  : rateLimit({ store: store('biz-media'), windowMs: 15 * 60 * 1000, limit: 6000, keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''), standardHeaders: true, legacyHeaders: false });
