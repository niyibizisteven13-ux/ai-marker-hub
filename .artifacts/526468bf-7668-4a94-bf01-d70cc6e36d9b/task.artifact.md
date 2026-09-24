# Tasks: Backend Reliability and Cost-Tracking Implementation

- [x] Update Prisma schema with `JobCostLog` and `FailedJob` models
- [x] Implement `server/services/CostTrackingService.ts`
- [x] Implement `server/services/reliableJobRunner.ts`
- [x] Modify `server/services/AiService.ts` to return token usage in Claude responses
- [x] Integrate `runWithRetry` and `logJobCost` into `server/services/GradingService.ts`
- [x] Integrate `runWithRetry` and `logJobCost` into `server/services/FormScoringService.ts`
- [x] Create `server/routes/adminRoutes.ts` for margin checking
- [x] Register `adminRoutes` in `server.ts`
- [x] Verify implementation with unit tests/manual checks
- [x] Update `worker.ts` and `server.ts` to pass `batchId` to `GradingService`

## Phase 2: Pre-flight Validation & Circuit Breaker
- [x] Implement `server/services/preFlightService.ts` (garbage check + rubric health)
- [x] Implement `server/services/CostCircuitBreakerService.ts`
- [x] Enhance Zod schemas in `server/middleware/validation.ts`
- [x] Integrate Pre-flight into `GradingService.ts`
- [x] Integrate Circuit Breaker into `reliableJobRunner.ts`
- [x] Add admin endpoints for spend monitoring and circuit reset in `server/routes/adminRoutes.ts`
- [x] Verify Pre-flight logic (blank/garbage inputs)
- [x] Verify Circuit Breaker logic (threshold trip)
