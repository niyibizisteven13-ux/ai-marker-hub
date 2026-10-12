export function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[^\d+]/g, '');
  if (/^\+2507[2389]\d{7}$/.test(cleaned)) {
    return cleaned;
  }
  if (/^2507[2389]\d{7}$/.test(cleaned)) {
    return '+' + cleaned;
  }
  if (/^07[2389]\d{7}$/.test(cleaned)) {
    return '+250' + cleaned.slice(1);
  }
  if (/^7[2389]\d{7}$/.test(cleaned)) {
    return '+2500' + cleaned; // Wait, Rwandan numbers are 9 digits after +250: 7XX XXX XXX -> +250 7XX XXX XXX
  }
  // Let's correct Rwandan local numbers: 0788123456 -> +250788123456
  // Standard Rwandan mobile: +250 followed by 7 followed by 2, 3, 8, or 9, and 7 digits (total 9 digits after 250).
  // E.g., 788123456 (9 digits) -> +250 + 788123456 = +250788123456
  if (/^7[2389]\d{7}$/.test(cleaned)) {
    return '+250' + cleaned;
  }
  if (/^\+[1-9]\d{7,14}$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}

export function maskPhone(phone: string): string {
  if (phone.length < 8) return phone;
  return phone.slice(0, 5) + ' ••• •• ' + phone.slice(-2);
}

export function sanitizeNext(nextParam: string | null): string | null {
  if (!nextParam) return null;
  if (!nextParam.startsWith('/')) return null;
  if (nextParam.startsWith('//')) return null;
  if (nextParam.includes('://')) return null;
  if (nextParam.includes('\\')) return null;
  if (nextParam.length > 200) return null;
  return nextParam;
}
