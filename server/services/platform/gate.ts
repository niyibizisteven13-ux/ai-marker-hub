import type { NextFunction, Request, Response } from 'express';
import { activeAnnouncement, flagOn, platformSettings } from './settings.js';
import { clientIp, isBlockedIp } from './security.js';

/**
 * The administrator's platform controls, applied to every API call before any work is done: blocked addresses, then maintenance mode.
 * Sign-in, the admin pages, health checks, the public status and MySEB are never held back by maintenance, so the administrator can always
 * get in and turn it off (and students already inside a test are not cut off).
 */
const OPEN_DURING_MAINTENANCE = /^\/(health|csp-report|platform\/status|auth(\/|$)|admin(\/|$)|myseb(\/|$))/;
const ALWAYS_OPEN = /^\/(health|platform\/status)/;

export function platformGate(req: Request, res: Response, next: NextFunction) {
  const s = platformSettings();
  if (s.blockedIps.length && !ALWAYS_OPEN.test(req.path) && isBlockedIp(clientIp(req), s.blockedIps)) {
    return res.status(403).json({ error: 'Access from your network is blocked. Contact the administrator if this is a mistake.', blocked: true });
  }
  if (s.maintenance.on && !OPEN_DURING_MAINTENANCE.test(req.path)) {
    return res.status(503).json({ error: s.maintenance.message || 'Bwenge is being updated. Please try again in a few minutes.', maintenance: true });
  }
  next();
}

/** What every page needs to know: is maintenance on, is there an announcement, and which big features are available. No secrets. */
export function platformStatus(_req: Request, res: Response) {
  const s = platformSettings();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ maintenance: s.maintenance.on ? { on: true, message: s.maintenance.message } : { on: false }, announcement: activeAnnouncement(s), features: { myseb: flagOn('myseb.enabled'), mysebBrowser: flagOn('myseb.browserMode') } });
}
