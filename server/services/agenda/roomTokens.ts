import { randomBytes } from 'node:crypto';
import { appSettingKV, type KV } from './store.js';

/**
 * A Telegram button must fit in 64 bytes, but a room and a student are two long ids. So the button carries a short single-use token and
 * the details (whose room, which student, what to do) wait here for 8 hours. Only the person the token was made for can use it.
 */
export type RoomButtonAction = 'back_in' | 'pause' | 'resume_all' | 'add' | 'dismiss_give' | 'confirm';
export interface RoomToken { userId: string; kind: 'form' | 'task'; ref: string; action: RoomButtonAction; sid?: string; name?: string; minutes?: number; at?: number }
export const TOKEN_TTL_MS = 8 * 3_600_000;
const key = (t: string) => `ra-token:${t}`;

export async function makeToken(t: RoomToken, kv: KV = appSettingKV(), now = Date.now()): Promise<string> {
  const token = randomBytes(7).toString('base64url');
  await kv.put(key(token), { ...t, at: now }, t.userId);
  // tidy up old tokens now and then
  if (Math.random() < 0.05) for (const r of await kv.list('ra-token:', 300)) if (now - Number((r.value as RoomToken)?.at ?? 0) > TOKEN_TTL_MS) await kv.del(r.key);
  return token;
}

/** Uses a token once. Returns why not when it cannot be used. */
export async function takeToken(token: string, userId: string | undefined, kv: KV = appSettingKV(), now = Date.now()): Promise<{ ok: true; token: RoomToken } | { ok: false; why: 'unknown' | 'expired' | 'not_yours' }> {
  if (!/^[\w-]{6,16}$/.test(token)) return { ok: false, why: 'unknown' };
  const v = (await kv.get(key(token))) as RoomToken | undefined;
  if (!v || typeof v !== 'object') return { ok: false, why: 'unknown' };
  if (!userId || v.userId !== userId) return { ok: false, why: 'not_yours' };           // not consumed: the right person can still use it
  await kv.del(key(token));
  if (now - Number(v.at ?? 0) > TOKEN_TTL_MS) return { ok: false, why: 'expired' };
  return { ok: true, token: v };
}
