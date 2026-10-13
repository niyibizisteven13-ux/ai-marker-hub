# Unified Landing Page Login Form and GitHub Deployment Plan

Streamline the landing page login flow (`AuthFlow.tsx`) so there is a single, clean, unified login form directly on the landing page, and push all updates to GitHub.

## User Review Required

> [!IMPORTANT]
> - We will streamline `AuthFlow.tsx` on the landing page to remove duplicate/redundant phone buttons and provide a clean, unified login interface (Google SSO + direct email/identifier sign-in).
> - After pushing to GitHub, AWS Amplify will automatically detect the new commit on `main` and redeploy.

## Open Questions

- None.

## Proposed Changes

### Components
#### [MODIFY] [AuthFlow.tsx](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/components/AuthFlow.tsx)
- Clean up `AuthFlow.tsx` to have a single, unified login card on the landing page (Google sign-in and Email/Password sign-in), ensuring no duplicate or conflicting forms.

## Verification Plan

### Automated Tests
- Run `npm run build` to ensure the project builds correctly without TypeScript or Vite errors.

### Manual Verification / Deployment
- Verify UI on landing page.
- Push all changes to GitHub (`git push origin main`).
- Answer user's question regarding AWS Amplify console showing the updated repository/commit.
