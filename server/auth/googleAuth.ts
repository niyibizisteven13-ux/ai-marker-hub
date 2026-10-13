import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { sanitizeNext } from './sanitizeNext.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';

const oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

export function isInAppBrowser(userAgent: string = ''): boolean {
  const ua = userAgent.toLowerCase();
  const inAppKeywords = [
    'fban', 'fbav', 'instagram', 'wechat', 'micromessenger', 'line',
    'twitter', 'linkedinapp', 'snapchat', 'pinterest', 'wv', 'webview'
  ];
  return inAppKeywords.some((keyword) => ua.includes(keyword));
}

export function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function getGoogleAuthUrl(nextUrl?: string) {
  const state = crypto.randomBytes(32).toString('hex');
  const nonce = crypto.randomBytes(32).toString('hex');
  const { verifier, challenge } = generatePKCE();
  const sanitizedNext = sanitizeNext(nextUrl);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['openid', 'email', 'profile'],
    state,
    nonce,
    prompt: 'select_account',
    code_challenge_method: 'S256' as any,
    code_challenge: challenge,
  });

  return { authUrl, state, nonce, verifier, sanitizedNext };
}

export async function verifyGoogleCode(code: string, codeVerifier: string, expectedNonce: string) {
  const { tokens } = await oauth2Client.getToken({
    code,
    codeVerifier,
  });

  const idToken = tokens.id_token;
  if (!idToken) {
    throw new Error('google_failed: No ID token returned from Google.');
  }

  const ticket = await oauth2Client.verifyIdToken({
    idToken,
    audience: CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error('google_failed: Invalid ID token payload.');
  }

  if (payload.nonce && payload.nonce !== expectedNonce) {
    throw new Error('google_failed: Nonce mismatch.');
  }

  if (!payload.email_verified) {
    throw new Error('google_unverified');
  }

  return {
    sub: payload.sub,
    email: payload.email!,
    name: payload.name || payload.email!.split('@')[0],
    picture: payload.picture,
    emailVerified: payload.email_verified,
  };
}
