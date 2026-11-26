#!/usr/bin/env bash
# Configures authenticated, loopback-only Redis for a single Bwenge server.
#
#   bash /opt/nexus/scripts/cluster/setup-single-redis.sh
source "$(dirname "$0")/lib.sh"
need_root

[[ -z ${PRIMARY_IP:-} && -z ${NODES:-} ]] || die "This server is configured for a multi-server cluster. Use setup-primary.sh instead."
systemctl cat "$SERVICE" >/dev/null 2>&1 || die "The $SERVICE service was not found."

ENV_FILE=$(env_file)
PORT=$(app_port)
TS=$(date +%F-%H%M%S)
BACKUP_DIR=/root/backups
mkdir -p "$BACKUP_DIR"
ENV_BACKUP="$BACKUP_DIR/$(basename "$ENV_FILE")-$TS"
cp -a "$ENV_FILE" "$ENV_BACKUP"
RCONF=/etc/redis/redis.conf
RCONF_BACKUP=

rollback() {
  local code=$?
  trap - EXIT
  (( code == 0 )) && return
  warn "Redis setup failed; restoring the previous app environment and Redis configuration."
  cp -a "$ENV_BACKUP" "$ENV_FILE"
  if [[ -n $RCONF_BACKUP && -f $RCONF_BACKUP ]]; then cp -a "$RCONF_BACKUP" "$RCONF"; fi
  systemctl restart redis-server >/dev/null 2>&1 || true
  systemctl restart "$SERVICE" >/dev/null 2>&1 || true
  exit "$code"
}
trap rollback EXIT

say "Installing Redis"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq redis-server >/dev/null
RCONF_BACKUP="$BACKUP_DIR/redis-conf-$TS"
cp -a "$RCONF" "$RCONF_BACKUP"

# Reuse the current local Redis credential on reruns; otherwise create one.
REDIS_PASSWORD=${REDIS_PASSWORD:-}
if [[ -z $REDIS_PASSWORD ]]; then
  current_url=$(env_get REDIS_URL || true)
  REDIS_PASSWORD=$(python3 - "$current_url" <<'PY'
import sys
from urllib.parse import unquote, urlsplit

try:
    parsed = urlsplit(sys.argv[1])
    if parsed.scheme == "redis" and parsed.hostname == "127.0.0.1" and (parsed.port or 6379) == 6379:
        print(unquote(parsed.password or ""))
except ValueError:
    pass
PY
)
fi
[[ -n $REDIS_PASSWORD ]] || REDIS_PASSWORD=$(openssl rand -hex 32)
[[ $REDIS_PASSWORD =~ ^[A-Za-z0-9._~-]+$ ]] || die "REDIS_PASSWORD must contain only URL-safe characters."
REDIS_URL="redis://:$REDIS_PASSWORD@127.0.0.1:6379/0"

sed -i -E '/^[[:space:]]*bind[[:space:]]/d; /^[[:space:]]*protected-mode[[:space:]]/d; /^[[:space:]]*port[[:space:]]/d; /^[[:space:]]*requirepass[[:space:]]/d; /^[[:space:]]*maxmemory([[:space:]]|$)/d; /^[[:space:]]*maxmemory-policy[[:space:]]/d' "$RCONF"
printf '\nbind 127.0.0.1 ::1\nprotected-mode yes\nport 6379\nrequirepass %s\nmaxmemory 512mb\nmaxmemory-policy allkeys-lru\n' "$REDIS_PASSWORD" >> "$RCONF"
chown root:redis "$RCONF"
chmod 640 "$RCONF"

env_set REDIS_URL "$REDIS_URL"
chown "$APP_USER:$APP_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"
systemctl enable --now redis-server >/dev/null
systemctl restart redis-server
for _ in $(seq 1 15); do
  if REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli -h 127.0.0.1 ping 2>/dev/null | grep -qx PONG; then break; fi
  sleep 1
done
REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli -h 127.0.0.1 ping | grep -qx PONG || die "Redis did not become ready."
if redis-cli -h 127.0.0.1 ping 2>/dev/null | grep -qx PONG; then die "Redis unexpectedly accepts unauthenticated access."; fi

say "Restarting $SERVICE"
systemctl restart "$SERVICE"
wait_healthy 127.0.0.1 "$PORT"
for _ in $(seq 1 20); do
  if curl -fsS --max-time 4 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q '"redis":"ok"'; then
    ok "Redis is authenticated, loopback-only, and connected to the app."
    trap - EXIT
    exit 0
  fi
  sleep 2
done
die "The app did not report Redis as healthy."
