# Forms: AI form building, research-ready data and analysis

Forms, surveys and questionnaires are created, changed, checked, published and analysed **from the chat**. The
form editor and the results page are the same data seen another way, and "Ask Bwenge" is open beside them.

## Where it lives

| Part | File |
|---|---|
| Canonical model (fields, variables, measurement levels, branching rule, codebook) | `server/services/forms/model.ts` |
| Server-side validation of submissions (branching-aware) and of form definitions | `server/services/forms/validation.ts` |
| Versions (a published definition is frozen; responses record their version) | `server/services/forms/versions.ts` |
| Deterministic statistics (no LLM arithmetic) | `server/services/forms/stats.ts` |
| Dataset, coverage, summaries, crosstab / group comparison / correlation | `server/services/forms/analysis.ts` |
| Readiness review | `server/services/forms/review.ts` |
| AI generation and editing (structured output, checked before saving) | `server/services/forms/generate.ts` |
| Owner operations (ownership checks, open/close, links) | `server/services/forms/service.ts` |
| Chat tools | `server/services/ai/tools/formTools.ts` |
| Form studio page (`/forms/:id/edit`) | `src/pages/FormStudioPage.tsx` |
| Ask Bwenge drawer (form editor and marked-exam review) | `src/components/AskBwengeDrawer.tsx` |

## Chat tools

`create_form`, `edit_form`, `review_form`, `publish_form`, `list_forms`, `analyze_form`, `form_report`.
The planner routes form requests to them (`intent: 'form'`). A request for a web page about figures that merely
came from a survey ("make a web page showcasing these survey figures") stays an HTML report, unless it names a
saved form ("my survey", "this form"). Set `ENABLE_FORM_TOOLS=false` to switch the tools off.

New forms are always drafts. Publishing checks the definition (duplicate ids, empty choice lists, min > max,
branching that points to a missing or later question or to a value that is not an option) and records a version.

## Readiness score

`Q = 0.25·C + 0.20·V + 0.20·L + 0.20·P + 0.15·A` (completeness, validity, language, privacy, analysability), each 0–100.
Critical findings (for example personal data without a consent statement) block "ready" whatever the score.

## Statistics

All numbers come from code: frequencies and percentages, descriptives (mean, SD, median, quartiles, skewness,
outliers), crosstab with chi-square, Cramér's V and a small-cell warning, group comparison (ANOVA F, p, η²),
Pearson and Spearman correlation with p-values. The method is chosen from the measurement levels, and unsuitable
requests are refused with the reason. Questions hidden by branching count as "not shown", not as missing.

`form_report` produces an HTML report and an Excel workbook (Responses, Codebook, Response rates).

## Studio endpoints (owner only)

- `GET /api/forms/:id/studio`: form, links, response count, review, versions, codebook, per-question summaries.
- `PUT /api/forms/:id/schema` `{schema}`: saves the editor's form (never opens or closes it), returns the review.
- `POST /api/forms/:id/open` `{open}`: opens (after the definition check, records a version) or closes the form.

The public submit endpoint validates every answer on the server and stores `formVersion`.

## Ask Bwenge beside the work

The drawer posts to `/api/ai/chat` with `surface: 'form' | 'exam'` and `surfaceId`. On a form, the request is
treated as "edit my form …" for that form; on a marked exam, the exam chat is focused on that exam, so questions
about a student or a mark need no ids. When the reply ends, the page reloads what changed.

## Deploy

Run `npx prisma migrate deploy` (migration `20261025000100_form_versions` adds `FormVersion` and
`FormSubmission.formVersion`).

## Not built yet

Form generation from an uploaded document, conversational (chat-style) filling for respondents, multilingual
versions, collaboration, a template library and survey weighting.
