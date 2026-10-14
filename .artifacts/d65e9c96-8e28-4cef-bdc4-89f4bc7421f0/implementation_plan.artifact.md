# Implementation Plan: Bwenge AI Marker Hub Gaps & UX Enhancements

This implementation plan addresses the key friction points and gaps identified in the end-to-end user journey audit (Landing -> Onboarding -> Core Usage -> UX).

## User Review Required

> [!IMPORTANT]
> This plan introduces robustness improvements across AI grading fallbacks, individual script retries in batch marking, in-app browser OAuth handling, and first-time user onboarding.

## Open Questions
- None. The approach leverages existing utility structures (`aiFallback.ts`, `authService.ts`, etc.) to ensure seamless fallback and resilience.

## Proposed Changes

### Authentication & Landing (`src/components/AuthFlow.tsx`)
- Add an automatic *"Open in External Browser"* helper button when in-app webview detection triggers (`isInAppBlocked`), allowing users to easily escape restricted in-app browsers (Instagram, Facebook) for Google OAuth.

### Onboarding & Workspace (`src/App.tsx` & `src/components/CompleteBwengeStudio.tsx`)
- Add a dismissible **Quick-Start Onboarding Banner / Tour** for first-time or returning users landing in the studio, guiding them through Exam Creation -> Rubric -> AI Marking.

### AI Marking & Fallbacks (`src/components/Step4AIMarks.tsx` & `src/utils/aiFallback.ts`)
- Enhance Step 4 (`Step4AIMarks.tsx`) to support **individual script retry buttons** when a script fails marking, rather than forcing a full re-batch.
- Integrate robust offline/missing API key fallback logic so exam generation and script grading succeed with realistic mock data if backend API keys are absent.

## Verification Plan

### Automated Tests
- Build verification (`npm run build`) to ensure TypeScript compilation and asset bundling succeed.

### Manual Verification
- Test in-app browser OAuth warning & external browser button.
- Verify batch marking with individual script retry error handling.
- Verify onboarding banner display and dismissal.
