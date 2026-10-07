# Authentication Redesign & Security Hardening Implementation Plan

Redesign authentication for Bwenge / Marker AI so sessions are secure, survive page reloads, expire gracefully, and never leave the UI in a "half signed-in" session or risk shared computer privacy.

## User Review Required

> [!IMPORTANT]
> - Access tokens are now stored **exclusively in memory** on the client (`authFetch.ts`), never in `localStorage` or `sessionStorage`.
> - Refresh tokens are stored in httpOnly, Secure (in production), SameSite=Lax cookies (`bwenge_rt`), with sliding 30-day expiration and 90-day absolute expiration, tracked via SHA-256 hashes in PostgreSQL (`RefreshSession` Prisma model).
> - Token reuse detection will revoke entire token sessions family and log `TOKEN_REUSE` in audit logs.
> - All raw `fetch` calls in components/services that passed Bearer tokens manually are migrated to `authFetch` with single-flight silent refresh and retry logic.

## Open Questions

- None. All architectural constraints and target designs are fully specified.

## Proposed Changes

### Database & Migration
#### [NEW] [migration.sql](file:///C:/Users/niyib/Downloads/ai-marker-hub/prisma/migrations/20261003000300_refresh_session/migration.sql)
#### [MODIFY] [schema.prisma](file:///C:/Users/niyib/Downloads/ai-marker-hub/prisma/schema.prisma)
- Add `RefreshSession` model.

### Server-side Authentication & Security
#### [MODIFY] [production/auth.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/production/auth.ts)
- Update `requireAuth` to verify issuer (`bwenge`), audience (`bwenge-web`), HS256 algorithm, 15m expiration, returning JSON error code (`NO_TOKEN`, `TOKEN_EXPIRED`, `INVALID_TOKEN`).
- Implement comprehensive `writeAuditLog` supporting LOGIN, LOGIN_FAILED, LOGOUT, LOGOUT_ALL, TOKEN_REUSE, PASSWORD_RESET.
- Add `requireRole` helper.

#### [MODIFY] [production/rateLimiter.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/production/rateLimiter.ts)
- Add `authLimiter` (10 requests / 15 min / IP).

#### [MODIFY] [server/controllers/authController.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server/controllers/authController.ts)
- Implement register, login (with secure httpOnly refresh cookie and `RefreshSession` DB record), refresh (with token rotation and reuse detection), logout, logout-all.
- Add account lockout tracking (5 failed logins in 15 min -> 429 Retry-After).

#### [MODIFY] [server.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server.ts)
- Secure `/api/ai/chat` attachment lookup (`where: { id: { in: ids }, userId }`).
- Remove `|| 'local-dev'` / `|| 'anonymous'` userId fallbacks on authenticated routes.

### Client-side Authentication & State
#### [MODIFY] [src/utils/authFetch.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/utils/authFetch.ts)
- Implement single-flight silent refresh on 401 `TOKEN_EXPIRED`, automatic retry, `credentials: 'include'`, proactive refresh timer & visibilitychange trigger, and `bwenge:session-expired` event dispatch.

#### [MODIFY] [src/store/useStore.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/store/useStore.ts)
- Remove token and user from persisted localStorage.
- Add authStatus (`'loading'` | `'authenticated'` | `'anonymous'`).

#### [MODIFY] [App.tsx](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/App.tsx)
- Boot flow: call `/api/auth/refresh` on start.
- Workspace restore failure guard (`workspaceRestoreFailed`).
- Listen for `bwenge:session-expired` and BroadcastChannel (`bwenge-auth`).
- Replace raw fetches with `authFetch`.
- Comprehensive logout cleanup.

#### [MODIFY] [src/components/LoginModal.tsx](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/components/LoginModal.tsx)
- Rebuild LoginModal: full-screen bottom sheet on mobile, centered modal on desktop, accessible inputs (>=16px, >=44px touch targets), sentence-case inline validation errors, focus trap.

#### [MODIFY] [src/components/LeftSidebar.tsx](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/components/LeftSidebar.tsx)
- Update profile menu and sign out flow.

#### [MODIFY] [src/components/SettingsModal.tsx](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/components/SettingsModal.tsx)
- Add "Sign out of all devices" (`/api/auth/logout-all`).

## Verification Plan

### Automated Tests
- Run `npx tsc --noEmit` and `npm run build`.

### Manual Verification
- Test anonymous boot, sign up, sign login, page reload persistence, silent token refresh during chat streaming, token reuse detection, account lockout on wrong passwords, cross-tab sync via BroadcastChannel, shared computer logout cleanup, and file access isolation between users.
