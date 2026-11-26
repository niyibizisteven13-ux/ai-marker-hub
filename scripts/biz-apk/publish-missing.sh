#!/usr/bin/env bash
set -euo pipefail
umask 077

signing_dir=/root/bwenge-apk-signing
apk_dir=${BWENGE_BIZ_APK_DIR:-/opt/nexus/.bwenge-business-apks}
builder="$(dirname -- "$(realpath -- "${BASH_SOURCE[0]}")")/build-biz-apk.py"
export ANDROID_HOME=${ANDROID_HOME:-/opt/bwenge-android-sdk}
export BIZ_APK_USE_LOCAL_API=1
export BIZ_APK_KEYSTORE="$signing_dir/signing.p12"
export BIZ_APK_KEY_ALIAS=bwenge-biz
BIZ_APK_KEY_PASSWORD=$(<"$signing_dir/password")
export BIZ_APK_KEY_PASSWORD

install -d -m 755 -- "$apk_dir"
exec 9>/run/bwenge-biz-apk-publisher.lock
flock -n 9 || exit 0

work=$(mktemp -d --tmpdir="$apk_dir" .publish.XXXXXX)
trap 'rm -rf -- "$work"' EXIT
runuser -u postgres -- psql -XAt -v ON_ERROR_STOP=1 -d nexus > "$work/slugs" <<'SQL'
SELECT DISTINCT value->>'slug'
FROM "AppSetting"
WHERE key LIKE 'biz:%'
  AND value->>'published' = 'true'
  AND value->>'category' <> 'profile'
  AND value->>'suspended' IS NULL
  AND value->>'slug' ~ '^[a-z0-9][a-z0-9-]{0,63}$'
ORDER BY 1;
SQL

failed=0
while IFS= read -r slug; do
  [[ "$slug" =~ ^[a-z0-9][a-z0-9-]{0,63}$ ]] || continue
  file="$apk_dir/$slug.apk"
  [[ -s "$file" ]] && continue
  if python3 "$builder" "$slug" --version-code "$(date +%s)" --output "$work/$slug.apk" &&
     chmod 644 "$work/$slug.apk" &&
     mv -f -- "$work/$slug.apk" "$file"; then
    echo "Published APK for $slug"
  else
    echo "APK build failed for $slug" >&2
    failed=1
  fi
done < "$work/slugs"
exit "$failed"
