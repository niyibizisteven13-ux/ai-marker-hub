import crypto from 'crypto';
import { prisma } from '../db.js';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function getOtpSecret(): string {
  const secret = process.env.EMAIL_OTP_SECRET || process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('EMAIL_OTP_SECRET or SESSION_SECRET must be set to at least 32 characters');
  }
  return secret;
}

export function normalizeEmail(email: string): string {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase().normalize('NFKC');
}

export function generateCode(): string {
  // Cryptographically secure 6-digit code
  const num = crypto.randomInt(100000, 1000000);
  return num.toString();
}

export function normalizeCode(code: string): string {
  return code.replace(/\D/g, '');
}

export function computeCodeHash(email: string, code: string): Buffer {
  const normalized = normalizeEmail(email);
  return crypto.createHmac('sha256', getOtpSecret()).update(`${normalized}:${normalizeCode(code)}`).digest();
}

function asHashBuffer(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (
    value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'Buffer' &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    return Buffer.from((value as { data: number[] }).data);
  }
  return null;
}

export async function createEmailCode(email: string, ip?: string) {
  const normalized = normalizeEmail(email);
  const code = generateCode();
  const codeHash = computeCodeHash(normalized, code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
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
      consumedAt: null,
      ipHash,
    },
  });

  return code;
}

export async function verifyEmailCode(email: string, code: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  const normalizedCode = normalizeCode(code);
  if (!/^\d{6}$/.test(normalizedCode)) return false;

  const record = await prisma.emailCode.findFirst({
    where: { email: normalized, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!record || record.expiresAt < new Date()) {
    return false;
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    await prisma.emailCode.deleteMany({ where: { id: record.id } });
    return false;
  }

  const expectedHash = asHashBuffer(record.codeHash);
  const providedHash = computeCodeHash(normalized, normalizedCode);

  if (!expectedHash || expectedHash.length !== providedHash.length || !crypto.timingSafeEqual(expectedHash, providedHash)) {
    const nextAttempts = record.attempts + 1;
    if (nextAttempts >= MAX_ATTEMPTS) {
      await prisma.emailCode.deleteMany({
        where: { id: record.id, consumedAt: null, attempts: record.attempts },
      });
    } else {
      await prisma.emailCode.updateMany({
        where: { id: record.id, consumedAt: null, attempts: record.attempts },
        data: { attempts: nextAttempts },
      });
    }
    return false;
  }

  const consumed = await prisma.emailCode.deleteMany({
    where: {
      id: record.id,
      consumedAt: null,
      attempts: record.attempts,
      expiresAt: { gt: new Date() },
    },
  });

  return consumed.count === 1;
}
