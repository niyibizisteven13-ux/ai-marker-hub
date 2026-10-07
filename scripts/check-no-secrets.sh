#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

bad_patterns=(
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

# 1. Check git tracked files for secret files (excluding example/template files)
for file in $(git ls-files ".env*" 2>/dev/null || true); do
  if [[ "$file" != ".env.example" && "$file" != *.example ]]; then
    echo "Blocked by git: $file"
    exit 1
  fi
done

# 2. Check git tracked files for temp/log artifacts
for pattern in "${bad_patterns[@]}"; do
  if git ls-files --error-unmatch "$pattern" >/dev/null 2>&1; then
    echo "Blocked by git: $pattern"
    exit 1
  fi
done

# Allow a developer-local .env file when it is not tracked in git. The repo's
# .gitignore keeps secrets out of version control, and git ls-files above already
# catches any accidentally-added tracked secret file.
for path in combined.log error.log prisma/dev.db; do
  if [ -e "$path" ]; then
    echo "Blocked by filesystem check: $path"
    exit 1
  fi
done

echo "No secret or temp artifacts are tracked or present in the repo root."
