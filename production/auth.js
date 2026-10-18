import jwt from 'jsonwebtoken';
import { prisma } from '../server/db.js';
import { getJwtSecret } from '../server/auth/secrets.js';

const JWT_SECRET = getJwtSecret();

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

    req.teacher = { teacherId: decoded.userId };
    req.user = decoded;
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
  return async (req, res, next) => {
    if (!req.user?.userId) {
      return res.status(403).json({ error: 'Forbidden: insufficient permissions.' });
    }
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { id: true, email: true, name: true, role: true },
      });
      if (!user || user.role !== role) {
        return res.status(403).json({ error: 'Forbidden: insufficient permissions.' });
      }
      req.user = { ...req.user, email: user.email, name: user.name, role: user.role };
      return next();
    } catch (error) {
      console.error('Role verification failed:', error);
      return res.status(503).json({ error: 'Permissions could not be verified. Please retry.' });
    }
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
