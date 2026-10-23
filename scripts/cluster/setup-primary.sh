#!/usr/bin/env bash
# One-time setup of the PRIMARY server for a multi-server Bwenge. Safe to run again.
#
#   PRIMARY_IP=10.0.0.2 bash scripts/cluster/setup-primary.sh
#
# PRIMARY_IP is this server's address on the Hetzner private network. It installs and configures:
#   - Redis (shared cache, rate limits, instant messages between servers), private network only, password set
#   - PostgreSQL listening on the private network too (each new server is allowed by add-node.sh)
#   - NFS sharing of the data folder, so every server sees the same uploaded and generated files
#   - nginx load balancing (this server alone until servers are added)
#   - nightly database and file backups, kept 14 days (and copied off the server if BACKUP_REMOTE is set)
#   - an SSH key this server uses to deploy to the others
source "$(dirname "$0")/lib.sh"
need_root
[[ -n $PRIMARY_IP ]] || die "Set PRIMARY_IP to this server's private network address (Hetzner Console → Networks)."
ip -4 addr | grep -q "inet $PRIMARY_IP/" || die "$PRIMARY_IP is not an address of this server. Attach the server to the private network first."
systemctl cat "$SERVICE" >/dev/null 2>&1 || die "The $SERVICE service was not found."
# The load-balancing step writes nginx configuration. On a server whose site is served by Caddy it would put a
# second web server on ports 80/443, so stop here (see docs/SCALING.md, "Caddy").
if systemctl is-active caddy >/dev/null 2>&1 && ! systemctl is-active nginx >/dev/null 2>&1; then
  die "This server serves the site with Caddy, not nginx. The multi-server setup currently configures nginx only; see docs/SCALING.md (Caddy) before adding servers."
fi

ENV_FILE=$(env_file)
PORT=$(app_port)
DATABASE_URL=$(env_get DATABASE_URL)
say "App: $APP_DIR, service $SERVICE, port $PORT, environment file $ENV_FILE"

say "Installing Redis, NFS and rsync"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq redis-server nfs-kernel-server rsync curl >/dev/null

# ── Redis ──────────────────────────────────────────────────────────────────
REDIS_PASSWORD=${REDIS_PASSWORD:-$(openssl rand -hex 24)}
RCONF=/etc/redis/redis.conf
sed -i -E '/^(bind|protected-mode|requirepass|maxmemory|maxmemory-policy) /d' "$RCONF"
printf 'bind 127.0.0.1 %s\nprotected-mode yes\nrequirepass %s\nmaxmemory 512mb\nmaxmemory-policy volatile-lru\n' "$PRIMARY_IP" "$REDIS_PASSWORD" >> "$RCONF"
chmod 640 "$RCONF"
# Start Redis only once the private network is up, so it can listen on it after a reboot.
mkdir -p /etc/systemd/system/redis-server.service.d
printf '[Unit]\nAfter=network-online.target\nWants=network-online.target\n[Service]\nRestart=always\nRestartSec=3\n' > /etc/systemd/system/redis-server.service.d/bwenge.conf
systemctl daemon-reload
systemctl enable --now redis-server >/dev/null
systemctl restart redis-server
redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping | grep -q PONG && ok "Redis running on 127.0.0.1 and $PRIMARY_IP"

# ── PostgreSQL ─────────────────────────────────────────────────────────────
if [[ $DATABASE_URL =~ @(localhost|127\.0\.0\.1)[:/] ]]; then
  PGCONF=$(ls /etc/postgresql/*/main/postgresql.conf 2>/dev/null | tail -1)
  [[ -n $PGCONF ]] || die "PostgreSQL configuration not found."
  if ! grep -qE "^listen_addresses *= *'localhost,$PRIMARY_IP'" "$PGCONF"; then
    sed -i -E "s/^#? *listen_addresses *=.*/listen_addresses = 'localhost,$PRIMARY_IP'/" "$PGCONF"
    systemctl restart postgresql
  fi
  ok "PostgreSQL also listens on $PRIMARY_IP (servers are allowed one by one)"
else
  warn "DATABASE_URL does not point to this server; leaving the database as it is."
fi

# ── Shared files (NFS) ──────────────────────────────────────────────────────
mkdir -p "$APP_DIR/data"
chown "$APP_USER:$APP_USER" "$APP_DIR/data"
systemctl enable --now nfs-kernel-server >/dev/null
ok "NFS server ready ($APP_DIR/data is shared with each added server)"

# ── This server's role ────────────────────────────────────────────────────
env_set REDIS_URL "redis://:$REDIS_PASSWORD@127.0.0.1:6379/0"
env_set NODE_ROLE primary
env_set NODE_NAME "${NODE_NAME:-node-1}"
ok "Environment updated (REDIS_URL, NODE_ROLE=primary)"

# ── Deploy key ──────────────────────────────────────────────────────────────
[[ -f $SSH_KEY ]] || ssh-keygen -q -t ed25519 -N '' -C bwenge-cluster -f "$SSH_KEY"
ok "Deploy key: $SSH_KEY.pub"

# ── nginx ──────────────────────────────────────────────────────────────────
save_cluster_env
write_nginx_upstreams
patch_nginx_sites

# ── Backups ────────────────────────────────────────────────────────────────
install -m 750 "$APP_DIR/scripts/cluster/backup.sh" /usr/local/bin/bwenge-backup
cat > /etc/cron.d/bwenge-backup <<EOF
# Nightly database dump and file copy (scripts/cluster/backup.sh)
15 2 * * * root BACKUP_REMOTE=${BACKUP_REMOTE:-} /usr/local/bin/bwenge-backup >> /var/log/bwenge-backup.log 2>&1
EOF
ok "Nightly backups at 02:15 into /var/backups/bwenge${BACKUP_REMOTE:+ and $BACKUP_REMOTE}"

systemctl restart "$SERVICE"
wait_healthy 127.0.0.1 "$PORT"

echo
say "Primary ready. Add each new server with:"
echo "    bash $APP_DIR/scripts/cluster/add-node.sh <private-ip-of-new-server>"
echo "The new server must accept this key for root (see docs/SCALING.md):"
cat "$SSH_KEY.pub"
