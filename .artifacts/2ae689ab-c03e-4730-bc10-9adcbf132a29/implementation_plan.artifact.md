# Authentication & Session Fixes Implementation Plan

Fix authentication 500 errors, secure audit logging, add `cookie-parser`, handle atomic registration/refresh, improve error visibility, ensure subscription info in user object, and update routes and client `authFetch`.

## User Review Required

> [!IMPORTANT]
> This plan covers installing `cookie-parser`, applying 6 robustness and security fixes in `authController.ts`, updating `server.ts` to register `cookie-parser` and auth routes correctly, updating `authFetch.ts` to handle `ROTATED` retry logic, and ensuring proper Prisma client generation and migrations.

## Proposed Changes

### Server & Database

#### [MODIFY] [schema.prisma](file:///C:/Users/niyib/Downloads/ai-marker-hub/prisma/schema.prisma)
- Ensure `RefreshSession` model exists and matches user requirements (already present in schema).
- Run `prisma migrate dev` or `prisma db push` / `prisma generate`.

#### [MODIFY] [server.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server.ts)
- Import and use `cookie-parser` right after `express.urlencoded(...)`.
- Ensure all auth routes (`refresh`, `logout`, `logout-all`, `me`) are properly wired in `authRoutes.ts`.

#### [MODIFY] [authRoutes.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server/routes/authRoutes.ts)
- Register `/refresh`, `/logout`, `/logout-all`, and `/me` routes with appropriate rate limits and `requireAuth`.

### Controllers & Business Logic

#### [MODIFY] [authController.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server/controllers/authController.ts)
- Bug 1: Make audit logging non-fatal (`void audit(...)`), and skip DB write for failed logins, logging via `console.warn`.
- Bug 2: Integrate `cookie-parser` usage.
- Bug 3: Implement atomic refresh token claim / rotation handling with `ROTATED` code tolerance.
- Bug 4: Restrict refresh token reading strictly to cookies (`req.cookies?.bwenge_rt`).
- Bug 5: Wrap user creation and initial session creation in a single `prisma.$transaction`.
- Bug 6: Provide developer-friendly error messages when not in production.
- Bug 7: Include `subscription` in `buildAuthenticatedUser`.

### Client Utilities

#### [MODIFY] [authFetch.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/utils/authFetch.ts)
- Handle `ROTATED` error code: wait ~200ms and retry once instead of treating as session expiry.

## Verification Plan

### Automated Tests
- Run `npm run lint` (`tsc --noEmit`) to verify TypeScript compilation.
- Run test suite via `npm test`.

### Manual Verification
- Install `cookie-parser` and `@types/cookie-parser`.
- Run database migrations / prisma generate.
- Test signup, login, refresh, and `/api/user/me`.
