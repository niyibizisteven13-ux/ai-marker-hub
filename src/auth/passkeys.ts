import { startAuthentication, startRegistration, browserSupportsWebAuthn, platformAuthenticatorIsAvailable } from '@simplewebauthn/browser';
import { authFetch, getApiUrl } from '../utils/authFetch';

/**
 * Passkeys in the browser: the phone asks for the fingerprint, face or screen lock; the server checks the answer.
 * Nothing secret ever reaches this code: the private key stays in the phone's secure chip.
 */
export const passkeysSupported = () => typeof window !== 'undefined' && browserSupportsWebAuthn();
/** True on a phone or laptop that has a built-in fingerprint, face or screen-lock check. */
export const hasBuiltInBiometric = async () => { try { return passkeysSupported() && (await platformAuthenticatorIsAvailable()); } catch { return false; } };

export interface PasskeyInfo { id: string; name: string; createdAt: string; lastUsedAt: string | null; deviceType: string | null }
export interface PasskeyStatus { creds: PasskeyInfo[]; required: boolean; recoveryLeft: number }
export class PasskeyProblem extends Error { constructor(message: string, public code?: string, public triesLeft?: number) { super(message); } }

async function call<T = any>(path: string, init: RequestInit = {}, signedIn = true): Promise<T> {
  const res = signedIn
    ? await authFetch(`/api/auth/passkey${path}`, init)
    : await fetch(getApiUrl(`/api/auth/passkey${path}`), { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'bwenge', ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new PasskeyProblem(body?.error || 'Something went wrong. Please try again.', body?.code, body?.triesLeft);
  return body as T;
}
const json = (b: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(b) });
/** The person closed the phone's prompt, or it timed out: not an error worth shouting about. */
export const wasCancelled = (e: unknown) => ['NotAllowedError', 'AbortError'].includes((e as Error)?.name);
/** A readable message for something that went wrong while talking to the phone. */
export function explain(e: unknown): string {
  if (e instanceof PasskeyProblem) return e.message;
  if (wasCancelled(e)) return 'It was cancelled or timed out. Please try again.';
  if ((e as Error)?.name === 'InvalidStateError') return 'This device is already added.';
  return 'This device could not be used. Please try again.';
}

export const status = async (): Promise<PasskeyStatus> => { const b = await call<Partial<PasskeyStatus>>('/status'); return { creds: Array.isArray(b?.creds) ? b.creds : [], required: b?.required === true, recoveryLeft: Number(b?.recoveryLeft) || 0 }; };
export async function addPasskey(name?: string): Promise<{ recoveryCodes: string[] | null } & PasskeyStatus> {
  const optionsJSON = await call('/register/options', json({}));
  const response = await startRegistration({ optionsJSON });
  return call('/register/verify', json({ response, name }));
}
/** A fresh fingerprint or face check, to allow one sensitive change. */
export async function confirmWithPasskey(purpose: 'manage' | 'unlock' = 'manage'): Promise<void> {
  const optionsJSON = await call('/assert/options', json({ purpose }));
  const response = await startAuthentication({ optionsJSON });
  await call('/assert/verify', json({ purpose, response }));
}
/** Runs a change; if the server wants a fresh check first, asks for the fingerprint or face and tries once more. */
export async function withProof<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (e) { if (e instanceof PasskeyProblem && e.code === 'PROOF_REQUIRED') { await confirmWithPasskey('manage'); return run(); } throw e; }
}
export const setRequired = (required: boolean) => call<PasskeyStatus>('/settings', json({ required }));
export const removePasskey = (id: string) => call<PasskeyStatus>(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const regenerateRecovery = () => call<{ recoveryCodes: string[] }>('/recovery/regenerate', json({}));

/* second step after Google or the emailed code (no session yet: the ticket is an HttpOnly cookie) */
export interface MfaDone { ok: true; next: string; accessToken: string; expiresIn: number }
export async function signInWithPasskey(): Promise<MfaDone> {
  const optionsJSON = await call('/mfa/options', json({}), false);
  const response = await startAuthentication({ optionsJSON });
  return call('/mfa/verify', json({ response }), false);
}
export const signInWithRecoveryCode = (code: string) => call<MfaDone>('/mfa/recovery', json({ code }), false);
