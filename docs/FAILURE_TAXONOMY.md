# AI failure taxonomy and baseline evidence

Classify each failure at the narrowest layer supported by evidence. Do not label an absent trace or an unrun model evaluation as a product failure.

| Class | Evidence/signs | Typical owner/fix |
|---|---|---|
| Plumbing | Timeouts, truncated streams, missing events, provider mismatch, cancellation failure, silent fallback | Runtime, provider adapter, infrastructure |
| Prompt/routing | Wrong language, intent, format, task policy, or verbosity with valid context/tools | Prompt, intent router, model settings |
| Tool schema | Wrong tool or invalid/missing arguments | Tool definitions, intent-specific tool selection |
| Tool bug | Valid input causes an error, invalid artifact, or incorrect result | Tool implementation and independent verification |
| Retrieval | Supporting passage exists but is not retrieved, or citations do not support claims | Ingestion, chunking, retrieval, reranking, verifier |
| Parsing/OCR | Ground-truth text/table values are lost, corrupted, or uncertain scan content is treated as reliable | Parsing, OCR/vision, confidence display |
| Model limit | Repeatable failure with correct context, clear prompt, and valid tools | Capability-specific routing or task decomposition |
| Data | Missing, stale, conflicting, or ambiguous source/rubric | Knowledge governance, source owner, rubric review |
| UX | User cannot tell capabilities, progress, uncertainty, or recovery action | UI, progress events, error copy |
| Privacy/safety | Untrusted instructions are followed, data leaks, or opt-out/temporary data is reused | Safety controls, access checks, consent/data pipeline |
| Evaluation/observability | No reproducible task, missing trace, invalid grader, or metrics misrepresent what was measured | Eval harness, trace storage, test infrastructure |

## Baseline failures observed (2026-10-16)

Commands run before this implementation:

- `npm test`: 60 test cases; 44 passed and 16 failed. The security precheck passed.
- `npm run lint`: failed with existing TypeScript errors in the sample generator, missing test dependency typings, server/admin/route typings, and application types.

Observed failure classes in `npm test`:

1. **Test bootstrap/environment (5 suite failures):** multiple suites abort because `FILE_URL_SECRET` is not set in the test process. This does not establish a user-facing AI failure.
2. **Test-runner compatibility (7 suite failures):** test files importing Vitest APIs fail under the configured `node --test` runner with "Vitest failed to access its internal state."
3. **Persistence/test configuration (1 test failure):** prompt hydration test cannot initialize Prisma because the database is unavailable.
4. **Stale/incorrect production guard expectations (3 test failures):** SQLite URL rejection, JWT fallback secret, and production compose configuration assertions fail against current files.

The failures above are test/guard results, not classified production traces. No provider request, user chat content, student data, error logs, thumbs-down records, or correction records were used. No application database or deployed environment was available to mine; the requested 30-day top-20 production failure list is **NOT RUN**.

## Evidence-ranked next work

Ranking is constrained to observed evidence; user impact/frequency for production is unknown.

| Rank | Work | Evidence | Expected impact | Effort | Status |
|---|---|---|---|---|---|
| 1 | Make the configured test command consistent with the test APIs it runs | Seven suites abort importing Vitest state under `node --test` | Restore confidence in CI and regression checks; no direct model-quality claim | Medium | Not implemented here |
| 2 | Provide safe deterministic test configuration for required secrets and persistence | Five suites require `FILE_URL_SECRET`; one Prisma-backed test has no DB | Reduce environment-only failures and unblock reliability tests | Low-medium | Not implemented here |
| 3 | Reconcile production guard tests with the current deployment/auth configuration | Three source-guard assertions fail | Restore accurate production configuration checks | Medium | Not implemented here |
| 4 | Collect privacy-minimized request traces and run approved end-to-end evals | No per-request capability traces, replay records, or measured provider outputs were available | Enables evidence-based product fixes and model/cost comparison | High; requires schema, consent, admin UI, and provider decisions | Blocked on product/security decisions |

Do not infer a fix is effective from test bootstrap improvements alone. Re-run the same checks and separately evaluate real model outputs before claiming capability gains. The product owner has since approved an overall gate of no more than a 2 percentage-point capability regression and zero safety/leakage failures; no AI capability result is available to apply that gate yet.
