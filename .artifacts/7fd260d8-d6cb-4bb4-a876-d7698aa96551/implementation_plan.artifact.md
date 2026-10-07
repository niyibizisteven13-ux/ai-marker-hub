# Implementation Plan - Bwenge Phone Layout Single-Screen Chat-First Pattern

Transform the phone layout (viewport < 1024px) to follow a single-screen chat-first pattern: chat home, left navigation drawer, and full-screen sheets for Marking and Results. Keep desktop (>= 1024px) visually and functionally unchanged. Do not touch `server.ts` or backend files.

## User Review Required

> [!IMPORTANT]
> - **Phone Layout Overhaul**: Phone view (< 1024px) opens directly to chat home (`CreateStudio`), with a top-left drawer menu trigger, a top-center conversation title (when messages exist), and top-right new chat button + more menu.
> - **Marking & Results Sheets**: Marking and Results open as full-screen overlays (`MobileSheet`) above the chat with a header back button.
> - **Design Tokens**: Apply exact color tokens (`#262624` page bg, `#30302E` composer/menus, `#1F1E1D` drawer, `#141413` user bubble, `#FAF9F5` body text, `#C2C0B6` secondary, `#9C9A92` muted, `#D97757` accent send button, hairline borders).
> - **Input & Touch Targets**: Ensure font-size >= 16px on phone inputs, >= 44x44px hit areas for tappable controls, safe-area padding (`env(safe-area-inset-top/bottom)`), and `h-dvh` / `var(--app-h, 100dvh)` height handling.

## Proposed Changes

### 1. New Hooks & Components
- **[NEW]** [useIsMobile.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/hooks/useIsMobile.ts): `matchMedia` query hook for viewport < 1024px.
- **[NEW]** [useVisualViewportHeight.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/hooks/useVisualViewportHeight.ts): Sets CSS var `--app-h` using `window.visualViewport.height`.
- **[NEW]** [MobileSheet.tsx](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/components/MobileSheet.tsx): Full-screen overlay sheet for Marking and Results with header, back button, title, and optional scan button.

### 2. Global & Token Updates
- **[MODIFY]** [index.html](file:///C:/Users/niyib/Downloads/ai-marker-hub/index.html): Update viewport meta tag with `viewport-fit=cover, interactive-widget=resizes-content`.
- **[MODIFY]** [designTokens.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/utils/designTokens.ts): Add all requested mobile color and styling tokens.

### 3. Component Rewrites & Refinements
- **[MODIFY]** [App.tsx](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/App.tsx):
  - Import `useIsMobile`, `useVisualViewportHeight`, `MobileSheet`.
  - Remove `if (workspace.activeTab) state.setActiveTab(workspace.activeTab);` in workspace restore so users always open on chat.
  - Implement mobile branch rendering `CreateStudio` + `MobileSheet` for Marking/Results.
  - Wrap streaming / insight `setActiveTab('marking_hub')` calls with `if (!isMobile)`.
  - Clean up desktop/mobile conditional layout.
- **[MODIFY]** [CreateStudio.tsx](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/components/CreateStudio.tsx):
  - Rewrite render for chat-first experience (header with menu button, truncated title, new-chat; empty state with Bwenge logo mark, serif greeting, subtitle, 3 action chips; conversation auto-scroll with stick-to-bottom and "New response" pill; composer card docked at bottom with staged attachment preview, auto-growing textarea `text-base`, model picker, send/stop button).
- **[MODIFY]** [LeftSidebar.tsx](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/components/LeftSidebar.tsx):
  - Update drawer sizing (`w-[86vw] max-w-[300px] lg:w-64`), height (`h-dvh lg:h-screen`), padding (`env(safe-area-inset-top/bottom)`), lucide icons, mobile touch hit areas (>= 44x44px), recents list scroll behavior.
- **[MODIFY]** [ChatMessage.tsx](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/components/ChatMessage.tsx):
  - Update bubble styling, user attachment preview chips, and always-visible action row (`opacity-100` on mobile).

## Verification Plan

### Automated Tests
- Build verification using `run_shell_command` (`npm run build` and `npx tsc --noEmit`).

### Manual Verification
- Review responsive layout behavior at mobile viewport (< 1024px) and desktop (>= 1024px).
