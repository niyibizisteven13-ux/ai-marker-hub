import crypto from 'node:crypto';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { prisma } from '../db.js';

/**
 * Passkeys (fingerprint, face or screen lock on the phone) as a second step after Google or the emailed code, and as the key that opens
 * the app on a phone. Stored in the AppSetting key/value table (no migration):
 *   passkeys:<userId>      -> { creds, required, recovery }     the person's passkeys and whether sign-in asks for one
 *   mfa-ticket:<sha256>    -> { userId, next, exp, tries }       "first step done, second step pending" (5 minutes, 5 tries)
 *   chal:<slot>            -> { challenge, exp }                 the challenge of one ceremony (5 minutes, used once)
 *   proof:<userId>         -> { exp }                            a fresh passkey check that allows one sensitive change
 * Passkeys are always created and checked with user verification "required": the phone must confirm the person (fingerprint, face or PIN).
 */
const db = prisma as any;
const TEMP_MS = 5 * 60_000;
const MAX_TRIES = 5;

export interface PasskeyCred { id: string; publicKey: string; counter: number; transports?: string[]; name: string; createdAt: string; lastUsedAt?: string; deviceType?: string; backedUp?: boolean }
export interface PasskeyRecord { creds: PasskeyCred[]; required: boolean; /** sha256 hex of recovery codes not used yet */ recovery: string[] }
const EMPTY: PasskeyRecord = { creds: [], required: false, recovery: [] };

/** Where passkeys are valid: the relying party id (a registrable domain) and the exact origins that may use it. */
export function relyingParty(env: NodeJS.ProcessEnv = process.env): { id: string; name: string; origins: string[] } {
  const base = new URL(env.APP_BASE_URL || 'https://www.bwenge.space');
  const id = (env.PASSKEY_RP_ID || base.hostname.replace(/^www\./, '')).toLowerCase();
  const extra = String(env.PASSKEY_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const origins = extra.length ? extra : id === 'localhost' ? ['http://localhost:3000', 'http://localhost:5173'] : [`https://${id}`, `https://www.${id}`];
  return { id, name: 'Bwenge', origins };
}

async function getKv<T>(key: string): Promise<T | null> { const r = await db.appSetting.findUnique({ where: { key } }).catch(() => null); return r?.value && typeof r.value === 'object' ? (r.value as T) : null; }
async function putKv(key: string, value: unknown) {
  const now = new Date(); const ex = await db.appSetting.findUnique({ where: { key } }).catch(() => null);
  if (ex) await db.appSetting.update({ where: { key }, data: { value, updatedBy: 'passkeys', updatedAt: now } });
  else await db.appSetting.create({ data: { key, value, updatedBy: 'passkeys', updatedAt: now } });
}
const delKv = (key: string) => db.appSetting.delete({ where: { key } }).catch(() => undefined);
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export async function loadRecord(userId: string): Promise<PasskeyRecord> {
  const r = await getKv<PasskeyRecord>(`passkeys:${userId}`);
  return r ? { creds: Array.isArray(r.creds) ? r.creds : [], required: r.required === true, recovery: Array.isArray(r.recovery) ? r.recovery : [] } : { ...EMPTY, creds: [], recovery: [] };
}
const saveRecord = (userId: string, r: PasskeyRecord) => putKv(`passkeys:${userId}`, r);

/** True when signing in as this person must end with a passkey (or a recovery code). */
export async function hasSecondFactor(userId: string): Promise<boolean> { const r = await loadRecord(userId); return r.required && r.creds.length > 0; }

/* ---------------------------------------------------------------- temporary records */
async function putTemp(key: string, value: Record<string, unknown>) { await putKv(key, { ...value, exp: Date.now() + TEMP_MS }); }
/** Reads a temporary record; an old one counts as missing. `use` removes it (one use). */
async function takeTemp<T extends { exp: number }>(key: string, use: boolean): Promise<T | null> {
  const r = await getKv<T>(key);
  if (!r) return null;
  if (r.exp < Date.now()) { await delKv(key); return null; }
  if (use) await delKv(key);
  return r;
}

/* ---------------------------------------------------------------- sign-in tickets */
const ticketKey = (token: string) => `mfa-ticket:${sha(token)}`;
export async function issueTicket(userId: string, next: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await putTemp(ticketKey(token), { userId, next, tries: 0 });
  return token;
}
export const readTicket = (token: string | undefined) => (token ? takeTemp<{ userId: string; next: string; tries: number; exp: number }>(ticketKey(token), false) : Promise.resolve(null));
export const burnTicket = (token: string) => delKv(ticketKey(token));
/** Counts a failed try; the ticket is destroyed after five. Returns the tries left. */
export async function failTicket(token: string): Promise<number> {
  const t = await readTicket(token); if (!t) return 0;
  const tries = (t.tries ?? 0) + 1;
  if (tries >= MAX_TRIES) { await burnTicket(token); return 0; }
  await putKv(ticketKey(token), { ...t, tries });
  return MAX_TRIES - tries;
}

/* ---------------------------------------------------------------- registering a passkey */
export async function registrationOptions(user: { id: string; email: string; name?: string }) {
  const rp = relyingParty(); const rec = await loadRecord(user.id);
  const options = await generateRegistrationOptions({
    rpName: rp.name, rpID: rp.id, userName: user.email, userDisplayName: user.name || user.email, userID: new TextEncoder().encode(user.id),
    attestationType: 'none', timeout: 120_000,
    excludeCredentials: rec.creds.map((c) => ({ id: c.id, transports: c.transports as any })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
  await putTemp(`chal:reg:${user.id}`, { challenge: options.challenge });
  return options;
}

export async function finishRegistration(userId: string, response: RegistrationResponseJSON, name?: string): Promise<{ cred: PasskeyCred; recoveryCodes: string[] | null }> {
  const rp = relyingParty();
  const chal = await takeTemp<{ challenge: string; exp: number }>(`chal:reg:${userId}`, true);
  if (!chal) throw new PasskeyError('That request expired. Please try again.', 400);
  const v = await verifyRegistrationResponse({ response, expectedChallenge: chal.challenge, expectedOrigin: rp.origins, expectedRPID: rp.id, requireUserVerification: true }).catch(() => null);
  if (!v?.verified || !v.registrationInfo) throw new PasskeyError('This device could not be verified. Please try again.', 400);
  const { credential, credentialDeviceType, credentialBackedUp } = v.registrationInfo;
  const rec = await loadRecord(userId);
  if (rec.creds.some((c) => c.id === credential.id)) throw new PasskeyError('This device is already added.', 409);
  if (rec.creds.length >= 10) throw new PasskeyError('You can keep up to 10 passkeys. Remove one first.', 409);
  const cred: PasskeyCred = {
    id: credential.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'), counter: credential.counter, transports: credential.transports as string[] | undefined,
    name: String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || `Passkey ${rec.creds.length + 1}`, createdAt: new Date().toISOString(), deviceType: credentialDeviceType, backedUp: credentialBackedUp,
  };
  rec.creds.push(cred);
  let recoveryCodes: string[] | null = null;
  if (!rec.recovery.length) { const made = makeRecoveryCodes(); rec.recovery = made.hashes; recoveryCodes = made.codes; }   // shown once, at the first passkey
  await saveRecord(userId, rec);
  return { cred, recoveryCodes };
}

/* ---------------------------------------------------------------- checking a passkey */
/** A check of one person's passkeys. `slot` keeps this ceremony apart from others (a ticket, "unlock", "manage"). */
export async function assertionOptions(userId: string, slot: string) {
  const rp = relyingParty(); const rec = await loadRecord(userId);
  if (!rec.creds.length) throw new PasskeyError('No passkey is set up on this account.', 400);
  const options = await generateAuthenticationOptions({ rpID: rp.id, userVerification: 'required', timeout: 120_000, allowCredentials: rec.creds.map((c) => ({ id: c.id, transports: c.transports as any })) });
  await putTemp(`chal:${slot}`, { challenge: options.challenge });
  return options;
}

/** True when the response is a genuine, user-verified answer from one of the person's passkeys for this slot's challenge. The counter is kept up to date. */
export async function verifyAssertion(userId: string, slot: string, response: AuthenticationResponseJSON): Promise<boolean> {
  const rp = relyingParty();
  const chal = await takeTemp<{ challenge: string; exp: number }>(`chal:${slot}`, true);
  if (!chal) return false;
  const rec = await loadRecord(userId);
  const cred = rec.creds.find((c) => c.id === response?.id);
  if (!cred) return false;
  const v = await verifyAuthenticationResponse({
    response, expectedChallenge: chal.challenge, expectedOrigin: rp.origins, expectedRPID: rp.id, requireUserVerification: true,
    credential: { id: cred.id, publicKey: Buffer.from(cred.publicKey, 'base64url'), counter: cred.counter, transports: cred.transports as any },
  }).catch(() => null);
  if (!v?.verified) return false;
  cred.counter = v.authenticationInfo.newCounter; cred.lastUsedAt = new Date().toISOString();
  await saveRecord(userId, rec);
  return true;
}

/* ---------------------------------------------------------------- sensitive changes need a fresh check */
export const grantProof = (userId: string) => putTemp(`proof:${userId}`, {});
export async function takeProof(userId: string): Promise<boolean> { return !!(await takeTemp(`proof:${userId}`, true)); }

/* ---------------------------------------------------------------- recovery codes */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
/** Eight one-time codes like "k3m9-x7qd" (shown once; only their hashes are kept). */
export function makeRecoveryCodes(n = 8): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: n }, () => { const pick = () => Array.from(crypto.randomBytes(4), (b) => ALPHABET[b % ALPHABET.length]).join(''); return `${pick()}-${pick()}`; });
  return { codes, hashes: codes.map(normalizeCode).map(sha) };
}
export const normalizeCode = (c: string) => String(c ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** Uses a recovery code once. */
export async function useRecoveryCode(userId: string, code: string): Promise<boolean> {
  const rec = await loadRecord(userId); const h = sha(normalizeCode(code));
  const i = rec.recovery.indexOf(h);
  if (i < 0) return false;
  rec.recovery.splice(i, 1); await saveRecord(userId, rec); return true;
}
export async function regenerateRecovery(userId: string): Promise<string[]> { const rec = await loadRecord(userId); const m = makeRecoveryCodes(); rec.recovery = m.hashes; await saveRecord(userId, rec); return m.codes; }

/* ---------------------------------------------------------------- settings */
export async function setRequired(userId: string, required: boolean) {
  const rec = await loadRecord(userId);
  if (required && !rec.creds.length) throw new PasskeyError('Add a passkey first.', 400);
  rec.required = required; await saveRecord(userId, rec);
}
export async function removeCred(userId: string, id: string): Promise<boolean> {
  const rec = await loadRecord(userId); const before = rec.creds.length;
  rec.creds = rec.creds.filter((c) => c.id !== id);
  if (rec.creds.length === before) return false;
  if (!rec.creds.length) { rec.required = false; rec.recovery = []; }      // nothing left to ask for
  await saveRecord(userId, rec); return true;
}
/** For an administrator helping someone who lost their phone and recovery codes. */
export async function resetAll(userId: string) { await delKv(`passkeys:${userId}`); }

export class PasskeyError extends Error { constructor(message: string, public status = 400) { super(message); } }
