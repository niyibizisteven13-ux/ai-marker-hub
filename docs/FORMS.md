# Forms: AI form building, research-ready data and analysis

Forms, surveys and questionnaires are created, changed, checked, published and analysed **from the chat**. The
form editor and the results page are the same data seen another way, and "Ask Bwenge" is open beside them.

## Where it lives

| Part | File |
|---|---|
| Canonical model (fields, variables, measurement levels, branching rule, codebook) | `server/services/forms/model.ts` |
| Server-side validation of submissions (branching-aware) and of form definitions | `server/services/forms/validation.ts` |
| Versions (a published definition is frozen; responses record their version) | `server/services/forms/versions.ts` |
| Deterministic statistics (no LLM arithmetic) | `server/services/forms/stats.ts` |
| Dataset, coverage, summaries, crosstab / group comparison / correlation | `server/services/forms/analysis.ts` |
| Readiness review | `server/services/forms/review.ts` |
| AI generation and editing (structured output, checked before saving) | `server/services/forms/generate.ts` |
| Owner operations (ownership checks, open/close, links) | `server/services/forms/service.ts` |
| Chat tools | `server/services/ai/tools/formTools.ts` |
| Form studio page (`/forms/:id/edit`) | `src/pages/FormStudioPage.tsx` |
| Ask Bwenge drawer (form editor and marked-exam review) | `src/components/AskBwengeDrawer.tsx` |

## Chat tools

`create_form`, `edit_form`, `review_form`, `publish_form`, `list_forms`, `analyze_form`, `form_report`.
The planner routes form requests to them (`intent: 'form'`). A request for a web page about figures that merely
came from a survey ("make a web page showcasing these survey figures") stays an HTML report, unless it names a
saved form ("my survey", "this form"). Set `ENABLE_FORM_TOOLS=false` to switch the tools off.

New forms are always drafts. Publishing checks the definition (duplicate ids, empty choice lists, min > max,
branching that points to a missing or later question or to a value that is not an option) and records a version.

## Readiness score

`Q = 0.25·C + 0.20·V + 0.20·L + 0.20·P + 0.15·A` (completeness, validity, language, privacy, analysability), each 0–100.
Critical findings (for example personal data without a consent statement) block "ready" whatever the score.

## Statistics

All numbers come from code: frequencies and percentages, descriptives (mean, SD, median, quartiles, skewness,
outliers), crosstab with chi-square, Cramér's V and a small-cell warning, group comparison (ANOVA F, p, η²),
Pearson and Spearman correlation with p-values. The method is chosen from the measurement levels, and unsuitable
requests are refused with the reason. Questions hidden by branching count as "not shown", not as missing.

`form_report` produces an HTML report and an Excel workbook (Responses, Codebook, Response rates).

## Studio endpoints (owner only)

- `GET /api/forms/:id/studio`: form, links, response count, review, versions, codebook, per-question summaries.
- `PUT /api/forms/:id/schema` `{schema}`: saves the editor's form (never opens or closes it), returns the review.
- `POST /api/forms/:id/open` `{open}`: opens (after the definition check, records a version) or closes the form.

The public submit endpoint validates every answer on the server and stores `formVersion`.

## Ask Bwenge beside the work

The drawer posts to `/api/ai/chat` with `surface: 'form' | 'exam'` and `surfaceId`. On a form, the request is
treated as "edit my form …" for that form; on a marked exam, the exam chat is focused on that exam, so questions
about a student or a mark need no ids. When the reply ends, the page reloads what changed.

## Deploy

Run `npx prisma migrate deploy` (migration `20261025000100_form_versions` adds `FormVersion` and
`FormSubmission.formVersion`).

## Not built yet

Form generation from an uploaded document, conversational (chat-style) filling for respondents, multilingual
versions, collaboration, a template library and survey weighting.

## Test protection (quizzes and typed answers)

Form settings > Test protection: **block pasting** into typed answers (paste and drop are stopped), **shuffle question order** (within each section; off when questions depend on earlier answers), **shuffle options** of every choice question, and **record activity**. Recording is always on for quizzes and is announced to the student on the form.

Recorded per response (`shared/formIntegrity.ts`): characters typed vs pasted per typed answer, blocked paste attempts, times the page or window was left and for how long, total time. The server re-checks the numbers (known questions only, bounded) and stores flags under `_integrity`: pasted, paste blocked, answer much longer than what was typed, left the page, finished unusually fast, no activity record. The lecturer sees them as "Worth a look" in Individual responses.

These are **signals for review, not proof**: a modified browser can fake them, and they never change a mark. There is deliberately no "AI-written" percentage: text detectors are unreliable and wrongly accuse people who write in a second language. Phase 2 (not built): server-issued start time and time limit, a lecturer-run writing check compared with the student's own earlier answers, and a short oral follow-up list.

## Timed tests (server clock, camera rule, accommodations)

Quiz Form settings > Test protection > **Timed test**: minutes, camera rule, seconds out of frame before it counts, and the class (from the Classes tab) whose roster and accommodations apply.

- **Server clock** (`server/services/formExam/service.ts`). A student starts a session with their registration number; the server keeps the time, the page only shows it (it asks every 5 s and works out the offset from `serverNow`). Refreshing does not stop the clock. Submitting needs the session secret and only works while the session allows (running, or up to 90 s after time ran out); a response after that is refused. When time is up the page sends what the student has and required questions are not enforced.
- **Accommodations** come from the class roster: extra time (added to the clock), camera exemption (that student sits without the camera check), breaks (the clock stops until they continue), large text. A student not on the roster is refused when "only students on the class list" is on.
- **Camera rule** (`shared/examRules.ts`, `src/lib/faceDetector.ts`, `src/components/ExamRunner.tsx`). Face detection (MediaPipe BlazeFace) runs on the student's device with model and WebAssembly files served by us (the wasm files are copied from the pinned package at build time by `vite.config.ts`). No picture or video is recorded or sent; only events (`face_lost` with seconds, `face_back`, `multiple_faces`, `camera_stopped`, `camera_denied`). Frame rule: exactly one face, at least 2% of the picture, mostly inside it. A short look away is only a countdown; after the grace period one `face_lost` event is sent. Rules: **off**, **warn** (record only), **pause** (the clock stops and the questions are hidden until the lecturer resumes; "Resume those whose face is back" does a whole lab at once).
- **The clock waits for the camera.** With a camera rule, a new session is paused ("camera check") until the student's face has been in the oval for 2.5 s, so set-up time is not exam time.
- **Lecturer's live view** (`ExamMonitor`, in the form's Results): sitting, paused and why, time left, camera and page signals; resume, pause, +5 min, end one student's test, let a student who lost their page back in (new secret, the old page stops working).
- A timed response carries `_exam` (session id, registration number, time used, and counts of camera and page events). The Classes dashboard uses the registration number to match the response and shows camera events as "Review".

Fairness and limits: face detectors can fail in dim light, on weak cameras, with some head coverings or a camera at a bad angle, and a student may look away for honest reasons. That is why the default is a countdown, then a pause the lecturer decides on, and never an automatic fail. Run a trial with real students on the phones and laptops they use before an exam counts. Behind one campus network address the submit limiter (60 per 15 min per address) can block a whole lab: raise `FORM_SUBMIT_MAX` before a large exam.

Not built yet: voice answers for students with that accommodation, a seat-by-seat view, and recording a short still image on a flag (deliberately left out for privacy).

## Test design settings and class review

All of these are chosen by the form creator in Form settings > Test protection (quizzes and timed tests).

- **One question at a time / no going back / seconds per question** (`oneAtATime`, `noGoingBack`, `perQuestionSeconds`). One question per screen; with "no going back" the Back button is gone and the screen says so. A timer per question opens the next question (or sends the test on the last) when it runs out; students with extra time get proportionally longer. These are page controls: they keep honest students on track and make sharing harder, but a modified browser could skip them, so the server does not rely on them for marks.
- **Block copying the question text** (`blockCopy`). Copy and cut on the page are stopped and counted (the student's own answer box still works). Photos and screenshots cannot be stopped.
- **Question pools** (`poolGroup` on a question, `poolPicks` on the form; `shared/formPool.ts`). "Each student gets 10 of the 30 in pool A." The draw depends only on a seed (the test session for timed tests, a random id kept for the visit otherwise), so a refresh draws the same questions. The server repeats the draw from the seed in the response and validates and marks only the questions that student was given, so the score is out of what they got. Pools stop neighbours copying; they do not hide questions from someone who reads the page source.
- **Leaving the page or full screen** (timed tests: `exam.leaveAction`, `maxLeaves`, `requireFullscreen`). Always recorded. The creator chooses: only record, warn the student, pause after too many times (the lecturer decides; "resume those whose face is back" never resumes these), or end the test after too many times (the page sends what the student has).
- **Device and network** (quizzes and timed tests). A random id kept on the student's device and a keyed hash of the network address (never the address itself) are stored with the response. The student is told on the form.
- **Class review** (`GET /api/forms/:id/class-review`, shown in "Worth a look" for each response; `server/services/forms/classReview.ts`): near-identical written answers (3-word overlap of 60% or more, answers of 20 words or more), the same wrong answers on at least 4 questions, two people on one device, two or three people on one network within 30 minutes (larger groups are ignored: a lab shares an address), and a long written answer in a very different style from the same student's other answers (a note, needs at least four long answers). Up to 400 responses.

What is deliberately not here: an "AI-written %" score (detectors are not reliable enough to accuse a student and are biased against second-language writers: the paste, typing, style and comparison leads above are stronger and fairer), ID card photos and room scans (sensitive data; check ID in person), and lockdown-browser control of the computer (impossible in a web page; full screen plus counting leaves is the closest).
