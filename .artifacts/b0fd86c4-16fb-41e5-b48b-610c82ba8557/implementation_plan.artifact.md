# Implementation Plan - Bwenge Chat UI Kit & Live SSE Server Integration

Integrate the full `bwenge-chat-ui` kit server-side and client-side into `ai-marker-hub` (`server/routes/chatSseRoutes.ts` or `server.ts`, `server/services/ai/thinkingRelay.ts`, and client chat streaming components) so that users experience real Claude-style thinking summaries, tool status updates, elapsed timers, step histories, and streamed responses.

## User Review Required

> [!IMPORTANT]
> This plan introduces an SSE chat endpoint supporting both Anthropic Claude streaming (with adaptive thinking summaries and tool status descriptions) and mock mode, along with the UI components (`ActivityLine`, `Spark`, `StreamingMessage`, `useChatStream`) matching the exact specification from the `bwenge-chat-ui` kit.

## Proposed Changes

### [Backend]

#### [NEW] [thinkingRelay.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server/services/ai/thinkingRelay.ts)
- Turns streamed model thinking into occasional one-line status updates (`status` events).

#### [NEW] [chatSseRoutes.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server/routes/chatSseRoutes.ts)
- Express SSE endpoint `/api/chat` handling Claude API streaming (with adaptive thinking summaries and tool status execution) or mock mode when no API key is set, with proper header flushing, heartbeat pings, and disconnect abort handling.

#### [MODIFY] [server.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server.ts)
- Mount chat SSE routes.

### [Frontend]

#### [MODIFY] [ChatMessage.tsx](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/components/ChatMessage.tsx)
- Use `ActivityLine`, `Spark`, and `StreamingMessage` to display real-time thinking status, tool steps, elapsed time, and streaming text.

## Verification Plan

### Automated Tests
- Type check (`npx tsc --noEmit`) and server build validation.

### Manual Verification
- Test chat SSE endpoint and UI message streaming behavior.
