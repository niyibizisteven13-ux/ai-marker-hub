import crypto from 'node:crypto';
import { sha } from './config.js';

// A short readable word in the middle catches typos: 849277 is shown as 8492-KIGALI-77.
const WORDS = ['KIGALI', 'HUYE', 'MUSANZE', 'RUBAVU', 'NYUNGWE', 'AKAGERA', 'KIVU', 'VIRUNGA', 'IMPALA', 'INKOKO',
  'UMURIMA', 'IMANA', 'AMAHORO', 'URUBUGA', 'IKIBUGA', 'INTORE', 'NYABARONGO', 'GISENYI', 'BUTARE', 'RWAMAGANA'];

export function newCode() {
  const digits = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  return { digits, display: formatCode(digits) };
}
export function formatCode(digits) {
  const word = WORDS[parseInt(digits, 10) % WORDS.length];
  return `${digits.slice(0, 4)}-${word}-${digits.slice(4)}`;
}
/** Accepts "849277", "8492-KIGALI-77", with any spacing or case. Returns the 6 digits or null. */
export function parseCode(input) {
  const d = String(input ?? '').replace(/[^0-9]/g, '');
  if (d.length !== 6) return null;
  const shown = String(input).toUpperCase().match(/[A-Z]+/g);
  if (shown && shown.join('') !== WORDS[parseInt(d, 10) % WORDS.length]) return null; // word does not match the digits: typo
  return d;
}
export const codeHash = (digits) => sha('code:' + digits);
export const tokenHash = (token) => sha('token:' + token);
export const secretHash = (secret) => sha('secret:' + secret);
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const newSecret = () => 'mseb_' + crypto.randomBytes(24).toString('base64url');

/** Small fixed-window limiter (per key). Replace with Redis if you run more than one server. */
export function rateLimit({ windowMs, max, keyFn = (req) => req.ip }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    if (++h.n > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });
    }
    next();
  };
}

/**
 * Counts only FAILED tries. A whole lab of students behind one school network can all enter the right code at once;
 * only guessing (wrong codes) is slowed down. While an address is over its limit, every try from it is refused,
 * right or wrong, so a refusal never tells an attacker whether a guess was close.
 */
export function failureGate({ windowMs, max, keyFn = (req) => req.ip }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  const entry = (key) => {
    const now = Date.now(); let h = hits.get(key);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    return h;
  };
  return {
    blocked: (req) => { const h = entry(keyFn(req)); return h.n >= max ? Math.ceil((h.reset - Date.now()) / 1000) : 0; },   // seconds to wait, 0 = fine
    fail: (req) => { entry(keyFn(req)).n++; },
  };
}
