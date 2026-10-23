import logger from '../../utils/logger.js';

/**
 * MTN Mobile Money "Collections" client: request-to-pay and transaction status.
 *
 * Configuration (server environment only, never in code or chat):
 *   MOMO_BASE_URL                 https://sandbox.momodeveloper.mtn.com (sandbox) or the production URL MTN gives you
 *   MOMO_COLLECTION_PRIMARY_KEY   Ocp-Apim-Subscription-Key of the Collections product (MOMO_SUBSCRIPTION_KEY also accepted)
 *   MOMO_API_USER / MOMO_API_KEY  API user (UUID) and API key
 *   MOMO_TARGET_ENV               "sandbox" or the production value from MTN (for Rwanda: "mtnrwanda")
 *   MOMO_CURRENCY                 RWF in production; the sandbox only accepts EUR
 *   MOMO_CALLBACK_HOST            optional; public HTTPS base for callbacks (defaults to APP_BASE_URL)
 *   MOMO_SIMULATE=true            development only: simulated payments without MTN (refused in production)
 *
 * A callback is only a hint: payment status is always confirmed by asking MTN (GET requesttopay/{id}).
 */

export type MomoStatus = 'PENDING' | 'SUCCESSFUL' | 'FAILED';
export interface MomoResult { status: MomoStatus; reason?: string; financialTransactionId?: string }

export class MomoError extends Error {
  constructor(message: string, public status = 502, public code = 'MOMO_ERROR') { super(message); }
}

const env = (...keys: string[]) => keys.map((k) => process.env[k]?.trim()).find(Boolean) ?? '';

export function momoConfig() {
  const targetEnv = env('MOMO_TARGET_ENV') || 'sandbox';
  return {
    baseUrl: (env('MOMO_BASE_URL', 'MOMO_API_URL') || 'https://sandbox.momodeveloper.mtn.com').replace(/\/$/, ''),
    subscriptionKey: env('MOMO_COLLECTION_PRIMARY_KEY', 'MOMO_SUBSCRIPTION_KEY'),
    apiUser: env('MOMO_API_USER'),
    apiKey: env('MOMO_API_KEY'),
    targetEnv,
    currency: env('MOMO_CURRENCY') || (targetEnv === 'sandbox' ? 'EUR' : 'RWF'),
    callbackHost: (env('MOMO_CALLBACK_HOST', 'APP_BASE_URL')).replace(/\/$/, ''),
    simulate: process.env.MOMO_SIMULATE === 'true' && process.env.NODE_ENV !== 'production',
  };
}

export const momoReady = () => { const c = momoConfig(); return c.simulate || Boolean(c.subscriptionKey && c.apiUser && c.apiKey); };
export const momoMode = (): 'live' | 'sandbox' | 'simulated' | 'off' => { const c = momoConfig(); return c.simulate ? 'simulated' : !momoReady() ? 'off' : c.targetEnv === 'sandbox' ? 'sandbox' : 'live'; };

/** MSISDN without "+": Rwanda numbers become 2507XXXXXXXX. MTN Rwanda numbers start with 078 or 079. */
export function normalizeMsisdn(phone: string): { msisdn: string; masked: string } {
  const digits = String(phone ?? '').replace(/\D/g, '');
  const msisdn = digits.startsWith('250') ? digits : digits.startsWith('07') ? `250${digits.slice(1)}` : digits.length === 9 && digits.startsWith('7') ? `250${digits}` : digits;
  const c = momoConfig();
  const ok = c.targetEnv === 'sandbox' || c.simulate ? /^\d{9,15}$/.test(msisdn) : /^2507[89]\d{7}$/.test(msisdn);
  if (!ok) throw new MomoError(c.targetEnv === 'sandbox' || c.simulate ? 'Enter a valid phone number.' : 'Enter an MTN Mobile Money number (078 or 079).', 400, 'INVALID_PHONE');
  return { msisdn, masked: `${msisdn.slice(0, 5)}•••${msisdn.slice(-3)}` };
}

let token: { value: string; expires: number } | null = null;
const simulated = new Map<string, { checks: number; fail: boolean }>();

export async function accessToken(): Promise<string> {
  if (token && Date.now() < token.expires) return token.value;
  const c = momoConfig();
  const res = await fetch(`${c.baseUrl}/collection/token/`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': c.subscriptionKey, Authorization: `Basic ${Buffer.from(`${c.apiUser}:${c.apiKey}`).toString('base64')}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    logger.error('[momo] token request failed', { status: res.status });
    throw new MomoError('Mobile Money is unavailable right now. Please try again in a few minutes.');
  }
  const data: any = await res.json();
  token = { value: data.access_token, expires: Date.now() + Math.max(60, Number(data.expires_in ?? 3600) - 60) * 1000 };
  return token.value;
}

/**
 * MTN rejects some characters in payerMessage/payeeNote with a bare 400 (no body), e.g. "·", accents or ":".
 * Keep letters, digits, spaces and . , - only.
 */
export const momoText = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 .,-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Bwenge AI';

export interface RequestToPay { referenceId: string; amount: number; msisdn: string; externalId: string; payerMessage: string; payeeNote: string }

/** The exact request-to-pay MTN receives (shared with scripts/momo-diagnose.ts). */
export function buildRequestToPay(o: RequestToPay, token: string, withCallback: boolean) {
  const c = momoConfig();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'X-Reference-Id': o.referenceId,
    'X-Target-Environment': c.targetEnv,
    'Ocp-Apim-Subscription-Key': c.subscriptionKey,
    'Content-Type': 'application/json',
  };
  if (withCallback && c.callbackHost.startsWith('https://')) headers['X-Callback-Url'] = `${c.callbackHost}/api/billing/momo/callback/${o.referenceId}`;
  const body = JSON.stringify({
    amount: String(Math.round(o.amount)), currency: c.currency, externalId: o.externalId.replace(/[^A-Za-z0-9]/g, '').slice(0, 36) || o.referenceId.replace(/-/g, '').slice(0, 18),
    payer: { partyIdType: 'MSISDN', partyId: o.msisdn },
    payerMessage: momoText(o.payerMessage), payeeNote: momoText(o.payeeNote),
  });
  return { url: `${c.baseUrl}/collection/v1_0/requesttopay`, headers, body };
}

// MTN only accepts callbacks to the host registered for the API user; when it refuses one, later requests skip it.
let callbackRefused = false;

/** Asks the payer to approve a payment on their phone. `referenceId` must be a UUID v4 (our payment id). */
export async function requestToPay(o: RequestToPay): Promise<void> {
  const c = momoConfig();
  if (c.simulate) { simulated.set(o.referenceId, { checks: 0, fail: o.msisdn.endsWith('0000') }); return; }
  if (!momoReady()) throw new MomoError('Mobile Money payments are not set up yet.', 503, 'NOT_CONFIGURED');
  const send = async (withCallback: boolean) => {
    const r = buildRequestToPay(o, await accessToken(), withCallback);
    const res = await fetch(r.url, { method: 'POST', headers: r.headers, body: r.body, signal: AbortSignal.timeout(20_000) });
    return { res, withCallback: 'X-Callback-Url' in r.headers };
  };
  let { res, withCallback } = await send(!callbackRefused);
  // A 400 creates nothing at MTN, so the same reference can be retried. Status is polled, so the callback is optional.
  if (res.status === 400 && withCallback) {
    logger.warn('[momo] request-to-pay refused with a callback URL; retrying without it', { callbackHost: c.callbackHost });
    ({ res, withCallback } = await send(false));
    if (res.status === 202) callbackRefused = true;
  }
  if (res.status === 401) token = null;
  if (res.status !== 202) {
    const body = await res.text().catch(() => '');
    logger.error('[momo] request-to-pay refused', { status: res.status, body: body.slice(0, 300), withCallback, currency: c.currency, amount: Math.round(o.amount), msisdn: `${o.msisdn.slice(0, 5)}•••${o.msisdn.slice(-3)}` });
    throw new MomoError(res.status === 409 ? 'This payment was already requested.' : 'Mobile Money could not start the payment. Check the number and try again.');
  }
}

/** Current status of a payment, from MTN. Network problems read as PENDING so a later check can confirm. */
export async function paymentStatus(referenceId: string): Promise<MomoResult> {
  const c = momoConfig();
  if (c.simulate) {
    const s = simulated.get(referenceId) ?? { checks: 0, fail: false };
    s.checks++;
    simulated.set(referenceId, s);
    if (s.checks < 2) return { status: 'PENDING' };
    return s.fail ? { status: 'FAILED', reason: 'PAYER_DECLINED' } : { status: 'SUCCESSFUL', financialTransactionId: `SIM${Date.now()}` };
  }
  if (!momoReady()) return { status: 'PENDING' };
  try {
    const res = await fetch(`${c.baseUrl}/collection/v1_0/requesttopay/${encodeURIComponent(referenceId)}`, {
      headers: { Authorization: `Bearer ${await accessToken()}`, 'X-Target-Environment': c.targetEnv, 'Ocp-Apim-Subscription-Key': c.subscriptionKey },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { status: 'PENDING' };
    const d: any = await res.json();
    const status: MomoStatus = d.status === 'SUCCESSFUL' ? 'SUCCESSFUL' : d.status === 'FAILED' || d.status === 'REJECTED' || d.status === 'TIMEOUT' ? 'FAILED' : 'PENDING';
    return { status, reason: d.reason?.code ?? d.reason ?? (d.status === 'TIMEOUT' ? 'TIMEOUT' : undefined), financialTransactionId: d.financialTransactionId };
  } catch (e) {
    logger.warn('[momo] status check failed', { errorType: (e as Error)?.name });
    return { status: 'PENDING' };
  }
}

/**
 * Connection check for the admin page: gets an access token and reads the Collections account balance.
 * Never returns secrets; only whether each step worked and MTN's status codes.
 */
export async function momoHealth(): Promise<{ ok: boolean; mode: ReturnType<typeof momoMode>; steps: Array<{ step: string; ok: boolean; detail: string }> }> {
  const c = momoConfig();
  const mode = momoMode();
  const steps: Array<{ step: string; ok: boolean; detail: string }> = [];
  if (c.simulate) return { ok: true, mode, steps: [{ step: 'Simulator', ok: true, detail: 'MOMO_SIMULATE is on (development only); no MTN calls are made.' }] };
  const missing = [!c.subscriptionKey && 'MOMO_COLLECTION_PRIMARY_KEY', !c.apiUser && 'MOMO_API_USER', !c.apiKey && 'MOMO_API_KEY'].filter(Boolean);
  if (missing.length) return { ok: false, mode, steps: [{ step: 'Configuration', ok: false, detail: `Missing on the server: ${missing.join(', ')}.` }] };
  steps.push({ step: 'Configuration', ok: true, detail: `Target ${c.targetEnv}, currency ${c.currency}, ${c.callbackHost.startsWith('https://') ? `callbacks to ${c.callbackHost}` : 'no HTTPS callback host (status is polled)'}.` });
  token = null;
  try {
    await accessToken();
    steps.push({ step: 'Access token', ok: true, detail: 'MTN accepted the API user and key.' });
  } catch {
    steps.push({ step: 'Access token', ok: false, detail: 'MTN refused the credentials. Check the subscription key, API user, API key and target environment.' });
    return { ok: false, mode, steps };
  }
  try {
    const res = await fetch(`${c.baseUrl}/collection/v1_0/account/balance`, {
      headers: { Authorization: `Bearer ${await accessToken()}`, 'X-Target-Environment': c.targetEnv, 'Ocp-Apim-Subscription-Key': c.subscriptionKey },
      signal: AbortSignal.timeout(20_000),
    });
    const d: any = res.ok ? await res.json().catch(() => ({})) : null;
    steps.push(res.ok
      ? { step: 'Collections account', ok: true, detail: `Reachable${d?.currency ? ` (${d.currency} account)` : ''}.` }
      : { step: 'Collections account', ok: false, detail: `MTN answered ${res.status}. The API user may not be activated for Collections in ${c.targetEnv}.` });
  } catch {
    steps.push({ step: 'Collections account', ok: false, detail: 'MTN could not be reached from the server (network or firewall).' });
  }
  return { ok: steps.every((x) => x.ok), mode, steps };
}

/** Test hook. */
export function resetMomo() { token = null; simulated.clear(); callbackRefused = false; }
