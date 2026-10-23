/**
 * Creates an MTN MoMo **sandbox** API user and API key for the Collections product.
 *
 *   MOMO_COLLECTION_PRIMARY_KEY=<your sandbox subscription key> \
 *   MOMO_CALLBACK_HOST=www.bwenge.space \
 *   npx tsx scripts/momo-sandbox-setup.ts
 *
 * Copy the printed lines into the server environment (never into git). Production credentials are not created
 * this way: MTN Rwanda issues them through the partner portal after the go-live application.
 */
import { randomUUID } from 'node:crypto';

const base = (process.env.MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com').replace(/\/$/, '');
const key = process.env.MOMO_COLLECTION_PRIMARY_KEY || process.env.MOMO_SUBSCRIPTION_KEY;
const host = (process.env.MOMO_CALLBACK_HOST || 'www.bwenge.space').replace(/^https?:\/\//, '').replace(/\/.*$/, '');

if (!key) {
  console.error('Set MOMO_COLLECTION_PRIMARY_KEY to the Collections subscription key from momodeveloper.mtn.com (Profile → Subscriptions).');
  process.exit(1);
}
if (!base.includes('sandbox')) {
  console.error('This script only works against the sandbox. Production API users come from MTN.');
  process.exit(1);
}

const user = randomUUID();
const created = await fetch(`${base}/v1_0/apiuser`, {
  method: 'POST',
  headers: { 'X-Reference-Id': user, 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ providerCallbackHost: host }),
});
if (created.status !== 201) {
  console.error(`Creating the API user failed (${created.status}): ${await created.text()}`);
  process.exit(1);
}
const keyRes = await fetch(`${base}/v1_0/apiuser/${user}/apikey`, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key } });
if (keyRes.status !== 201) {
  console.error(`Creating the API key failed (${keyRes.status}): ${await keyRes.text()}`);
  process.exit(1);
}
const { apiKey } = (await keyRes.json()) as { apiKey: string };
console.log('Sandbox credentials created. Add these to the server environment (e.g. /opt/nexus/.env), then restart:\n');
console.log(`MOMO_BASE_URL=${base}`);
console.log('MOMO_COLLECTION_PRIMARY_KEY=<the key you used>');
console.log(`MOMO_API_USER=${user}`);
console.log(`MOMO_API_KEY=${apiKey}`);
console.log('MOMO_TARGET_ENV=sandbox');
console.log(`MOMO_CALLBACK_HOST=https://${host}`);
console.log('\nThen open Admin → Billing → "Test MTN connection".');
