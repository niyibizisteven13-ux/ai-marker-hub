#!/usr/bin/env bash
# Nightly backup (installed as /usr/local/bin/bwenge-backup by setup-primary.sh):
#   - PostgreSQL: a compressed dump per night, kept 14 days
#   - files (uploads, generated files, exams): a mirror of the data folder, refreshed nightly
#   - if BACKUP_REMOTE is set (for example a Hetzner Storage Box: u123456@u123456.your-storagebox.de:bwenge),
#     both are copied there too, so a lost server does not take the backups with it.
# Restore: see docs/SCALING.md ("Restore from a backup").
set -euo pipefail
umask 077
APP_DIR=${APP_DIR:-/opt/nexus}
SERVICE=${SERVICE:-nexus}
DEST=${BACKUP_DIR:-/var/backups/bwenge}
KEEP_DAYS=${KEEP_DAYS:-14}
mkdir -p "$DEST/db" "$DEST/data"
chmod 700 "$DEST"

ENV_FILE=$(systemctl show -p EnvironmentFiles --value "$SERVICE" 2>/dev/null | awk '{print $1}' | sed 's/^-//' || true)
[[ -f ${ENV_FILE:-} ]] || ENV_FILE=$APP_DIR/.env
DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
STAMP=$(date -u +%Y%m%d-%H%M%S)
dump="$DEST/db/bwenge-$STAMP.dump"
pending=$(mktemp "$DEST/db/.pending.XXXXXXXX")
trap 'rm -f -- "$pending"' EXIT
pg_dump --format=custom --no-owner --dbname="${DATABASE_URL%%\?*}" --file="$pending"
pg_restore --list "$pending" >/dev/null
mv -T -- "$pending" "$dump"
rsync -a --delete --exclude '/jobs/' "$APP_DIR/data/" "$DEST/data/"
find "$DEST/db" -name 'bwenge-*.dump' -mtime +"$KEEP_DAYS" -delete

if [[ -n ${BACKUP_REMOTE:-} ]]; then
  rsync -a --delete -e 'ssh -p 23 -o BatchMode=yes' "$DEST/" "$BACKUP_REMOTE/"
fi
echo "$(date -Is) backup ok: $(du -sh "$dump" | cut -f1) database, $(du -sh "$DEST/data" | cut -f1) files"
