#!/usr/bin/env bash
# Deploys main when GitHub has a newer commit than the one running. Run every few minutes by cron
# (install-autodeploy.sh). Nothing is pushed to the server: it pulls from GitHub itself, so deploys need no
# SSH access, keys or GitHub Actions minutes.
#
# A commit that fails to deploy is remembered and not retried until a newer commit arrives.
source "$(dirname "$0")/lib.sh"
need_root
cd "$APP_DIR"

STATE=/var/lib/bwenge
mkdir -p "$STATE"
# One deploy at a time: a slow build must not be started again by the next run.
exec 9>"$STATE/autodeploy.lock"
flock -n 9 || exit 0

remote=$(sudo -u "$APP_USER" git ls-remote origin refs/heads/main | cut -f1)
[[ -n $remote ]] || die "Could not read main from GitHub."
running=$(sudo -u "$APP_USER" git rev-parse HEAD)
[[ $remote == "$running" ]] && exit 0
[[ $remote == "$(cat "$STATE/autodeploy.failed" 2>/dev/null)" ]] && exit 0

say "$(date -Is) new commit on main: ${remote:0:7} (running ${running:0:7})"
if bash "$APP_DIR/scripts/cluster/deploy-all.sh"; then
  rm -f "$STATE/autodeploy.failed"
  ok "$(date -Is) deployed ${remote:0:7}"
else
  echo "$remote" > "$STATE/autodeploy.failed"
  die "$(date -Is) deploy of ${remote:0:7} failed; it is not retried until a newer commit. See: journalctl -u $SERVICE -n 80"
fi
