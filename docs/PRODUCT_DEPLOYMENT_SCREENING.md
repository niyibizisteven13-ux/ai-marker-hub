# Product and deployment screening

**Screened:** 2026-10-18
**Product:** Bwenge AI Marking Studio (`ai-marker-hub`)
**Deployment target:** Self-managed Hetzner CX33; manual deployments by the owner.
**Scope:** AI capability, service delivery, product design, and production readiness.

## Readiness assessment

The repository contains a functioning product core: rubric-based marking, exam and form workflows, a chat interface, document ingestion, retrieval, generated files, admin knowledge tools, and AI evaluation scaffolding. It is not yet possible to call the service production-ready from repository evidence alone. Provider quality and spend, production database state, email delivery, persistent storage, recovery, and an end-to-end release run still require operator verification.

The deeper implementation inventory and historical hardening record are in [AI capability audit](AI_CAPABILITY_AUDIT.md). This screen narrows that work to launch decisions.

## Release blockers and gates

| Priority | Area | Finding | Required before public launch |
|---|---|---|---|
| P0 | Production migration | The removed Fly config used `prisma db push --accept-data-loss`, which can apply unreviewed destructive schema changes. | Use the Hetzner runbook's `prisma migrate deploy`; rehearse the checked-in migrations on a production-like database and verify backup/restore first. |
| P0 | AI quality and spend | The evaluation contract says model evaluations are not authorized above a $0 spend cap; provider quality, marking agreement, and Kinyarwanda/French quality are not measured to launch thresholds. | Agree a provider budget, run a cost-bounded synthetic benchmark, establish teacher review for marking, and keep unmeasured capabilities explicitly experimental. |
| P0 | Persistent user data | The app writes generated files and job/export state to local `./data` and `./exports`. | Keep both paths on durable Hetzner storage, set ownership for the app user, and test restart/release behavior and restore from backup. |
| P0 | Production configuration | Production requires PostgreSQL plus stable 32-character `JWT_SECRET` and `FILE_URL_SECRET`; provider keys and SMTP settings are separate. Repo configuration cannot establish that the live secrets, email sender, domain, and callbacks are correct. | Configure secrets in the deployment platform; verify OTP delivery, provider access, billing callbacks, and authentication using staging accounts. |
| P1 | Service reliability | The process uses in-process queues and therefore must remain single-instance. A CX33 is the intended initial host. | Keep one PM2 fork process until queue and file state are externalized; monitor RAM and disk while OCR and AI tasks run. |
| P1 | AI capability scope | Web, image, Python, scan, and synthetic media features have flags and varying maturity. Several capabilities need human review or are not true provider generation. | Launch only the documented, enabled capability set. Keep unsupported/mock surfaces off and show honest states when extraction or generation is incomplete. |
| P1 | Abuse and cost controls | There are IP limits, but no unified per-user/org AI budget and cost enforcement across all model paths. Public forms also need monitoring for abuse. | Set user/org quotas and provider spend alerts/circuit breakers; review public form throttles and alerting before broad signup. |
| P1 | Support and operations | Health checks cover database reachability, but a production operating model (alerts, incident ownership, support SLA, retention/deletion, and restore rehearsal) is not demonstrated by the code. | Name an operator, define support and incident procedures, set retention policy, and rehearse database and file recovery. |

## AI product plan

1. **Make marking reviewable.** Keep rubric criteria, awarded marks, evidence excerpts, confidence/uncertainty, and teacher corrections together. Require a teacher decision for low-confidence OCR or marking. Never silently convert unreadable work into a score.
2. **Measure before advertising.** Build a versioned synthetic benchmark for rubric marking, OCR, exam generation, retrieval/citations, and language. Report teacher agreement, within-one-mark rate, OCR accuracy, groundedness, latency, token use, and cost. Keep held-out examples separate.
3. **Unify provider behavior.** Use one explicit provider/model selection and failure policy across chat, marking, forms, and background jobs. Track per-user/org tokens and estimated cost, apply hard budgets, and provide retryable errors rather than success-shaped defaults.
4. **Make context visible.** Show which rubric/documents informed an answer, allow a reviewer to open evidence, and clearly label missing or weak evidence. Preserve tenant and consent boundaries recorded in the AI audit.
5. **Expose capabilities as services.** Organize the product around clear tasks: Mark submissions, Create an assessment, Build a form, Ask Bwenge, and Review results. Each service needs a short input checklist, expected output, price/usage impact, status, and a recoverable failure path.
6. **Close the feedback loop safely.** Keep teacher corrections private by default. Only approved, consented, PII-reviewed samples can enter evaluation or datasets, with lineage and rollback.

## Product design direction

The current product already has a visual foundation and responsive workflows. The main design risk is inconsistency: the sign-in experience, dark navigation, light assessment surfaces, and multiple older/newer studio components use different styles and labels. Evolve the existing product instead of layering on a second design system.

An initial navigation polish is included with this screening: the user-facing “Agent” label is now “Marking”, the new-chat action uses the product icon set instead of an emoji, and primary navigation actions show a visible keyboard focus ring. This is a first step; the end-to-end workspace redesign and responsive visual review remain release work.

- **Visual language:** warm paper surfaces for reading and review; deep ink navigation; one terracotta action color; restrained teal for verified/complete states. Standardize spacing, type scale, borders, radii, and focus rings through the existing design tokens.
- **Core workspace:** a clear three-part flow — setup (assessment and rubric), submissions (documents and review queue), and results (class summary and export). Keep the active task and batch status visible; collapse secondary controls until needed.
- **AI states:** distinguish `Ready`, `Working`, `Needs review`, `Could not complete`, and `Complete`. Pair every AI score with evidence and a direct correction action. Do not use generic success metrics or fabricated confidence.
- **Service discovery:** make the five primary tasks above the first-level navigation. Name “Agent” by what it does for the user (for example, “Marking” or “AI assistant”) and reserve “Agent” for technical/admin language.
- **Accessibility and mobile:** preserve keyboard navigation, visible focus, contrast, touch targets, reduced motion, and a single-column review flow on phones. Keep upload and status feedback available without hover.
- **Design quality gate:** review core flows at mobile, tablet, and desktop sizes; test keyboard-only and screen-reader labels; verify empty, loading, partial, error, and success states before release.

## Deployment sequence

1. Use the Hetzner VPS runbook in [DEPLOY.md](DEPLOY.md); keep one PM2 fork process. Deploy manually from the server; CI auto-deploy workflows have been removed.
2. Back up the production database and durable files; rehearse restore.
3. Provision PostgreSQL and durable storage; set stable production secrets and only the AI/SMTP credentials for enabled features.
4. Run `npm ci`, `npm run lint`, `npm test`, `npm run build`, then `npx prisma migrate deploy` against staging. Review failures; do not use `db push` to reconcile production.
5. Exercise sign-in/OTP, upload, marking, human correction, results export, file download, rate limiting, and error/retry paths in staging with synthetic data.
6. Run a bounded AI benchmark and confirm provider spend; deploy a canary with a rollback point.
7. Verify health, logs, alerts, backups, storage persistence after restart, and one-machine queue behavior. Increase capacity only after moving shared queue/state out of process.

## Current decision

**Do not treat this screening as deployment approval.** Deployment remains gated on durable Hetzner storage, an approved AI spend envelope and quality thresholds, staging verification, and a successful recovery rehearsal. The workspace contains an unrelated pre-existing edit in `.idea/caches/deviceStreaming.xml`; it was not changed as part of this screening.
