# MySEB inside bwenge.space (wired)

A lecturer ticks **Require MySEB** on a quiz, test or form. Students can then only open it inside the MySEB app
(Windows / Mac / Linux, Android, iPhone) or, if allowed, its Chrome extension. Anyone else gets `403 MYSEB_REQUIRED`
and a "How to get MySEB" screen instead of the questions.

## How it fits together
```
Lecturer (bwenge UI) ──► bwenge server ──(MYSEB_SERVICE_KEY)──► MySEB server (Postgres)
                              ▲                                        ▲
Student: MySEB app/extension ─┴── opens https://bwenge…/forms/<id> ────┘  verify-code, heartbeat, violations
```
* Lecturer: Form → *Form settings → Test protection → Require MySEB → Generate MySEB code*. First time, bwenge creates the
  matching exam on the MySEB server (`exam.mysebExamId` is saved on the form). The code is `8492-KIGALI-77` plus a QR for phones. The
  panel also shows the live monitor (IN EXAM / PAUSED / LEFT / ENDED, violations) with Resume and End for student.
* Student: installs MySEB (`/myseb` lists downloads), types the code, the test opens inside the app.
* bwenge checks **every** student route of a MySEB form with the MySEB server (`server/services/mySeb.ts`):
  `GET /api/forms/:id`, `GET /api/public/forms/:id`, `POST /api/forms/:id/submit`, `POST /api/forms/:id/upload`,
  `POST /api/form-exams/public/:formId/start`. The lecturer who owns the form bypasses it (preview).
* The page shell (`/forms/:id`) is served to everyone (it contains no questions) but gives the phone app its HttpOnly cookie.
* If the MySEB server is down the routes answer `503` (fail closed).

## Set up
1. Run `myseb/backend` (own Postgres DB, HTTPS, `TRUST_PROXY=1`). Set its `TEACHER_KEY` to a long random value.
2. In bwenge's environment: `MYSEB_URL=https://myseb.your-domain`, `MYSEB_SERVICE_KEY=<same value as TEACHER_KEY>`, `APP_URL=https://www.bwenge.space`,
   and the `MYSEB_DL_*` download links (`.env.example`).
3. Build the apps and point them at the MySEB server: desktop `config.json` → `apiBase`, phone `--dart-define=MYSEB_API=…`.
   `myseb/scripts/pack-extension.sh` zips the Chrome extension.
4. Put the MySEB server's own `PUBLIC_URL` to its https address (QR codes use it).

## The live room (one screen for the whole class)
From a form's *How students take this test → MySEB → Open live room* (or the same button on a task) you get `/live/form/<id>`
or `/live/task/<id>`: a tile per student with their camera picture (if you turned on *Camera pictures*), status, the question they
are on (Q4 of 12 and its text), and Resume / End / "what happened". On top: **Get code for students** (code + QR),
**Pause everyone**, **Let everyone continue**, **Camera pictures** on/off, **Needs attention** filter, **End test**.
* The exam page tells the room where the student is (`MySebLiveReporter`, runs only inside MySEB): bwenge relays it to MySEB with the service key.
* The **Camera** menu in the room has three settings: **Off**, **Pictures** (a small picture every 10 s) and **Live video**. Everything is
  **off by default**, each student first sees a plain notice and must press *Turn on my camera*, and nothing is recorded or saved.
* **Live video** is sent by each student's browser straight to the lecturer's browser (WebRTC). Our servers only pass short set-up messages
  (in memory, about a minute). The room connects to the tiles on screen, **12 at a time**, and everyone else shows the small picture, so a class
  of hundreds works; scroll or use *Needs attention* to move the live tiles around.
* **Sound** is a separate switch (*Allow listening*, live mode only). The student's microphone stays silent until you press **Listen** on one tile;
  you hear one student at a time, and that student sees a red "Your lecturer is listening" notice while you do. Stop listening and it goes silent again.
* Pictures are kept **in memory on the MySEB server only** (never in the database or on disk), replaced by the next one, and forgotten when the student ends,
  the test ends, or 3 minutes pass. Check your school's rules and data-protection law before using camera or sound with students.
* Choosing how students take a test is one choice in the form builder: **Normal / MySEB / Safe Exam Browser**.

### Live video needs a TURN server for some students
STUN alone connects students on ordinary home and campus networks. Students behind strict firewalls (roughly 1 in 5) need a **TURN relay**,
or their tile stays on the small picture. Run [coturn](https://github.com/coturn/coturn) with `use-auth-secret` and set `MYSEB_TURN_URLS` and
`MYSEB_TURN_SECRET` (same secret) in bwenge's environment. bwenge hands out TURN passwords that expire after 6 hours; the secret is never sent to a browser.
Each live student uses about 150 kbit/s of the student's upload and of your download (the lecturer's computer decodes up to 12 streams).

## How many students
Measured on one 4-core container with the load generator on the same machine, MySEB server as a single Node process, each simulated student
sending a heartbeat and a live-room report every 5 s and holding a live-video set-up connection:

| Students at once | Requests/s | Heartbeat p95 | Server CPU (of one core) | Memory | Errors |
|---|---|---|---|---|---|
| 500 | 200 | 8 ms | 5 % | 127 MB | 0 |
| 1,500 | 600 | 14 ms | 45 % | 257 MB | 0 |
| 3,000 | 1,200 | 103 ms (p99 1.1 s) | 63 % | 377 MB | 0 |

* The 5,000-student run is **not valid**: the test client ran out of file handles. One Node process is single-threaded, so expect a ceiling of roughly 4,000 to 5,000 students per MySEB server; plan for a few hundred students per live room in practice.
* The live-video set-up messages and pictures are kept in the memory of one server, so run **one** MySEB server per deployment (it is the only stateful part). To go beyond it, move that memory to Redis first.
* This measured the MySEB server only. Live-video media does not pass through it. bwenge's own load (marking, AI) is separate.
* Limits that protect the system: one live report per student every 3 s; 12 live tiles per lecturer screen; 2 lecturer tabs per student; code guessing 10 tries/min per address.

## Assignments (hand-in links)
Same switch on the task's dashboard: *Require MySEB (secure exam app)*. The task text, its files and the hand-in
(`GET /api/assignments/public/:token`, `.../files/:index`, `POST .../submit`) answer 403 outside MySEB; the page shell
`/a/<token>` stays reachable (it holds no task content) and the student's own result page is not locked. Best for work done in class.
Choosing a file or photo opens a system dialog: the apps allow 45 s (desktop) / 60 s (phone) for that and do not count it as leaving.

## What the apps watch for (every one is recorded; leaving-type ones pause the student)
tab/window/app switch (blur > 1.5 s, home, recents), a second monitor, remote-control or screen-recording programs
(TeamViewer, AnyDesk, OBS, … extend with `blockedProcesses` in the desktop `config.json`), screenshots, copy/paste, dev tools,
closing the app, losing the connection (20 s without a heartbeat).

## Not covered yet
* The Flutter app has never been compiled; see `docs/MOBILE.md`. The Android/iOS file chooser inside the web view has not been tested.
* A second device (a phone beside the laptop) cannot be detected by software.
