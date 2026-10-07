# Production deployment requirements

Production deployment requires external services and credentials. The application now fails fast when PostgreSQL, the JWT secret, HTTPS application origin, or Redis are missing. Do not use the development `.env` values or expose database/cache ports publicly.

## Required services and secrets

- Managed PostgreSQL with automated backups, point-in-time recovery, TLS, and a least-privilege application role.
- Managed Redis with authentication/TLS and persistence appropriate to the queue workload. Set `REDIS_URL`.
- `JWT_SECRET`: at least 32 random characters; rotate it deliberately because rotation revokes existing sessions.
- `APP_URL`: the public HTTPS application origin, without a trailing path.
- `STORAGE_DRIVER=s3` after the private S3 adapter is implemented and configured. Current Docker Compose deliberately defaults to local storage and therefore will fail the production startup guard.
- At least one supported AI provider key. Configure only the provider keys used in production.
- A durable private S3-compatible object store with encryption, lifecycle/retention rules, and signed downloads. `STORAGE_DRIVER=s3` currently acts as a deployment guard only; an S3 storage adapter still needs implementation before production can start.
- `MOMO_WEBHOOK_SECRET` and provider IP allowlist if MTN MoMo callbacks are enabled. Payment callbacks fail closed when signature configuration is absent.

## Release sequence

1. Provision PostgreSQL, Redis, object storage, DNS, and TLS; implement and configure the object-storage adapter; add secrets in the deployment secret manager.
2. Run `npx prisma migrate deploy` once as a release job, before starting application replicas.
3. Build the Docker image and deploy the web service. Configure readiness checks against `/api/health`.
4. Deploy a separate BullMQ worker process using the same image and `REDIS_URL`; supervise restarts and monitor failed jobs. Do not run multiple migration jobs concurrently.
5. Verify signup/login, account isolation, upload/download, AI provider connectivity, queue processing, backups, restore, and payment callback signatures in staging.

## Current limits

- High-volume `/api/batch/grade` work still runs in the web process. Move this route to a durable queued job before relying on it for large or long-running production batches.
- The queue worker must be deployed as a separate process; the Docker image exposes the app server by default.
- Local file storage is development-only; configure a real object-store adapter before enabling uploads or generated exports in production.
- JWT access tokens use a one-hour default. There is no refresh-token/session revocation flow yet.
- Review public form submission abuse controls and retention/privacy requirements for student data before launch.
