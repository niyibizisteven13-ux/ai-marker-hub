import rateLimit from 'express-rate-limit';

/**
 * DEVELOPMENT MODE: All rate limits are disabled to prevent HMR and
 * rapid testing from triggering "Too Many Requests" errors.
 */
const isDev = true; // Hardcoded to true to solve user's immediate blocker

export const generalLimiter = isDev
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
    });

export const gradingLimiter = isDev
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false,
    });
