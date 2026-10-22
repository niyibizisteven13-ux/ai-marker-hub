# Statistics, HTML reports, rubric assessment and Claude agent tasks: backend

Backend only. No frontend files or frontend dependencies changed, and no new npm dependencies were added. Every API change only adds new endpoints or new fields.

## 1. Repository audit, and the design decisions it led to

| Finding | Decision |
|---|---|
| `python_service/` (FastAPI) is **not deployed**. PM2 runs only `dist/server.js`, nothing starts uvicorn, nothing in Node calls it, and it has no scipy. | The statistics engine is TypeScript in the Node backend (`server/services/analytics/`). Putting it in Python would mean deploying and operating a second service. All numerics are tested against R/NumPy/pandas reference values. Moving it to the Python service later would be a straight port if that service is deployed. |
| `ai/drawing/chart.ts` already renders Vega-Lite to SVG on the server with external data blocked; `svgSanitizer.ts` is a strict allow-list. | Charts reuse both. Reports contain static, sanitized SVG with no JavaScript, so they render under the strict CSP. |
| `FileStore` + `/api/files` already provide owner-scoped, expiring artifacts with signed URLs, served as attachments under `default-src 'none'; sandbox`. | Datasets, submissions and HTML reports are stored there. No new file route was added. |
| `fileJobQueue.ts` (added in 7beafae) was unused. The grading `QueueService` is grading-specific. | `fileJobQueue.ts` is extended into the durable job queue: persisted, idempotent, owner-scoped, with retry, deadline and restart recovery. |
| `GradingService` grades exam questions one by one, and its Claude path names a retired model ID (`claude-3-5-haiku-20241022`). | Criterion-level rubric assessment is a new module, `server/services/assessment/`. Exam grading is unchanged. |
| `AgentRuntime` + `ProviderAdapter` already run the tool loop for any OpenAI-compatible gateway. | Claude is added as a `ProviderAdapter` (`AnthropicAdapter`, official `@anthropic-ai/sdk`), so the same loop, tools, reliability layer and metrics apply. |
| Existing bug, not fixed here: `/api/files` session reads use `req.user.id`, but the JWT payload carries `userId`. | Unsigned (session) downloads look like they always return 401. New endpoints return **signed** URLs, which work. Worth a separate fix. |

## 2. Provider routing

| Traffic | Provider |
|---|---|
| Everyday chat (`streamGonkaChat`) | Gonka. Optional big-task provider for COMPLEX/ARTIFACT requests, as before. |
| Agent tasks: tool loops (`runGonkaAgentLoop`, web and Telegram), rubric assessment, AI report interpretation | **Claude** (`CLAUDE_AGENT_MODEL`, default `claude-haiku-5-5`) when `AI_AGENT_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` are set; otherwise Gonka's standard model. |
| Calculations, chart data, totals, quote checks, rubric checks | Deterministic code. The model is never trusted for these. |

How the Claude adapter (`providers/anthropicAdapter.ts`) behaves:

- **Sampling and effort:** it never sends `temperature`/`top_p`/`top_k`, which current Claude models reject. Effort is set with `CLAUDE_EFFORT`.
- **Prompt caching:** the stable prefix is cached automatically (`cache_control: ephemeral`).
- **Thinking and tool blocks:** they are replayed unchanged within a tool loop, via `ChatMessage.providerState`. This metadata is stripped before any request goes to Gonka.
- **Structured output:** structured tasks use `output_config.format` (JSON schema), and the result is validated again in code.
- **Retries:** SDK retries are off; `ReliableProviderAdapter` is the single retry/fallback policy.
- **Fallback:** transient Claude errors fall back to Gonka (`CLAUDE_FALLBACK_TO_GONKA`).
- **Refusals:** a `refusal` stop is final. It becomes `CONTENT_REFUSED`, with no retry and no fallback.
- **Truncated tool calls:** a tool call cut off by `max_tokens` is never executed.

**Before production:** check that the Anthropic account has access to `claude-haiku-5-5` and billing set up, then set the price in `AI_MODEL_PRICING_JSON` for cost estimates. No live Claude call was made while building this; all tests use a fake SDK client.

## 3. Statistics engine (`server/services/analytics/`)

- **Loading** (`dataset.ts`): CSV/TSV (delimiter detected), XLSX, and JSON (an array of row objects). Limits are 20 MB, 200k rows and 200 columns. Going over a limit is an error, never silent truncation. The file extension decides the format.
- **Column typing:** numeric, categorical, boolean, datetime or text, plus hints (identifier-like, binary, year, percent). Values like `1,234`, `12.5%` and `(3.2)` are parsed. Missing markers are configurable (`missingValues`). Any other text in a numeric column counts as *invalid* and is reported.
- **Missing values are never zero.**
- **Quality report:** missingness per column, exact duplicate rows, invalid values, constant or empty columns, ragged rows, and renamed headers.
- **Statistics** (`statistics.ts`):
  - **Descriptive:** n, missing, mean, median, mode(s), min/max/range, sample variance/SD, quartiles and percentiles (R type 7), IQR, CV (only on a ratio scale), adjusted skewness G1, excess kurtosis G2, SE, and a t-based 95% CI.
  - **Weighted:** weighted mean/SD, with a warning that design-based SEs are not computed.
  - **Tables:** frequency tables; cross-tabs with Pearson χ², Cramér's V and a low-expected-count warning.
  - **Correlation:** Pearson (t-test p-value, Fisher-z CI) and Spearman, both with a causation warning.
  - **Regression:** OLS (SE, t, p, CI, R², adjusted R², F), which refuses collinear or underdetermined input.
  - **Tests:** one-sample and Welch t-tests (with Cohen's d).
  - **Outliers:** Tukey fences.
  - **Time series:** period changes, which are undefined from a zero or missing base; CAGR only for positive endpoints; linear trend.
- **Orchestration** (`analyze.ts`): every result carries its method and notes.
- **Reproducibility:** the output records the input sha256, engine version, filters and transformations. Identical input gives identical output.

## 4. Charts and HTML reports

- **Charts** (`charts.ts`): the type follows the data. Distributions get a histogram (Freedman–Diaconis bins) and a box plot (drawn from our own quartiles). Categories get a bar chart; two categoricals get a grouped bar and a heatmap. Correlations get a heatmap, regression a scatter with fitted line, and time a line chart. Every chart has a title, axis titles, caption, alt text, provenance and its data table. Charts whose data has no spread are skipped.
- **Not implemented:** 3D and geographic charts. No 3D is invented when the data is 2D, and no reliable geo support exists yet.
- **Reports** (`htmlReport.ts`, `reportBuilder.ts`):
  - **Contents:** summary, research question, data, methods and preparation, data quality, results, limitations, conclusion and recommendations, sources, and reproducibility.
  - **Labels:** every sentence is labelled *Source value*, *Calculated* or *Interpretation*.
  - **Escaping:** all text is HTML-escaped and SVG is sanitized.
  - **No active content:** there are no scripts or external resources, and a CSP meta tag is set.
- **Validation before storing** (`validateHtmlArtifact`): the report must have no scripts, event-handler attributes, script URLs (including entity-encoded ones), external resources, server paths or credential-like strings, and must be at most 8 MB.
- **Optional AI interpretation** (`narrative.ts`): the model sees only the calculated findings. If its text contains any number not present in those findings, it is discarded and the deterministic text is kept.

## 5. Rubric assessment (`server/services/assessment/`)

1. **Rubric:** given as JSON or plain text (`Criterion (10 marks): …`, indented levels `- Good (6-8): …`, plus a required `Total: N marks` line). Unparsed lines are returned, not guessed.
2. **Rubric validation:** criterion maxima must sum to the total, and weights must sum to 100% and match the maxima. Level ranges must lie within each criterion. Half-mark rules are checked. Inconsistencies are **errors**, and the rubric is never adjusted.
3. **Submission:** given as text or a TXT/DOCX/text-based PDF upload (using the existing `extractText`). It is split into paragraphs P1… with page numbers, and sent inside `<submission>` delimiters as untrusted data.
4. **Model proposal:** one structured call (`generateStructured`, with schema plus one repair attempt) proposes a mark, level, evidence quotes, rationale, missing requirements, errors, improvements and confidence for each criterion.
5. **Checks in code:**
   - **Marks:** a mark outside its range, or not a valid 0.5/1 step, is flagged and **not used**.
   - **Levels:** level and mark must agree.
   - **Evidence:** every quote must be found in the submission, or it is flagged `NOT FOUND`. Marks given without verified evidence are flagged.
   - **Totals:** totals are summed in code. There is no total while any criterion is unmarked.
   - **Human review:** low confidence or high stakes means human review.
6. **Status:** an assessment stays `proposed` until an instructor reviews the flagged criteria (`/reviews`) and confirms (`/confirm`). The report shows AI-proposed, instructor and final marks side by side, plus the review log.
7. **Data minimisation:** the submission text is deleted after assessment. The record keeps quotes and a sha256 of the text.

## 6. API contracts

All routes require auth (`requireAuth`) and are scoped to the signed-in user. Another user's resources return **404**. Every response includes `requestId`. Errors use the shape `{ code, error, requestId }`.

| Method & path | Purpose | Success |
|---|---|---|
| `POST /api/analytics/datasets` (multipart `file`) | Validate and store a dataset (7-day TTL); returns profile, quality, preview | 201 |
| `GET /api/analytics/datasets/:id` | Profile again | 200 |
| `POST /api/analytics/datasets/:id/analyze` | Synchronous analysis (≤ 50k rows) → `{ analysis, charts }` (Vega-Lite specs + data tables) | 200 / 413 `USE_REPORT_JOB` |
| `POST /api/analytics/datasets/:id/reports` | HTML report job. Optional `Idempotency-Key` header; the same request returns the same job | 202 / 200 duplicate |
| `POST /api/assessment/rubrics/validate` | `{ rubric }` or `{ rubricText }` → parsed rubric, errors, warnings, unparsed lines | 200 / 422 |
| `POST /api/assessment/assessments` | JSON or multipart (`submission` file). Fields: `rubric`/`rubricText`, `submissionText`, `modelAnswer`, `courseMaterial`, `highStakes`, `studentLabel` | 202 / 422 |
| `GET /api/assessment/assessments/:id` | Record + `final` (applied reviews) + fresh signed report URL | 200 |
| `POST /api/assessment/assessments/:id/reviews` | `{ criterionId, marks, comment? }` instructor mark (range and step checked) | 200 / 422 |
| `POST /api/assessment/assessments/:id/confirm` | `{ confirmed: true }`. Refused while flagged criteria are unreviewed | 200 / 422 |
| `GET /api/jobs/:id` | `queued` → `processing` (stage, %) → `completed` / `failed` / `cancelled` | 200 |
| `GET /api/jobs/:id/result` | Result + artifact `{ fileId, name, mime, bytes, url (signed), expiresAt }` | 200 / 409 `NOT_READY` |
| `DELETE /api/jobs/:id` | Cancel | 200 |

Example analysis request:
```json
{ "analyses": [
    { "type": "describe", "columns": ["score"], "groupBy": "district" },
    { "type": "crosstab", "row": "district", "column": "gender" },
    { "type": "correlation", "columns": ["score", "hours"], "method": "spearman" },
    { "type": "regression", "y": "score", "x": ["hours"] },
    { "type": "ttest", "column": "score", "groupBy": "gender" },
    { "type": "outliers", "column": "score" },
    { "type": "timeseries", "time": "year", "value": "score", "groupBy": "district" } ],
  "filters": [{ "column": "year", "op": "gte", "value": 2020 }],
  "missingValues": ["-99"] }
```

Example report request: `{ "title": "Scores by district", "researchQuestion": "…", "analysis": { … }, "interpretation": "ai", "language": "Kinyarwanda", "citations": [{ "title": "…", "url": "https://…" }] }`.

## 7. Configuration, storage and operations

New variables are listed with safe defaults in `.env.example`: `AI_AGENT_PROVIDER`, `ANTHROPIC_API_KEY`, `CLAUDE_AGENT_MODEL`, `CLAUDE_EFFORT`, `CLAUDE_FALLBACK_TO_GONKA`, `CLAUDE_REQUEST_TIMEOUT_MS`, `JOBS_DIR`, `JOBS_CONCURRENCY`, `JOBS_MAX_ACTIVE_PER_USER`, `ASSESSMENTS_DIR`.

**Storage:**
- **Location:** `FILE_STORE_DIR` (datasets, submissions, reports), `JOBS_DIR` and `ASSESSMENTS_DIR` must be on durable storage. They are git-ignored.
- **Retention:** datasets 7 days, submissions 2 days (deleted after assessment), reports 7 days (assessment reports 30), jobs 7 days, assessment records 90 days.
- **Cleanup:** an hourly sweep removes expired items.

**Jobs:**
- **Where they run:** jobs run inside the Node process, which suits the current single-instance PM2 setup. With several instances, run the queue in one worker or move it to Redis (`bullmq` is already a dependency).
- **After a restart:** jobs that were running are re-queued, or failed with `WORKER_RESTARTED` once their attempts are used up. Graceful shutdown stops the queue.
- **Limits:** each user may have at most 5 active jobs, each attempt has a 10-minute deadline, and only retryable failures are retried, at most twice.

**Migrations:** none. Nothing new in the database.

**Rollback:** set `AI_AGENT_PROVIDER=gonka` (Claude off) and restart, or revert the commit. The data directories are inert without the code.

**Monitoring:** watch the `[jobs]`, `[AI provider]` and `[AI routing]` log lines and `GET /api/admin/ai/provider-metrics`, which includes Claude when it is enabled.

## 8. Test results

| Command | Result |
|---|---|
| `NODE_ENV=test node --test --import tsx tests/*.test.ts` | 198 tests: **188 pass, 10 fail**. The 10 failures are the same set that failed before this work (unrelated modules). |
| New tests (`stats_engine`, `analytics_artifacts`, `assessment`, `anthropic_adapter`, `job_queue`, `education_routes`) | 52 / 52 pass |
| `npx tsc --noEmit` | Error list identical to the pre-existing baseline (29, all outside this work) |
| `npm run build` | passes |
| `npm run security:check` | passes |
| Server boot | starts; new routes return 401 without auth; routing decisions are logged |

The tests cover:
- **Statistics:** calculations against R/NumPy/pandas reference values.
- **Data handling:** malformed, empty, oversized and ragged files.
- **Artifacts:** HTML injection through titles, category labels and citations; the validator, including entity-encoded `javascript:`; chart validation; and rejection of AI narrative that adds numbers.
- **Assessment:** rubric parsing and validation, quote verification, out-of-range and level-mismatch marks, totals, and review/confirm.
- **Claude adapter:** message conversion, thinking-block replay, absence of sampling params, refusal with no fallback, `max_tokens`-truncated tool calls, error mapping, and fallback to Gonka.
- **Jobs:** idempotency, owner isolation, retries, deadlines (including handlers that ignore cancellation), restart recovery and expiry.
- **HTTP:** an end-to-end report download through signed URLs, a tampered signature (403), and cross-user 404s.

Bugs found and fixed by these tests:
- **Silent row truncation:** files over the row limit were truncated instead of rejected.
- **MIME override:** the MIME type overrode the file extension.
- **Hung jobs:** a job cancelled during start-up hung until its deadline.
- **Validator false positive:** the HTML validator flagged escaped `aria-label` text as markup.

## 9. Known limitations and next steps

1. **No live Claude call yet.** Run one supervised assessment and one AI-interpreted report against the real API before enabling for users.
2. **Not implemented:**
   - **3D charts:** for example Plotly; this adds a script dependency and needs a CSP decision.
   - **Geographic charts:** these need vetted boundary data.
   - **Statistics from PDFs:** PDF tables must be extracted first.
   - **Survey design:** strata and clusters are not modelled.
3. **Agent tools:** the agent cannot yet call the statistics engine as a tool. Next step: add `analyze_dataset` / `create_report` tools to `buildToolkit`, so chat questions about uploaded data use these deterministic paths.
4. **Forms:** form/survey analysis currently means uploading the responses as a dataset (frequencies, cross-tabs, missingness). Form-schema extraction and open-ended answer summaries are not built.
5. **Personalised learning:** preferences (language, level, pace) are not built. They should reuse the existing user settings and memory privacy controls.
6. **Quotas:** per-user token quotas (`BudgetManager`) are still not enforced on routes. The job cap and the existing rate limiter apply.
7. **Single-process queue:** see §7.
