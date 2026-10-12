# Bwenge Studio UI/UX & Feature Enhancement Plan

This implementation plan details the comprehensive UX/UI refinements requested for Bwenge Studio (AI Marker Hub), aligning the interface with modern AI studio standards, Kinyarwanda/multilingual support, trustworthy citations, consistent color palettes, and robust mobile/desktop layouts.

## User Review Required

> [!IMPORTANT]
> **Authentication & Routing State:** Unauthenticated users will now correctly see the Landing Page / Sign-in state (with Sign in as the primary amber button, hiding Upgrade until signed in), and `/signup` or guest states will not mistakenly expose the chat interface.

> [!NOTE]
> **Language & Greetings:** Time-based greetings in Kinyarwanda (**Mwaramutse** for morning, **Mwiriwe** for afternoon and evening) combined with the user's name when signed in.

## Open Questions

- *None.* All requirements for starter cards, composer tools, trust chips, footer disclaimer, three-dots menu structure, and mobile responsiveness are fully specified.

## Proposed Changes

### [UI & Components]

#### [MODIFY] [CompleteBwengeStudio.tsx](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/components/CompleteBwengeStudio.tsx) and [ModernBwengeStudio.tsx](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/components/ModernBwengeStudio.tsx)
- Integrate modernized starter cards by task: **Rwanda's data**, **Mark an exam**, **Farming advice**, **Write or translate**.
- Implement dynamic Kinyarwanda greetings (**Mwaramutse** / **Mwiriwe**) with user name when authenticated.
- Top bar cleanup: remove redundant brand name when next to sidebar, add mode selector (Auto, Fast, Deep) and clean chat title.

#### [MODIFY] [CompactInputBar.tsx](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/components/CompactInputBar.tsx) / Input Composer
- Add microphone button for voice input (Kinyarwanda voice support).
- Transform `+` button into a popover action menu (Upload file, Camera scan, Paste text).
- Remove vendor name references like "GonkaRouter".
- Add "Sources" toggle and "Answer in" language selector underneath the text box.

#### [MODIFY] Footer & Trust Citations
- Replace tiny footer text with: *"Bwenge can make mistakes. Check important information."*
- Add expandable source chips under AI answers linking to document, page, and table.
- Add "Report or correct" action button feeding the feedback and correction loop.

#### [MODIFY] [TopNavbar.tsx](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/components/TopNavbar.tsx) & Three-Dots Menu
- Organize the three-dots popover menu into clear sections:
  - **This chat:** Share, Rename, Export (PDF, DOCX), Temporary chat (not saved), Delete chat.
  - **Answers:** Show sources (default on), Answer language (Auto, Kinyarwanda, English, French), Report or correct.
  - **App:** Language, Theme, Open on Telegram, Help & shortcuts, Install app (when available), Log out.
- Marking & Results pages actions: Export results (CSV/Excel), Print, Share report.

#### [MODIFY] [LandingPage.tsx](file:///C:/Users/niyib/Downloads/ai-marker-hub/pages/LandingPage.tsx) & Authentication State
- Ensure signed-out state promotes "Sign in" as the main amber button, hiding "Upgrade" until signed in.
- Fix routing for `/signup` and anonymous states.
- Unify color palette: teal for "on"/active states, amber for primary action.

## Verification Plan

### Automated Tests
- Build project successfully using Gradle / Vite build (`npm run build`).

### Manual Verification
- Verify home screen greeting, starter cards, and top bar appearance.
- Test composer microphone, `+` attachments menu, mode chips, and Sources / Answer-in toggles.
- Verify footer disclaimer and source citations with "Report or correct".
- Test three-dots menu categories on both desktop and mobile viewports.
