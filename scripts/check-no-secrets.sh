#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

bad_paths=(
  ".env"
  ".env.*"
  "combined.log"
  "error.log"
  "prisma/dev.db"
  "prisma/*.db"
  "*.bak"
  "*.tmp"
  "server-output*.txt"
  "startup_log.txt"
  "tsc-server-errors.txt"
)

for pattern in "${bad_paths[@]}"; do
  if git ls-files --error-unmatch "$pattern" >/dev/null 2>&1; then
    echo "Blocked by git: $pattern"
    exit 1
  fi
done

for path in .env combined.log error.log prisma/dev.db; do
  if [ -e "$path" ]; then
    echo "Blocked by filesystem check: $path"
    exit 1
  fi
done

echo "No secret or temp artifacts are tracked or present in the repo root."
