import crypto from 'node:crypto';

/**
 * Who is uploading from the scanner page. Two ways in:
 * - Telegram Mini App: the page sends Telegram's signed initData, checked with the bot token (no link needed);
 * - a link from /scan with a short-lived token (groups, desktop browsers, older Telegram apps).
 * Both resolve to the Telegram chat the scan should be delivered to.
 */

const TOKEN_TTL = 30 * 60_000;
const INIT_DATA_MAX_AGE_S = 24 * 3600;
const tokens = new Map<string, { chatId: string; expires: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [t, d] of tokens) if (d.expires <= now) tokens.delete(t);
}, 5 * 60_000).unref();

export function issueScanToken(chatId: string): string {
  const token = crypto.randomBytes(12).toString('base64url');
  tokens.set(token, { chatId, expires: Date.now() + TOKEN_TTL });
  return token;
}

/** A token stays valid until it expires, so several scans (one per student) can be sent from one session. */
export function resolveScanToken(token: string | undefined): string | null {
  const d = token ? tokens.get(token) : undefined;
  return d && d.expires > Date.now() ? d.chatId : null;
}

/**
 * Validates Telegram Mini App initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
 * and returns the user's id, which is also the chat id of their private chat with the bot.
 */
export function verifyInitData(initData: string | undefined, botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? '', now = Date.now()): string | null {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(check).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null;
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || now / 1000 - authDate > INIT_DATA_MAX_AGE_S) return null;
  try {
    const id = JSON.parse(params.get('user') ?? 'null')?.id;
    return typeof id === 'number' || typeof id === 'string' ? String(id) : null;
  } catch {
    return null;
  }
}

/** Public scanner page; Telegram only opens Mini Apps over HTTPS. */
export function scannerUrl(token?: string): string {
  const base = (process.env.APP_BASE_URL || 'https://www.bwenge.space').replace(/\/$/, '');
  return `${base}/scanner.html${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export const miniAppReady = () => scannerUrl().startsWith('https://');
