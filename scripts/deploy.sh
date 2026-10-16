#!/usr/bin/env bash
# Manual helper script to deploy or reload bwenge.space on the remote VPS
set -e

VPS_USER="${VPS_USER:-deploy}"
VPS_HOST="${VPS_HOST:-203.0.113.10}"
APP_DIR="/var/www/bwenge.space"

echo "Connecting to $VPS_USER@$VPS_HOST to update bwenge.space..."

ssh $VPS_USER@$VPS_HOST << 'EOF'
  cd /var/www/bwenge.space
  echo "Pulling latest changes..."
  git pull origin main
  echo "Installing production dependencies..."
  npm ci --omit=dev
  echo "Building application..."
  npm run build || true
  echo "Reloading PM2 process..."
  pm2 reload bwenge.space || pm2 start ecosystem.config.js
  pm2 save
  echo "Deployment complete!"
EOF
