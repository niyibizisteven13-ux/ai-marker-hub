# AI reliability, model routing and NISR data: backend contract and runbook

Scope: backend only. No frontend files are changed. Every API change only adds fields.

## 1. Why users saw "try again" / "high demand" errors

**Found in the code (proven by tests in `tests/ai_reliability.test.ts`):**

1. **In-stream gateway errors were never retried.** A gateway can answer HTTP 200 and then send `{"error":{"message":"…high demand…"}}` inside the stream with no numeric status. The old `isRetryable` only looked at the HTTP status, so such an error failed immediately. A busy gateway could therefore fail even a one-word prompt on the first try.
2. **The upstream reason was thrown away.** Non-2xx bodies were never read and `Retry-After` was ignored. Logs could not separate "busy" from "bad request", and retries could not respect the gateway's requested wait.
3. **Retries were stacked (introduced in commit 7beafae).** `ReliableGonkaAdapter` (3 retries, waits up to 30 s, at least 5 s on 429) sat inside `AgentRuntime` (3 more retries). That allowed up to 16 upstream attempts per message, well past the 60 s window, which overloads a busy gateway further. It also retried after partial output (risking duplicated text) and dropped the timeout details the chat error code depends on.
4. **Commit 7beafae left the server unable to start.** `AiService.ts` had a duplicated block and `deterministicTools.ts` contained invalid characters. Both were syntax errors.

**Still hypotheses (need production logs to confirm):** how often Gonka actually returns busy/429, and whether the reverse proxy times out before the app. The new `provider_*` logs and `/api/admin/ai/provider-metrics` exist to answer these questions. Nothing in this change proves the 60-second problem is fixed in production.

## 2. Request flow

```
POST /api/ai/chat ─► request-id middleware (X-Request-Id)
  └► AiService.streamGonkaChat
       ├► TaskRouter.route(prompt)  → taskClass, reasonCode, model, fallbackModel, maxOutputTokens   [logged: "AI routing"]
       └► bwengeAgent.run(model, fallbackModel, requestId)
            └► AgentRuntime (retries only a stream that broke after partial output; emits turn_reset)
                 └► ReliableProviderAdapter (the single retry policy)
                      └► OpenAICompatibleAdapter → GonkaRouter
```

`ReliableProviderAdapter` (`server/services/ai/providers/reliableAdapter.ts`):

- **Retries only transient failures:** 429, 500/502/503/504, timeouts, connection errors, and "busy/high demand" messages. It never retries 400/401/403/404 or malformed responses.
- **Retries only before any output reached the caller.**
- **Backoff** is exponential with jitter, `AI_INITIAL_BACKOFF_MS` up to `AI_MAX_BACKOFF_MS`, and never shorter than `Retry-After`.
- **Total deadline:** no attempt starts after `AI_TOTAL_DEADLINE_MS` (default 45 s). It aborts at once when the client disconnects.
- **Per-model circuit breaker:** after `AI_BREAKER_THRESHOLD` consecutive transient failures the model is skipped for `AI_BREAKER_COOLDOWN_MS`, then one trial request is allowed.
- **Fallback:** only to an explicitly configured `GONKA_FALLBACK_MODEL`, only after transient or model-unavailable failures, and only for SIMPLE/STANDARD/DETERMINISTIC work without images (unless `GONKA_FALLBACK_SUPPORTS_VISION=true`). It is logged as `provider_fallback` and counted in metrics.
- **Final error** keeps `status`/`timeout`/`timeoutKind` and is marked `exhausted`, so no outer layer retries it again.

### Error categories

`PROVIDER_BUSY`, `RATE_LIMITED`, `PROVIDER_TIMEOUT`, `NETWORK_ERROR`, `INVALID_REQUEST`, `AUTH_FAILURE`, `MODEL_UNAVAILABLE`, `INTERNAL_ERROR` (see `normalizeError` in `providers/types.ts`). Provider details stay in logs as `upstreamMessage`, redacted and truncated to 200 characters. They never appear in responses.

### Chat SSE `error` event (fields added, existing fields unchanged)

```json
{ "code": "AI_UPSTREAM_FAILED", "message": "Bwenge is handling a lot of requests right now. Please try again in a moment.",
  "category": "PROVIDER_BUSY", "retryable": true, "requestId": "2b3476d0-…" }
```

`code` keeps its previous values (`AI_UPSTREAM_TIMEOUT`, `AI_UPSTREAM_AUTH_FAILED`, `AI_UPSTREAM_FAILED`, `AI_UNAVAILABLE`, `CONTEXT_RETRIEVAL_FAILED`). Every API response now carries an `X-Request-Id` header. A client may send its own `X-Request-Id` (8–64 chars of `[A-Za-z0-9_-]`).

## 3. Model routing

| Class | Chosen when (`reasonCode`) | Model env | Fallback |
|---|---|---|---|
| SIMPLE | greetings, short "what is/define/translate" (`GREETING_OR_SHORT_QA`) | `GONKA_ECONOMICAL_MODEL` | `GONKA_FALLBACK_MODEL`, else `GONKA_MODEL` |
| STANDARD | default, or attached files (`DEFAULT`, `ATTACHED_FILES`) | `GONKA_MODEL` | `GONKA_FALLBACK_MODEL` if set |
| DETERMINISTIC | calculate/average/median/percent change… (`DETERMINISTIC_CALCULATION`) | `GONKA_MODEL` | `GONKA_FALLBACK_MODEL` if set |
| COMPLEX | >1500 chars, compare/synthesize/analyze report (`LONG_OR_MULTI_SOURCE`) | `GONKA_PREMIUM_MODEL` | **never** |
| ARTIFACT_SPEC | chart/graph/diagram/quiz/flashcards (`ARTIFACT_SPECIFICATION`) | `GONKA_PREMIUM_MODEL` | **never** |

Any class model left unset uses `GONKA_MODEL`. With only `GONKA_MODEL` set, behaviour is the same as before routing existed. Invalid model ids in env are ignored. `AI_MODEL_ROUTING=off` disables classification. Per-class output caps (`AI_MAX_OUTPUT_TOKENS_{SIMPLE,STANDARD,COMPLEX}`) apply when the caller does not set its own limit. Routing currently applies to the web chat path (`streamGonkaChat`); other `bwengeAgent.run` callers use `GONKA_MODEL`.

`BudgetManager` (concurrency caps, monthly token quota from `AiTrace`, cost estimates from `AI_MODEL_PRICING_JSON`) is implemented and tested but **not enforced on any route yet**.

## 4. NISR data

The folder convention, manifest fields, table mapping, approval seam and update workflow are in [`data/nisr/README.md`](../data/nisr/README.md).

- Build or validate: `npm run nisr:index` (idempotent; `--force`, `--write-checksums`) and `npm run nisr:validate`.
- Chat: `search_knowledge` consults the NISR index only when the question looks statistical (`isStatisticsQuery`). Hits carry title, organization, reference period, source URL and source file/row, and are passed to the model as untrusted data.

### Endpoints

All responses include `requestId`.

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/datasets/nisr/datasets` | user | Indexed datasets with source metadata and index version |
| `GET /api/datasets/nisr/search?q=…&limit=8` | user | Ranked records/passages with citations; `warnings` when nothing matches |
| `POST /api/datasets/nisr/query` | user | Deterministic filter + statistics + artifacts (below) |
| `GET /api/admin/datasets/nisr/status` | admin | Manifest problems, index version, per-dataset ingestion status |
| `POST /api/admin/datasets/nisr/reindex` `{ "force": false }` | admin | Rebuild; audit-logged (`NISR_REINDEX`); 409 while one is running |
| `GET /api/admin/ai/provider-metrics` | admin | Per-model calls, success rate, errors by category, retries, fallbacks, p50/p95/p99 latency, breaker state |

`POST /api/datasets/nisr/query` request (strict; unknown fields → 400 `INVALID_REQUEST`; needs `datasetId` or `indicator`; matching is case- and accent-insensitive, exact):

```json
{ "indicator": "Unemployment rate", "geography": "Gasabo", "period": "2023", "datasetId": "lfs-2023", "chartType": "line", "limit": 500 }
```

Response:

```json
{
  "records": [{ "datasetId": "…", "row": 4, "indicator": "…", "geography": "Gasabo", "period": "2021", "value": null, "missing": true, "unit": "%", "dimensions": {} }],
  "stats": { "count": 3, "sum": 60, "mean": 20, "median": 20, "min": 10, "max": 30, "missingCount": 1 },
  "units": ["%"],
  "change": { "from": "2019", "to": "2022", "fromValue": 10, "toValue": 30, "absolute": 20, "percent": 200, "formula": "(30 - 10) / |10| × 100" },
  "artifacts": [
    { "type": "table", "schemaVersion": "1", "title": "…", "columns": [...], "rows": [...], "source": {...} },
    { "type": "chart", "schemaVersion": "1", "chartType": "line", "title": "…", "xKey": "period",
      "series": [{ "dataKey": "value", "label": "…" }], "data": [{ "period": "2019", "value": 10 }], "unit": "%",
      "source": { "organization": "…", "dataset": "…", "period": "…", "reference": "https://…" } }
  ],
  "sources": [{ "datasetId": "…", "title": "…", "organization": "…", "referencePeriod": "…", "sourceUrl": "…", "source": "data/nisr/raw/…" }],
  "warnings": ["1 record(s) have no value in the source and were excluded from calculations."],
  "truncated": false,
  "requestId": "…"
}
```

`stats` is `null` across mixed units, indicators or datasets. A chart is produced only when it is meaningful: one indicator and unit, one value per x position. Every artifact passes `validateArtifact` (`server/services/ai/artifacts/artifactSchema.ts`). The validator uses a strict JSON schema with no extra properties (so no HTML or code fields), checks that keys exist in the data, accepts only finite numbers or null, and requires non-negative pie/histogram values. Use the same validator for any model-generated artifact before returning it.

## 5. Configuration

New variables are listed with safe defaults in `.env.example`. None of them is required: with none set, the server runs as before. The only differences are the new reliability policy and the additional fields/endpoints.

## 6. Deploying and rolling back

1. Deploy as usual. No database migration is needed.
2. Run `npm run nisr:index` on the host once datasets are added. The index lives in `data/nisr/index/`, which is git-ignored. Put it on durable storage or rebuild it on each deploy.
3. Check `GET /api/admin/ai/provider-metrics` and the `[AI provider]` / `[AI routing]` log lines.

Rollback options:

- Unset the class-specific model env vars, or set `AI_MODEL_ROUTING=off`. This removes routing with a restart and no code change.
- Set `AI_MAX_ATTEMPTS=1` to disable adapter retries.
- Revert the commit for a full rollback. The data and manifest are inert without the code.

## 7. Runbook

| Symptom | Check | Action |
|---|---|---|
| Many `PROVIDER_BUSY`/`RATE_LIMITED` | provider-metrics `errorsByCategory`, `breakerOpens` | Configure `GONKA_FALLBACK_MODEL`; reduce traffic; contact the gateway |
| `MODEL_UNAVAILABLE` | `upstreamMessage` in `provider_attempt_failed` logs | Fix the model id in env (`GONKA_*_MODEL`) |
| `AUTH_FAILURE` | logs | Rotate `GONKA_API_KEY` |
| Requests near 60 s | p95/p99 latency, `timeToFirstChunkMs` | Lower `AI_TOTAL_DEADLINE_MS`; check proxy timeout |
| NISR dataset `failed` | `/api/admin/datasets/nisr/status` | Checksum mismatch → confirm the file, then `--write-checksums` after clearing the old checksum; column errors → fix `table` mapping |
| Cost spike | `[UsageAccounting]` logs, `AiTrace` | Lower `AI_MAX_OUTPUT_TOKENS_*`; unset `GONKA_PREMIUM_MODEL` |

## 8. Known limitations

- Metrics are in-memory per process. They reset on restart and are not aggregated across instances.
- NISR search is keyword-based (the existing `rankKnowledgeChunks`, with accent folding and English/French/Kinyarwanda stop words). It runs over all records per query, which suits thousands of rows; large datasets will need a persisted inverted index or the existing embedding KB. No embeddings are used for NISR yet.
- PDFs must be converted to text or tables before ingestion. The pipeline does not OCR.
- Phase 3 is not wired. `FileJobQueue` and `DocumentPipeline` from commit 7beafae are not used by any route. The existing `/api/batch/:jobId` flow is unchanged.
- Quotas and concurrency caps (`BudgetManager`) are not enforced yet.
