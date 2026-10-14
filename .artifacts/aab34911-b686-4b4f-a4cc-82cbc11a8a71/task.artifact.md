# Task List: Refactor AiService and Integrate Bwenge AI Capabilities

- `[x]` Review and approve updated implementation plan
- `[x]` Refactor `AiService.ts` to integrate `createAiAgent`, `FileStore`, AbortSignal, and fix fallback/streaming
- `[x]` Mount `createFileRouter` in `server.ts` and add `.env.example` settings (`FILE_URL_SECRET`, `FILE_STORE_DIR`, `ALLOW_GEMINI_FALLBACK`)
- `[x]` Update chat client wrappers and migrate legacy Gonka/Claude methods to `bwengeAgent.run`
- `[x]` Create walkthrough artifact
