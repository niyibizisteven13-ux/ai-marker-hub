import rateLimit from 'express-rate-limit';

const isDev = process.env.NODE_ENV !== 'production';
const emailKey = (req) => {
  const email = typeof req.body?.email === 'string'
    ? req.body.email.trim().toLowerCase().normalize('NFKC')
    : '';
  return `email:${email || 'invalid'}`;
};

const otpLimit = (limit, keyGenerator) => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit,
  ...(keyGenerator ? { keyGenerator } : {}),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', retryAfter: 900 } },
});

export const generalLimiter = isDev
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
    });

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 100 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Try again later.' },
});

export const otpRequestIpLimiter = otpLimit(20);
export const otpRequestEmailLimiter = otpLimit(3, emailKey);
export const otpVerifyIpLimiter = otpLimit(30);
export const otpVerifyEmailLimiter = otpLimit(10, emailKey);

export const gradingLimiter = isDev
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false,
    });

export const publicFormSubmitLimiter = isDev
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many form submissions from this network. Please wait and try again.' },
    });

export const batchGradingLimiter = isDev
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 6,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many batch grading uploads from this network. Please wait and try again.' },
    });
