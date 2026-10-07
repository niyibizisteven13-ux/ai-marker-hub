# Task List

- [/] 1. Install `cookie-parser` and `@types/cookie-parser`
- [ ] 2. Run Prisma migration / `prisma generate`
- [ ] 3. Update `server.ts` to register `cookie-parser` middleware
- [ ] 4. Update `server/routes/authRoutes.ts` to register all auth endpoints (`refresh`, `logout`, `logout-all`, `me`)
- [ ] 5. Update `server/controllers/authController.ts` with bugs 1-7 fixes (non-fatal audit logging, atomic rotation & ROTATED handling, cookie-only refresh token, atomic signup transaction, dev error visibility, subscription in user object)
- [ ] 6. Update `src/utils/authFetch.ts` to handle `ROTATED` code with retry
- [ ] 7. Verify compilation (`npm run lint`), build, and test
