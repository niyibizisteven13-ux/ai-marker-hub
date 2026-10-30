import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { SharedRateLimitStore } from '../server/services/cache/redis.js';

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

export const generalLimiter = isDev
  ? (req, res, next) => next()
  : rateLimit({
      store: store('general'),
      windowMs: 15 * 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
    });

export const authLimiter = rateLimit({
  store: store('auth'),
      windowMs: 15 * 60 * 1000,
  max: isDev ? 100 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Try again later.' },
});

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
      max: 60,
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
