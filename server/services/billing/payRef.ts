import crypto from 'node:crypto';

/**
 * The payment code a person quotes when they send money by hand and message the administrator on WhatsApp (for example "BW-4F7K2A").
 * It is worked out from the account id, so it never changes, needs no storage, and the administrator can type it into
 * Admin → Billing → Users to find the person. It identifies an account for the administrator only; it opens nothing.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';           // no 0/O, 1/I/L: easy to read out and type
export function payRef(userId: string): string {
  const h = crypto.createHash('sha256').update(`bwenge-pay:${userId}`).digest();
  return 'BW-' + Array.from(h.subarray(0, 6), (b) => ALPHABET[b % ALPHABET.length]).join('');
}
/** True when the search text is a payment code (with or without the dash, any case). */
export const looksLikePayRef = (q: string) => /^bw-?[a-z2-9]{6}$/i.test(q.trim());
export const normalizePayRef = (q: string) => { const c = q.trim().toUpperCase().replace(/^BW-?/, ''); return `BW-${c}`; };
