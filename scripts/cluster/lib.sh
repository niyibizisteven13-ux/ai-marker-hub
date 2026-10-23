#!/usr/bin/env bash
# Shared helpers for the cluster scripts. Sourced, not run.
# The defaults match the current production server; override them in /etc/bwenge/cluster.env if needed.

set -euo pipefail

CLUSTER_ENV=/etc/bwenge/cluster.env
[[ -f $CLUSTER_ENV ]] && source "$CLUSTER_ENV"

APP_DIR=${APP_DIR:-/opt/nexus}
SERVICE=${SERVICE:-nexus}
APP_USER=${APP_USER:-nexus}
SSH_KEY=${SSH_KEY:-/root/.ssh/bwenge_cluster}
NODES=${NODES:-}                     # private IPs of the extra servers, space separated
PRIMARY_IP=${PRIMARY_IP:-}           # private IP of this (primary) server

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m ok\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m !!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mERR\033[0m %s\n' "$*" >&2; exit 1; }

need_root() { [[ $(id -u) -eq 0 ]] || die "Run as root."; }

# The app's environment file, as systemd loads it.
env_file() {
  local f
  f=$(systemctl show -p EnvironmentFiles --value "$SERVICE" 2>/dev/null | awk '{print $1}' | sed 's/^-//')
  [[ -n $f && -f $f ]] && { echo "$f"; return; }
  [[ -f $APP_DIR/.env ]] && { echo "$APP_DIR/.env"; return; }
  die "Cannot find the app's environment file (looked at the $SERVICE service and $APP_DIR/.env)."
}

env_get() { grep -E "^$1=" "$(env_file)" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

# Sets KEY=VALUE in the environment file, replacing an existing line.
env_set() {
  local file key=$1 value=$2
  file=$(env_file)
  if grep -qE "^$key=" "$file"; then
    python3 - "$file" "$key" "$value" <<'PY'
import sys
path, key, value = sys.argv[1:]
lines = open(path).read().splitlines()
out = [f"{key}={value}" if l.startswith(key + "=") else l for l in lines]
open(path, "w").write("\n".join(out) + "\n")
PY
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

app_port() {
  local p
  p=$(env_get PORT || true)
  [[ -z $p ]] && p=$(systemctl show -p Environment --value "$SERVICE" 2>/dev/null | tr ' ' '\n' | grep -E '^PORT=' | cut -d= -f2 || true)
  echo "${p:-3000}"
}

unit_file() { systemctl show -p FragmentPath --value "$SERVICE"; }

node_ssh() { local host=$1; shift; ssh -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "root@$host" "$@"; }

# Waits until http://host:port/api/health reports the database as ok.
wait_healthy() {
  local host=$1 port=$2 tries=${3:-40} body
  for ((i = 1; i <= tries; i++)); do
    body=$(curl -fsS --max-time 4 "http://$host:$port/api/health" 2>/dev/null || true)
    if [[ $body == *'"database":"ok"'* ]]; then ok "$host:$port healthy $(sed -E 's/.*"node":"([^"]*)".*/(\1)/' <<<"$body")"; return 0; fi
    sleep 3
  done
  warn "$host:$port is not healthy: ${body:-no answer}"
  return 1
}

# Copies the built app (code, node_modules, dist) to a node. Data, exports and the env file stay put.
sync_code() {
  local host=$1
  rsync -a --delete --chown="$APP_USER:$APP_USER" -e "ssh -i $SSH_KEY -o BatchMode=yes" \
    --exclude '/data/' --exclude '/exports/' --exclude '/.env' --exclude '/.env.*' --exclude '*.log' \
    "$APP_DIR/" "root@$host:$APP_DIR/"
}

# nginx: one upstream for the whole site (sticky per visitor) and one for the paths that must reach the
# primary server (Telegram webhook and scanner, Mobile Money callbacks, admin live updates).
write_nginx_upstreams() {
  local port conf=/etc/nginx/conf.d/bwenge-cluster.conf
  port=$(app_port)
  {
    echo "# Written by scripts/cluster. Do not edit by hand; run scripts/cluster/add-node.sh instead."
    echo "upstream bwenge_app {"
    echo "    hash \$binary_remote_addr consistent;   # sticky per visitor IP (full address, unlike ip_hash)"
    echo "    server 127.0.0.1:$port max_fails=2 fail_timeout=10s;"
    for n in $NODES; do echo "    server $n:$port max_fails=2 fail_timeout=10s;"; done
    echo "    keepalive 64;"
    echo "}"
    echo "upstream bwenge_primary {"
    echo "    server 127.0.0.1:$port;"
    echo "    keepalive 16;"
    echo "}"
    echo "map \$uri \$bwenge_upstream {"
    echo "    default bwenge_app;"
    echo "    ~^/api/telegram/ bwenge_primary;"
    echo "    ~^/api/billing/momo/callback bwenge_primary;"
    echo "    ~^/api/payments/momo/callback bwenge_primary;"
    echo "    ~^/api/admin/live bwenge_primary;"
    echo "    ~^/scan(ner)?\\.html bwenge_primary;"
    echo "}"
  } > "$conf"
}

# Points the site's proxy_pass at the upstreams (once). Backups go to /etc/nginx/bwenge-backups (outside the
# folders nginx loads); if nginx rejects the result, the previous files are put back.
patch_nginx_sites() {
  local port changed=0 f real bak=/etc/nginx/bwenge-backups/$(date +%Y%m%d%H%M%S)
  local -a touched=()
  port=$(app_port)
  for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
    [[ -e $f && $f != */bwenge-cluster.conf ]] || continue
    real=$(readlink -f "$f")
    if grep -qE "proxy_pass +http://(127\.0\.0\.1|localhost):$port/?;" "$real"; then
      mkdir -p "$bak"
      cp -a "$real" "$bak/$(basename "$real")"
      sed -i -E "s#proxy_pass +http://(127\.0\.0\.1|localhost):$port/?;#proxy_pass http://\$bwenge_upstream;#g" "$real"
      touched+=("$real")
      say "nginx: $real now sends traffic to the cluster (backup in $bak)"
      changed=1
    fi
  done
  if ! nginx -t 2>/tmp/bwenge-nginx-test.log; then
    cat /tmp/bwenge-nginx-test.log >&2
    for f in "${touched[@]}"; do cp -a "$bak/$(basename "$f")" "$f"; done
    rm -f /etc/nginx/conf.d/bwenge-cluster.conf
    nginx -t 2>/dev/null && systemctl reload nginx
    die "nginx rejected the new configuration; the previous configuration was restored."
  fi
  systemctl reload nginx
  [[ $changed -eq 1 ]] || ok "nginx already uses the cluster upstream"
}

save_cluster_env() {
  mkdir -p /etc/bwenge && chmod 700 /etc/bwenge
  cat > "$CLUSTER_ENV" <<EOF
# Bwenge cluster settings (written by scripts/cluster). Contains a secret: keep it root-only.
APP_DIR=$APP_DIR
SERVICE=$SERVICE
APP_USER=$APP_USER
SSH_KEY=$SSH_KEY
PRIMARY_IP=$PRIMARY_IP
NODES="$(echo $NODES | xargs)"
REDIS_PASSWORD=${REDIS_PASSWORD:-}
EOF
  chmod 600 "$CLUSTER_ENV"
}
