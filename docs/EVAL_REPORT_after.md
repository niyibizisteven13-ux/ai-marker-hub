# Evaluation report after the first measurement pass

**Date:** 2026-10-16  
**Scope:** offline deterministic evaluation infrastructure only  
**Behavioral AI fixes:** none; no before/after product improvement is claimed

## Ran

```text
npm run eval -- --all --split dev
node --test --import tsx tests/eval_runner.test.ts
```

The evaluation runner executed **19 synthetic deterministic component cases**, each 3 times:

| Measure | Result |
|---|---:|
| Component cases passed | 19/19 (100%) |
| 95% Wilson interval across 19 cases | 83.2%-100.0% |
| Instability | 0/19 cases (0%) |
| Grader latency p50 / p95 | 0.056ms / 455.051ms |
| Model latency, tokens, and provider cost | NOT MEASURED (runner makes no model calls) |
| Held-out split | NOT RUN (no independent held-out data) |

The run covers six retrieval examples (including no-match), two DOCX generated and reopened checks, three citation checks, four extraction checks, and four JSON-schema checks. The 100% result is component-level only and is not an end-to-end capability success rate. Full per-case results are in [2026-10-16-all-dev.md](../evals/reports/2026-10-16-all-dev.md) and [2026-10-16-all-dev.json](../evals/reports/2026-10-16-all-dev.json).

The focused runner tests passed **4/4**. Capability-specific runs passed **A: 3/3** and **B: 1/1**. The full post-change `npm test` run completed with **48/64 passed and 16 failed**; the same 16 pre-existing environment, runner, database, and guard failures from the baseline remained, while all four new runner tests passed. `npm run lint` still fails with the same pre-existing diagnostics recorded in the baseline; there are no TypeScript diagnostics in the new evaluation runner or its test. The full suite creates untracked `combined.log` and `error.log` artifacts; those were removed after testing and the repository security precheck passed after cleanup. The pre-change suite result remains 44/60.

## What changed and evidence

| Change | Why | Evidence / trace IDs | Metric delta | Cost delta | Risk |
|---|---|---|---|---|---|
| Capability contract A-L | Establish measurable target definitions before tuning | Synthetic contract; production trace IDs unavailable | Not applicable; proposed criteria are not approved | None measured | Thresholds need product-owner approval |
| Failure taxonomy and baseline report | Classify known test evidence without mislabeling it as user failures | `npm test`, `npm run lint`; no production traces available | Test suite: 44/60 before, 48/64 after with the same 16 failures; type-check failed | Not measured | Current dirty worktree means findings apply to this worktree state |
| Offline component eval runner and 19 synthetic tasks | Make deterministic retrieval/citation/extraction/schema/DOCX checks repeatable | `npm run eval -- --all --split dev`; no model calls | 19/19; 0% instability; no pre-existing comparable runner | No provider cost; local grader cost not measured | Small English-only, non-representative dev set |
| Privacy-minimized agent traces and admin telemetry | Persist operational metadata for unified agent requests and surface 7-day aggregates | `node --test --import tsx tests/ai_trace.test.ts tests/eval_runner.test.ts`; 5/5 passed, including one synthetic trace assertion | No model behavior delta measured; trace latency, errors, retries, and capability aggregates are now recorded for observed requests | Provider cost remains NOT MEASURED; trace rows store `costUsd` as null until reliable provider cost data is available | Covers `bwengeAgent` runs only; dashboard aggregates the 500 newest traces; database migration must be deployed; trace replay is unavailable because prompt/output/tool content is not retained |
| Bound streamed chat generation length | Reduce wasted generation time on routine turns while preserving the larger agent workflow limit | `node --test --import tsx tests/ai_trace.test.ts tests/chat_provider_failures.test.ts`; 5/5 passed; synthetic adapter confirmed `max_tokens` is forwarded | Simple small-talk cap: 256 tokens; regular streamed chat cap: 2,048 tokens instead of 8,192. End-to-end latency delta is NOT MEASURED because no provider calls were made | Provider cost delta NOT MEASURED; shorter maximum output can reduce output-token spend for turns that previously used more than the new cap | Could truncate unusually long chat answers; complex tool workflows keep the existing 8,192-token limit |

## Not run / remaining

- End-to-end evaluations A-L, provider/model comparison, prompt/tool routing experiments, and deployment validation.
- 30 tasks per capability, 100+ teacher-marked/synthetic marking cases, three-language coverage, adversarial injection suite, and an independently curated held-out split.
- Cost per 100 model tasks, model p50/p95 latency, human/native-speaker judge calibration, and before/after capability deltas.
- Trace replay, complete instrumentation of legacy provider paths, explicit model routing configuration, versioned prompt rollout, self-verifying file/drawing tools, rubric authoring/calibration, and canary/rollback gates.
- Production log/feedback/correction mining and a top-20 failure list; the available local database was not inspected for user content.
- Applying the new `AiTrace` schema migration and verifying live database telemetry in the deployed environment.

Those steps require a representative synthetic benchmark, a positive provider spend cap (the current cap is $0 per 100 tasks), any needed per-capability thresholds, and access to an appropriate staging/deployed environment. The approved overall regression and data-handling decisions are recorded in [CAPABILITY_CONTRACT.md](./CAPABILITY_CONTRACT.md).
