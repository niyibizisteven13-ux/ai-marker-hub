# Deploying MySEB

One small server (2 vCPU, 2 GB RAM is plenty for a few thousand students) with Docker.

```bash
cd myseb/deploy && cp .env.example .env     # fill it in (random values; keep the file private)
docker compose --env-file .env up -d        # MySEB + PostgreSQL + HTTPS (Caddy) + TURN (coturn)
curl https://$MYSEB_DOMAIN/readyz           # {"ok":true}
```
DNS: point `MYSEB_DOMAIN` at the server. Open ports 80, 443, 3478 (TCP and UDP) and 49160-49200 (UDP).

## Connect bwenge
In bwenge's environment: `MYSEB_URL=https://<MYSEB_DOMAIN>`, `MYSEB_SERVICE_KEY=<TEACHER_KEY>`, `APP_URL=https://www.bwenge.space`,
`MYSEB_TURN_URLS=turn:<MYSEB_DOMAIN>:3478`, `MYSEB_TURN_SECRET=<TURN_SECRET>`, and the `MYSEB_DL_*` download links.
Build the apps pointing at `https://<MYSEB_DOMAIN>` (desktop `config.json` `apiBase`, phone `--dart-define=MYSEB_API=...`) and remove `usesCleartextTraffic` from the Android manifest.

## Run it
| What | How |
|---|---|
| Is it up? | `GET /healthz` (alive), `GET /readyz` (alive and the database answers) |
| Numbers | `GET /metrics` with `Authorization: Bearer <TEACHER_KEY>` (Prometheus text: students by status, live memory, uptime) |
| Backups | `docker compose exec db pg_dump -U myseb myseb > myseb-$(date +%F).sql` daily; keep 14. Restore with `psql`. Live pictures and video set-up are memory-only and are not backed up by design |
| Upgrade | `git pull && docker compose build && docker compose up -d`. Tables update themselves on start, safely even if two servers start together. A stop lets requests finish, then exits within seconds |
| Privacy | Finished students, their violation logs and old exams are deleted after `RETENTION_DAYS` (default 90). Set it to what your school's policy says |
| Secrets | `PEPPER` must never change once students have joined (it signs the stored hashes). Rotate `TEACHER_KEY` by changing it here and in bwenge together |
| More than one server | Not yet: live-room pictures and video set-up live in one server's memory. Run one MySEB server (tested to 3,000 simultaneous students on one 4-core machine) |

The compose file passes `docker compose config`. The image itself was not built or run in the build environment (no Docker daemon): do a first start on a test machine.
