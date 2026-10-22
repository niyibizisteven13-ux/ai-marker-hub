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
  echo "Installing dependencies (the build needs dev tools such as esbuild)..."
  npm ci
  echo "Building application..."
  npm run build
  echo "Applying database migrations..."
  npx prisma migrate deploy
  echo "Reloading PM2 process..."
  pm2 reload ecosystem.config.js --update-env || pm2 start ecosystem.config.js
  pm2 save
  echo "Deployment complete!"
EOF
