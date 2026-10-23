/**
 * Finds which part of a request-to-pay MTN refuses. Run on the server, in the app directory:
 *
 *   npm run --silent momo:diagnose                 (sandbox test number 46733123456)
 *   npm run --silent momo:diagnose -- 0788123456   (also try a number the way the app formats it)
 *
 * Each line sends one request-to-pay and prints MTN's HTTP status (202 = accepted). Only statuses, the masked
 * number and the callback host are printed: no keys or tokens. In the sandbox nothing is charged.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { accessToken, buildRequestToPay, momoConfig, momoReady, normalizeMsisdn } from '../server/services/billing/momo.js';

const c = momoConfig();
if (!momoReady() || c.simulate) {
  console.error('MTN MoMo is not configured here (MOMO_COLLECTION_PRIMARY_KEY, MOMO_API_USER, MOMO_API_KEY).');
  process.exit(1);
}
console.log(`Target ${c.targetEnv}, currency ${c.currency}, callback host ${c.callbackHost || '(none)'}`);

let token: string;
try { token = await accessToken(); } catch { console.error('Token request failed: check MOMO_API_USER, MOMO_API_KEY and the subscription key.'); process.exit(1); }
console.log('token                     200 OK');

const typed = process.argv[2];
const testNumber = '46733123456';
const raw = (variant: { amount: string; message: string; callback: boolean; msisdn?: string }) => {
  const id = randomUUID();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'X-Reference-Id': id, 'X-Target-Environment': c.targetEnv, 'Ocp-Apim-Subscription-Key': c.subscriptionKey, 'Content-Type': 'application/json' };
  if (variant.callback) headers['X-Callback-Url'] = `${c.callbackHost}/api/billing/momo/callback/${id}`;
  const body = JSON.stringify({ amount: variant.amount, currency: c.currency, externalId: 't1', payer: { partyIdType: 'MSISDN', partyId: variant.msisdn ?? testNumber }, payerMessage: variant.message, payeeNote: 'test' });
  return { url: `${c.baseUrl}/collection/v1_0/requesttopay`, headers, body };
};
const app = (msisdn: string, withCallback: boolean) => {
  const id = randomUUID();
  return buildRequestToPay({ referenceId: id, amount: 500, msisdn, externalId: id, payerMessage: 'Bwenge AI: GO credits · 500 credits', payeeNote: 'Bwenge GO_PACK 12345678' }, token, withCallback);
};

const cases: Array<[string, { url: string; headers: Record<string, string>; body: string }]> = [
  ['plain (known good)', raw({ amount: '1', message: 'test', callback: false })],
  ['+ callback URL', raw({ amount: '1', message: 'test', callback: true })],
  ['+ message with "·"', raw({ amount: '1', message: 'Bwenge AI: GO credits · 500 credits', callback: false })],
  ['+ message with ":" only', raw({ amount: '1', message: 'Bwenge AI: GO credits 500 credits', callback: false })],
  ['+ amount 500', raw({ amount: '500', message: 'test', callback: false })],
  ['app request, with callback', app(testNumber, true)],
  ['app request, no callback', app(testNumber, false)],
];
if (typed) {
  try {
    const n = normalizeMsisdn(typed);
    cases.push([`app request, number ${n.masked}`, app(n.msisdn, false)]);
  } catch (e) { console.log(`number "${typed.replace(/\d(?=\d{3})/g, '•')}": ${(e as Error).message}`); }
}

for (const [name, r] of cases) {
  const res = await fetch(r.url, { method: 'POST', headers: r.headers, body: r.body, signal: AbortSignal.timeout(20_000) }).catch(() => null);
  const text = res ? (await res.text().catch(() => '')).slice(0, 160) : '';
  console.log(`${name.padEnd(26)}${res ? `${res.status} ${res.status === 202 ? 'OK' : 'REFUSED'}` : 'network error'}${text ? `  ${text}` : ''}`);
}
console.log('\nThe app now sends plain-ASCII messages and retries without the callback URL if MTN refuses it.');
