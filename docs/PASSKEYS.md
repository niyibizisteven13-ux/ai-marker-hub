# Passkeys: fingerprint or face as the second step, and the app lock

Bwenge signs people in with Google or an emailed code. A **passkey** adds a second step that only the person's own phone can answer
(fingerprint, face or screen lock). The private key never leaves the phone's secure chip; the server keeps only the public key.
Passkeys are always created and checked with *user verification required*.

## For the person (Settings → Security)
1. **Add a passkey** on this phone or laptop. The first one also shows **8 recovery codes** once (copy or download; each works once).
2. Switch on **Ask for my passkey when I sign in**. After Google or the emailed code, a "Confirm it is you" step asks for the fingerprint or
   face. Without it there is no session.
3. Switch on **Lock the app on this phone**. The app opens only after the fingerprint or face, and again after 1, 5 or 15 minutes away (or every
   time). This is a per-device screen lock stored in the phone's browser; it needs a built-in fingerprint/face/screen-lock.
4. Lost phone: use a **recovery code** on the sign-in step. Lost phone *and* codes: an administrator uses **Admin → Users → Reset passkeys**
   (removes the passkeys, switches the step off, signs the person out everywhere; audited as `RESET_USER_PASSKEYS`).

Turning the step off, removing a passkey or making new recovery codes while the step is on needs a fresh fingerprint or face check, so a stolen
open session cannot switch protection off. Removing the last passkey switches the step off and clears the codes.

## How it works
* `server/auth/passkeys.ts` stores everything in AppSetting (no migration): `passkeys:<userId>`, `mfa-ticket:<hash>` (5 minutes, 5 tries),
  `chal:<slot>` (a ceremony's challenge, used once), `proof:<userId>`.
* `authController`: after Google or the emailed code, `hasSecondFactor(user)` holds the sign-in: no session is created; an HttpOnly `mfa_ticket`
  cookie is set (Google redirects to `/?mfa=1`; the email step answers `{ mfaRequired: true }`).
* `/api/auth/passkey/mfa/{options,verify,recovery}` finish the sign-in and create the session. Routes in `server/routes/passkeyRoutes.ts`.
* Browser: `src/auth/passkeys.ts` (`@simplewebauthn/browser`), `MfaStep`, `SecuritySection`, `AppLock`.

## Setup
Passkeys are tied to the site's domain. Defaults come from `APP_BASE_URL` (`www.bwenge.space` → id `bwenge.space`, origins `https://bwenge.space` and
`https://www.bwenge.space`). Override with `PASSKEY_RP_ID` and `PASSKEY_ORIGINS` (comma separated). Passkeys made on one domain do not work on
another (for example a preview URL). They need HTTPS (localhost is allowed for development).

## Limits
* The app lock is a screen lock on top of an existing sign-in: it keeps a borrowed or unattended phone out; it does not replace signing in.
* It covers the Bwenge web app (including when added to the home screen). The MySEB student apps (Flutter, Electron) do not have it.
