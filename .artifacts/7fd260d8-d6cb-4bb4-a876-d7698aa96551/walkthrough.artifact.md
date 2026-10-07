# Walkthrough - Bwenge Phone Layout Single-Screen Chat-First Pattern

I have successfully implemented the single-screen chat-first phone layout pattern for viewports < 1024px while keeping the desktop experience (>= 1024px) unchanged.

## Changes Made

### 1. New Hooks & Components
- **`useIsMobile.ts`**: Reactive media query hook checking `(max-width: 1023px)`.
- **`useVisualViewportHeight.ts`**: Tracks `window.visualViewport.height` and updates `--app-h` CSS variable to prevent keyboard overlap.
- **`MobileSheet.tsx`**: Full-screen slide-in overlay sheet for Marking and Results with a header back button (`ArrowLeft`, 44x44px hit area) and optional scan button.

### 2. Viewport & Design Tokens (`index.html`, `designTokens.ts`)
- Added viewport meta tag with `viewport-fit=cover, interactive-widget=resizes-content`.
- Updated color and radius tokens to match the requested specs (`#262624` page bg, `#30302E` composer/menus, `#1F1E1D` drawer, `#141413` user bubble, `#FAF9F5` body text, `#D97757` send accent).

### 3. Component Updates
- **`CreateStudio.tsx` (Chat Home & Conversation)**:
  - Phone header: menu button (left), truncated conversation title (center), new-chat button + more menu (right).
  - Empty state: Bwenge logo mark, serif greeting ("Good morning/afternoon/evening, {name}"), subtitle, and 3 action chips ("Upload student paper", "Scan answers", "Create an exam").
  - Conversation: stick-to-bottom scroll tracking with "New response" pill when scrolled up.
  - Composer card: docked at bottom with staged attachment preview chips, auto-growing textarea (`text-base`), model picker, and send/stop button.
- **`LeftSidebar.tsx` (Drawer)**:
  - Slide-in left drawer (`w-[86vw] max-w-[300px]`, `h-dvh`), safe-area padding, touch targets >= 44x44px, and clean lucide icons for Chat, Marking, and Results.
- **`ChatMessage.tsx`**:
  - Uncapped assistant message width, user attachment chips above bubbles, and always-visible action buttons on mobile.
- **`App.tsx`**:
  - Default startup on `documents` (chat home), mobile sheet routing for Marking and Results, and clean separation between mobile single-screen pattern and desktop multi-pane layout.

## Verification Results
- `npm run build` completed successfully with exit code 0.
