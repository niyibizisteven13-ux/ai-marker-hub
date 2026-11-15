# Deploying MySEB

## Easiest: inside the existing bwenge server (nothing new to set up)
If `MYSEB_URL` is **not** set, bwenge runs MySEB itself under `https://<your site>/myseb`, in the same process and the same PostgreSQL database (its own tables). Secrets are derived from `JWT_SECRET`, so there is nothing to configure: deploy, open the live room, get a code. Set `APP_URL` to your public address if you can. Build the apps with `apiBase` = `https://<your site>/myseb`. Set `MYSEB_EMBED=0` to turn this off.
MySEB runs as its own process on the same machine (its own CPU core and event loop), and `/myseb` is passed through to it, so a crowd of students cannot slow the website. If it crashes it restarts by itself.
Measured with `node myseb/scripts/loadtest.mjs <url> <teacherKey> <students>` on a 4-core test machine that also ran the load generator, with students sending heartbeats and a lecturer watching the room: 2,000 students: heartbeat p95 6 ms, 4,000: p95 12 ms, 8,000: p95 262 ms and the site page p95 120 ms, zero errors in all. That does not include live camera pictures or video set-up, so plan for about 2,000 at once on one machine until you have run the test on your own server.
This suits a school or a few thousand students at a time. Live video for many students is better on its own machine (below), which also needs TURN for students behind strict networks.

## Separate server (bigger exams, live video)

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

## Getting the apps to students
Actions tab → **Build MySEB apps** → Run workflow (the address defaults to `https://bwenge.space/myseb`). It builds the Windows installer, macOS dmg, Linux AppImage and Android APK, and attaches them to the run. Push a tag such as `myseb-v1.0.0` to also publish them as a GitHub Release.
Then set `MYSEB_DL_PAGE` (a https link to where students download, for example the release page) so the code page shows a **Download MySEB** button.
The Windows and Mac installers are not code-signed, so Windows SmartScreen and macOS Gatekeeper warn students once ("More info → Run anyway"). Signing needs a paid certificate. The Android APK is sideloaded (students allow "install from this source"); the Play Store needs a developer account.

## Showing the student's screen and face in the live room
In the live room, **Show** chooses Face, Screen, or Face and screen; **If a student leaves** chooses Only record it, Pause them, **Pause, then end the second time** (recommended), or End their test at once. A student who leaves appears at the top with a beep and an **End their test now** button.
- **Laptop app:** shares the whole main screen without a picker, so a student cannot pick a smaller window. While the screen is shared, the "screenshots show black" protection is lifted so the lecturer sees the exam instead of a black rectangle.
- **Phone app:** the phone's in-app browser cannot share its screen, so a phone student shows their camera instead and is never penalised for it. Real screen capture on Android needs native code (MediaProjection) and is not built yet.
- Stopping the share counts as leaving the test, once per stop, and the leave rule applies. Pictures of the screen stay in memory for about 3 minutes and are never saved.
