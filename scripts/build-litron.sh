#!/usr/bin/env bash
set -euo pipefail

app_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$(mktemp -d)"
trap 'rm -rf -- "$source_dir"' EXIT

git -C "$source_dir" init --quiet
git -C "$source_dir" fetch --quiet --depth=1 \
  https://github.com/niyibizisteven13-ux/litron-vpn-app.git \
  c36d59f04f2fb590e7a6c72f9522e6ff75fe17f2
git -C "$source_dir" checkout --quiet --detach FETCH_HEAD

# Host the web app without distributing the native tunnel's client credentials.
rm -f -- "$source_dir/public/server-config.json"
printf '[]\n' > "$source_dir/public/server-config.json"

(
  cd "$source_dir"
  npm ci --no-audit --no-fund
  npm run build -- --base=/litron-vpn/
)

mkdir -p "$app_root/dist/web/litron-vpn"
cp -R "$source_dir/dist/." "$app_root/dist/web/litron-vpn/"
