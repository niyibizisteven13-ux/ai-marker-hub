# Pre-flight Validation and Cost Circuit Breaker Plan

Implement additional layers of protection to ensure high-quality AI inputs and prevent runaway costs.

## User Review Required

> [!IMPORTANT]
> **Heuristic Definitions**: The "garbage input" heuristic currently checks for minimum text length and empty answers. We may need to tune these thresholds based on real-world data (e.g., how short can a valid short answer be?).
>
> **Spend Thresholds**: The Circuit Breaker will default to a $50/hour threshold. You can adjust this in the `CostCircuitBreakerService` or via environment variables.

## Proposed Changes

### Pre-flight Validation Layer

#### [MODIFY] [validation.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server/middleware/validation.ts)
- Add deeper Zod validation for `examPaper` (rubric structure) and `studentScript` (answer presence).
- Ensure required fields like `maxMarks` and `criteria` are present in rubrics.

#### [NEW] [preFlightService.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server/services/preFlightService.ts)
- Implement `validateScriptQuality(script)`: Flags scripts with no answers or pure whitespace/garbage OCR text.
- Implement `validateRubricHealth(rubric)`: Checks if the rubric makes logical sense (e.g., total marks match the exam paper).

#### [MODIFY] [GradingService.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server/services/GradingService.ts)
- Call `preFlightService` before initiating any AI grading.
- If validation fails, return a "Needs Teacher Review" result immediately without calling the AI, saving tokens.

---

### Cost Circuit Breaker

#### [NEW] [CostCircuitBreakerService.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server/services/CostCircuitBreakerService.ts)
- Periodically (or per-call) check `JobCostLog` for cumulative spend in the last hour.
- Implement a `checkCircuitState()` function that throws an error if the spend threshold is exceeded.
- Provide an admin override to reset the circuit.

#### [MODIFY] [reliableJobRunner.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server/services/reliableJobRunner.ts)
- Integrate `CostCircuitBreakerService.checkCircuitState()` at the beginning of `runWithRetry`.
- If the circuit is "open" (tripped), the job will fail immediately with a `CostCircuitBreakerError`.

---

### Administration

#### [MODIFY] [adminRoutes.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server/routes/adminRoutes.ts)
- Add endpoints to view current spend vs. threshold.
- Add an endpoint to manually trip or reset the circuit breaker.

## Verification Plan

### Automated Tests
- Unit tests for `preFlightService` with edge cases: empty scripts, malformed rubrics, and high-quality inputs.
- Unit tests for `CostCircuitBreakerService` using mocked `JobCostLog` data to trip the circuit.

### Manual Verification
- Upload a blank image/document to the grading flow and verify it is flagged without an AI call.
- Artificially lower the circuit breaker threshold and verify that new jobs are rejected until reset.
