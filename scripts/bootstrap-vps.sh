#!/usr/bin/env bash
# ==============================================================================
# Automated VPS Bootstrap & Deployment Script for bwenge.space on Ubuntu
# ==============================================================================
# Run this script as root on a fresh Ubuntu 24.04/26.04 VPS instance.
# Usage:
#   export DOMAIN="bwenge.space"
#   export GITHUB_REPO="git@github.com:YOUR_GITHUB_USER/bwenge.space.git"
#   export ADMIN_EMAIL="admin@bwenge.space"
#   sudo -E bash scripts/bootstrap-vps.sh
# ==============================================================================

set -euo pipefail

DOMAIN="${DOMAIN:-bwenge.space}"
GITHUB_REPO="${GITHUB_REPO:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"

if [[ -z "$GITHUB_REPO" || -z "$ADMIN_EMAIL" ]]; then
  echo "Error: Please set GITHUB_REPO and ADMIN_EMAIL environment variables."
  echo "Example:"
  echo "  export DOMAIN=\"bwenge.space\""
  echo "  export GITHUB_REPO=\"git@github.com:username/bwenge.space.git\""
  echo "  export ADMIN_EMAIL=\"admin@bwenge.space\""
  echo "  sudo -E bash scripts/bootstrap-vps.sh"
  exit 1
fi

echo "=============================================================================="
echo "Starting VPS Bootstrap for domain: $DOMAIN"
echo "Repository: $GITHUB_REPO"
echo "=============================================================================="

# ------------------------------------------------------------------------------
# STEP 0: Create non-root deploy user & configure SSH hardening
# ------------------------------------------------------------------------------
if ! id "deploy" &>/dev/null; then
  echo "==> Creating 'deploy' user..."
  adduser --gecos "" deploy
  usermod -aG sudo deploy
  rsync --archive --chown=deploy:deploy /root/.ssh /home/deploy || true
  echo "deploy ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/deploy
fi

echo "==> Hardening SSH configuration..."
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sshd -t && systemctl restart ssh

# ------------------------------------------------------------------------------
# STEP 1: Initial Server Hardening & UFW Firewall
# ------------------------------------------------------------------------------
echo "==> Updating system packages..."
export DEBIAN_FRONTEND=noninteractive
apt update && apt upgrade -y
apt install -y ufw curl git ca-certificates gnupg postgresql postgresql-contrib nginx certbot python3-certbot-nginx

echo "==> Configuring UFW Firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# ------------------------------------------------------------------------------
# STEP 2: PostgreSQL Database Setup
# ------------------------------------------------------------------------------
echo "==> Configuring PostgreSQL..."
systemctl enable --now postgresql

DB_PASSWORD=$(openssl rand -hex 24)
DB_NAME="bwengedb"
DB_USER="bwengeuser"

echo "==> Provisioning PostgreSQL database and user..."
sudo -v
sudo -u postgres psql <<EOF
CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};
REVOKE ALL ON DATABASE ${DB_NAME} FROM PUBLIC;
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
\c ${DB_NAME}
GRANT ALL ON SCHEMA public TO ${DB_USER};
EOF

# Verify PostgreSQL binding
LISTEN_ADDR=$(grep -n "^listen_addresses" /etc/postgresql/*/main/postgresql.conf || echo "localhost")
echo "PostgreSQL listen addresses configuration: $LISTEN_ADDR"

# ------------------------------------------------------------------------------
# STEP 3: Node.js & Application Setup
# ------------------------------------------------------------------------------
echo "==> Installing Node.js 24 LTS..."
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs

echo "==> Setting up application directory (/var/www/bwenge.space)..."
mkdir -p /var/www/bwenge.space
chown deploy:deploy /var/www/bwenge.space

# Clone repo as deploy user if not already cloned
if [ ! -d "/var/www/bwenge.space/.git" ]; then
  su - deploy -c "git clone $GITHUB_REPO /var/www/bwenge.space"
fi

cd /var/www/bwenge.space
su - deploy -c "cd /var/www/bwenge.space && npm ci --omit=dev"

echo "==> Generating production .env file..."
JWT_SECRET=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"

cat > /var/www/bwenge.space/.env <<EOF
NODE_ENV=production
PORT=5000
DATABASE_URL=${DATABASE_URL}
JWT_SECRET=${JWT_SECRET}
SESSION_SECRET=${SESSION_SECRET}
EOF
chown deploy:deploy /var/www/bwenge.space/.env
chmod 600 /var/www/bwenge.space/.env

# ------------------------------------------------------------------------------
# STEP 4: PM2 Process Management
# ------------------------------------------------------------------------------
echo "==> Installing and configuring PM2..."
npm install -g pm2

cat > /var/www/bwenge.space/ecosystem.config.js <<'EOF'
module.exports = {
  apps: [{
    name: "bwenge.space",
    script: "npm",
    args: "start",
    cwd: "/var/www/bwenge.space",
    env: { NODE_ENV: "production", PORT: 5000 },
    max_memory_restart: "300M",
    autorestart: true
  }]
};
EOF
chown deploy:deploy /var/www/bwenge.space/ecosystem.config.js

su - deploy -c "cd /var/www/bwenge.space && pm2 start ecosystem.config.js && pm2 save"
env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u deploy --hp /home/deploy || true

# ------------------------------------------------------------------------------
# STEP 5 & 6: Nginx Reverse Proxy Configuration
# ------------------------------------------------------------------------------
echo "==> Configuring Nginx reverse proxy..."
cat > /etc/nginx/sites-available/bwenge.space <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;

        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout 60s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/bwenge.space /etc/nginx/sites-enabled/bwenge.space
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# ------------------------------------------------------------------------------
# STEP 7: Certbot SSL / HTTPS Setup
# ------------------------------------------------------------------------------
echo "==> Securing with Certbot SSL..."
certbot --nginx -d "${DOMAIN}" -d "www.${DOMAIN}" --non-interactive --agree-tos -m "${ADMIN_EMAIL}" --redirect || echo "Certbot warning: ensure DNS A/CNAME records are fully propagated."

# ------------------------------------------------------------------------------
# EXTRA: Swap Configuration & Automated Backups
# ------------------------------------------------------------------------------
if [ ! -f /swapfile ]; then
  echo "==> Allocating 1GB swap file for low-RAM VPS..."
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Setting up automated daily database backup cron job..."
mkdir -p /home/deploy/backups
chown deploy:deploy /home/deploy/backups

cat > /home/deploy/.pgpass <<EOF
localhost:5432:${DB_NAME}:${DB_USER}:${DB_PASSWORD}
EOF
chown deploy:deploy /home/deploy/.pgpass
chmod 600 /home/deploy/.pgpass

(crontab -l 2>/dev/null; echo "0 3 * * * pg_dump -U ${DB_USER} -h localhost ${DB_NAME} | gzip > /home/deploy/backups/bwengedb-\$(date +\%F).sql.gz") | crontab -

echo "=============================================================================="
echo "VPS Bootstrap & Deployment Complete Successfully for bwenge.space!"
echo "Your app is now live at https://${DOMAIN}"
echo "=============================================================================="
