import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Safe Exam Browser (a free, open-source lockdown browser used by many universities): it blocks new tabs and other
 * programs, and adds a header to every request it makes: X-SafeExamBrowser-RequestHash = SHA-256 of the full request
 * URL (without #fragment) followed by the Browser Exam Key of the configuration it runs. The server holds the same
 * key and recomputes the hash, so a normal browser (which does not know the key) cannot take the test.
 * https://safeexambrowser.org/developer/seb-config-key.html
 */
export const SEB_HEADER = 'x-safeexambrowser-requesthash';

export const sebRequestHash = (absoluteUrl: string, key: string) => createHash('sha256').update(absoluteUrl.split('#')[0] + key).digest('hex');

/** The address the browser used for this request (behind a reverse proxy, `protocol` and `host` come from its headers). */
export const absoluteUrl = (req: { protocol: string; get(name: string): string | undefined; originalUrl: string }) => `${req.protocol}://${req.get('host')}${req.originalUrl}`;

export function sebAllowed(req: { protocol: string; get(name: string): string | undefined; originalUrl: string }, keys: string[]): boolean {
  const got = String(req.get(SEB_HEADER) ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(got) || !keys.length) return false;
  const url = absoluteUrl(req);
  return keys.some((k) => { const want = sebRequestHash(url, k); return timingSafeEqual(Buffer.from(want), Buffer.from(got)); });
}
