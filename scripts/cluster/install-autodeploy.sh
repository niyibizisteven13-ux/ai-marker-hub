#!/usr/bin/env bash
# Turns on automatic deploys: every 5 minutes the server checks GitHub and deploys main when it changed.
# Safe to run again. Run once on the primary server:
#
#   bash /opt/nexus/scripts/cluster/install-autodeploy.sh
#
# Turn it off:  rm /etc/cron.d/bwenge-autodeploy
source "$(dirname "$0")/lib.sh"
need_root
command -v flock >/dev/null || apt-get install -y -qq util-linux >/dev/null
cat > /etc/cron.d/bwenge-autodeploy <<EOF
# Deploy main when GitHub has a new commit (scripts/cluster/autodeploy.sh)
*/5 * * * * root bash $APP_DIR/scripts/cluster/autodeploy.sh >> /var/log/bwenge-autodeploy.log 2>&1
EOF
say "Checking GitHub and deploying now if main is newer"
bash "$APP_DIR/scripts/cluster/autodeploy.sh" | tee -a /var/log/bwenge-autodeploy.log
ok "Automatic deploys are on: every 5 minutes (log: /var/log/bwenge-autodeploy.log)"
