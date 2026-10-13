# Comprehensive Integration Plan: Bwenge AI Capabilities into AiService & App

Refactor `server/services/AiService.ts`, server routing, and frontend chat components to fully integrate the Bwenge AI capabilities layer, addressing all 11 known issues and user requirements.

## User Review Required

> [!IMPORTANT]
> - **Provider Fallback Control**: `ALLOW_GEMINI_FALLBACK=false` by default. `providerAvailable('gonkarouter')` will be strictly separated from Gemini clients.
> - **All Legacy Gonka/Claude Methods Migrated**: `sendGonkaChat`, `streamGonkaChat`, `runGonkaAgentLoop`, and `streamClaudeChat` will be replaced by `agent.run(...)` across all callers (`generateContent`, `sendClaudeChat`, `analyzeImage`, `runDeepResearch`, etc.).
> - **File Security & Router**: HMAC-signed downloads via `createFileRouter` with user ID checks (other user = 403, tampered = 403), `FILE_URL_SECRET` (>=16 chars, no hardcoded default), hourly `purgeExpired`.

## Proposed Changes

### Backend & Service Layer (`server/`)

#### [MODIFY] [AiService.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server/services/AiService.ts)
- Initialize `createAiAgent` with `FileStore`, GonkaRouter provider, and secure knowledge/python services.
- Implement strict `ALLOW_GEMINI_FALLBACK=false` check and fix `providerAvailable`.
- Migrate `generalAssist`, `generateContent`, `sendClaudeChat`, `analyzeImage`, `runDeepResearch`, and `extractSchema` to use `agent.run(...)` (with `toolNames: []` for non-tool calls).
- Support `AbortSignal` tied to request close.
- Support event streaming (`text`, `tool_call`, `tool_result`, `attachment`, `sources`, `turn_reset`, `usage`, `done`).

#### [MODIFY] [server.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server.ts)
- Mount `createFileRouter` at `/api/files` with session/auth `getUserId`.
- Set up hourly `fileStore.purgeExpired()` cleanup interval.

#### [MODIFY] [.env.example](file:///C:/Users/niyib/Downloads/ai-marker-hub/.env.example)
- Add `FILE_URL_SECRET` and `FILE_STORE_DIR`.

### Frontend & UI (`src/`)

#### [MODIFY] Chat components & AiResponseView integration
- Handle `attachment`, `sources`, `turn_reset` events in the chat client.
- Render `AiResponseView` with attachments and sources (`animate={false}` for history).
- Persist attachments (`id`, `name`, `mime`, `size`, `kind`, `previewId`) and sources with messages; call `fileStore.refresh` on load.

## Verification Plan

### Automated Tests & Checks
- Run `npm run verify` in `bwenge-ai-capabilities`.
- Run `npm run lint` (`tsc --noEmit`) and build checks in `ai-marker-hub`.
- Test file router security (403 for other user or tampered signatures).

### 11 Problems Mapping Table
| Problem | Solution / Change | Test / Verification |
|---|---|---|
| 1. Inconsistent `stripThinkingTags` | Use `ThinkFilter` in `AgentRuntime` | Unit test in `agentRuntime.test.ts` |
| 2. `streamGonkaChat` never streams | Use `openaiCompatible.ts` streaming SSE | Integration test |
| 3. `streamClaudeChat` loses answer | Migrate to `agent.run` | Integration test |
| 4. No timeout on stream reading | Add idle timeout (45s) in adapter | Timeout test |
| 5. PDF/Word UTF-8 binary corruption | Use `ingestUploads` text extraction | Ingest test |
| 6. Images dropped with tools | Pass images through `AgentRuntime` | Multi-modal test |
| 7. Silent provider fallback to Gemini | `ALLOW_GEMINI_FALLBACK=false` check | Provider availability test |
| 8. Three drifted tool loops | Unified `AgentRuntime` & `ToolRegistry` | Tool loop test |
| 9. Mid-stream failures hang loop | Retry turn & emit `turn_reset` | Stream recovery test |
| 10. Recovery messages pollute text | Separate `turn_reset` event | Event stream test |
| 11. UI typewriter performance | Optimized `AiResponseView` with chunks | UI component test |

### 7 End-to-End Scenarios
1. Word report with chart (`create_document` + `create_chart`) -> Download and open `.docx` & `.svg/.png`
2. Excel workbook with live formulas (`create_spreadsheet`) -> Download and open `.xlsx`
3. 5-slide PowerPoint deck (`create_presentation`) -> Download and open `.pptx`
4. Drawing / SVG illustration (`create_drawing`) -> Download and open `.svg`/`.png`
5. Process flowchart / diagram (`create_diagram`) -> Download and open `.svg`
6. Uploaded PDF summary (`read_attachment` + summary) -> Verify text context
7. Sourced answer or "not found" (`search_knowledge` + citations) -> Verify source chips `[1]`
