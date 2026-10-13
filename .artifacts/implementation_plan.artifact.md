# Fix Login and Authentication Flow Plan

Resolve all authentication and login issues across the frontend (`authService.ts`) and backend (`authRoutes.ts` & `authController.ts`), including the missing Google login endpoint (`/api/auth/google`), API base URL configuration support (`VITE_API_BASE_URL`), and robust fallback mechanisms.

## User Review Required

> [!IMPORTANT]
> - We will add the missing `/api/auth/google` endpoint to `authRoutes.ts` and `authController.ts` so Google login calls succeed on the backend.
> - We will update `authService.ts` to support `VITE_API_BASE_URL` pointing to your App Runner backend or local server, ensuring robust error handling and seamless fallback.

## Open Questions

- None.

## Proposed Changes

### Backend
#### [MODIFY] [authController.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server/controllers/authController.ts)
- Implement `googleLogin` controller handling Google SSO authentication / fallback session creation.

#### [MODIFY] [authRoutes.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server/routes/authRoutes.ts)
- Register `router.post('/google', googleLogin)` and `router.get('/google', googleLogin)`.

### Frontend
#### [MODIFY] [authService.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/auth/authService.ts)
- Use `VITE_API_BASE_URL` for all auth fetch calls (`/api/auth/...`) so requests correctly reach your App Runner backend when deployed.

## Verification Plan

### Automated Tests
- Run `npm run build` to ensure clean TypeScript compilation.

### Manual Verification
- Test password login, email OTP login, and Google login against the backend.
