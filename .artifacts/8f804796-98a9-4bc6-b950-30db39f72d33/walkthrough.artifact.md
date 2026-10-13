# Walkthrough - Fly.io Deployment Configuration

I have successfully configured your Node.js/TypeScript backend (`ai-marker-hub`) for deployment to Fly.io in the Stockholm (`arn`) region, with PostgreSQL support and optimized handling for long-running AI streaming routes.

## Changes Made

### 1. Created `fly.toml`
Configured the app for Fly.io targeting the Stockholm (`arn`) region on port `3000`, with auto-stop/start scaling and database migration release commands:
```toml
app = "ai-marker-hub"
primary_region = "arn"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0
  processes = ["app"]

[deploy]
  release_command = "npx prisma migrate deploy"

[env]
  NODE_ENV = "production"
  APP_URL = "https://bwenge.com"
  AI_PROVIDER = "gonkarouter"
```

### 2. Codebase & Server Verification
- **Port & Host Binding**: Verified `server.ts` binds to `0.0.0.0` and `process.env.PORT` (defaulting to 3000).
- **CORS Middleware**: Configured to trust `https://bwenge.com` via `APP_URL`.
- **Docker & Build**: Verified multi-stage Dockerfile and successful TypeScript build (`npm run build`).

## Production Deployment Guide

### Step 1: Install Fly CLI & Authenticate
```bash
fly auth login
```

### Step 2: Initialize / Launch App (if not already created)
```bash
fly launch --no-deploy --copy-config
```

### Step 3: Set Production Secrets
Run the following command to set your production environment secrets (replace placeholder values with your actual keys):
```bash
fly secrets set \
  DATABASE_URL="postgresql://user:password@hostname:5432/dbname?sslmode=require" \
  JWT_SECRET="your-secure-jwt-secret-at-least-32-chars-long" \
  GEMINI_API_KEY="your-gemini-api-key" \
  APP_URL="https://bwenge.com"
```

### Step 4: Deploy to Stockholm (`arn`) Region
```bash
fly deploy
```
