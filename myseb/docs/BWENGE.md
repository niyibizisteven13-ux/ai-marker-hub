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

## Not covered yet
* The task hand-in page (`/a/<token>`, "assignments") is a separate system and is **not** behind MySEB yet.
* Android file picker inside the phone app (for tests that need photo/file upload) is not wired in the Flutter code.
* The Flutter app has never been compiled; see `docs/MOBILE.md`.
