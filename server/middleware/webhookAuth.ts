import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import logger from '../utils/logger.js';

/**
 * Verifies the signature of incoming webhooks from MTN MoMo.
 * In production, MTN sends a signature in the X-Callback-Signature header.
 */
export function verifyMomoSignature(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.MOMO_WEBHOOK_SECRET;

  if (process.env.NODE_ENV === 'development' || !secret) {
    logger.warn('Skipping MoMo signature verification (Dev mode or secret missing)');
    return next();
  }

  const signature = req.get('X-Callback-Signature');
  if (!signature) {
    logger.error('Missing X-Callback-Signature header');
    return res.status(401).json({ error: 'Missing signature' });
  }

  const payload = JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64');

  if (signature !== expectedSignature) {
    logger.error('Invalid MoMo signature detected', { received: signature, expected: expectedSignature });
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
}

/**
 * Optional IP whitelisting for extra security.
 * Placeholder for known MoMo/Airtel gateway IP ranges.
 */
export function whitelistPaymentGateways(req: Request, res: Response, next: NextFunction) {
  const clientIp = req.ip || req.socket.remoteAddress;
  const whitelist = (process.env.PAYMENT_GATEWAY_IPS || '').split(',').map(ip => ip.trim());

  if (process.env.NODE_ENV === 'development' || !process.env.PAYMENT_GATEWAY_IPS) {
    return next();
  }

  if (clientIp && !whitelist.includes(clientIp)) {
    logger.warn('Blocked payment callback from unauthorized IP', { clientIp });
    return res.status(403).json({ error: 'Unauthorized source' });
  }

  next();
}
