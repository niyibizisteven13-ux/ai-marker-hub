# MySEB — your own Safe Exam Browser

Teacher makes a code → student types it into the MySEB app → the device locks and the exam opens.
Laptop (Electron), phone (Flutter), Chrome extension (optional, low security), teacher dashboard (web), backend (Node + PostgreSQL).

```
myseb/
├── backend/                Node 20 + Express + PostgreSQL
│   ├── src/server.js         app, routes mounting, sweeper (heartbeat timeouts)
│   ├── src/routes.js         /api: exams, generate-code, verify-code, heartbeat, violation, finish, gate, monitor
│   ├── src/guard.js          mySebGuard: 403 "MySEB Needed" on EVERY exam request without a valid key
│   ├── src/remoteGuard.js    same guard for an exam site elsewhere (bwenge.space) – one copy-paste file
│   ├── src/exam.js           small built-in sample exam (so you can test without another site)
│   ├── src/schema.sql        exams, exam_codes, exam_sessions, violations
│   ├── public/dashboard/     teacher dashboard (plain HTML/JS, no build)
│   └── test/flow.test.js     13 end-to-end tests of the rules below (real Postgres)
├── desktop/                Electron kiosk app (main.js holds the secret; renderer never sees it)
├── mobile/                 Flutter app + native-overlay/ (Kotlin MainActivity, Swift AppDelegate) + setup.sh
├── extension/              Chrome MV3 extension (declarativeNetRequest adds the header to the exam tab only)
└── docs/                   MOBILE.md (what phones can/can't enforce), BWENGE.md (plugging into bwenge.space)
```

## Install & run

```bash
# 1. Backend + dashboard
sudo -u postgres psql -c "CREATE USER myseb WITH PASSWORD 'myseb'" -c "CREATE DATABASE myseb OWNER myseb"
cd myseb/backend && cp .env.example .env     # set TEACHER_KEY and PEPPER; PUBLIC_URL = http://<laptop-ip>:4000 for phones
npm install
set -a; . ./.env; set +a; npm start           # tables are created on start. Dashboard: http://localhost:4000/dashboard/
npm test                                      # 13 end-to-end tests

# 2. Desktop app
cd ../desktop && npm install
MYSEB_API=http://localhost:4000 npm start     # real kiosk. For development: npm run dev (windowed, devtools)
npm run dist                                  # installers (Windows/macOS/Linux)

# 3. Mobile (needs Flutter SDK + Android Studio / Xcode)
cd ../mobile && ./setup.sh
flutter run --dart-define=MYSEB_API=http://<laptop-ip>:4000

# 4. Extension: chrome://extensions → Developer mode → Load unpacked → myseb/extension
```
Production: use HTTPS, remove `usesCleartextTraffic` from the Android manifest, set `NODE_ENV=production` (refuses to start without TEACHER_KEY/PEPPER), put the backend behind a proxy and set `TRUST_PROXY=1`.

## Test steps

1. **Teacher generates a code.** Dashboard → sign in with `TEACHER_KEY` → *New exam* (leave URL empty to use the built-in sample) → *Generate Code*. You get e.g. `8492-KIGALI-77`, a Copy button, a QR for phones and the exam secret (shown once). Toggle **Require MySEB** per exam.
2. **Student on laptop.** Open MySEB desktop → name + code → the exam opens full screen. Teacher's *Live monitor* shows the student `IN EXAM`.
3. **Student on phone.** MySEB mobile → name + code (or scan the QR → "Open in MySEB") → locked WebView. Android asks once to confirm *screen pinning*. Same code works for many students.
4. **Cheat attempts** (each must be blocked or must pause the exam; check the monitor + violation list):
   | Attempt | Result |
   |---|---|
   | Laptop: Ctrl+T / N / W, F12, Ctrl+Shift+I, Alt+F4, PrintScreen, Ctrl+C/V, right-click | blocked, violation logged |
   | Laptop: Alt+Tab / click another window > 1.5 s | violation `leave` → **PAUSED**, app shows "Exam paused", exam site returns 403 until teacher *Resume* |
   | Laptop: close window | "Are you sure? Exam will end" + `close_attempt` violation; confirm → ENDED |
   | Phone: Home / app switcher | `background` violation sent at once → **PAUSED** (screen pinning blocks Home in the first place) |
   | Phone: screenshot / screen recording | black screen (Android FLAG_SECURE); iOS: cover + violation |
   | Open the exam URL in normal Chrome | **403 "MySEB Needed"** |
   | Copy the token into Chrome / another device | blocked + `token_misuse` violation |
   | Kill the app / network | no heartbeat for 20 s → **LEFT**; on return → PAUSED |
   | Laptop: second monitor, TeamViewer / AnyDesk / OBS running | `extra_display` / `forbidden_app` violation → **PAUSED** |
   | Re-enter the code to escape a pause | same device gets the same (paused) state; other device refused |
5. Teacher: *Resume* / *End Exam* per student, *End exam* for everyone (codes expire).

## How the rules in the brief are met

| Rule | Where |
|---|---|
| Secret never in frontend JS | Desktop: header added in Electron's main process (`webRequest.onBeforeSendHeaders`); preload exposes no token. Extension: DNR rule in the browser, token in service-worker session storage. Mobile: Dart code, never the page. |
| Code/secret stored hashed | HMAC-SHA256 with server `PEPPER`; shown once. |
| One code = one exam, many students | `exam_codes` → exam; each `verify-code` makes its own `exam_sessions` row + unique token. |
| Code expires after exam ends | `POST /exams/:id/end` revokes codes; sweeper ends exams with `ends_at`; codes also have a TTL. |
| Token from normal Chrome blocked | Token needs the MySEB user-agent marker **and** the device id it was issued to (+ `X-MySEB-Client`); anything else → 403 + `token_misuse`. Re-entering the code rotates the token. |
| Header checked on EVERY request | `mySebGuard` is mounted in front of the whole `/exam/:id` tree (page, script, XHR). External sites use `remoteGuard.js`. |

## Honest limits (read this)

* **No app can fully stop a determined cheater.** A second phone/camera, a VM, or someone sitting next to the student can't be stopped by software. MySEB makes cheating *visible and costly*.
* **Alt+Tab / Win key can't be intercepted by Electron** on Windows/macOS. MySEB detects focus loss (> 1.5 s), pulls focus back and pauses. For harder blocking add a native low-level keyboard hook or run on managed (kiosk/MDM) machines.
* **Screenshots on desktop:** `setContentProtection` makes screen capture black on Windows/macOS; Linux has no equivalent. PrintScreen is also blocked and the clipboard cleared.
* **Mobile pinning:** without a device-owner/MDM policy Android shows a confirm prompt the student can exit by holding Back+Recents; iOS Guided Access can only be started by the app on supervised devices. Those exits are *detected* (background / heartbeat) and pause the exam. See `docs/MOBILE.md`.
* **Mobile sub-resources** can't carry a custom header in a web view, so the server sets an HttpOnly cookie on the first header-authenticated page load and honours it only for mobile sessions with the MySEB user agent. Weaker than the header; documented in `guard.js`.
* **Extension mode is low security**: it cannot lock Chrome; Ctrl+T/W/N may never reach the page. It detects tab-hidden/blur/tab-close and the header is scoped to the exam tab only. Off by default per exam (*allow extension*).
* Students identify by typed name (no accounts). On bwenge.space use the real student identity there.
* Teacher auth is a single `TEACHER_KEY`; replace `requireTeacher` in `routes.js` with bwenge's login for multi-teacher use.
