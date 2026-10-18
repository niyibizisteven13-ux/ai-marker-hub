# AI Capability Audit

**Audit scope:** current working tree on `main` (the branch is one commit ahead of `origin/main` and has pre-existing modified and untracked files). Findings describe that working tree, not a clean checkout. No application code was changed for this audit; this document is the requested Phase 1 deliverable.

**Status note:** the findings below describe the pre-hardening audit snapshot. The remediation status and remaining deployment checks are recorded in [Hardening update](#hardening-update).

**Evidence rule:** `WORKING` means an implementation has a real execution path and does not turn a provider/tool failure into a fabricated result. `PARTIAL` means a real path exists but has material correctness, safety, isolation, integration, or coverage gaps. `STUB-MOCK` means the user-facing result is synthetic, hard-coded, or merely a prompt/metadata adapter rather than the advertised capability. `DEAD CODE` means the apparent feature is not connected to a live caller, or its advertised tool path is bypassed.

Line references below are to the audited working tree. “Tests” identifies relevant checked-in tests; a listed test is not evidence of production evaluation or of a test having passed.

## Executive summary

The repository has real AI-assisted marking, form creation/scoring, document ingestion, a streaming OpenAI-compatible adapter, a bounded agent loop, local document/chart generation, retrieval, and dataset preparation/export. These are not one consistent “Agent” product today:

- The new runtime in [`server/services/ai/`](../server/services/ai/AgentRuntime.ts) is actually configured with GonkaRouter in [`AiService.ts`](../server/services/AiService.ts), but its tools are not consistently used by the chat/provider branches. Several older routes pass Anthropic tool definitions and executors into wrapper methods that ignore those arguments.
- Only authenticated routes are generally available for private AI work, and the admin RAG/dataset console is ADMIN-only. There are no per-tool role checks or user confirmation gates. Public form retrieval/submission is intentionally unauthenticated, with only the global IP limiter in production.
- Retrieval uses persistent PostgreSQL records and Gemini-generated embeddings serialized as JSON vectors, not pgvector. The general search path does not scope results by user or organization. In addition, context hydration reads recent platform records without ownership filters. This is a significant cross-tenant privacy risk.
- “Fine-tuning” creates an inference-time prompt adapter from approved examples in the application process. It does not submit a training job to a provider or modify model weights. The endpoint nevertheless records `TRAINING`/`COMPLETED` job states and creates model-registry entries.
- Some error paths are honest and tested (notably marking/form scoring), but other paths still emit defaults such as “Key insight summarized,” fake scanner confidence/IDs, canned media/design artifacts, or fixed analytics metrics.
- The UI has chat, a marking workspace, results, and form creation, but no Agent page or capability launcher. The media artifact renderer can make mock designs/animations appear generated.

## Capability inventory

| Capability | Status | Main implementation (file:line) |
|---|---|---|
| GonkaRouter/provider adapter and chat streaming | PARTIAL | [`AiService.ts`](../server/services/AiService.ts#L87), [`openaiCompatible.ts`](../server/services/ai/providers/openaiCompatible.ts#L1), [`server.ts`](../server.ts#L759) |
| AgentRuntime loop and tool argument validation | PARTIAL | [`AgentRuntime.ts`](../server/services/ai/AgentRuntime.ts#L1), [`registry.ts`](../server/services/ai/tools/registry.ts#L1), [`createAiAgent.ts`](../server/services/ai/createAiAgent.ts#L1) |
| Registered AgentRuntime tools (file, drawing, data) | PARTIAL | [`tools/index.ts`](../server/services/ai/tools/index.ts#L1), [`fileTools.ts`](../server/services/ai/tools/fileTools.ts#L1), [`drawingTools.ts`](../server/services/ai/tools/drawingTools.ts#L1), [`dataTools.ts`](../server/services/ai/tools/dataTools.ts#L1) |
| Legacy Anthropic tools / sandbox build agent | DEAD CODE (tool path) | [`generalTools.ts`](../server/services/generalTools.ts#L1), [`agentTools.ts`](../server/services/agentTools.ts#L1), [`executeAgentTool.ts`](../server/services/executeAgentTool.ts#L1), [`agentRoutes.ts`](../server/routes/agentRoutes.ts#L1) |
| Uploads and document extraction | PARTIAL | [`ingest.ts`](../server/services/ai/ingest.ts#L1), [`extract.ts`](../server/services/ai/files/extract.ts#L1), [`documentService.ts`](../src/services/documentService.ts#L105) |
| Private generated-file storage/download | PARTIAL | [`FileStore.ts`](../server/services/ai/files/FileStore.ts#L1), [`fileRouter.ts`](../server/services/ai/fileRouter.ts#L1) |
| Documents, spreadsheets, presentations, text and archives | WORKING (runtime tool layer) | [`fileTools.ts`](../server/services/ai/tools/fileTools.ts#L1), [`generators/`](../server/services/ai/files/generators/spec.ts#L1) |
| SVG drawings, charts and diagrams | WORKING (runtime tool layer) | [`drawingTools.ts`](../server/services/ai/tools/drawingTools.ts#L1), [`drawing/`](../server/services/ai/drawing/svgSanitizer.ts#L1) |
| Raster image generation | STUB-MOCK / unavailable | [`drawingTools.ts`](../server/services/ai/tools/drawingTools.ts#L94), [`AiService.ts`](../server/services/AiService.ts#L119) |
| Python analysis tool | PARTIAL | [`dataTools.ts`](../server/services/ai/tools/dataTools.ts#L87), [`AiService.ts`](../server/services/AiService.ts#L129) |
| Web search / URL fetch | DEAD CODE (AgentRuntime registration) | [`tools/index.ts`](../server/services/ai/tools/index.ts#L1), [`executeAgentTool.ts`](../server/services/executeAgentTool.ts#L54) |
| Curated RAG ingestion, retrieval and evaluation | PARTIAL | [`adminRoutes.ts`](../server/routes/adminRoutes.ts#L973), [`KnowledgeRetrievalService.ts`](../server/services/KnowledgeRetrievalService.ts#L335), [`EmbeddingService.ts`](../server/services/EmbeddingService.ts#L1) |
| Legacy context hydration and memory | PARTIAL | [`ContextAwareService.ts`](../server/services/ContextAwareService.ts#L105), [`MemoryService.ts`](../server/services/MemoryService.ts#L1) |
| Dataset preparation, JSONL export and quality checks | PARTIAL | [`adminRoutes.ts`](../server/routes/adminRoutes.ts#L1519), [`DatasetQualityService.ts`](../server/services/DatasetQualityService.ts#L1) |
| “Fine-tuning” / model adapters | STUB-MOCK (prompt adapter, not fine-tuning) | [`adminRoutes.ts`](../server/routes/adminRoutes.ts#L1885), [`ContextAwareService.ts`](../server/services/ContextAwareService.ts#L22), [`schema.prisma`](../prisma/schema.prisma#L515) |
| AI form generation and enhancement | PARTIAL | [`FormOrchestrator.ts`](../server/services/FormOrchestrator.ts#L18), [`server.ts`](../server.ts#L1531), [`formRoutes.ts`](../server/routes/formRoutes.ts#L327) |
| Public form display/submission | PARTIAL | [`server.ts`](../server.ts#L1503), [`DynamicForm.tsx`](../src/components/DynamicForm.tsx#L1) |
| Form scoring, insights, analytics and selection | PARTIAL | [`FormScoringService.ts`](../server/services/FormScoringService.ts#L1), [`AnalyticsWorker.ts`](../server/services/AnalyticsWorker.ts#L1) |
| Exam and rubric generation | PARTIAL | [`server.ts`](../server.ts#L1800) |
| Script marking and queued batch grading | PARTIAL | [`GradingService.ts`](../server/services/GradingService.ts#L1), [`QueueService.ts`](../server/services/QueueService.ts#L1), [`server.ts`](../server.ts#L1897) |
| OCR/live scan-to-form and scan grading | STUB-MOCK / PARTIAL | [`server.ts`](../server.ts#L1640), [`documentService.ts`](../src/services/documentService.ts#L257) |
| Summarization and translation | PARTIAL | [`server.ts`](../server.ts#L1953) |
| Image/video/audio/workflow “artifact” generation | STUB-MOCK | [`server.ts`](../server.ts#L571), [`MarkdownRenderer.tsx`](../src/components/MarkdownRenderer.tsx#L37) |
| Chat, marking, results and forms UI | PARTIAL | [`App.tsx`](../src/App.tsx#L1046), [`LeftSidebar.tsx`](../src/components/LeftSidebar.tsx#L45), [`CenterWorkspace.tsx`](../src/components/CenterWorkspace.tsx#L1) |

## 1. Provider layer

### GonkaRouter and model selection

- The new adapter is an OpenAI-compatible streaming implementation: it posts `model`, messages, optional tools, and stream options to the configured `/chat/completions` endpoint; it parses SSE deltas, tool-call deltas, usage, and JSON non-stream responses ([`openaiCompatible.ts:1-85`](../server/services/ai/providers/openaiCompatible.ts#L1)).
- `bwengeAgent` is constructed once in [`AiService.ts:87-132`](../server/services/AiService.ts#L87) with provider name GonkaRouter, `GONKA_BASE_URL` (default gateway), `GONKA_API_KEY`, and `GONKA_MODEL` (default `zai-org/GLM-5.3-Flash`). The model is captured in the configured agent; the general request wrappers do not consistently forward caller-supplied model choices.
- Connect, idle and total request timeouts are configured as 15s/30s/60s for this agent. The runtime retries retryable provider failures once with a 500ms delay. The adapter supports cancellation; the runtime caps one run at 12 turns by default, tool execution at 90 seconds, and parallel tools at three ([`AiService.ts:95-107`](../server/services/AiService.ts#L95), [`AgentRuntime.ts:25-46`](../server/services/ai/AgentRuntime.ts#L25)).
- Streaming is real in the AgentRuntime and in `/api/ai/chat` SSE handling. The legacy Gemini and OpenRouter paths are not all token-streamed: OpenRouter is a single response, while several named methods (`sendClaudeChat`, NVIDIA and Ollama wrappers) route back through GonkaRouter rather than their named provider ([`AiService.ts:377-477`](../server/services/AiService.ts#L377), [`AiService.ts:553-600`](../server/services/AiService.ts#L553)).

### Retries, failure, cost and future providers

- The new runtime propagates non-retryable failures; chat SSE reports an error event, and grading/form paths return retry-oriented errors. However, an empty successful provider response can still produce an empty result; it is not uniformly rejected at the provider adapter boundary.
- Several legacy methods use a separate 30-second fetch timeout and error handling. `sendGonkaChat` accepts a `timeoutMs` option but does not pass it through to the agent adapter; callers expecting a longer dataset/playground timeout therefore do not control that adapter’s configured timeout ([`AiService.ts:36-64`](../server/services/AiService.ts#L36), [`AiService.ts:350-375`](../server/services/AiService.ts#L350)).
- There is no enforced per-user AI quota or dollar/token budget in AgentRuntime. There is an IP-based global limiter in production (300 requests/15 minutes) and a separate IP-based grading limiter (60/15 minutes); both are bypassed outside production. Paywall/usage controls exist in some service routes, but are not a substitute for per-user provider rate/cost enforcement ([`rateLimiter.js:1-42`](../production/rateLimiter.js#L1), [`server.ts:275-285`](../server.ts#L275)).
- Agent traces record hashed user/chat identifiers, prompt version, retries, tokens and status, but `costUsd` is always null in the current writer. Existing `JobCostLog` code uses a documented flat placeholder for some grading charges; racing fallback providers can also incur multiple provider calls for one result ([`createAiAgent.ts:145-187`](../server/services/ai/createAiAgent.ts#L145), [`GradingService.ts:100-116`](../server/services/GradingService.ts#L100), [`AiService.ts:219-246`](../server/services/AiService.ts#L219)).
- The adapter interface is reusable, but the host wires only one provider instance. Adding a provider requires explicit selection/fallback policy, its own model and timeout config, provider health and billing instrumentation, tool-format compatibility, and tests. Several legacy provider-named methods are aliases, so adding credentials alone would not switch those paths.

**Requirements:** PostgreSQL for AI traces and normal app records; GonkaRouter credentials and reachable network for primary generation. Some legacy functions also use Gemini, OpenAI, Anthropic, OpenRouter, DeepSeek or Ollama credentials. `FILE_URL_SECRET` (at least 16 characters) is required at module initialization even for otherwise unrelated `AiService` use.

**Tests:** `tests/chat_provider_failures.test.ts` covers a successful OpenAI-compatible stream, retry after timeout, non-retry of 401, and small-talk routing. `tests/gonka_streaming.test.ts`, `tests/model_guard.test.ts`, `tests/no_fabricated_assessment.test.ts`, and `tests/ai_trace.test.ts` cover adjacent behavior. These do not demonstrate provider parity, cost caps, or multi-provider failover.

## 2. Agent runtime and tools

`createAiAgent` constructs the one shared `AgentRuntime`, ingests uploads, appends a capabilities prompt, and streams `text`, tool-call/result, source, usage, retry-reset and completion events. Arguments are JSON-parsed and checked against AJV-compiled tool schemas before execution. Retryable provider errors are retried; the default turn limit is 12, with a final no-tools model request after the limit ([`AgentRuntime.ts:1-113`](../server/services/ai/AgentRuntime.ts#L1), [`AgentRuntime.ts:150-195`](../server/services/ai/AgentRuntime.ts#L150), [`registry.ts:1-50`](../server/services/ai/tools/registry.ts#L1)).

### Tools actually registered by the host’s AgentRuntime

The host injects knowledge retrieval and Python. It does not inject web search, URL fetch, or an image provider, so those optional tools are absent in this deployment. Each tool below is gated only by whether it is included in the registry; there is no ADMIN/INSTRUCTOR/other-role authorization in `ToolContext` or `runOne`. All are reachable only through the authenticated route(s) that invoke this agent.

| Tool | Input → output / effect | Runtime permission and validation | Failure / coverage / risk |
|---|---|---|---|
| `create_document` | Structured title, blocks, optional output formats/file name → DOCX/PDF/HTML/Markdown attachment. | Any caller of this runtime; AJV schema plus block normalization and generator checks. | Returns an error result if invalid or render fails. Writes local file immediately; no confirmation. Generator tests are under `bwenge-ai-capabilities/tests/generators.test.ts`, not the root `npm test` glob. |
| `create_spreadsheet` | Workbook sheets/rows and optional XLSX/CSV → attachment(s). | Same; AJV validates a schema, but nested size/shape constraints are incomplete. | Local file write is immediate. Root coverage is limited; separate generator tests exist. |
| `create_presentation` | Slide structure and optional images → PPTX attachment. | Same; schema and renderer checks, but no explicit approval step. | Error returned when generation fails; local file is written immediately. Separate generator tests exist. |
| `create_text_file` | Filename/extension and content → validated text/code file. | Same; allowed extension and 5 MiB content limit in generator. | Error returned on unsupported extension/size; local write is immediate. |
| `create_archive` | Up to 100 file IDs → ZIP attachment (generator also caps count/size). | FileStore checks ownership on every source file; argument JSON schema applies. | Explicit error on read/archive failures; local write is immediate. |
| `create_drawing` | SVG plus optional title/name → sanitized SVG and PNG preview attachment. | Same; SVG sanitizer and renderer checks. | Explicit SVG/render error; file write is immediate. |
| `create_chart` | Vega-Lite spec with inline data → rendered SVG/PNG preview attachment. | Same; renderer rejects unsupported spec/data URLs and sanitizer applies. | Explicit render error; file write is immediate. |
| `create_diagram` | Nodes/edges plus optional title/name → rendered SVG/PNG preview attachment. | Same; AJV limits nodes to 80, but edge and text bounds are not comprehensive. | Explicit render error; file write is immediate. |
| `read_attachment` | Owned `fileId`, optional `maxChars` (1,000–120,000) → extracted text. | Any caller; FileStore verifies user ownership; AJV checks arguments. | Returns explicit file/extraction errors. Text is wrapped as untrusted on the tool-result path. |
| `search_knowledge` | Query and topK (1–12) → retrieved passages and source objects. | Any caller; AJV checks shape. The injected service accepts `userId` but ignores it in the retrieval closure. | Returns “no matching sources” or explicit retrieval error; globally scoped data can cross users/organizations. |
| `run_python` | Python code (maximum 50,000 chars) → stdout/stderr and optionally attachments. | Any caller; AJV checks code string length, but this is not role authorization or human approval. | Explicit Python error. The app adapter currently returns stdout only, discarding sandbox-produced files. It invokes the shared Python MCP sandbox and has a 90s tool timeout. |
| `generate_image` (optional) | Prompt (max 2,000 chars), size and name → image attachment. | Not registered: `services.image` is not configured. | Tool itself returns “Image generation is not configured”; keep hidden. |
| `web_search`, `fetch_url` (optional) | Query or HTTP(S) URL → untrusted results/page text. | Not registered: `services.webSearch` is not configured. | Legacy implementation is separate and not wired to the current registry. |

The source of the actual list is [`tools/index.ts:1-20`](../server/services/ai/tools/index.ts#L1). The common error helper marks tool errors, and `AgentRuntime` returns those errors to the model and emits an `isError` tool result. It does not itself require the model/user to confirm a write, email, or paid operation.

### Legacy declared tools and executors

There are additional, incompatible tool declarations: `generalTools.ts` exposes `load_specialized_tool`, `delegate_task`, `store_session_variable`, `generate_visual_annotation`, and `cross_reference_visuals`; `ToolRegistry.ts` describes Python, form building, memory, curriculum research, browser-extension, web-search, document-reading, report-export and visualization tools. `agentTools.ts` describes file read/write/edit/list and command execution. [`server.ts:1042-1200`](../server.ts#L1042) passes some of these definitions and an executor to `AiService.generalAssist`, and `/api/agent/projects/:id/message` passes a different set to `AiService.runAgentLoop`. Those wrappers currently call `bwengeAgent.run` without forwarding the supplied definitions or executor, so these declarations do not control the runtime; the project “build agent” cannot reliably perform its advertised file operations.

Additional old executor cases include `fact_check`, `plan_task`, `save_memory`, sentiment/confidence, `run_code`, dataset patterns, image/video/audio/workflow generation and `build_form` ([`executeAgentTool.ts:132-329`](../server/services/executeAgentTool.ts#L132)). Some are real service wrappers; others return descriptions or synthetic values. Examples of hard-coded claims include cross-curriculum “85%” alignment and canned lesson text in [`server.ts:1168-1174`](../server.ts#L1168). Treat the old declarations and executor as untrusted/dead until their call path is unified and tested.

### Prompt injection and confirmation

`ingestUploads` inserts extracted attachment text into the same user message sent to a model and labels it untrusted; the capabilities prompt explicitly says file/web/search text is data, not instructions ([`ingest.ts:28-65`](../server/services/ai/ingest.ts#L28), [`capabilitiesPrompt.ts:14-22`](../server/services/ai/capabilitiesPrompt.ts#L14)). This is a useful prompt-level mitigation, not an enforcement boundary: once the model sees a malicious document or form answer, it can still emit a tool call, and `AgentRuntime` executes valid calls automatically. Form answers also enter model prompts in scoring/analytics paths. There is no mandatory confirmation for file creation, database writes, batch/simulation side effects, outbound web/Python work, or any paid provider call.

**Tests:** the separate capability package contains `tests/agentRuntime.test.ts`, drawing/generator/platform tests, and UI tests, but the repository’s root `npm test` script runs only `tests/*.test.ts`. Root tests cover chat failures, grounding, uploads, selected prompt/document behavior, marking, and form failure behavior; no current root test proves per-role tool filtering, malicious-document non-execution, or confirmation.

## 3. Retrieval-augmented generation (RAG)

### Ingestion, parsing, OCR and limits

- The admin knowledge upload is behind `/api/admin`’s `requireAuth` + `requireRole('ADMIN')` router guard. It extracts text, rejects extraction failures, caps extracted text at 2,000,000 characters and indexed chunks at 5,000, uses configurable chunk size/overlap, and stores each chunk in PostgreSQL ([`adminRoutes.ts:85-86`](../server/routes/adminRoutes.ts#L85), [`adminRoutes.ts:973-1145`](../server/routes/adminRoutes.ts#L973)).
- `extractText` for Agent attachments supports DOCX, XLSX, PPTX, PDF text layers, HTML, text/code and images. XLSX extraction is capped at 500 rows per sheet; the general extracted-text limit is 120,000 characters by default. It explicitly does not OCR scanned PDFs; it returns a note asking for a photo or OCR/vision ([`extract.ts:19-95`](../server/services/ai/files/extract.ts#L19)).
- The shared upload middleware permits up to 100 MiB per file, 10 files, and buffers uploads in memory ([`upload.ts:1-26`](../server/middleware/upload.ts#L1)). Agent inline ingestion takes at most 10 uploads and places at most 30,000 characters of each extracted text in the initial prompt; later `read_attachment` can return at most 120,000 characters. The separate knowledge-upload route inherits the 100 MiB upload cap and applies its extracted-text/chunk limits.
- Tesseract OCR exists in the document service for scanned PDF/image ingestion and is bounded to 20 PDF pages and a 30s OCR timeout; `HighVolumeBatchService` has another English-only OCR path for the first 20 pages. This is not the Agent attachment extractor’s behavior. OCR errors are usually explicit, but low-quality OCR can still yield partial text. Images/PDFs can also be passed to the multimodal provider directly ([`documentService.ts:75-105`](../src/services/documentService.ts#L75), [`documentService.ts:257-325`](../src/services/documentService.ts#L257), [`HighVolumeBatchService.ts:39-62`](../server/services/HighVolumeBatchService.ts#L39)).

### Embeddings, storage, ranking, citations and isolation

- Embeddings are generated by Google GenAI using `GEMINI_EMBEDDING_MODEL` (default `gemini-embedding-2-preview`). Vectors are JSON strings in `DocumentChunk.embedding`; PostgreSQL persists them, but the schema has no pgvector column/index. Retrieval loads up to 5,000 recent candidate chunks into application memory and computes cosine similarity there ([`EmbeddingService.ts:1-61`](../server/services/EmbeddingService.ts#L1), [`schema.prisma:426-462`](../prisma/schema.prisma#L426), [`KnowledgeRetrievalService.ts:335-434`](../server/services/KnowledgeRetrievalService.ts#L335)).
- Retrieval is hybrid lexical/semantic, with default top-K from `RetrievalSetting` (schema default 6) and a semantic floor of 0.55. An optional reranker interface exists and safely retains hybrid ranking on error, but the ordinary Agent/production call sites do not inject one. Settings/schema are inconsistent: the code’s embedding model comes from `GEMINI_EMBEDDING_MODEL`, while `RetrievalSetting.embedModel` and admin defaults advertise different model labels; the actual `hybrid`, `rerank`, and metadata flags are not all applied by the ranker.
- There is deletion and embedding re-indexing for admin documents. Deleting a `Document` cascades chunks in PostgreSQL, but the local source file’s physical removal is not guaranteed by this database delete route. Re-indexing calls Gemini and updates chunk vectors.
- The new `search_knowledge` tool returns retrieved passage records and titles/page metadata, so the passages themselves are real. The tool prompt asks the model for ordinal citations `[1]`, `[2]`; the `KnowledgePassage` object does not include `chunkId`, and chunk page numbers are often null for current uploads. This is weaker traceability than the legacy evidence path, which places exact `chunkId` IDs in context and validates them with `GroundedAnswerService`. That citation validator is not uniformly applied to all Agent paths.
- **Isolation is not implemented in the common retrieval path.** `KnowledgeBase`/`Document`/`DocumentChunk` have no owner or organization ID in [`schema.prisma:415-462`](../prisma/schema.prisma#L415). `AiService` passes `userId` to its knowledge service, but the closure discards it and calls `retrieveKnowledgeChunks(query, { limit: topK })` ([`AiService.ts:119-135`](../server/services/AiService.ts#L119)). With no knowledge-base filter, all active/approved chunks can be candidates. `ContextAwareService` also fetches recent forms, submissions, insights, datasets and approved examples without user or organization filters ([`ContextAwareService.ts:105-174`](../server/services/ContextAwareService.ts#L105)). A caller can provide `activeFormId`; the hydrated-form lookup does not first verify its owner.

### Evaluation and failure

Admin routes provide a retrieval benchmark endpoint with recall, precision and MRR; the ranker also has a pure benchmark helper. Root `tests/knowledge_retrieval.test.ts` covers lexical/hybrid ranking, thresholds, query language normalization, extraction/chunking, citation validation and provider response parsing. There is no evidence in this audit of a sufficiently sized, independently labeled production evaluation set; evaluation is request-supplied/offline and not a gate for activation.

Embedding failures are logged and can fall back to lexical retrieval. Retrieval errors from the Agent tool return an explicit tool error. The legacy context hydration route catches context construction failure and continues with empty hydrated context, so a general answer can proceed without the evidence it was meant to retrieve. The consequence is an ungrounded answer, not a verified “no sources” answer.

## 4. Datasets, “fine-tuning” and adapters

### What is real

- Admins can create datasets, harvest examples from platform forms, submissions, exams, document chunks and usage events, upload a document and ask GonkaRouter for source-grounded question/answer examples, review/approve examples, export JSONL with a manifest, and inspect dataset statistics ([`adminRoutes.ts:349-429`](../server/routes/adminRoutes.ts#L349), [`adminRoutes.ts:1575-1692`](../server/routes/adminRoutes.ts#L1575), [`adminRoutes.ts:1818-1864`](../server/routes/adminRoutes.ts#L1818)).
- `DatasetQualityService` includes duplicate detection, dataset splits, heuristic PII detection/redaction, validation, source-grounding checks and export quality gates. Tests exercise selected helpers in `tests/knowledge_retrieval.test.ts`.
- Prisma has `Dataset`, `DatasetExample`, `FineTuneJob`, and `AiModel` records. The `dataset_knowledge_adapters` migration adds metadata and `adapterPrompt` columns; it does not add provider training artifacts or a training service ([`20261008000100_dataset_knowledge_adapters/migration.sql`](../prisma/migrations/20261008000100_dataset_knowledge_adapters/migration.sql), [`schema.prisma:515-575`](../prisma/schema.prisma#L515)).

### What is not real fine-tuning

There is no provider training API call, worker that submits a training job, model-weight artifact, checkpoint, or local training process. `/fine-tune/jobs` marks a database row `TRAINING`, builds a textual adapter from approved examples using inference-time GonkaRouter calls (with a deterministic text fallback), writes `adapterPrompt`, then creates an `AiModel` named `adapter:...` and marks the row `COMPLETED` ([`adminRoutes.ts:1885-2031`](../server/routes/adminRoutes.ts#L1885), [`adminRoutes.ts:632-695`](../server/routes/adminRoutes.ts#L632)). This is prompt/context adaptation plus a few-shot path, not training. The test endpoint simply sends a normal model request with the adapter prompt and examples ([`adminRoutes.ts:2078-2141`](../server/routes/adminRoutes.ts#L2078)).

### PII, consent, evaluation, versions and rollback

- The `DatasetExample` database model has no persisted `consent`, origin, or reviewer fields, despite those being modeled by the standalone quality helper. Harvesting includes submission data/answers; the export route maps every row to `consent: true` before quality checks. This can defeat the helper’s no-consent PII blocker. Treat harvested datasets as containing potentially sensitive user/submission data until explicit consent and PII review are made part of persisted workflow ([`adminRoutes.ts:349-429`](../server/routes/adminRoutes.ts#L349), [`adminRoutes.ts:1818-1844`](../server/routes/adminRoutes.ts#L1818), [`schema.prisma:524-536`](../prisma/schema.prisma#L524)).
- The upload UI can mark documents with `consentGiven`, but text documents are initially approved even when that flag is false; retrieval filters approval but not consent. Scanned/image/audio material is initially pending review. Consent is therefore not a complete retrieval or training policy ([`adminRoutes.ts:1000-1015`](../server/routes/adminRoutes.ts#L1000), [`adminRoutes.ts:1097-1124`](../server/routes/adminRoutes.ts#L1097)).
- Job creation can auto-approve pending examples; after adapter generation the model is created active in the requested environment (default `production`) without a held-out evaluation gate. `trainingMetrics` is empty and `evalScore` is not computed. Dataset export has a quality gate, but the “fine-tune” execution path directly reads approved rows rather than requiring a successful export/evaluation.
- Dataset/model version fields are nominal metadata. Model records can be deactivated/activated manually, but there is no tested rollback release workflow tied to the previous active adapter. The adaptation runs on the application server/process and makes model inference calls; no actual training is run elsewhere.

**Status:** adapter behavior is **STUB-MOCK** if described as fine-tuning; dataset curation/export is **PARTIAL**. Do not market the adapter name as a trained model.

## 5. Forms, scoring, analytics and public submissions

- **Form creation:** `FormOrchestrator.reason` requests a schema from the model, checks that it contains a non-empty title, questions/fields and question titles, and creates a database form only after that check. Provider/parse failures return a retry-oriented error and do not persist substitute questions. Validation does not fully enforce the declared question types/options, unique IDs, score/rubric sums or all nested schema invariants. Related tests include `tests/no_fabricated_assessment.test.ts`, `tests/orchestrator_integration.test.ts`, and `tests/services.test.ts`.
- **Enhancement and simulation:** `/api/forms/ai-agent` is authenticated. Enhancement checks for nonempty question text but normalizes many malformed/missing fields to defaults. Simulation generates synthetic submissions and persists them, then runs analytics; this is a real test-data action but must not be mistaken for real respondents. There is no confirmation guard before this database write ([`FormOrchestrator.ts:95-285`](../server/services/FormOrchestrator.ts#L95)).
- **Public submission:** `/api/forms/:id` and `/api/public/forms/:id` expose a form, and `/api/forms/:id/submit` accepts public responses. Submission checks requiredness, selected option membership, several typed values and per-string 50,000-character limits. It accepts no CAPTCHA/honeypot or per-form request quota, and rate limiting is only the global per-IP production limiter (disabled in development). The JSON body can contain a large aggregate of answer data subject to the server body parser limit. Public endpoints are intentionally unauthenticated, not an authenticated AI tool.
- **Scoring:** objective answer keys are locally compared, then the AI is asked for a 0–100 score and feedback. Missing/invalid model output causes an explicit “submission remains unscored; please retry” error. The numeric score is clamped to 0–100; criterion-breakdown contents are not comprehensively checked, and the fallback objective match permits a substring match for sufficiently long expected answers. A form without a rubric is still scored against model-inferred criteria. Tests in `tests/no_fabricated_assessment.test.ts` cover provider absence, timeout, incomplete grading/scoring output and form generation failure.
- **Analytics and selection:** numeric aggregates and question distributions are computed from stored data. AI qualitative analysis can fall back to deterministic computed summary text; selection requires a complete set of unique rankings and returns `selection: null` on model failure. Results map a missing sentiment to `positive`, which is not evidence-backed. `aggregateBatchPerformance` is explicitly a no-op returning null because the StudentScript table does not exist. `tests/services.test.ts`, `tests/context_awareness.test.ts` and form/retrieval tests provide partial coverage.
- **Ownership:** authenticated form analysis checks that the requesting user owns the form. Some other context-hydration paths do not check `form.userId` before including data, as described in the RAG section.

## 6. Marking, exams, rubrics and scanning

- **Exam generation:** authenticated, grading-limited route. Validates non-empty question/answer fields, rubric criteria and exact total marks; failure returns `503` and a retry path, not a fabricated paper. `tests/no_fabricated_assessment.test.ts`, validation/orchestrator tests cover parts of this behavior. Rubric-generation route checks for a non-empty criteria list but does not enforce every criterion’s bounds or total equality.
- **Script marking:** real GonkaRouter-backed AI evaluation with preflight rubric/script checks, exact question count, unique question correspondence, valid marks, feedback and pending-on-failure behavior. Route returns `503` with a retry instruction; `Step4AIMarks` leaves failed scripts pending and offers retry. `tests/no_fabricated_assessment.test.ts` covers key failure cases, but not fairness/bias or agreement against a gold-standard marking set.
- **Batch queue:** no Redis/BullMQ requirement in the current `QueueService`. Jobs execute asynchronously in-process and are snapshotted to `exports/local-jobs.json`; a restart can hydrate records, but it is not a distributed queue and two VPS processes do not coordinate. Persistence read/write failures are swallowed. Batch grading loops over scripts sequentially and records failures; the cost model and user-specific concurrency limits need hardening ([`QueueService.ts:1-128`](../server/services/QueueService.ts#L1)).
- **OCR / scan grading:** `documentService.ts` has a real bounded Tesseract path, but `/api/ai/scan-agent` is materially unsafe as a grading result: scan-to-form inserts two generic questions when the model returns none; grading fills missing student IDs with random IDs, transcript with placeholder text, confidence with `92`, and feedback with a canned provider claim. This is success-shaped fabricated output and should be hidden or fixed before presenting it as an AI grading capability ([`server.ts:1640-1795`](../server.ts#L1640)). Route-level failure is not enough to protect the success-shaped fallbacks.
- **Batch high-volume OCR:** a separate Tesseract implementation OCRs English (`eng`) and is limited to 20 pages. It is called by the Telegram scan flow; it is not the same path as `/api/ai/scan-agent`. `tests/upload_flow.test.ts` covers upload behavior; OCR grading has no gold-set evaluation identified here.

## 7. Other generation, design and chat features

### Real, local renderers

The AgentRuntime’s local generators can create documents (DOCX/PDF/HTML/Markdown), spreadsheets (XLSX/CSV), presentations (PPTX), text/code files, archives, SVG drawings, Vega-Lite charts and node/edge diagrams. These are actual deterministic renderers driven by model-produced content/specifications; they do not mean a design has been visually verified. They require Node dependencies, the FileStore and writable disk. Errors in tools are explicit, but files are immediately written when the model asks the tool; there is no user confirmation.

### Design, images, video, audio, workflow and browser extensions

- There is no separate production UX/UI design brief, wireframe or React-preview capability exposed through AgentRuntime. `create_text_file` can create source-code text, but is not an executed application-design/preview service.
- `generate_image` is defined, but the host does not inject an image provider, so it is not registered. A fallback SVG is fabricated by `server.ts` from a fixed template when prompts mention logo/image/design. It is labeled as a named visual model despite no such provider being called ([`server.ts:639-660`](../server.ts#L639)).
- Video, audio, workflow and dataset artifacts are hard-coded sample/demo structures in `executeBackendAgentPostProcess`; the frontend renders them with local SVG/CSS animation and browser speech synthesis, not generated media. The workflow sample includes made-up performance metrics and email/calendar steps. These are **STUB-MOCK**, not capabilities ([`server.ts:571-754`](../server.ts#L571), [`MarkdownRenderer.tsx:37-230`](../src/components/MarkdownRenderer.tsx#L37), [`MarkdownRenderer.tsx:580-690`](../src/components/MarkdownRenderer.tsx#L580)).
- The old browser-extension tool writes a local manifest/rules directory if called, but its legacy executor is not connected to the current AgentRuntime. Do not expose it as a supported Agent capability without the actual executor and path/security review.

### Summary, translation and chat

- Chat streams provider output over SSE; the current client stops waiting on provider failure, displays a clear error and has a retry callback. Existing UI also supports attachment staging and responsive mobile layout. These are not a new Agent page and do not show an explicit structured tool-progress timeline for the current runtime.
- `/api/ai/summarize` substitutes “Key insight summarized.” when the model returns empty text; `/api/ai/translate` similarly substitutes “Translation complete.” Both are success-shaped fallbacks and violate the no-fabrication requirement. Replace with an explicit retryable error before exposing as Agent tools ([`server.ts:1953-1983`](../server.ts#L1953)).
- UI strings for the main sidebar are hard-coded in English; `src/i18n/landing.ts` includes EN/RW/FR, but the navigation does not consume its dictionary. The model system prompt requests Kinyarwanda, English and French; language quality is not backed by a dedicated evaluation set. Use “prompted multilingual support,” not guaranteed translation quality.

## 8. Cross-cutting controls and operations

### Authentication, roles and public endpoints

- `/api/ai/chat`, marking, exams, scan agent, form generation and most private workflows require authentication. The `/api/admin` router additionally requires `ADMIN`. `/api/agent` is mounted behind authentication and a global limiter; its project IDs are namespaced with the account ID. Form creation/editing and analytics include ownership checks in key routes.
- No current Agent tool enforces a role matrix such as ADMIN versus INSTRUCTOR. The user ID in the runtime context is an ownership key for files, not an authorization policy. Public form reads and submissions are unauthenticated by design; admin RAG routes are not public.
- Main AI routes inherit a shared global IP-based production limiter; grading gets a stricter IP-based limiter. Neither is per-user/per-organization and development bypasses both. Public submission abuse protection is correspondingly limited.

### Uploads, storage and retention

- Shared Multer uploads are in-memory, up to 100 MiB each. New Agent ingestion stores each file in a local `FileStore` (default `./data/generated`, default max 25 MiB) with per-user metadata, short-lived HMAC-signed download URLs and default 24-hour expiry. A persistent mounted disk is required if generated attachments must survive container replacement. No Redis or S3 is required by this FileStore.
- `purgeExpired()` exists but has no caller in this repository; expired files are rejected on read but may remain on disk. Chat uploads also use a separate older FileRecord/cloud-or-local pipeline. Storage behavior therefore differs by route and hosting setup.
- AI trace schema deliberately stores hashes and operational metadata rather than prompts or tool arguments, which is a good data-minimization design. It has no retention/expiry policy. Other job payloads, form submissions, extracted chunks, dataset examples and local queue snapshots can include personal or student data. Logging is mixed: current AI trace avoids content, but older code logs user text previews, filenames/paths and exception objects. Do not claim global secret-free/PII-free logging.

### Single VPS and dependencies

- PostgreSQL is required for normal application forms, jobs, knowledge chunks, datasets and traces. Agent-created files need a persistent local directory and `FILE_URL_SECRET`. Queueing is in-process plus local JSON persistence; there is no need for Redis, but horizontal/multi-process deployment is not safe as a shared queue. The new file store does not require S3; older upload/cloud paths may use a separate cloud-storage integration.
- Provider availability is checked mostly by credential presence (Ollama by a short health request); there is no unified provider circuit breaker. Startup fails if `FILE_URL_SECRET` is absent/too short.

### Current root test coverage

Root tests include chat provider failures, Gonka streaming, no-fabricated grading/form/scoring cases, RAG ranking/evaluation helpers, upload flow, auth flows, context hydration, and selected UI/landing behavior. `npm test` does not execute `bwenge-ai-capabilities/tests/**` because its script is `node --test --import tsx tests/*.test.ts`. No current test is identified for the future Agent route redirect, role-based Agent capability visibility, tool failure UI state, or document-instruction prompt injection; those are Phase 2 requirements.

## Capability status summary

| Capability | Status | Honest description |
|---|---|---|
| Provider layer | PARTIAL | GonkaRouter streaming is configured; provider selection/fallback is inconsistent and budgets are not enforced. |
| AgentRuntime | PARTIAL | Bounded loop, event reporting and JSON-schema argument validation; not a role-aware or confirmation-aware Agent product. |
| Local document/table/presentation output | WORKING (runtime tool layer) | Creates downloadable files locally from model-authored content; output still needs user review. |
| SVG/chart/diagram output | WORKING (runtime tool layer) | Sanitized local rendering from supplied/generated specs; not generative raster imagery or a UI preview. |
| Attachment reading | PARTIAL | Per-user file checks and extraction for supported formats; scanned documents/OCR behavior varies by path. |
| Python, RAG search | PARTIAL | Python sandbox and retrieval exist, but role/confirmation and tenant-isolation issues block broad exposure. |
| Web search / URL fetch | DEAD CODE (current AgentRuntime) | No web service is injected into this host runtime. |
| Form generation | PARTIAL | Real generated schemas and persisted forms, with incomplete schema validation. |
| Public forms | PARTIAL | Real public form flow and server validation; weak abuse controls. |
| Form scoring/analytics | PARTIAL | Real scoring and computed statistics; not fully validated or independently evaluated. |
| Script marking | PARTIAL | Real rubric-driven model marking with fail-closed behavior; requires teacher review and quality evaluation. |
| Scan grading | STUB-MOCK / PARTIAL | Real OCR exists, but scan route can return invented questions, IDs, transcript, confidence and feedback. |
| Fine-tuning | STUB-MOCK | Dataset-grounded prompt/context adapter only; no model training or model artifact. |
| Image/video/audio/workflow design artifacts | STUB-MOCK | Fixed template/demo output; not actual provider-generated content or automation. |
| UX/UI design preview | DEAD CODE / not present | No verified dedicated Agent design/preview implementation. |
| Summarize/translate | PARTIAL | Provider calls exist, but empty responses become canned success text. |

## Prioritized gaps

### Security first

1. Enforce user/organization filters in RAG and context hydration; scope every document, form, submission, and dataset query. Add isolation tests with two accounts.
2. Add tool authorization per role and mandatory confirmation for writes, email, paid calls, scans/marking persistence and other externally visible or billable actions. Do not rely on prompt wording.
3. Make uploaded documents, retrieved passages and form answers untrusted at every path; keep them isolated from system instructions, and add a regression test that a document instruction cannot trigger a tool.
4. Persist real consent/provenance and PII review metadata. Remove the unconditional `consent: true` export mapping and require quality/consent gates in the adapter-builder path.
5. Add per-user/per-organization limits, provider cost caps, aggregate upload limits and public form anti-abuse controls. Confirm the Python sandbox is isolated and does not share a user-writable workspace.

### Correctness and reliability

6. Remove all success-shaped fallbacks: scanner defaults, empty summary/translation text, canned media/design/workflow metrics, fabricated analytics defaults and dead-tool hard-coded outputs. Return explicit error/retry states.
7. Route every provider path through one adapter contract; ensure selected model, timeout, abort, retry and provider labels are honored. Add one configured secondary provider with explicit fallback semantics only after tests/cost handling.
8. Validate full form/exam/rubric/scoring schemas and all returned ranking/evaluation fields; do not mutate persisted state from incomplete model output.
9. Preserve traceable citations with stable chunk IDs and page/source metadata. Make retrieval failure stop or clearly degrade grounded-answer requests rather than silently continuing without evidence.
10. Use a durable queue appropriate for the target VPS, surface persistence failures, and add retention/cleanup for local files, traces, job payloads and student data.

### Features and evaluation

11. Unify the legacy Anthropic tool declarations/executors with the current AgentRuntime or remove them from capability claims. Add explicit tool progress, failure and confirmation events.
12. Build representative multilingual (Kinyarwanda, English, French) retrieval, grading and form evaluations, including OCR gold data and human-agreement measures; gate production adapter/model activation on evaluation.
13. Only after verified implementation, expose image/video/audio/workflow generation and UX/UI design cards. Current prompt wording and artifact renderers are not evidence those generators work.

## What the Agent can honestly expose

### Candidate to expose after the Agent route is wired to the existing runtime

- Create a structured downloadable document (Word/PDF/HTML/Markdown).
- Create an Excel/CSV workbook or PowerPoint presentation.
- Create a sanitized SVG illustration, chart, or diagram.
- Read a user-owned supported attachment and report extraction limitations.
- Explain that an output is model-generated and ask the user to review it.

These are actual runtime tools, but local file writes currently happen without confirmation and tools are not consistently connected to the present chat route. Do not present them as available in a new Agent screen until route, permission, event and confirmation behavior are wired.

### Hide or mark “coming soon” until gaps are closed

- **Marking and form making as Agent tools:** the underlying application workflows exist, but are separate endpoints/services; current AgentRuntime does not expose those tools. Keep the existing marking/form pages working rather than implying the Agent can invoke them.
- **Knowledge search/RAG:** hide from broad Agent use until retrieval is user/organization isolated and sources are stably traceable.
- **Python:** hide until sandbox ownership/isolation, role permission, confirmation and output-file handling are verified.
- **Web search/URL fetch:** hide; no web service is configured in the current AgentRuntime host.
- **Raster image generation:** hide; no image provider is configured.
- **Fine-tuning:** label “dataset-grounded prompt adapter (not model training)” in admin surfaces; never claim model weights were trained.
- **OCR grading/scan-to-form:** hide or mark experimental until all success-shaped defaults are removed and a gold-set evaluation exists.
- **Video, audio, automated workflows, email/calendar actions, browser extensions, and UX/UI preview:** hide or mark “coming soon”; current outputs are mock artifacts, legacy tool paths or static templates.
- **Summarization/translation:** do not advertise as an Agent capability until empty provider responses return an explicit error/retry state and multilingual quality is evaluated.

## Hardening update

The following changes were made after the audit. They do not create an Agent page; Phase 2 remains unstarted.

| Area | Current implementation |
|---|---|
| Knowledge and context isolation | Knowledge retrieval requires a user ID and scopes documents to their owner, organization membership, or document-level plus knowledge-base-level global approval. Context forms, submissions, insights, datasets, consented/PII-reviewed examples, active adapters, and style examples are owner-scoped. Active form hydration checks both form ID and owner. |
| Legacy data | The migration adds nullable owner fields, backfills from the earliest ADMIN, leaves legacy knowledge unapproved for global sharing, and defaults legacy consent/PII flags to false. It stops with an actionable error if legacy AI data exists but no ADMIN can own it. |
| Scan grading | Invalid or incomplete model output now returns an explicit retryable failure; marks must be numeric and question totals must match the reported totals. No default transcript, IDs, questions, marks, confidence, or feedback are supplied. The backend and frontend scan feature flags default off. |
| Summarize/translate | Empty model responses return retryable errors rather than canned success text. |
| Synthetic artifacts | Fixed media/workflow/dataset artifact postprocessing and mock renderer cards are behind separate flags that default off. |
| Dataset adapter honesty | The admin UI and API call this a dataset-grounded prompt adapter, use `BUILDING_ADAPTER`/`ADAPTER_READY`, and explicitly report that weights are not trained. The QLoRA instructions endpoint and misleading model names are removed/renamed. Provider model selection remains the base model. |
| Consent and PII | Examples default to pending and false consent/PII-review flags. Approval, adapter builds, and export require both recorded consent and completed PII review. Dataset-derived style/context examples are filtered by both flags. |
| Tools | Python, web search, URL fetch, and image generation are not registered unless their corresponding `ENABLE_AGENT_*` flag is explicitly set to `true`; leave them unset pending separate review. |
| Deployment | PM2 is configured for one forked process. Local files and job state use persistent `./data` and `./exports`. File expiry purging runs at startup and daily, with failures logged. Redis is not required. If Gemini embeddings are unavailable, startup emits one warning and retrieval continues lexically. |
| Public signup | `ALLOW_PUBLIC_SIGNUP` defaults to false in production. Admins can provision users through the authenticated admin user-creation endpoint; existing users may still authenticate. |
| Production secrets and database | JWT and signed-file URLs no longer use hardcoded fallback keys. Production requires configured 32-character secrets and a PostgreSQL `DATABASE_URL`; non-production gets process-ephemeral keys. Missing context retrieval now terminates chat with an explicit retryable error instead of continuing without evidence. |
| Verification | Two-account scope tests, signup-flag tests, consent/PII export tests, and disabled-tool registration tests were added. Their final pass/fail status is reported with the deployment work; this document does not claim that unrun tests passed. |

The original audit inventory and gap list above remain a record of the pre-hardening snapshot. Check the deployment guide for migration order and operator steps.
