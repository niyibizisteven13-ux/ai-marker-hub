# Implementation Plan: Fix Auth Refresh 404 & Deploy to Fly.io

## User Review Required
> [!IMPORTANT]
> This plan implements the missing `/api/auth/refresh` endpoint in `authController.ts` and `authRoutes.ts`, and triggers a fresh `flyctl deploy` to ensure production on `bwenge.space` runs the latest code.

## Proposed Changes

### Backend Auth Controller (`server/controllers/authController.ts`)
- Implement `refreshTokenHandler` to validate refresh cookies / tokens against Prisma `RefreshSession` and issue a new JWT access token.

### Backend Auth Routes (`server/routes/authRoutes.ts`)
- Mount `router.post('/refresh', authLimiter, logErrors('refreshToken', refreshTokenHandler))`.

### Deployment
- Run `npm run build` and `flyctl deploy` to update the production machine on Fly.io.

## Verification Plan
- Verify build succeeds (`npm run build`).
- Verify Fly.io deployment completes successfully.
