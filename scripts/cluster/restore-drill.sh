#!/usr/bin/env bash
# Restore a trusted Bwenge custom-format dump into a disposable PostgreSQL instance.
set -euo pipefail
umask 077

if [[ $# != 1 || ! -f $1 || ! -r $1 ]]; then
  echo "Usage: $0 /path/to/bwenge-backup.dump" >&2
  exit 2
fi
if [[ $(id -u) != 0 ]]; then
  echo 'Run as root so the temporary server can run as postgres.' >&2
  exit 2
fi

dump=$1
bin=$(pg_config --bindir)
for tool in initdb pg_ctl pg_restore psql; do
  [[ -x $bin/$tool ]] || { echo "PostgreSQL tool unavailable: $tool" >&2; exit 2; }
done

work=$(mktemp -d /tmp/bwenge-restore.XXXXXXXX)
data="$work/data"
socket="$work/socket"
started=0
cleanup() {
  if [[ $started == 1 && -f $data/postmaster.pid ]]; then
    if ! runuser -u postgres -- "$bin/pg_ctl" -D "$data" -m fast -w stop > /dev/null; then
      echo "Could not stop the drill instance. Its workspace is $work." >&2
      return 1
    fi
  fi
  rm -rf -- "$work"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

chown postgres:postgres "$work"
install -d -m 700 -o postgres -g postgres "$socket"
SECONDS=0
runuser -u postgres -- "$bin/initdb" -D "$data" --auth-local=peer --auth-host=scram-sha-256 > "$work/init.log"
cat >> "$data/postgresql.conf" <<CONFIG
listen_addresses = ''
unix_socket_directories = '$socket'
unix_socket_permissions = 0700
CONFIG
started=1
runuser -u postgres -- "$bin/pg_ctl" -D "$data" -l "$work/postgres.log" -w start > /dev/null
db_flags=(--host="$socket" --port=5432 --username=postgres)
runuser -u postgres -- "$bin/psql" -X "${db_flags[@]}" --dbname=postgres -v ON_ERROR_STOP=1 -q -c 'CREATE DATABASE bwenge_restore'
runuser -u postgres -- "$bin/pg_restore" "${db_flags[@]}" --dbname=bwenge_restore --exit-on-error --single-transaction --no-owner --no-privileges < "$dump" > "$work/restore.log" 2>&1 || { echo "Database restore failed." >&2; exit 1; }
runuser -u postgres -- "$bin/psql" -X "${db_flags[@]}" --dbname=bwenge_restore -v ON_ERROR_STOP=1 -q -o /dev/null \
  -c 'SELECT 1 FROM public."User" LIMIT 1; SELECT 1 FROM public."AppSetting" LIMIT 1;'
echo "Database restore passed in ${SECONDS}s (User and AppSetting readable)."
