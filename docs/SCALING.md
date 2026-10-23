# Running Bwenge on several servers

One primary server and any number of web servers behind it. Visitors reach the primary's nginx, which spreads
them across all servers. Each visitor stays on one server (hash of their IP address), and a server that stops
answering is skipped automatically.

```
                         visitors, Telegram, MTN MoMo
                                     │ HTTPS
                     ┌───────────────▼────────────────┐
                     │ server 1: PRIMARY              │
                     │ nginx (TLS, load balancer)     │
                     │ app (NODE_ROLE=primary)        │──── private network ────┐
                     │ PostgreSQL · Redis · NFS share │                         │
                     │ nightly backups                │        ┌────────────────▼─┐  ┌──────────────────┐
                     └────────────────────────────────┘        │ server 2: web    │  │ server 3: web    │
                                                               │ app (NODE_ROLE=  │  │ app (NODE_ROLE=  │
                                                               │ web), shared     │  │ web), shared     │
                                                               │ files mounted    │  │ files mounted    │
                                                               └──────────────────┘  └──────────────────┘
```

| What | Where | Why |
|---|---|---|
| Database | PostgreSQL on the primary, reached over the private network | One source of truth |
| Shared cache, rate limits, messages between servers | Redis on the primary | Limits count across servers; "Pause AI" reaches every server at once; this month's cost figures are computed once |
| Uploaded and generated files, exams, documents | `/opt/nexus/data` on the primary, mounted on web servers (NFS) | A file made on one server can be downloaded from any |
| Background jobs | Each server's own queue (`/var/lib/bwenge/jobs` on web servers) | A job runs where it was started; no two servers run the same job |
| Site-wide schedules (payment checks, renewal reminders, clean-up, re-indexing, Telegram webhook) | Primary only (`NODE_ROLE=primary`) | They must run once |
| Telegram webhook and scanner, MoMo callbacks, admin live updates | Always sent to the primary by nginx | They keep short-lived state in memory |

If Redis stops, every server keeps working on its own memory. If the database stops, requests fail with a clear
error, and service resumes by itself when the database is back. Nothing is ever written to a local file instead.

## One-time setup

### 1. In the Hetzner Console
1. **Networks → Create network**: `10.0.0.0/16`, one subnet in your zone. Attach the existing server
   (167.233.119.224). Note its private IP, for example `10.0.0.2`.
2. **Servers → Add server**, twice: same location, **same Ubuntu release as the current server**, CPX31 or larger,
   attached to the same network, with your SSH key. Note their private IPs, for example `10.0.0.3` and `10.0.0.4`.
3. Optional, recommended: **Storage Box** for off-server backups.

### 2. Prepare the primary (once)
```bash
ssh -i ~/.ssh/hetzner root@167.233.119.224 'cd /opt/nexus && sudo -u nexus git pull -q origin main && PRIMARY_IP=10.0.0.2 bash scripts/cluster/setup-primary.sh'
```
It prints a public key at the end. To use a Storage Box for backups, add `BACKUP_REMOTE=u123456@u123456.your-storagebox.de:bwenge` before `bash`.

### 3. Let the primary reach the new servers (once per server)
```bash
ssh -i ~/.ssh/hetzner root@167.233.119.224 'cat /root/.ssh/bwenge_cluster.pub' | ssh -i ~/.ssh/hetzner root@NEW_SERVER_PUBLIC_IP 'cat >> ~/.ssh/authorized_keys'
```

### 4. Add the servers
```bash
ssh -i ~/.ssh/hetzner root@167.233.119.224 'bash /opt/nexus/scripts/cluster/add-node.sh 10.0.0.3 && bash /opt/nexus/scripts/cluster/add-node.sh 10.0.0.4'
```
Each run installs Node.js, mounts the shared files and copies the built app and its settings. It then starts
the service, waits until the server is healthy and adds it to nginx. Web servers accept app traffic only from
the primary.

## Deploy (every time): one command for all servers
```bash
ssh -i ~/.ssh/hetzner root@167.233.119.224 'cd /opt/nexus && sudo -u nexus git pull -q origin main && bash scripts/cluster/deploy-all.sh --pulled'
```
On the primary it installs, builds, migrates the database, restarts and checks health. It then updates each web
server in turn, checking each before the next. If a server fails its check, the deploy stops there and the
remaining servers keep the previous version. The same command works with no web servers yet.

## Checking
- Which server answered: the `X-Served-By` response header (`node-1`, `node-2`, …).
- Health of each server: `curl http://10.0.0.3:PORT/api/health` from the primary shows the database, Redis, node and role.
- Logs: `journalctl -u nexus -n 100` on the server concerned.

## Backups and restore
Nightly at 02:15 the primary dumps the database (kept 14 days) to `/var/backups/bwenge/db`. It mirrors the
shared files to `/var/backups/bwenge/data` and copies both to `BACKUP_REMOTE` when set. Log: `/var/log/bwenge-backup.log`.

To restore after a loss:
```bash
systemctl stop nexus
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL_WITHOUT_QUERY" /var/backups/bwenge/db/bwenge-YYYYMMDD-HHMM.dump
rsync -a /var/backups/bwenge/data/ /opt/nexus/data/
systemctl start nexus
```
For a brand-new empty database without a dump (a test environment), use `scripts/db-bootstrap-empty.sh`.

## Caddy

The production server serves the site with **Caddy** (automatic HTTPS), not nginx. The scripts above configure
nginx, so `setup-primary.sh` refuses to run while Caddy is the active web server. Before adding servers, either
move the site to nginx, or add the same load balancing to the Caddyfile:

```
bwenge.space {
    @primary path /api/telegram/* /api/billing/momo/callback* /api/payments/momo/callback* /api/admin/live* /scanner.html /scan.html
    reverse_proxy @primary 127.0.0.1:5000
    reverse_proxy 127.0.0.1:5000 10.0.0.3:5000 10.0.0.4:5000 {
        lb_policy ip_hash
        health_uri /api/health
        fail_duration 10s
    }
}
www.bwenge.space {
    redir https://bwenge.space{uri} permanent
}
```

On one server nothing needs to change: Redis, server roles and the cluster scripts stay unused.

## Limits of this setup
- The primary holds the database, Redis and the files, so it is the single point of failure. If it is lost,
  restore it from the backups. The next step up is a managed PostgreSQL with a standby, and S3-compatible
  object storage instead of NFS.
- If Cloudflare or another proxy is put in front, nginx must read the visitor's IP from its header
  (`real_ip_header`). Otherwise all visitors look the same and land on one server.
