# Single-process deployment

This application is configured for one PM2 process on a single VPS. Do not increase PM2 instances or enable cluster mode: in-process queues, caches, and streaming state are not shared across workers.

## Requirements

- Node.js supported by the repository's package manifest.
- PostgreSQL and a valid `DATABASE_URL`. PostgreSQL is required for production; the local mock database is not a production substitute.
- Set the production secrets required by the app through the VPS process manager or its secret store. In particular, configure `JWT_SECRET` and `FILE_URL_SECRET` (each at least 32 characters), and the provider credentials for the AI features you intend to enable. Production startup fails if either secret or the PostgreSQL `DATABASE_URL` is missing or invalid. Never place secrets in this document or commit them.
- No `REDIS_URL` is required. The queue uses the local process and persists job snapshots under `./exports`.
- `GEMINI_API_KEY` is optional for chat/RAG startup. Without it, semantic embeddings are unavailable; startup logs one warning and knowledge search uses lexical retrieval. Ingestion can still store text chunks, but does not create semantic vectors.

## Persistent storage

Run PM2 from the repository root. The app creates these directories if needed:

- `./data/generated` (or `FILE_STORE_DIR`) for generated files.
- `./exports` for local queue snapshots and generated export files.

Mount or otherwise persist both `./data` and `./exports` across restarts and releases. Keep them writable by the application user and restrict access to the VPS account. Back them up according to the retention policy for user-generated and student data.

## Deploy and migrate

1. Back up PostgreSQL and the persistent `./data` and `./exports` directories.
2. Install the lockfile dependencies and build the application:

   ```sh
   npm ci
   npm run build
   ```

3. Apply the checked-in migrations against the existing production database:

   ```sh
   npx prisma migrate deploy
   ```

   The account-scoping migration adds nullable owner columns, assigns legacy knowledge/documents/datasets to the earliest ADMIN, and defaults legacy knowledge to not globally approved. It refuses to continue when legacy AI data exists but no ADMIN is available to own the backfill; provision an ADMIN before applying the migration. It also renames legacy adapter columns and normalizes old adapter statuses/model names. Dataset examples keep `consentGiven=false` and `piiReviewed=false`; they must not be approved/exported until an administrator records both.

4. Ensure production has `ALLOW_PUBLIC_SIGNUP=false` (the production default). To provision an account, an authenticated ADMIN may `POST /api/admin/users` with a JSON body containing a valid `email` and `name`; the user can then authenticate through the existing email verification flow.
5. Start or reload the single fork process from the repository root:

   ```sh
   pm2 start ecosystem.config.js
   pm2 save
   ```

   On subsequent deployments, use `pm2 reload ecosystem.config.js --update-env`. The ecosystem file pins `instances: 1` and `exec_mode: 'fork'`.
6. Confirm the process is online and review its operational health without exposing environment files or secret values. File expiry purging runs once on startup and once every 24 hours; purge errors are logged.

## Feature flags

Mock-artifact and risky-tool flags default to off and should remain unset until their implementation is separately reviewed. AI scanning is enabled by default; set both scan flags to `false` to disable it:

- `ENABLE_AI_SCAN` and frontend build-time `VITE_ENABLE_AI_SCAN` (set to `false` to disable scanning).
- `ENABLE_MOCK_AGENT_ARTIFACTS` and frontend build-time `VITE_ENABLE_MOCK_ARTIFACTS`.
- `ENABLE_AGENT_PYTHON_TOOL`, `ENABLE_AGENT_WEB_TOOLS`, and `ENABLE_AGENT_IMAGE_GENERATION`.

Do not enable mock-artifact flags in production: those surfaces are synthetic demos, not generated media or workflow results.
