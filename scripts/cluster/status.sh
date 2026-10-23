#!/usr/bin/env bash
# Read-only production snapshot: prints facts, changes nothing, never prints secret values.
#
#   bash /opt/nexus/scripts/cluster/status.sh
source "$(dirname "$0")/lib.sh"
set +e
PORT=$(app_port)
ENV_FILE=$(env_file)
has() { grep -qE "^$1=.+" "$ENV_FILE" && echo yes || echo no; }

echo "== App"
echo "version:        $(sudo -u "$APP_USER" git -C "$APP_DIR" log --oneline -1 2>/dev/null | cut -c1-70)"
echo "service:        $(systemctl is-active "$SERVICE") (restarts: $(systemctl show -p NRestarts --value "$SERVICE"), since $(systemctl show -p ActiveEnterTimestamp --value "$SERVICE"))"
echo "health:         $(curl -fsS --max-time 5 "http://127.0.0.1:$PORT/api/health" 2>&1)"
echo "node:           $(node -v)"
echo "errors (24 h):  $(journalctl -u "$SERVICE" --since '24 hours ago' -p err --no-pager -q 2>/dev/null | wc -l) error lines"

echo "== Public site"
# Ask the local web server (Caddy or nginx) for the public site: a server often cannot reach its own public
# address through its firewall. Follow the www → main-domain redirect and read the page actually served.
R=(--resolve www.bwenge.space:443:127.0.0.1 --resolve bwenge.space:443:127.0.0.1)
FINAL=$(curl -sSL "${R[@]}" -m 10 -o /dev/null -w '%{url_effective}' https://www.bwenge.space/ 2>/dev/null)
H=$(curl -sS "${R[@]}" -m 10 -D - -o /dev/null "${FINAL:-https://www.bwenge.space/}" 2>&1)
echo "https status:   $(head -1 <<<"$H" | tr -d '\r') at ${FINAL:-?}"
echo "security policy:$(grep -i '^content-security-policy' <<<"$H" >/dev/null && echo ' enforced' || echo ' MISSING')"
echo "HSTS:          $(grep -i '^strict-transport-security' <<<"$H" >/dev/null && echo ' yes' || echo ' no')"
echo "web server:     $(grep -i '^server:' <<<"$H" | cut -d' ' -f2- | tr -d '\r' || true)$(systemctl is-active caddy >/dev/null 2>&1 && echo ' (caddy active)')$(systemctl is-active nginx >/dev/null 2>&1 && echo ' (nginx active)')"
echo "TLS expires:    $(echo | openssl s_client -servername www.bwenge.space -connect www.bwenge.space:443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"

echo "== Settings present (values not shown)"
for k in NODE_ENV DATABASE_URL JWT_SECRET FILE_URL_SECRET APP_BASE_URL ANTHROPIC_API_KEY GONKA_API_KEY TELEGRAM_BOT_TOKEN EMAIL_SMTP_URL SMTP_HOST MOMO_TARGET_ENV REDIS_URL; do printf '%-18s %s\n' "$k" "$(has "$k")"; done
echo "MoMo mode:      $(grep -E '^MOMO_TARGET_ENV=' "$ENV_FILE" | cut -d= -f2)"

echo "== Machine"
echo "cpu/memory:     $(nproc) cores, $(free -h | awk '/Mem:/{print $2" total, "$7" available"}')"
echo "disk:           $(df -h "$APP_DIR" | awk 'NR==2{print $4" free of "$2" ("$5" used)"}')"
echo "data size:      $(du -sh "$APP_DIR/data" 2>/dev/null | cut -f1)"
echo "database size:  $(sudo -u postgres psql -tAc "select pg_size_pretty(sum(pg_database_size(datname))) from pg_database" 2>/dev/null)"
echo "python libs:    $(python3 -c 'import numpy, pandas; print("numpy+pandas ok")' 2>/dev/null || echo 'missing (built-in analysis engine used)')"
echo "firewall:       $(ufw status 2>/dev/null | head -1)"
echo "open ports:     $(ss -tlnH 2>/dev/null | awk '{print $4}' | grep -vE '^(127\.|\[::1\]|::1)' | sed -E 's/.*:([0-9]+)$/\1/' | sort -un | tr '\n' ' ')(listening on public addresses)"
echo "auto updates:   $(dpkg -l unattended-upgrades 2>/dev/null | grep -q '^ii' && echo installed || echo 'not installed')"

echo "== Backups"
echo "nightly job:    $([[ -f /etc/cron.d/bwenge-backup ]] && echo installed || echo 'NOT installed')"
echo "latest dump:    $(ls -t /var/backups/bwenge/db/*.dump 2>/dev/null | head -1 || echo none)"
echo "last result:    $(tail -1 /var/log/bwenge-backup.log 2>/dev/null || echo 'no log')"
