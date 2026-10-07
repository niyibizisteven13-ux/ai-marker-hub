# Task Tracking: Authentication Redesign & Security Hardening

- [x] Database Schema & Migration (`RefreshSession`)
- [/] Server Auth Controller & Routes (login, register, refresh, logout, logout-all, lockout, audit logs)
- [ ] Server Security Fixes (`server.ts` file ownership, remove anonymous fallbacks)
- [ ] Rate Limiting (`authLimiter`)
- [ ] Backend Auth Middleware (`production/auth.ts`)
- [ ] Client Auth Fetch (`authFetch.ts` single-flight, retry, proactive refresh)
- [ ] Zustand Store & Boot Flow (`useStore.ts`, App.tsx boot refresh, workspace restore guard)
- [ ] Client UI Redesign (LoginModal, LeftSidebar profile, SettingsModal sign out all)
- [ ] Verification & Build (`npx tsc --noEmit`, `npm run build`)
