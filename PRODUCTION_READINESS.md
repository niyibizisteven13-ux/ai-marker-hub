# Production deployment requirements

Production deployment requires external services and credentials. The application requires PostgreSQL, stable JWT and file URL signing secrets, HTTPS, SMTP for email verification, and at least one AI provider. Batch jobs are recorded in PostgreSQL but the work currently runs in the web process; do not run multiple app processes or expect an in-flight batch to survive a restart.

## Required services and secrets

- PostgreSQL with automated backups, point-in-time recovery, TLS, and a least-privilege application role. On a self-hosted VPS, keep its port bound to localhost/private networking and encrypt backup storage.
- `JWT_SECRET`: at least 32 random characters; rotate it deliberately because rotation revokes existing sessions.
- `FILE_URL_SECRET`: at least 32 random characters, kept stable across restarts so existing signed file links remain valid.
- `APP_URL`: the public HTTPS application origin, without a trailing path.
- Use a dedicated PostgreSQL application role for `DATABASE_URL`, not the container's `postgres` superuser. The Compose initialization script creates a schema-owner application role; it runs only when the PostgreSQL data volume is first created.
- At least one supported AI provider key. Configure only the provider keys used in production.
- Persistent, access-restricted storage for `FILE_STORE_DIR` (defaults to `./data/generated`), `./uploads`, and `./exports`. New uploads are stored once under `./uploads` with owner-scoped database records and private filesystem permissions. Back these paths up and define retention for generated files, uploaded student work, and exports.
- `MOMO_WEBHOOK_SECRET` and provider IP allowlist if MTN MoMo callbacks are enabled. Payment callbacks fail closed when signature configuration is absent.

## Data protection requirements

- Keep the PostgreSQL port and app/file-service ports private. The supplied Compose file binds service ports to `127.0.0.1`; keep them behind Nginx and HTTPS.
- Store deployment secrets outside the repository in a root-readable environment file or secret manager. If using a file, restrict it to the deploy user (`chmod 600`). `.dockerignore` excludes environment files, local data, uploads, exports, and private keys from image builds.
- Use encrypted VPS storage or an encrypted data volume and encrypt off-site database/file backups. PostgreSQL form responses and extracted text are not application-level encrypted; disk and backup encryption are required to protect data at rest.
- Uploaded work, scan images, and form responses are sent to the configured AI provider when the related analysis feature is used. Disclose this to users and review the provider’s retention and training settings before processing real student data.
- Set a written retention period and delete expired exports, uploaded source files, generated files, form submissions, and backups accordingly. Uploaded source files currently have no automatic deletion policy or account self-service deletion workflow.

## Release sequence

1. Provision PostgreSQL, persistent VPS storage, DNS, and TLS; configure SMTP and AI provider credentials through a secret manager or a root-readable environment file outside the repository.
2. Run `npx prisma migrate deploy` once against the production database before starting the application.
3. Install TLS certificates, adapt `nginx.conf.example` to the domain, then build and start with Compose. Keep app and file-service ports bound to localhost; do not expose them directly to the internet.
4. Keep persistent `./data`, `./uploads`, and `./exports` volumes. Run one app instance because caches and in-flight batch work are process-local. Restrict SSH and allow public inbound traffic only on SSH, HTTP, and HTTPS as needed.
5. Verify signup/login, account isolation, uploads/downloads, AI provider connectivity, queue restart recovery, backups, restore, and payment callback signatures in staging.

## Current limits

- High-volume `/api/batch/grade` work still runs in the web process. Move this route to a durable queued job before relying on it for large or long-running production batches.
- Batch jobs run inline in the web process. Restarted in-flight jobs are marked failed and require the user to upload again; large batch grading should move to a durable external queue before scaling or accepting high volume. The legacy `QueueService` is not currently used to execute production jobs.
- Local file storage can support a single VPS only when paths are persistent, private, backed up, and covered by a retention policy. Multiple replicas need shared durable storage. Public form submissions have an IP rate limit and a 200 KB payload cap; the limit is in-memory and resets on restart. Add a durable abuse-control strategy and account/data deletion workflow before broad institutional use.
- JWT access tokens last 15 minutes. Refresh sessions can be reviewed and revoked per device or across the account; an already-issued access token may remain usable until its 15-minute expiry.
- `/api/batch/grade` work runs in the web process. A restart marks in-flight batch records failed and requires a re-upload; move it to a durable worker queue before scaling or accepting high volume.
