#!/usr/bin/env bash
set -euo pipefail

app_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$(mktemp -d)"
trap 'rm -rf -- "$source_dir"' EXIT

git -C "$source_dir" init --quiet
git -C "$source_dir" fetch --quiet --depth=1 \
  https://github.com/niyibizisteven13-ux/litron-vpn-app.git \
  a3c256452b4e1d78e5e0a18c7669079465c3efb7
git -C "$source_dir" checkout --quiet --detach FETCH_HEAD

# Host the web app without distributing the native tunnel's client credentials.
rm -f -- "$source_dir/public/server-config.json"
printf '[]\n' > "$source_dir/public/server-config.json"
sed -i 's|"/server-config.json"|import.meta.env.BASE_URL + "server-config.json"|' \
  "$source_dir/src/mobileLogicCode.ts"

(
  cd "$source_dir"
  npm ci --no-audit --no-fund
  npm run build -- --base=/litron-vpn/
)

mkdir -p "$app_root/dist/litron-vpn"
cp -R "$source_dir/dist/." "$app_root/dist/litron-vpn/"
