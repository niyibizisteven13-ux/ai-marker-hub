# Task List: Refactor AiService and Integrate Bwenge AI Capabilities

- `[x]` Review and approve updated implementation plan
- `[/]` Refactor `AiService.ts` to integrate `createAiAgent`, `FileStore`, AbortSignal, and fix fallback/streaming
- `[ ]` Mount `createFileRouter` in `server.ts` and add `.env.example` settings
- `[ ]` Update frontend chat client to handle `attachment`, `sources`, `turn_reset` and render `AiResponseView`
- `[ ]` Run automated checks (`npm run verify`, `tsc --noEmit`, `npm run lint`)
- `[ ]` Verify 7 end-to-end generation scenarios
- `[ ]` Create walkthrough artifact
