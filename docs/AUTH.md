# Bwenge Authentication & Security Guide

This document outlines the architecture, setup, threat model, and runbook for Bwenge authentication ("Continue with Google" and passwordless email code).

---

## 1. Flow Diagrams

### 1.1 Continue with Google (Server-Side Redirect Flow with PKCE)
```
Browser                         Our API                                  Google
  | click "Continue with Google"  |                                         |
  |------------------------------>| GET /api/auth/google/start?next=/chat   |
  |                               | create state + nonce + PKCE verifier;   |
  |                               | store in a short-lived signed cookie    |
  |<------------------------------| 302 to accounts.google.com (scope=openid email profile,
  |                               |   prompt=select_account, code_challenge=S256, state, nonce)
  |-------------------------------------------------------------------------->| user picks account, consents
  |<--------------------------------------------------------------------------| 302 /api/auth/google/callback?code&state
  |------------------------------>| verify state + cookie; exchange code     |
  |                               | (with code_verifier + client secret);    |
  |                               | verify ID token (signature via Google    |
  |                               | JWKS, iss, aud, exp, nonce, email_verified)
  |                               | find/link/create user; create session    |
  |<------------------------------| 302 to sanitized `next` (or POST_LOGIN_ROUTE), Set-Cookie session
```

### 1.2 Continue with Email (Passwordless 6-Digit Code)
```
1. Person taps "Continue with email", types their email, taps "Send code".
2. POST /api/auth/email/start { email, locale } -> ALWAYS 202 { ok: true, retryAfter: 30 }
3. We email a 6-digit code (valid 10 minutes, HMAC-SHA256 hashed).
4. Person types the code (auto-submit at 6 digits).
5. POST /api/auth/email/verify { email, code }   -> 200 { accessToken, user, isNewUser } + HttpOnly refresh cookie
6. The short-lived access token stays in memory; on page reload, the browser sends the refresh cookie to /api/auth/refresh.
```

---

## 2. Google Cloud Console Setup

1. Go to **Google Cloud Console** > **APIs & Services** > **OAuth consent screen**.
2. Configure app name (`Bwenge`), support email, privacy policy URL, authorized domains.
3. Scopes: `openid`, `email`, `profile` (non-sensitive). Publish app to **Production**.
4. Go to **Credentials** > **Create Credentials** > **OAuth client ID** > **Web application**.
5. Authorized JavaScript origins: your frontend origins.
6. Authorized redirect URIs: `${APP_BASE_URL}/api/auth/google/callback`.
7. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in server environment variables.

---

## 3. Environment Variables (`.env.example`)

```env
APP_NAME=Bwenge
APP_BASE_URL=http://localhost:3000
POST_LOGIN_ROUTE=/chat
SESSION_SECRET=<32+ random bytes HMAC pepper>
SESSION_IDLE_DAYS=30
SESSION_ABSOLUTE_DAYS=90

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=${APP_BASE_URL}/api/auth/google/callback

EMAIL_PROVIDER=console # console | smtp | resend
EMAIL_FROM="Bwenge <login@bwenge.ai>"
EMAIL_SMTP_URL=
```

---

## 4. Threat Model & Security Controls

| Threat | Prevention Control |
|---|---|
| **CSRF** | `SameSite=Lax` cookies, Origin checks, double-submit tokens. |
| **Code Interception / Replay** | Single-use email codes hashed with HMAC-SHA256, 10-minute expiry, max 5 attempts. |
| **Token Theft** | OAuth provider tokens stay server-side; application access tokens stay in memory and refresh tokens use HttpOnly cookies. |
| **In-App Browser Attacks** | User-agent detection on Google start returns `{ blocked: 'in_app_browser' }` prompting browser open. |
| **Open Redirects** | `sanitizeNext(next)` ensures only relative internal paths under 200 characters are allowed. |
| **Account Enumeration** | Uniform 202 responses and consistent timing on email start regardless of account existence. |

---

## 5. Runbook

- **Rotate `SESSION_SECRET`**: Update the environment variable and restart the server. This invalidates existing HMAC code hashes (while refresh sessions remain valid until expiry).
- **Revoke All Sessions**: Run SQL `UPDATE refresh_sessions SET revoked_at = now() WHERE revoked_at IS NULL;`.
- **Google Outage**: Direct users to use "Continue with email" (passwordless 6-digit code) as an independent fallback authentication method.
