#!/usr/bin/env bash
# Nightly backups on a single server (no private network or other servers needed). Safe to run again.
#
#   bash /opt/nexus/scripts/cluster/install-backups.sh
#   BACKUP_REMOTE=u123456@u123456.your-storagebox.de:bwenge bash /opt/nexus/scripts/cluster/install-backups.sh
#
# Installs scripts/cluster/backup.sh as a 02:15 nightly job, then runs it once so you see that it works.
source "$(dirname "$0")/lib.sh"
need_root
command -v pg_dump >/dev/null || die "pg_dump is not installed (apt install postgresql-client)."
command -v rsync >/dev/null || { apt-get install -y -qq rsync >/dev/null; }
install -m 750 "$APP_DIR/scripts/cluster/backup.sh" /usr/local/bin/bwenge-backup
cat > /etc/cron.d/bwenge-backup <<EOF
# Nightly database dump and file copy (scripts/cluster/backup.sh)
15 2 * * * root BACKUP_REMOTE=${BACKUP_REMOTE:-} /usr/local/bin/bwenge-backup >> /var/log/bwenge-backup.log 2>&1
EOF
say "Running the first backup now"
BACKUP_REMOTE=${BACKUP_REMOTE:-} /usr/local/bin/bwenge-backup | tee -a /var/log/bwenge-backup.log
ok "Nightly backups at 02:15 into /var/backups/bwenge${BACKUP_REMOTE:+ and $BACKUP_REMOTE} (log: /var/log/bwenge-backup.log)"
[[ -n ${BACKUP_REMOTE:-} ]] || warn "Backups stay on this server. If the server is lost, they are lost with it: turn on Hetzner Backups or set BACKUP_REMOTE."
