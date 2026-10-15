# Deployment Plan: Push to GitHub & Deploy to Fly.io

This plan outlines the steps to commit and push all recent changes to GitHub and deploy the application to Fly.io.

## User Review Required

> [!IMPORTANT]
> Please verify that you have configured any required Fly.io secrets/environment variables (such as database URLs, API keys, SMTP settings, etc.) on Fly.io before deployment if they are needed by production.

## Open Questions

- Are there any specific environment secrets that need to be set via `fly secrets set` prior to deployment?

## Proposed Changes

### Git & GitHub
- Stage all modified and new files (`git add .`)
- Commit changes with an informative commit message (e.g., "Update auth, email settings, and add SMTP test")
- Push to GitHub (`git origin main`)

### Fly.io Deployment
- Run local build check (`npm run build`) to ensure TypeScript and Vite compile successfully.
- Execute Fly.io deployment (`fly deploy`) using the existing `fly.toml` and `Dockerfile`.
- Verify app health status via `fly status` and test endpoint `/api/health`.

## Verification Plan

### Automated Tests & Checks
- Run `npm run verify` (linting, tests, build).
- Run `git status` to ensure all changes are committed and pushed.
- Run `fly status` and `fly open` to verify online status.

### Manual Verification
- Access the deployed Fly.io URL (`https://ai-marker-hub.fly.dev` or via `fly open`) to ensure the server responds correctly.
