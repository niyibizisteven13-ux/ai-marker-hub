#!/usr/bin/env bash
# Adds a new web server to the cluster. Run on the PRIMARY server, once per new server:
#
#   bash scripts/cluster/add-node.sh 10.0.0.3
#
# The new server must be a fresh Ubuntu of the same release as the primary, attached to the same private
# network, with the primary's deploy key allowed for root (see docs/SCALING.md). It installs Node.js, mounts the
# shared files, copies the built app and its settings, starts the service and adds the server to nginx.
source "$(dirname "$0")/lib.sh"
need_root
NODE_IP=${1:-}
[[ $NODE_IP =~ ^[0-9.]+$ ]] || die "Usage: add-node.sh <private-ip-of-new-server>"
[[ -n $PRIMARY_IP ]] || die "Run setup-primary.sh first."
node_ssh "$NODE_IP" true || die "Cannot reach root@$NODE_IP with $SSH_KEY. Add $SSH_KEY.pub to the new server first."

ENV_FILE=$(env_file)
PORT=$(app_port)
UNIT=$(unit_file)
APP_UID=$(id -u "$APP_USER"); APP_GID=$(id -g "$APP_USER")
NODE_MAJOR=$(node -v | sed -E 's/^v([0-9]+).*/\1/')
HERE_RELEASE=$(. /etc/os-release && echo "${VERSION_ID:-}")
THERE_RELEASE=$(node_ssh "$NODE_IP" '. /etc/os-release && echo $VERSION_ID')
[[ $HERE_RELEASE == "$THERE_RELEASE" ]] || die "The new server runs Ubuntu $THERE_RELEASE; the primary runs $HERE_RELEASE. Use the same release (the app's native modules are copied as built)."
INDEX=$(( $(wc -w <<<"$NODES") + 2 ))
NAME=node-$INDEX
say "Adding $NAME ($NODE_IP): Node.js $NODE_MAJOR, port $PORT"

# ── Primary side: allow the new server to reach the database, Redis and the shared files ─────────────
DATABASE_URL=$(env_get DATABASE_URL)
if [[ $DATABASE_URL =~ @(localhost|127\.0\.0\.1)[:/] ]]; then
  HBA=$(ls /etc/postgresql/*/main/pg_hba.conf | tail -1)
  DB_NAME=$(sed -E 's#.*/([^/?]+)(\?.*)?$#\1#' <<<"$DATABASE_URL")
  DB_USER=$(sed -E 's#^postgres(ql)?://([^:@]+).*#\2#' <<<"$DATABASE_URL")
  LINE="host $DB_NAME $DB_USER $NODE_IP/32 scram-sha-256"
  grep -qF "$LINE" "$HBA" || { echo "$LINE" >> "$HBA"; systemctl reload postgresql; }
  ok "PostgreSQL allows $NODE_IP"
fi
EXPORT="$APP_DIR/data $NODE_IP(rw,sync,no_subtree_check,root_squash)"
grep -qF "$EXPORT" /etc/exports 2>/dev/null || echo "$EXPORT" >> /etc/exports
exportfs -ra
ok "Shared files exported to $NODE_IP"
if ufw status 2>/dev/null | grep -q 'Status: active'; then
  for p in 5432 6379 2049; do ufw allow from "$NODE_IP" to any port "$p" proto tcp >/dev/null; done
  ok "Firewall on the primary allows $NODE_IP (database, Redis, files)"
fi

# ── New server: system, user, Node.js, shared files ──────────────────────────────────────────────────
node_ssh "$NODE_IP" bash -s <<EOF
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates nfs-common rsync ufw >/dev/null
if ! command -v node >/dev/null || [[ \$(node -v | sed -E 's/^v([0-9]+).*/\1/') != $NODE_MAJOR ]]; then
  curl -fsSL https://deb.nodesource.com/setup_$NODE_MAJOR.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
getent group $APP_USER >/dev/null || groupadd -g $APP_GID $APP_USER
id -u $APP_USER >/dev/null 2>&1 || useradd -u $APP_UID -g $APP_GID -m -d /home/$APP_USER -s /usr/sbin/nologin $APP_USER
mkdir -p $APP_DIR/data /var/lib/bwenge/jobs
chown $APP_USER:$APP_USER $APP_DIR /var/lib/bwenge /var/lib/bwenge/jobs
grep -q " $APP_DIR/data nfs" /etc/fstab || echo "$PRIMARY_IP:$APP_DIR/data $APP_DIR/data nfs defaults,_netdev,noatime,hard,timeo=150 0 0" >> /etc/fstab
mountpoint -q $APP_DIR/data || mount $APP_DIR/data
ufw allow OpenSSH >/dev/null
ufw allow from $PRIMARY_IP to any port $PORT proto tcp >/dev/null
ufw --force enable >/dev/null
EOF
ok "System ready on $NODE_IP (Node.js $NODE_MAJOR, shared files mounted, firewall: SSH + app port from the primary only)"

# ── App, settings, service ───────────────────────────────────────────────────────────────────────────
sync_code "$NODE_IP"
TMP=$(mktemp)
sed -E \
  -e "s#@(localhost|127\.0\.0\.1)([:/])#@$PRIMARY_IP\2#" \
  -e "s#^REDIS_URL=redis://(:[^@]*)@127\.0\.0\.1:#REDIS_URL=redis://\1@$PRIMARY_IP:#" \
  -e '/^(NODE_ROLE|NODE_NAME|JOBS_DIR|QUEUE_SNAPSHOT_FILE)=/d' "$ENV_FILE" > "$TMP"
printf 'NODE_ROLE=web\nNODE_NAME=%s\nJOBS_DIR=/var/lib/bwenge/jobs\nQUEUE_SNAPSHOT_FILE=/var/lib/bwenge/local-jobs.json\n' "$NAME" >> "$TMP"
node_ssh "$NODE_IP" "mkdir -p $(dirname "$ENV_FILE")"
scp -q -i "$SSH_KEY" -o BatchMode=yes "$TMP" "root@$NODE_IP:$ENV_FILE"
rm -f "$TMP"
scp -q -i "$SSH_KEY" -o BatchMode=yes "$UNIT" "root@$NODE_IP:$UNIT"
[[ -d $UNIT.d ]] && scp -q -r -i "$SSH_KEY" -o BatchMode=yes "$UNIT.d" "root@$NODE_IP:$(dirname "$UNIT")/"
node_ssh "$NODE_IP" "chown $APP_USER:$APP_USER $ENV_FILE && chmod 600 $ENV_FILE && systemctl daemon-reload && systemctl enable $SERVICE >/dev/null 2>&1 && systemctl restart $SERVICE"
wait_healthy "$NODE_IP" "$PORT" || die "$NAME did not start. Check: ssh root@$NODE_IP journalctl -u $SERVICE -n 80"

# ── Load balancer ─────────────────────────────────────────────────────────────────────────────────────
grep -qw "$NODE_IP" <<<"$NODES" || NODES="$NODES $NODE_IP"
save_cluster_env
write_nginx_upstreams
patch_nginx_sites
ok "$NAME ($NODE_IP) is serving traffic. Cluster: primary + $(wc -w <<<"$NODES") server(s)."
