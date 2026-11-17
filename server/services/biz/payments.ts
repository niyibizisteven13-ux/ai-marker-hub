import type { Provider } from './secrets.js';

/**
 * Mobile-money collection (the customer gets a prompt on their phone and approves with their PIN): MTN MoMo "Collections / requesttopay" and
 * Airtel Money "merchant payments". Money goes straight from the customer to the business's own MTN or Airtel account; Bwenge never holds it.
 * `fetchImpl` is injected so the calls can be tested without a network. These adapters follow the providers' published APIs; they have not yet been
 * run against a live account (see docs/BWENGE4BIZ.md).
 */
export type PayState = 'pending' | 'success' | 'failed';
export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json: () => Promise<any>; text: () => Promise<string> }>;
export class PayError extends Error { constructor(message: string, public status = 502) { super(message); } }

/** "0788 123 456", "+250788123456", "788123456" -> "250788123456", or null. */
export function msisdn(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, ''); const n = d.startsWith('250') ? d : d.startsWith('0') ? `250${d.slice(1)}` : d.length === 9 ? `250${d}` : '';
  return /^250(72|73|78|79)\d{7}$/.test(n) ? n : null;
}
/** 078 and 079 are MTN, 072 and 073 are Airtel. */
export const providerOf = (n: string): Provider => (/^250(78|79)/.test(n) ? 'mtn' : 'airtel');
export const maskPhone = (n: string) => `${n.slice(0, 6)}***${n.slice(-3)}`;

const MTN_BASE = { sandbox: 'https://sandbox.momodeveloper.mtn.com', production: 'https://proxy.momoapi.mtn.com' };
const AIRTEL_BASE = { staging: 'https://openapiuat.airtel.africa', production: 'https://openapi.airtel.africa' };

export interface Gateway {
  request(o: { amount: number; phone: string; ref: string; note: string }): Promise<void>;
  status(ref: string): Promise<PayState>;
  /** Asks the provider for an access token only: proves the saved keys work, moves no money. */
  ping(): Promise<void>;
}

export function mtnGateway(creds: Record<string, string>, environment: string, f: Fetch): Gateway {
  const prod = environment === 'production'; const base = prod ? MTN_BASE.production : MTN_BASE.sandbox;
  const target = prod ? 'mtnrwanda' : 'sandbox'; const currency = prod ? 'RWF' : 'EUR';              // the MTN sandbox only accepts EUR
  async function token() {
    const r = await f(`${base}/collection/token/`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${creds.apiUser}:${creds.apiKey}`).toString('base64')}`, 'Ocp-Apim-Subscription-Key': creds.subscriptionKey } });
    if (r.status !== 200) throw new PayError(r.status === 401 ? 'MTN did not accept these keys. Check them in Secrets.' : 'MTN is not answering. Try again soon.');
    const t = (await r.json())?.access_token; if (!t) throw new PayError('MTN did not give an access token.'); return String(t);
  }
  const hdr = (t: string, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${t}`, 'X-Target-Environment': target, 'Ocp-Apim-Subscription-Key': creds.subscriptionKey, ...extra });
  return {
    async ping() { await token(); },
    async request({ amount, phone, ref, note }) {
      const t = await token();
      const r = await f(`${base}/collection/v1_0/requesttopay`, { method: 'POST', headers: hdr(t, { 'X-Reference-Id': ref, 'Content-Type': 'application/json' }), body: JSON.stringify({ amount: String(amount), currency, externalId: ref.slice(0, 20), payer: { partyIdType: 'MSISDN', partyId: phone }, payerMessage: note.slice(0, 80), payeeNote: note.slice(0, 80) }) });
      if (r.status !== 202) throw new PayError(r.status === 409 ? 'That payment was already sent.' : 'MTN refused the payment request. Check the number and the amount.');
    },
    async status(ref) {
      const t = await token(); const r = await f(`${base}/collection/v1_0/requesttopay/${encodeURIComponent(ref)}`, { method: 'GET', headers: hdr(t) });
      if (r.status !== 200) throw new PayError('Could not check the payment yet.'); const s = String((await r.json())?.status ?? '').toUpperCase();
      return s === 'SUCCESSFUL' ? 'success' : s === 'FAILED' || s === 'REJECTED' || s === 'TIMEOUT' ? 'failed' : 'pending';
    },
  };
}

export function airtelGateway(creds: Record<string, string>, environment: string, f: Fetch): Gateway {
  const base = environment === 'production' ? AIRTEL_BASE.production : AIRTEL_BASE.staging;
  async function token() {
    const r = await f(`${base}/auth/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: '*/*' }, body: JSON.stringify({ client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: 'client_credentials' }) });
    if (r.status !== 200) throw new PayError(r.status === 401 || r.status === 400 ? 'Airtel did not accept these keys. Check them in Secrets.' : 'Airtel is not answering. Try again soon.');
    const t = (await r.json())?.access_token; if (!t) throw new PayError('Airtel did not give an access token.'); return String(t);
  }
  const hdr = (t: string) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', Accept: '*/*', 'X-Country': 'RW', 'X-Currency': 'RWF' });
  return {
    async ping() { await token(); },
    async request({ amount, phone, ref }) {
      const t = await token();
      const r = await f(`${base}/merchant/v2/payments/`, { method: 'POST', headers: hdr(t), body: JSON.stringify({ reference: ref.slice(0, 20), subscriber: { country: 'RW', currency: 'RWF', msisdn: phone.replace(/^250/, '') }, transaction: { amount, country: 'RW', currency: 'RWF', id: ref } }) });
      const j = await r.json().catch(() => ({})); const ok = r.status === 200 && (j?.status?.success === true || String(j?.status?.response_code ?? '').endsWith('200'));
      if (!ok) throw new PayError('Airtel refused the payment request. Check the number and the amount.');
    },
    async status(ref) {
      const t = await token(); const r = await f(`${base}/standard/v1/payments/${encodeURIComponent(ref)}`, { method: 'GET', headers: hdr(t) });
      if (r.status !== 200) throw new PayError('Could not check the payment yet.'); const s = String((await r.json())?.data?.transaction?.status ?? '').toUpperCase();
      return s === 'TS' ? 'success' : s === 'TF' || s === 'TE' ? 'failed' : 'pending';
    },
  };
}
export const gatewayFor = (p: Provider, creds: Record<string, string>, env: string, f: Fetch) => (p === 'mtn' ? mtnGateway(creds, env, f) : airtelGateway(creds, env, f));
export const realFetch: Fetch = async (url, init) => { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }); return { status: r.status, json: () => r.json(), text: () => r.text() }; };
