# Prompt for your coding agent (paste this, with the bwenge-ai-capabilities folder attached)

You are a senior TypeScript engineer working in the Bwenge codebase. I have added a folder `bwenge-ai-capabilities/` containing a tested capability layer (agent runtime, file generators, drawing tools, upload extraction, signed downloads, React components). Integrate it into the existing project. Do not rewrite it; use it as is and fix integration issues.

Read first: `docs/README.md`, `docs/INTEGRATION.md`, `docs/AISERVICE_FIXES.md`. The existing file to change is `server/services/AiService.ts`.

Do, in order:
1. Copy `src/ai/` to `server/services/ai/`, the four UI files (not the MarkdownRenderer placeholder) into the components folder, and install the dependencies listed in INTEGRATION.md. Add the environment variables to `.env.example` (never commit secrets).
2. Create `server/services/ai/agent.ts` exactly as in INTEGRATION.md section 2, mapping our `KnowledgeRetrievalService` and `ExecutionSandbox` to the small `ToolServices` shapes. If an API differs, adapt the mapping, not the library.
3. Mount `createFileRouter` at `/api/files` using our existing auth middleware to get the user id, and add the hourly `purgeExpired` job.
4. Replace the Gonka branch of `generalAssist` as in INTEGRATION.md section 4. Keep memory context and pinned syllabus behavior. Keep `extractSchema` working (no tools).
5. Forward `AgentEvent`s over our existing SSE channel. Update the chat client to handle `attachment`, `sources`, and `turn_reset`, and render `AiResponseView` with `attachments`, `sources`, and `animate={false}` for messages loaded from history.
6. Persist `attachments` and `sources` with assistant messages; on load, call `fileStore.refresh` for each attachment and show expired files as expired.
7. Apply the fixes in AISERVICE_FIXES.md that remain relevant after the change (items 3, 7, 8 especially). Make the Gemini fallback explicit and configurable, and show a visible notice when it is used.
8. Add tests for the integration (agent mapping, router auth, history refresh). Do not delete the library tests.

Rules: TypeScript strict; no secrets in code; do not log message content or file contents; user-supplied text and files are untrusted data; keep the library's security behavior (SVG sanitizer, signed links, ownership checks).

Verify and report with REAL output (never write PASS for anything you did not run; write NOT RUN with the reason):
- `npm run verify` (typecheck + all tests) in the library and in the app.
- A manual or scripted end-to-end check for each of: "make a Word report with a chart", "make an Excel mark sheet with a total formula", "make a 5-slide deck", "draw a simple farm scene", "make a flowchart of the marking process", "read this uploaded PDF and summarise it", "answer a Rwanda statistics question with sources and say 'not found' when there is none". For each, state what the user sees and whether the download opens.
- Confirm a different logged-in user cannot download another user's file, and that a tampered link returns 403.
Finish with: files changed, commands run with outputs, anything not verified, and decisions I need to make.
