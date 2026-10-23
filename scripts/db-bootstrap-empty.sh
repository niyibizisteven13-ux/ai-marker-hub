#!/usr/bin/env bash
# Creates the full schema in an EMPTY PostgreSQL database and records every migration as applied, so later
# `prisma migrate deploy` runs only new migrations. Use it for a brand-new environment (staging, a test box).
# Never run it against a database that has data: restore a backup instead (scripts/cluster/backup.sh).
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must point to the empty database}"
if psql "${DATABASE_URL%%\?*}" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null | grep -qv '^0$'; then
  echo "This database already has tables. Refusing to continue." >&2
  exit 1
fi
npx prisma db push --skip-generate
for dir in prisma/migrations/*/; do
  name=$(basename "$dir")
  npx prisma migrate resolve --applied "$name" >/dev/null
  echo "recorded $name"
done
npx prisma migrate status
