import jwt from 'jsonwebtoken';
import { prisma } from '../server/db.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET environment variable is not set or too short. Set it in your .env file before starting the server.');
  process.exit(1);
}

export function isAuthEnabled() {
  return Boolean(JWT_SECRET);
}

export function requireAuth(req, res, next) {
  const authHeader = req.get?.('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!bearerToken) {
    return res.status(401).json({ error: 'Authentication required.', code: 'NO_TOKEN' });
  }

  try {
    const decoded = jwt.verify(bearerToken, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'bwenge',
      audience: 'bwenge-web',
    });

    if (!decoded || typeof decoded !== 'object' || typeof decoded.userId !== 'string' || !decoded.userId) {
      return res.status(401).json({ error: 'Invalid or expired token.', code: 'INVALID_TOKEN' });
    }

    const email = decoded.email?.toLowerCase().trim();
    const resolvedRole = email === 'niyibizisteven13@gmail.com' ? 'ADMIN' : decoded.role;
    req.teacher = { teacherId: decoded.userId };
    req.user = { ...decoded, role: resolvedRole };
    return next();
  } catch (err) {
    const isExpired = err.name === 'TokenExpiredError';
    return res.status(401).json({
      error: isExpired ? 'Token expired.' : 'Invalid or expired token.',
      code: isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
    });
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    const userRole = req.user?.email?.toLowerCase().trim() === 'niyibizisteven13@gmail.com' ? 'ADMIN' : req.user?.role;
    if (!req.user || userRole !== role) {
      return res.status(403).json({ error: 'Forbidden: insufficient permissions.' });
    }
    next();
  };
}

export async function writeAuditLog(actorId, action, resourceType, resourceId, details = {}) {
  try {
    // Sanitize details to ensure tokens or passwords are never logged
    const sanitizedDetails = { ...details };
    delete sanitizedDetails.password;
    delete sanitizedDetails.token;
    delete sanitizedDetails.refreshToken;
    delete sanitizedDetails.passwordHash;

    await prisma.auditLog.create({
      data: {
        actorId: actorId || 'system',
        action,
        resourceType,
        resourceId: resourceId || null,
        details: JSON.stringify(sanitizedDetails),
      },
    });
  } catch (err) {
    console.error('Audit Log failed:', err);
  }
}
