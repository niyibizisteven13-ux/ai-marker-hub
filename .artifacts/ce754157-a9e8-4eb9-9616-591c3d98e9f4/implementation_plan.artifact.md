# Integration Plan: Bwenge AI Capabilities into AI Marker Hub

Integrate the `bwenge-ai-capabilities` package into the `ai-marker-hub` project and analyze how to inject and utilize its agent runtime, file tools, and UI components.

## User Review Required

> [!IMPORTANT]
> - **Folder Placement**: We will copy the `bwenge-ai-capabilities` folder directly into the root of `ai-marker-hub` (or `packages/bwenge-ai-capabilities`).
> - **Dependency Merging**: We need to add `bwenge-ai-capabilities` dependencies (`@dagrejs/dagre`, `docx`, `pptxgenjs`, `vega`, `vega-lite`, `pdf-lib`, `jszip`, `sanitize-html`, etc.) to root `package.json`.

## Open Questions

- Should `bwenge-ai-capabilities` be treated as a local workspace package or imported directly via relative paths? (Recommendation: Local subfolder `bwenge-ai-capabilities` with path/workspace reference or direct imports).

## Proposed Changes

### Root / Project Structure
#### [NEW] [bwenge-ai-capabilities](file:///C:/Users/niyib/Downloads/ai-marker-hub/bwenge-ai-capabilities)
- Copy the entire `bwenge-ai-capabilities` folder from `C:/Users/niyib/Downloads/bwenge-ai-capabilities/bwenge-ai-capabilities` to `C:/Users/niyib/Downloads/ai-marker-hub/bwenge-ai-capabilities`.

#### [MODIFY] [package.json](file:///C:/Users/niyib/Downloads/ai-marker-hub/package.json)
- Add missing dependencies required by `bwenge-ai-capabilities` (e.g. `@dagrejs/dagre`, `docx`, `pptxgenjs`, `vega`, `vega-lite`, `pdf-lib`, `jszip`, `sanitize-html`, `@pdf-lib/fontkit`, `@resvg/resvg-js`, `@expo-google-fonts/inter`).
- Add workspace or dependency link if needed.

### Integration Analysis & Injection Points
#### Backend Integration (`server/`)
- Inject `AgentRuntime`, `createAiAgent`, and file/drawing/chart tools into Express routes or services in `server/routes/` or a new `server/services/bwengeAiService.ts`.

#### Frontend Integration (`src/`)
- Integrate UI components (`AiResponseView`, `MarkdownRenderer`, `SourceList`, `AttachmentCards`) into frontend pages or components.

## Verification Plan

### Automated Tests
- Run `npm run verify` (which runs `tsc --noEmit`, `vitest` / tests, and build) in `ai-marker-hub`.
- Run typechecking on `bwenge-ai-capabilities`.

### Manual Verification
- Verify server starts successfully with `npm run dev`.
- Verify frontend compiles without TypeScript errors.
