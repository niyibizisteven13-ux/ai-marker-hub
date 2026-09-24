# Fix Server Crash and Restore Missing Endpoints

The server is currently unresponsive (`ERR_CONNECTION_REFUSED`) likely due to an unhandled promise rejection in the proactive analytics logic and missing API endpoints that were accidentally removed during recent refactors.

## Proposed Changes

### [Backend - Reliability & Persistence]

#### [MODIFY] [AnalyticsWorker.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server/services/AnalyticsWorker.ts)
- **Safe Execution**: Wrap `aggregateBatchPerformance` in a `try-catch` block.
- **Fix Hallucination**: Remove the call to `prisma.studentScript.findMany` since that table does not exist in the current schema. For now, it will return `null` with a TODO to implement proper persistence.

#### [MODIFY] [server.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server.ts)
- **Robust Background Tasks**: Add a `.catch()` block to the fire-and-forget call to `analytics.aggregateBatchPerformance` to prevent process crashes on failure.
- **Endpoint Restoration**: Restore missing endpoints from `server.ts.bak`:
    - `/api/generate-exam`
    - `/api/mark-script`
    - `/api/generate-rubric`
    - `/api/ai/summarize`
    - `/api/ai/translate`
- **Dependency Alignment**: Ensure all restored endpoints use the new `AiService` instance and comply with existing rate limiting/auth middleware.

## Verification Plan

### Manual Verification
- **Startup Check**: Verify the server starts without crashing and logs "Marker AI server running on http://0.0.0.0:3000".
- **Connectivity Check**: Verify that `GET /api/health` returns `200 OK`.
- **Functionality Check**: Test `/api/mark-script` with a sample payload to ensure it returns a marked script without crashing the background worker.
- **HMR Check**: Verify the Vite HMR WebSocket connection is restored once the Express server is up.
