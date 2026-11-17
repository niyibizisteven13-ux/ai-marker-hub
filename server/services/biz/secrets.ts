import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * The business's payment secrets (MTN MoMo and Airtel Money API keys). They are encrypted with AES-256-GCM before they are stored, can be written but
 * never read back through any route, and only the payment code decrypts them, to call the provider. What the owner sees afterwards is the last four
 * characters of the main key, the environment and the date. The key comes from BIZ_SECRETS_KEY (set it in production); without it the server's JWT secret is used.
 */
export type Provider = 'mtn' | 'airtel';
export const PROVIDERS: Provider[] = ['mtn', 'airtel'];
export const FIELDS: Record<Provider, Array<{ id: string; label: string; secret: boolean; help: string }>> = {
  mtn: [
    { id: 'subscriptionKey', label: 'Subscription key (Ocp-Apim-Subscription-Key)', secret: true, help: 'From your product subscription on the MTN MoMo developer portal (Collections).' },
    { id: 'apiUser', label: 'API user (UUID)', secret: false, help: 'The API user you created for Collections.' },
    { id: 'apiKey', label: 'API key', secret: true, help: 'The key generated for that API user.' },
  ],
  airtel: [
    { id: 'clientId', label: 'Client ID', secret: false, help: 'From the Airtel Money Open API portal.' },
    { id: 'clientSecret', label: 'Client secret', secret: true, help: 'The matching secret.' },
  ],
};
export const ENVIRONMENTS: Record<Provider, string[]> = { mtn: ['sandbox', 'production'], airtel: ['staging', 'production'] };

export interface Sealed { iv: string; tag: string; ct: string }
export interface SecretsDoc { mtn?: { sealed: Sealed; hint: string; environment: string; at: string }; airtel?: { sealed: Sealed; hint: string; environment: string; at: string } }

export const keyFrom = (material: string) => createHash('sha256').update(`bwenge4biz-secrets|${material}`).digest();
export function seal(plain: string, key: Buffer): Sealed {
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}
export function open(s: Sealed, key: Buffer): string {
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(s.iv, 'base64')); d.setAuthTag(Buffer.from(s.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(s.ct, 'base64')), d.final()]).toString('utf8');
}

/** Checks the pasted fields for one provider; returns them trimmed, or a plain error. Secrets are never echoed in the error. */
export function cleanSecrets(provider: Provider, input: any): { fields: Record<string, string>; environment: string; hint: string } | { error: string } {
  const defs = FIELDS[provider]; if (!defs) return { error: 'Unknown provider.' };
  const fields: Record<string, string> = {};
  for (const d of defs) {
    const v = String(input?.[d.id] ?? '').trim();
    if (!v) return { error: `${d.label} is required.` }; if (v.length > 300 || /[\r\n\s]/.test(v)) return { error: `${d.label} does not look right. Paste it without spaces or line breaks.` };
    fields[d.id] = v;
  }
  if (provider === 'mtn' && !/^[0-9a-f-]{36}$/i.test(fields.apiUser)) return { error: 'The API user must be a UUID like 3f2b8c1e-…' };
  const environment = ENVIRONMENTS[provider].includes(String(input?.environment)) ? String(input.environment) : 'production';
  const main = provider === 'mtn' ? fields.apiKey : fields.clientSecret;
  return { fields, environment, hint: `…${main.slice(-4)}` };
}
