import crypto from 'crypto';
import { prisma } from '../db.js';

const SESSION_SECRET = process.env.SESSION_SECRET || 'ai-bwenge-default-session-secret-pepper-min-32-bytes';

export function normalizeEmail(email: string): string {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase().normalize('NFKC');
}

export function generateCode(): string {
  // Cryptographically secure 6-digit code
  const num = crypto.randomInt(100000, 1000000);
  return num.toString();
}

export function computeCodeHash(email: string, code: string): Buffer {
  const normalized = normalizeEmail(email);
  return crypto.createHmac('sha256', SESSION_SECRET).update(`${normalized}:${code.trim()}`).digest();
}

export async function createEmailCode(email: string, ip?: string) {
  const normalized = normalizeEmail(email);
  const code = generateCode();
  const codeHash = computeCodeHash(normalized, code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  const ipHash = ip ? crypto.createHash('sha256').update(ip).digest() : null;

  // Invalidate older unused codes for this email
  await prisma.emailCode.updateMany({
    where: { email: normalized, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  await prisma.emailCode.create({
    data: {
      email: normalized,
      codeHash,
      expiresAt,
      attempts: 0,
      ipHash,
    },
  });

  return code;
}

export async function verifyEmailCode(email: string, code: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  const record = await prisma.emailCode.findFirst({
    where: { email: normalized, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!record || record.expiresAt < new Date()) {
    return false;
  }

  if (record.attempts >= 5) {
    // Invalidate code after 5 wrong attempts
    await prisma.emailCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    return false;
  }

  const expectedHash = record.codeHash; // Buffer from Prisma Bytes
  const providedHash = computeCodeHash(normalized, code);

  if (expectedHash.length !== providedHash.length || !crypto.timingSafeEqual(expectedHash, providedHash)) {
    // Increment attempts
    await prisma.emailCode.update({
      where: { id: record.id },
      data: { attempts: record.attempts + 1 },
    });
    return false;
  }

  // Consume code (single use)
  await prisma.emailCode.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });

  return true;
}
