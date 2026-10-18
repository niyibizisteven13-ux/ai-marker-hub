import crypto from 'crypto';

const pendingLinks = new Map<string, { userId: string; expiresAt: number }>();
const LINK_TTL_MS = 10 * 60 * 1000;

export function issueTelegramLink(userId: string) {
  const now = Date.now();
  for (const [code, link] of pendingLinks) if (link.expiresAt <= now) pendingLinks.delete(code);
  const code = crypto.randomBytes(18).toString('base64url');
  pendingLinks.set(code, { userId, expiresAt: now + LINK_TTL_MS });
  return code;
}

export function consumeTelegramLink(code: string) {
  const link = pendingLinks.get(code);
  pendingLinks.delete(code);
  if (!link || link.expiresAt <= Date.now()) return null;
  return link.userId;
}
