# Baseline evaluation report

**Date:** 2026-10-16  
**State measured:** existing worktree before adding the evaluation harness or changing AI behavior  
**Data:** synthetic tests only; no personal or student data submitted to a provider

## Baseline results

| Measurement | Result | Interpretation |
|---|---:|---|
| Existing test cases | 44/60 passed (73.3%) | 16 failed; see [FAILURE_TAXONOMY.md](./FAILURE_TAXONOMY.md) |
| Security precheck (`npm run security:check`) | PASS | The `npm test` command's repository secret/artifact check passed |
| TypeScript check (`npm run lint`) | FAIL | Existing diagnostics span generator, test typings, server routes/admin, and app types |
| End-to-end capability success by A-L | NOT RUN | No approved model evaluation run, independent graders, or representative task corpus |
| Provider/model benchmark, model latency, tokens, cost per 100 tasks | NOT RUN | No approved benchmark/provider invocation; no results are inferred from local tests |
| Retrieval recall/groundedness/citation metrics on a representative set | NOT RUN | Existing unit tests cover a few synthetic cases, not a representative corpus |
| Marking agreement, repeated-run consistency, flag precision | NOT RUN | No teacher-labeled, consented sample or 100+ synthetic rubric benchmark is present |
| Held-out test split | NOT RUN | No independently curated held-out set was provided; do not tune or report held-out metrics |
| Production failure mining/top 20 | NOT RUN | No production trace store or approved access to the requested sources was available |
| Deployment verification | NOT RUN | No deployed environment was exercised |

### Existing test command

```text
npm test
```

Observed summary: **60 tests, 44 pass, 16 fail**. The security precheck passed. Failures were primarily test-runner/environment setup, one unavailable-database test, and three source-guard assertions; they are not evidence of model capability success or failure.

### Existing type-check command

```text
npm run lint
```

Result: **FAIL** with diagnostics already present in the worktree before this task's changes. The baseline diagnostics include `bwenge-ai-capabilities/scripts/make-samples.ts`, missing `@testing-library/react` typings, `server.ts`, `server/routes/adminRoutes.ts`, `server/routes/agentRoutes.ts`, `server/routes/telegramBotRoutes.ts`, `server/services/executeAgentTool.ts`, `src/App.tsx`, `src/db.ts`, and existing tests.

## Evaluation limitations and next evidence required

The repository's existing unit tests exercise retrieval ranking, extraction warnings, citation validation, provider error parsing, and no-fabricated-assessment handling. They are useful component regressions, not evaluations of the live AI system. A new offline deterministic runner measures a small synthetic component set; its grader latency is not model latency, and it makes no model calls. Current coverage is below the contract minimum of 30 tasks per capability and 100 marking tasks. No held-out, native-speaker, teacher-marked, or provider/cost result is claimed.

Before implementation of provider routing, prompt, training, or model-quality changes, obtain product-owner approval for capability thresholds, model/provider/data approval, per-request cost limits, correction-data consent, Kinyarwanda review, and teacher review capacity. See [CAPABILITY_CONTRACT.md](./CAPABILITY_CONTRACT.md).
