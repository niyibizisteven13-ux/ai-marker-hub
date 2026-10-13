# Fly.io Deployment Configuration Plan for Node.js/TypeScript Backend

Configure the Node.js/Express backend (`ai-marker-hub`) for production deployment on Fly.io in the Stockholm (`arn`) region, supporting PostgreSQL and long-running AI streaming routes.

## User Review Required

> [!IMPORTANT]
> Please review the proposed `fly.toml` configuration, particularly the region (`arn`), internal port (`3000`), auto-start/stop settings, and HTTP response timeouts for long-running AI streaming.

## Open Questions

- None. Existing codebase binds to `0.0.0.0:3000`, supports `process.env.PORT`, and has a production `Dockerfile` and build script (`npm run build`).

## Proposed Changes

### Configuration & Deployment Files

#### [NEW] [fly.toml](file:///C:/Users/niyib/Downloads/ai-marker-hub/fly.toml)
- App configuration for Fly.io targeting Stockholm (`arn`) region.
- Exposes internal port `3000`.
- Configures HTTP service with auto-start/stop enabled, graceful shutdown, and extended timeouts (e.g., 300s) for long-running AI streaming routes.
- Release command for running Prisma database migrations (`npx prisma migrate deploy`).

#### [MODIFY] [server.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server.ts) (Verification)
- Verified that `server.ts` dynamically binds to `PORT = Number(process.env.PORT) || 3000` and host `'0.0.0.0'`. No code changes required for port/host binding.
- CORS middleware reads `process.env.APP_URL` (`https://bwenge.com`), ensuring allowed access from frontend domain.

#### [NEW] [Fly.io Setup & Secrets Guide]
- Provide exact `fly secrets set` command with placeholder values.
- Provide terminal commands for Fly.io authentication and deployment.

## Verification Plan

### Automated Tests
- Run `npm run verify` (`npm run lint && npm run test && npm run build`) to ensure TypeScript compilation, tests, and bundling succeed.

### Manual Verification
- Review generated `fly.toml` and verify secret environment variables list.
