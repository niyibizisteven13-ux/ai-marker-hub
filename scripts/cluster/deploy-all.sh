#!/usr/bin/env bash
# Deploys the latest main to every server, one at a time, checking each one before moving on.
# Run on the PRIMARY server (the command in docs/SCALING.md does it from your computer):
#
#   bash /opt/nexus/scripts/cluster/deploy-all.sh
#
# 1. pulls main, installs, builds and applies database migrations on the primary, restarts it, checks health;
# 2. copies the same build to each other server, restarts it and checks health.
# If any server fails its health check, the deploy stops there and the remaining servers keep the old version.
source "$(dirname "$0")/lib.sh"
need_root
cd "$APP_DIR"

if [[ ${1:-} != --pulled ]]; then
  say "Pulling main"
  sudo -u "$APP_USER" git pull -q origin main
  # Run the freshly pulled copy of this script, not the one bash already started reading.
  exec bash "$APP_DIR/scripts/cluster/deploy-all.sh" --pulled
fi

PORT=$(app_port)
say "Building on the primary ($(sudo -u "$APP_USER" git log --oneline -1))"
sudo -u "$APP_USER" npm ci --silent
sudo -u "$APP_USER" npm run --silent build
sudo -u "$APP_USER" npx prisma migrate deploy
systemctl restart "$SERVICE"
wait_healthy 127.0.0.1 "$PORT" || die "The primary is not healthy after the update: journalctl -u $SERVICE -n 80"

for n in $NODES; do
  say "Updating $n"
  sync_code "$n"
  node_ssh "$n" "systemctl restart $SERVICE"
  wait_healthy "$n" "$PORT" || die "$n is not healthy; stopping here. Check: ssh root@$n journalctl -u $SERVICE -n 80"
done

[[ -f /etc/nginx/conf.d/bwenge-cluster.conf ]] && { write_nginx_upstreams; nginx -t 2>/dev/null && systemctl reload nginx; }
ok "Deployed $(sudo -u "$APP_USER" git log --oneline -1 | cut -c1-60) to primary${NODES:+ and $(wc -w <<<"$NODES") more server(s)}"
