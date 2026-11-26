#!/usr/bin/env bash
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run as root on the production host.' >&2; exit 1; }
directory=$(dirname -- "$(realpath -- "${BASH_SOURCE[0]}")")
install -d -m 755 /usr/local/lib/bwenge-biz-apk
install -m 755 "$directory/publish-missing.sh" /usr/local/lib/bwenge-biz-apk/
install -m 644 "$directory/../build-biz-apk.py" /usr/local/lib/bwenge-biz-apk/
install -m 644 "$directory"/bwenge-biz-apk-publisher.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now bwenge-biz-apk-publisher.timer
systemctl start bwenge-biz-apk-publisher.service
