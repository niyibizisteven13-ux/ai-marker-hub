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
* Camera pictures are **off by default**. When you turn them on, each student first sees a plain notice and must press *Turn on my camera*.
  One small JPEG (about 5 KB) every 10 s, kept **in memory on the MySEB server only** (never in the database or on disk), replaced by the
  next one, and forgotten when the student ends, the test ends, or 3 minutes pass. Check your school's rules and data-protection law before using it.
* Choosing how students take a test is one choice in the form builder: **Normal / MySEB / Safe Exam Browser**.

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
