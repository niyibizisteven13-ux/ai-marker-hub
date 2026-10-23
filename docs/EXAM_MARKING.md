# Examination marking (backend)

Teachers upload the official marking scheme and many candidate scripts through the **existing chat**. Bwenge.AI then:
- reads each script with the document pipeline;
- marks every question against the scheme;
- returns one download: annotated PDFs, an interactive HTML report, a real Excel workbook and machine-readable results.

The teacher review screen is `src/pages/ExamReviewPage.tsx`; everything else is backend. Replies use the chat's existing `text` and `attachment` stream events. There are no new dependencies (`pdf-lib`, `exceljs`, `jszip`, `sharp` and `jsdom` for tests were already installed). `/api/ai/scan-agent`, the Telegram bot, `/api/documents` and the AI/RAG services are unchanged.

## Architecture (as inspected)

| Concern | What exists | How marking uses it |
|---|---|---|
| Chat | `POST /api/ai/chat` in `server.ts` (SSE events `text`, `attachment`; files arrive as `attachments[]` base64, `attachmentIds`, or `attachment`) | A hook after the paywall check calls `examChat.handle()`. If the message is not about an exam, it returns `null` and the normal chat continues. |
| Files and downloads | `FileStore` (owner-private, expiring, signed URLs at `/api/files`) | Originals, marked PDFs, workbook, report and ZIP. |
| Background work | `FileJobQueue`: disk-persisted, owner-scoped, idempotency keys, recovers after restart, 10-minute deadline per attempt | Job types `exam.mark`, `exam.remark`, `exam.export` and `exam.scheme`. |
| Recognition | `server/services/documents/*` (pages, preprocessing, vision recognition, verification, tiling) | New `documentService.recognizeCached()` runs the same pipeline inside the marking job. The result is keyed by owner + content hash + pipeline version + settings, so an unchanged script is never recognised twice. |
| Persistence | `OwnedRecordStore`: per-user JSON records on disk, already used by documents and assessments | One record per exam under `EXAMS_DIR` (see "Why not Prisma" below). |

### Code (`server/services/exams/`)

| File | Responsibility |
|---|---|
| `scheme.ts` | Marking-scheme schema, validation, versions, extraction from the teacher's document. |
| `matching.ts` | Answer-to-question matching from written labels: `2(b)`, `Q3`, `a)`, `(ii)`, word numbers. |
| `marking.ts` | Model marking, then deterministic validation of every number, evidence id and quote. |
| `results.ts` | Effective marks, totals, percentages, statuses and class statistics, all computed in code. |
| `pdfGeometry.ts`, `annotate.ts` | Coordinate transforms and the marked PDF. |
| `workbook.ts`, `report.ts`, `bundle.ts` | The XLSX workbook, the self-contained HTML report and the ZIP with its manifest. |
| `service.ts` | Exams, uploads, runs, overrides, corrections, revisions and exports. |
| `chat.ts` | Intent recognition, file roles, active-exam context, commands and progress text. |

Routes are in `server/routes/examRoutes.ts`.

## Flow

1. **Intent.** A message with a marking verb plus either a marking-scheme mention or several scripts starts a batch. A single-file request such as "grade this essay" stays with the existing chat.
2. **File roles.**
   - **Scheme:** file name says marking scheme, rubric, memo, answer key or barème, or the file is a text file. The scheme can also be pasted into the message.
   - **Question paper:** file name says question paper or exam paper.
   - **Manifest:** a CSV or JSON file named manifest, candidates or class list.
   - **Candidate scripts:** all other PDFs and images.

   If no file is clearly the scheme, Bwenge asks which one it is. Files are kept for 24 hours, so the teacher can answer "file 2" without re-uploading.
3. **Candidate identity.** In order: manifest or explicit mapping in the message (`C014: alice.pdf`), then a candidate number in the file name (`C014_alice.pdf`), then a new id (`C001` …). The reply lists every mapping. Names written on the page are never used.
4. **Uploads.** Each upload is checked for a valid PDF or image signature, size and page limit, and a SHA-256 duplicate within the exam. The original is stored unchanged.
5. **Scheme.**
   - **Extraction:** the model only restructures the teacher's document. A mark it cannot find stays empty and blocks marking. Every question's marks must be confirmed against a quote from the scheme text.
   - **Validation:** criteria must add up to the question; questions must add up to the total; the mark step (half or whole) is enforced; duplicate numbers and holistic level ranges are checked.
   - **Confirmation:** a clean, unambiguous scheme is confirmed automatically. Otherwise Bwenge shows a summary and asks the teacher to confirm.
   - **Versions:** every change creates a version. A marking run freezes one version. A later confirmed change flags the affected questions (`scheme_changed`) instead of silently re-marking them.
6. **Marking run.** One `exam.mark` job per batch processes candidates `EXAM_CANDIDATE_CONCURRENCY` at a time.
   - **States:** `queued → validating → recognizing → matching_questions → marking → verifying → completed | completed_with_warnings | failed`, then `generating_artifacts` for the batch. Every state is persisted.
   - **Long batches:** a run hands over to a follow-up job after `EXAM_SEGMENT_BUDGET_MS`.
   - **Failures:** a provider error that can be retried is retried with jitter; a failed candidate never stops the others.
   - **Restarts:** re-running a finished segment skips candidates that are already marked, so nobody is scored twice.
7. **Marking.**
   - **Model input:** the scheme, the question paper (if any) and the candidate's transcription with element ids, uncertainty tags and teacher corrections. The model never sees the candidate's id or name.
   - **Model output:** marks per criterion (or a level for holistic questions), evidence ids, exact quotes, feedback, lost marks, and concerns about reading, matching or the scheme.
   - **Code checks:**
     - every criterion belongs to the question and its mark is within range and on the mark step;
     - the question mark is the sum of its criteria;
     - the model also returns a short correction and its own confidence; code caps the confidence by the checks (see "the saved record"); an invalid mark becomes "no mark" and is flagged, never clamped;
     - evidence ids must exist in this candidate's document, and quotes must match it;
     - totals and percentages are always computed in code.
8. **Review flags, without an approval screen.** Flags are raised for:
   - unreadable or uncertain handwriting, or recognition that disagrees with itself;
   - uncertain question matching, or several attempts at one question;
   - marks without matching evidence, or marks that don't fit the scheme;
   - a reading that changes the mark, or an ambiguous scheme.

   Each result is `provisional`, `needs_review`, `user_corrected` or `user_confirmed`. Flags appear in the report, the workbook and the chat. They never block generating the package.
9. **Package** (`examination-results/…` ZIP):
   - `index.html`;
   - `results.xlsx` (sheets: Class Results, Question Analysis, Marking Details, Review Log, Metadata);
   - `summary.json`;
   - `manifest.json` (SHA-256 of every file, result revision);
   - `candidates/<id>_marked.pdf`;
   - `reports/<id>_marking.json`.

   The workbook and ZIP are also sent as separate chat attachments. A candidate's PDF is sent on request.

## Conversational editing

Each command resolves the exam, candidate and question, validates the request, writes a new result revision with an audit event, recomputes totals, and regenerates stale files. Unchanged candidate PDFs are reused.

| Say | Effect |
|---|---|
| "status" | Real progress counts per state, or the finished package. |
| "Why did C009 lose marks on question 2?" | Criteria, feedback, lost marks, verified evidence quotes and open checks, all from stored results. |
| "Change C014's question 2 score to 4 because the method is correct" | An **examiner override**, stored next to the AI proposal (which is kept). It is range- and step-checked; a scheme conflict is recorded as a note. |
| "C014's answer to question 2 is 280, not 200" / "correct the reading on page 3 from 200 to 280" | A transcription correction on the document. The original reading is kept and the author and time are recorded. Only questions that use that element are re-marked. Ambiguous text asks which page or element. |
| "re-mark C014 question 3", "confirm C014", "confirm the marking scheme", "question 3 is worth 6 marks" | A queued re-mark, user confirmation, scheme confirmation, or a new scheme version. |
| "failed question 3", "top 10", "class statistics", "flagged items", "regenerate the workbook", "download everything", "show C014's marked paper", "pass mark 60%" | Queries computed from the stored results, or exports. |

Short references such as "the second paper" or "their" resolve against the active exam. When more than one candidate matches, Bwenge asks which.

## Marked PDFs and coordinates

The AI marks each question on the candidate's own scanned page, in red, the way a teacher would.

### On the page

- **One mark per step.**
  - A red tick goes beside a correct step and a red cross beside a wrong one. Part credit for a step is a tick with a short bar.
  - A question with several criteria gets one symbol per criterion. For example, "fraction right, decimal wrong" is a tick and a cross, then `2/4`.
  - When the teacher overrides a question's total, it shows one symbol.
- **Placement.**
  - The marks sit in the right margin, just right of the widest line of writing on that page.
  - They are level with the last line of the answer, where the answer ends, so they never cover the student's writing.
  - Marks on one page never overlap. If the margin is too narrow, the space right of the writing at that height is used.
  - If neither fits, the mark goes on the summary page only and is listed for the teacher.
- **Total.** It is circled at the top of page 1.
- **Corrections.**
  - Below a wrong answer, a short red correction from the marker (at most 80 characters, for example `7 x 5 = 35 cm2`) goes in the free space under the answer, or else in the margin under the mark.
  - It is never drawn over writing; if there is no free space, it appears on the summary page.
- **Original scan.** It is never changed. Its pages are copied into a new PDF; script and launch actions are stripped.
- **Draft and released copies.**
  - Until the teacher releases a script, its PDF carries "DRAFT – for teacher review, not released" and an orange `?` beside marks that need a check.
  - The released copy has neither.

### Layout and coordinates

- `server/services/exams/layout.ts` computes every item's position as fractions of the page as displayed (0–1, top-left origin). The PDF (`annotate.ts`) and the review screen draw from the same layout, so what the teacher moves is what gets printed.
- Recognition regions (0–1000 on the deskewed processed image) are converted with `processedToViewed`.
- `viewedToPdf` honours the PDF crop box and `/Rotate`. The tests render real PDFs at 0°, 90°, 180° and 270° with an offset crop box, and rotate images by 4° and −7.5°.

## Why a candidate lost marks: the saved record

For every question mark, the result stores:
- the answer as the AI read it (`answerAsRead`);
- for each criterion, the scheme line it was judged against (`rubric`), the marks and the reason;
- the short correction;
- a confidence (`high`, `medium` or `low`).

**How confidence is set.** It starts from the marker's own estimate. It is then capped:
- at 40% by a serious review flag;
- at 70% by any other flag;
- at 50% when marks have no quote that matches the script.

The basis is stored with the score.

**"Why did C014 lose marks on question 4?"** The chat answers by reading this record back, criterion by criterion. It never asks the model for a new explanation.

## Teacher review and release

Placement depends on finding where each answer ends, and handwriting varies, so some marks will land in the wrong place. Before release the teacher opens the review screen at `/exams/<examId>/review`. The chat links to it when the package is ready, and `/exams` lists all exams.

The screen shows:
- each page of the candidate's own scan with the red items exactly where the PDF puts them;
- a card per question from the saved record: the answer as read, a tick or cross per rubric line with its reason, the correction, the confidence and any open checks.

The teacher can:
- drag any mark, correction or the total, or select it and nudge it with the arrow keys (Shift for bigger steps);
- reset an item to its automatic position, hide or restore a correction, or place a mark that could not be located;
- change a question's mark with − / +. A reason is required, and the change is stored as an examiner override next to the AI's proposal;
- release this candidate, or all fully marked candidates.

**Release rules:**
- Releasing confirms every mark as the teacher's and regenerates the PDF without the draft label.
- A script with an unmarked question cannot be released.
- Any later change to marks or positions makes the script a draft again ("Changed since release") until it is released again.

**Storage and audit:**
- Positions are stored per candidate as `layout` overrides (page and fractions, who and when).
- The release is stored as `released`.
- Both are written to the audit log (`layout`, `release`).

## API (`/api/exams`, behind `requireAuth`, owner-scoped, `requestId` in every response)

`POST /` · `GET /:examId` · `POST /:examId/rubric` (JSON `{scheme, confirm?}` or multipart `scheme`/`questionPaper` → 202) · `GET /:examId/rubric` · `POST /:examId/rubric/confirm` · `POST /:examId/submissions` (multipart `scripts`, optional `manifest` file or `mapping` JSON) · `POST /:examId/mark` (202) · `GET /:examId/jobs/:jobId` · `GET /:examId/results` · `GET /:examId/submissions/:submissionId` (id or candidate id) · `PATCH /:examId/submissions/:submissionId/marks/:questionId` · `POST /:examId/submissions/:submissionId/corrections` (202 when re-marking) · `POST /:examId/exports` · `GET /:examId/artifacts` (with `stale`) · `GET /` (the user's exams) · `GET /:examId/review` · `GET /:examId/review/:submissionId` (pages, layout, saved record) · `GET /:examId/submissions/:submissionId/pages/:page` (the displayed page as JPEG) · `PUT /:examId/submissions/:submissionId/layout/:itemId` (`{page, fx, fy}`, `{hidden: true}` or `{reset: true}`) · `POST /:examId/release` (`{submissionIds}` or `{all: true}`).

Other users' exams answer 404. Signed download URLs expire after 1 hour (`FileStore`).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `AI_AGENT_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` | – | Needed: recognition needs a vision model; scheme extraction and marking use the agent model (`claude-haiku-5-5`). |
| `EXAMS_DIR` | `./data/exams` | Exam records and chat context (durable volume). |
| `EXAM_CANDIDATE_CONCURRENCY` | 2 | Scripts processed in parallel per batch. |
| `EXAM_MAX_CANDIDATES` | 100 | Per exam. |
| `EXAM_SEGMENT_BUDGET_MS` | 480000 | Hand over to a continuation job before the 10-minute queue deadline. |
| `EXAM_CHAT_WAIT_MS` | 45000 | How long a chat turn waits for a quick job (export, re-mark) before replying "still working". |
| `EXAM_MAX_FILES_PER_UPLOAD` | 30 | REST upload limit; each file ≤ 20 MB. |
| `FILE_STORE_MAX_BYTES` | 25 MB | Raise for large ZIP packages. If the ZIP is too large, the workbook, report and PDFs are still delivered separately. |
| `DOC_MAX_PAGES` | 20 | Pages per script. |

Retention: exam records, originals and artifacts are kept for 30 days, the same as documents.

## Why not Prisma

The exam's documents, the job queue and the assessments already persist through `OwnedRecordStore` and `FileStore`. Splitting one exam across Postgres and those stores would break atomic updates and owner scoping in one place. The test environment also has no Postgres. Records are written atomically (temporary file plus rename), and updates to one exam are serialised in process. Moving to Prisma would mean adding models for exam, scheme version, submission, result, revision and artifact; the record shapes in `types.ts` map directly onto them.

## Tests

`tests/exam_marking.test.ts` (12) and `/api/exams` cases in `tests/education_routes.test.ts`. They cover:
- **Unit:** scheme validation and keys; question matching; criterion validation and evidence checks; totals, statuses and statistics; deskew and PDF coordinates, checked by rendering; report escaping and filters, run in jsdom; workbook formula-injection guard; chat command parsing; candidate ids and manifests.
- **End to end with a scripted model:**
  - a batch with a duplicate, a damaged file and an unsupported file rejected;
  - one refused script isolated from the rest;
  - ZIP contents and manifest, workbook totals equal to the stored results, and PDF metadata and rotation;
  - overrides, the transcription correction that re-marks only the affected question, and stale-export regeneration;
  - the recognition cache, no duplicate scoring when a segment re-runs, and cross-user isolation;
  - the chat conversation from start to download, and ambiguous scheme files.

All of this is synthetic: printed pages and a scripted model.

## Limitations

- **Accuracy is unmeasured.** There are no real, human-marked scripts in the repository, so agreement with examiners (exact agreement, mean absolute error, how many wrong marks escape review) is unknown. Run a controlled evaluation on properly authorised, human-marked scripts before relying on the marks.
- **Question matching uses labels.** Unlabelled answers rely on the marker model's evidence, and are flagged when that evidence is outside the labelled answer.
- **Optional-question rules are not supported.** "Answer any three of five" is rejected with an explanation.
- **Arithmetic only.** Mathematical equivalence is judged by the model; no CAS is involved.
- **Single process.** The queue persists to disk but runs in one process. A chat turn waits for quick jobs only; batch progress is reported when the teacher asks.
- **No Telegram exam flow.** Telegram keeps its existing `/transcribe` document flow.
