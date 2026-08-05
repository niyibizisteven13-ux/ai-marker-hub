import fs from 'fs/promises';
import path from 'path';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIT_LOG_PATH = path.join(__dirname, '..', 'exports', 'audit.log.jsonl');
const JWT_SECRET = process.env.JWT_SECRET || 'bwenge_auth_secret_2026';

function getTeacherId(req) {
  const fromHeader = req.get?.('x-teacher-id') || req.headers?.['x-teacher-id'];
  if (typeof fromHeader === 'string' && fromHeader.trim()) {
    return fromHeader.trim();
  }

  if (req.body?.teacherId) {
    return String(req.body.teacherId);
  }

  return 'local-dev';
}

function getAuthToken() {
  return process.env.API_AUTH_TOKEN || process.env.AUTH_TOKEN || '';
}

export function isAuthEnabled() {
  return Boolean(getAuthToken()) || Boolean(process.env.JWT_SECRET);
}

export function requireAuth(req, res, next) {
  const expectedToken = getAuthToken();
  req.teacher = { teacherId: getTeacherId(req) };

  const authHeader = req.get?.('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const tokenFromQuery = req.query?.token;
  const tokenFromHeaderKey = req.get?.('x-api-key');
  const token = bearerToken || tokenFromHeaderKey || tokenFromQuery || '';

  if (token && expectedToken && token === expectedToken) {
    return next();
  }

  if (!token) {
    if (!expectedToken && !process.env.JWT_SECRET) {
      return next();
    }
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.teacher = { teacherId: decoded.userId || 'jwt-user' };
    req.user = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

export async function writeAuditLog(actorId, action, resourceType, resourceId, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    actorId: actorId || 'system',
    action,
    resourceType,
    resourceId,
    details,
  };

  await fs.mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true });
  await fs.appendFile(AUDIT_LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
}
