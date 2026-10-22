# Universal output and artifact engine

Backend only. Code: `server/services/outputs/`, `python_service/analysis/engine.py`, `server/routes/outputRoutes.ts`,
agent tools in `server/services/ai/tools/outputTools.ts`. There are no frontend changes. Artifacts reach users
through the existing chat attachments (`AttachmentRef`) and download links.

## How a request becomes an output

1. **Plan** (`planner.ts`). This step is rule-based and deterministic. It chooses the smallest output that fits:
   - prose for simple questions;
   - a computed table when numbers come from data;
   - a chart for comparisons and trends;
   - a file only when a format is named;
   - interactive HTML only for dashboards or explicit exploration;
   - a diagram or a map only when asked.

   It also decides whether computation (`analyze_data`) or retrieval (`search_knowledge`) is needed, and which proposed
   sources the user may use. In chat, the plan is added to the system prompt for that turn as a single line, and only
   when it calls for an artifact, computation or retrieval. Ordinary chat is unchanged.
2. **Spec** (`spec.ts`). Every artifact is a validated `OutputSpec` with:
   - `kind` and `title`;
   - `sources` (`[{type, id?, label, url?}]`);
   - the content.

   The spec is checked for structure (zod, strict) and then for meaning:
   - quantitative axes need a unit (or `"none"`);
   - every chart needs a `sourceNote`;
   - chart and table fields must exist in the data;
   - each format must have the content it needs.
3. **Compute** (`analysis.ts`, `pythonRunner.ts`, `engine.py`). Numbers come from the deterministic engine:
   - The model never computes them. It reads the result tables.
   - Charts and tables can reference stored results with `fromAnalysis: {artifactId, result}`, so figures are never
     retyped.
4. **Render, verify, store** (`service.ts`):
   - SVG is sanitised and made responsive, with a PNG preview.
   - HTML is self-contained and validated.
   - XLSX, DOCX, PPTX and PDF files are reopened before they are stored.
   - The artifact row records:
     - owner and organisation;
     - kind, format and status;
     - revision, root and parent;
     - the spec and its sources;
     - sha256, size and warnings.

## Output kinds

| kind | Format | Notes |
|---|---|---|
| `analysis` | JSON | Operations:<br>• `describe`, `missing`<br>• `distribution` (histogram, skewness, kurtosis, normality)<br>• `groupby`, `pivot`<br>• `correlation` (Pearson or Spearman, with p-values)<br>• `regression` (OLS: coefficients, SE, t, p, 95% CI, R², adjusted R², F, VIF, Jarque–Bera, Breusch–Pagan, Cook's distance)<br>• `outliers` (IQR, z-score, MAD)<br>• `moving_average`<br><br>Filters: `eq ne gt gte lt lte in notin isnull notnull`, with row counts before and after each filter. `units` are carried into every output. |
| `chart` | SVG + PNG preview | Chart types: bar, grouped-bar, stacked-bar, line, area, scatter, histogram, boxplot, heatmap, pie.<br>Every chart has a title, a "Source:" subtitle, axis titles with units, a bottom legend and tooltips. No fixed width, so it never overflows. |
| `widget` | HTML | • `table_explorer`: search, sort, paging, CSV download<br>• `chart_explorer`: series toggles, plus a static SVG in `<noscript>`<br>• `kpi_cards` |
| `report` | HTML | `layout: "report" \| "dashboard"`. Contains a summary, KPIs, and sections (text, table, chart). Includes a methods appendix built from the referenced analyses. |
| `document` | xlsx / pdf / docx / pptx | Built with the existing generators. Charts are embedded as PNG. A Sources sheet or slide is added. |
| `template` | docx / pptx / xlsx | Editable templates filled from an analysis:<br>• `statistical_report` (DOCX): Summary, Data, Method, Results, Interpretation, Assumptions, Limitations, Reproducibility<br>• `briefing_deck` (PPTX)<br>• `data_workbook` (XLSX, with a Method sheet)<br><br>Numbers in `summary` or `interpretation` that are not among the computed results are flagged as warnings. |
| `diagram` | SVG | Two inputs:<br>• Mermaid flowchart subset (`graph`/`flowchart` TD/LR; box, round, stadium, diamond and circle nodes; `-->`, `---`, `-.->`, `==>` and labelled edges)<br>• `graph` nodes and edges<br><br>`click`/`href` and other Mermaid diagram types are refused. |
| `map` | SVG | Offline:<br>• choropleth from GeoJSON polygons (quantile classes, "No data" pattern)<br>• proportional points<br><br>Boundaries must be supplied, for example a GeoJSON file in a knowledge repository. |
| `answer` | JSON | Prose plus an optional table. In chat, plain answers stay in the message. |
| `image` | PNG | Only when an image provider is wired in (not configured by default). Returns `IMAGE_UNAVAILABLE`. |

### Example: analysis, then an editable report and a chart from the same numbers

```json
{ "kind": "analysis", "title": "Study time", "dataset": { "type": "file", "id": "<fileId>" },
  "analysis": { "operations": [ { "op": "regression", "y": "score", "x": ["hours"] } ],
                "units": { "score": "points", "hours": "h" } } }
```
```json
{ "kind": "template", "template": "statistical_report", "title": "Study time and scores",
  "analysisArtifactId": "<analysis id>", "summary": "…", "sources": [ { "type": "file", "id": "<fileId>", "label": "study.csv" } ] }
```
```json
{ "kind": "chart", "title": "Mean score by class", "sources": [ { "type": "artifact", "id": "<analysis id>", "label": "Computed" } ],
  "chart": { "type": "bar", "x": { "field": "class", "title": "Class", "type": "nominal" },
             "y": { "field": "score_mean", "title": "Mean score", "unit": "points" },
             "fromAnalysis": { "artifactId": "<analysis id>", "result": 0 }, "sourceNote": "School records 2025" } }
```

Dataset sources (`dataset.type`):

| Type | Where the data comes from | Access rule |
|---|---|---|
| `file` | A chat attachment or generated file in the file store | Owner-checked |
| `dataset` | `/api/analytics` datasets | Owned by the user |
| `repository_file` | Knowledge repositories | Repository access rules |
| `upload` | Legacy `FileRecord` uploads | Owned by the user |

## Agent tools (chat)

Both tools are on by default. Set `ENABLE_OUTPUT_ENGINE_TOOLS=false` to disable them.

- **`analyze_data`** runs the engine and returns:
  - the result tables, wrapped as untrusted data;
  - row counts and filters;
  - assumptions and limitations;
  - the `analysisId`.

  The model is told to report only those numbers, with units and n, and that correlation or regression shows
  association, not causation.
- **`create_output`** creates one artifact from a spec. It waits up to 90 s and attaches the file. It does not handle
  the `analysis` kind.

The capabilities prompt has a "Choosing the output" section: no forced artifacts, and at most one large output per reply
unless the user asks for several.

### How a web-chat message reaches the tools

`POST /api/ai/chat` (`server.ts`) has two paths:

| Path | Has tools | Taken when |
|---|---|---|
| Agent (`AiService.generalAssist` → `bwengeAgent`) | Yes | Either rule matches (`useToolAgent` in `server/services/outputs/chatTurn.ts`):<br>• Original rule: general intent, an Anthropic key, and `AI_PROVIDER` is not `gonkarouter`.<br>• Added rule: the planner says the message needs a file, chart or computed numbers (`plan.artifact` or `plan.needsComputation`), and an agent model is configured (Claude agent or `GONKA_API_KEY`). A provider explicitly chosen in the UI that cannot run tools (Ollama) is respected. |
| Legacy text stream | No | Everything else (unchanged). |

Before this fix, `AI_PROVIDER=gonkarouter` (the default in `.env.example`) sent every message, including "make a chart and
an Excel file", to the legacy stream. That stream has no tools, and the persona prompt asks for ```` ```artifact-json ````
blocks, so the model answered with CSV text and told the user to save it as Excel.

Inside `generalAssist`, a tool turn works like this:

1. The turn runs on the agent model: Claude (`CLAUDE_AGENT_MODEL`, default `claude-haiku-5-5`) when
   `AI_AGENT_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` are set, otherwise Gonka. Everyday chat stays on Gonka.
   `ANTHROPIC_BASE_URL` is honoured by the SDK for an Anthropic-compatible endpoint.
2. The system prompt gets the planner hint, which lists every requested deliverable (for example "a chart (SVG) and an XLSX
   file"). It also gets rules that override the older `artifact-json` persona instructions: files exist only through tool
   calls, and the model must never tell the user to rename CSV text.
3. **Delivery check** (`runDeliverableTurn`):
   - If a requested deliverable has no matching attachment, the client is told to discard the streamed text (SSE `reset`),
     and the model gets one corrective turn.
   - Anything still missing is reported as "Not created: …".
   - Download links the model wrote itself are flagged.
4. **Attachment validation.** `create_output` only reports success after the stored file is re-read and matches the
   artifact: size, sha256, MIME type and file-format check. The signed download link (`/api/files/:id`) lasts at most
   7 days; the artifact stays available at `/api/outputs/:id/download`.

Telegram uses the same `generalAssist`: retries no longer duplicate text. Telegram does not yet send generated files as
documents.

## HTTP API (`/api/outputs`, behind `requireAuth`)

All errors return `{ code, error, details?, requestId }`. Another user's artifact always answers 404.

| Method and path | Body / query | Result |
|---|---|---|
| `POST /plan` | `{ message, attachments?, sources?, hasDataset? }` | `{ plan }`. Nothing is generated. |
| `POST /` | OutputSpec | Status codes:<br>• `201`: ready<br>• `200`: identical spec reused<br>• `202`: rendering<br>• `422`: invalid or failed<br><br>Returns `{ artifact, reused }`. |
| `POST /analyze` | `{ title?, dataset, analysis }` | Shortcut for `kind: "analysis"`. |
| `GET /` | `?limit&kind` | `{ artifacts }` (own artifacts only) |
| `GET /:id` | | `{ artifact }` |
| `GET /:id/analysis` | | `{ analysis }` (computed results) |
| `GET /:id/revisions` | | Lineage, oldest first |
| `POST /:id/revisions` | full new spec | New revision n+1. Earlier revisions stay available. |
| `POST /:id/retry` | | Re-renders a failed artifact on the same row. |
| `POST /:id/share` | `{ mode: private \| organization \| link, organizationId?, expiresInHours? (≤ 2160) }` | `{ shareToken, sharePath }` for links. Only the token's sha256 is stored. |
| `GET /:id/download` | `?view=1` | Download behaviour:<br>• Attachment by default.<br>• With `view=1`, HTML, SVG, PNG, PDF and JSON are served inline.<br><br>HTML is served under a sandboxing CSP: `sandbox allow-scripts`, `connect-src 'none'`, no external resources. |
| `DELETE /:id` | | Deletes the row and its files. |
| `GET /api/outputs/shared/:token` | `?view=1`, `?meta=1` | Public, token-only. Revoked by `share {mode:"private"}`; expires. |

Artifact view fields:
- `id`, `kind`, `format`, `title`, `status` (`queued | generating | ready | failed`);
- `revision`, `rootId`, `parentId`, `owner`;
- `createdAt`, `updatedAt`, `sources`;
- `sizeBytes`, `sha256`, `warnings`, `error`;
- `share`, `jobId`, `download`.

## Reliability and security

- **Asynchronous work.** Analyses, templates, reports and documents render in the persistent job queue (`output.render`).
- **No duplicates:**
  - An identical spec from the same user returns the same artifact (sha256 idempotency key).
  - A failed artifact is retried on the same row.
  - A job that is already `ready` never renders twice.
- **Python isolation** (`pythonRunner.ts`):
  - It runs in a separate `python3 -I` subprocess, never inside the API process, in a scratch directory.
  - The environment is clean: no API keys or database URLs, and thread counts are set to 1.
  - Limits: `RLIMIT_AS`, `RLIMIT_CPU`, `RLIMIT_NOFILE` and `RLIMIT_FSIZE`.
  - Sockets are disabled inside the engine. The run is wrapped in `unshare -rn` (an empty network namespace) when the
    host allows it.
  - There is a hard SIGKILL timeout, an output-size cap and a concurrency limit.
  - The engine only runs whitelisted operations on JSON input. It never evaluates code.
- **TypeScript fallback.** It is used when Python, numpy or pandas are missing, or when
  `ANALYSIS_REQUIRE_NETWORK_NAMESPACE=true` and namespaces are not available.
  - It covers: describe, missing, Pearson and Spearman correlation, numeric regression and IQR outliers.
  - It is pure arithmetic and runs no user code.
  - Its results say which engine was used.
- **Authorisation.** Every source and every referenced analysis is checked against the requesting user, both when an
  artifact is created and when it is rendered.
- **Output safety:**
  - HTML escapes all text. Embedded JSON is escaped.
  - The validator rejects external scripts, links, frames, forms, event-handler attributes, server paths and
    credential-like strings.
  - SVG goes through the existing sanitiser.
  - Mermaid labels are stripped of markup.
- **Methodology is kept.** Each analysis records:
  - source, sha256 and retrieval time;
  - row counts before and after filters;
  - units, methodology, assumptions and limitations;
  - for example missing-value handling, small-n warnings, multicollinearity, non-normal residuals,
    heteroscedasticity and influential points.
- **E2B fix.** The `run_python` E2B path (`ExecutionSandbox`) no longer interpolates code into a shell command.
  - Code is written to a file and run with `timeout 120`.
  - The `workspace/search` pattern is shell-quoted.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ANALYSIS_PYTHON` | `python3` | Interpreter. The server needs `pip install numpy pandas` (no scipy needed). |
| `ANALYSIS_TIMEOUT_MS` | 90000 | Hard kill. |
| `ANALYSIS_MEM_MB` / `ANALYSIS_CPU_SECONDS` | 1024 / 60 | Subprocess resource limits. |
| `ANALYSIS_MAX_CONCURRENCY` | 2 | Parallel engine processes. |
| `ANALYSIS_MAX_ROWS` | 200000 | Rows per analysis. |
| `ANALYSIS_MAX_INPUT_BYTES` / `ANALYSIS_MAX_OUTPUT_BYTES` | 64 MB / 32 MB | I/O caps. Repository files are read up to `ANALYSIS_MAX_INPUT_BYTES` (50 MB in `.env.example`). |
| `ANALYSIS_REQUIRE_NETWORK_NAMESPACE` | false | When `true`, Python is not used unless `unshare -rn` works. |
| `ANALYSIS_NETWORK_NAMESPACE` | on | Set `off` to skip `unshare` (sockets stay disabled in the engine). |
| `ANALYSIS_ENGINE_PATH` | `python_service/analysis/engine.py` | Engine location. |
| `ENABLE_OUTPUT_ENGINE_TOOLS` | true | Chat tools `analyze_data` and `create_output`. |

Deployment:
- Run `prisma migrate deploy`. It applies migration `20261022000200_generated_artifacts`.
- On the server, run `pip install numpy pandas` for the system `python3`.

## Not supported (yet)

- Arbitrary user Python. Use the existing E2B `run_python` tool (`ENABLE_AGENT_PYTHON_TOOL`, needs `E2B_API_KEY`).
- Image generation. No image provider is wired into the agent services, so `image` returns `IMAGE_UNAVAILABLE`.
- Map tiles and basemaps. Maps are offline SVG from supplied coordinates or boundaries.
- Mermaid features:
  - only flowcharts are supported;
  - subgraphs are flattened and styling is ignored, both with a warning.
- Some analysis operations need the Python engine. Without numpy and pandas:
  - a request with filters is refused;
  - group-by, pivot, distributions, moving averages, z-score and MAD outliers, and categorical predictors return a
    per-result error that says the Python engine is needed;
  - regression diagnostics (VIF, Breusch–Pagan, influence) are left out, with a warning.
- Artifacts render in the default theme. Interactive HTML follows `prefers-color-scheme` and `data-theme`.
