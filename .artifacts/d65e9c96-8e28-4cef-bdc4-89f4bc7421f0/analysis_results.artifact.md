# End-to-End User Journey & UX Gap Analysis: Bwenge AI Marker / Studio

This document provides a comprehensive audit of all remaining gaps, friction points, and user experience (UX) shortcomings in **Bwenge AI Marker Hub**, tracking the user path from **Landing -> Onboarding -> Core Usage -> Results & Export**.

---

## Executive Summary

| Stage | Key Gaps & Friction Points | Impact | Severity |
| :--- | :--- | :--- | :--- |
| **Landing & Auth** | • OTP email delivery depends on external backend/SMTP service config (`.env`).<br>• In-app browser detection blocks Google OAuth without a clean external browser fallback prompt.<br>• Password recovery / traditional password fallback is missing. | High drop-off during first-time sign-in. | **CRITICAL** |
| **Onboarding & First Use** | • Abrupt transition from landing page to the core studio workspace without an interactive guided tour or preloaded template selector.<br>• Empty state when no exam paper or student script is loaded can disorient new users. | Users unsure how to initiate their first grading run. | **HIGH** |
| **Core Studio Workflow (Step 1–5)** | • Step 1 (Upload/Generate) depends on backend endpoints (`/api/generate-exam`) which fail gracefully or throw generic errors if API keys (`GEMINI_API_KEY`) are missing.<br>• Step 4 (AI Batch Marking) lacks granular retry controls for individual failing scripts.<br>• Step 5 (Export) relies on client-side generation that may struggle with very large batch exports. | Workflow interruption during active grading. | **HIGH** |
| **UX & UI Polish** | • Mobile responsiveness on small viewports (`useIsMobile`) has cramped action bars and complex multi-step forms.<br>• Document scanner (`DocumentScanner.tsx`) depends on camera permissions and edge detection which can fail on poor lighting or non-standard mobile browsers.<br>• Keyboard shortcuts and accessibility (ARIA roles, focus traps) are partially implemented. | Frustrating mobile or low-light scanning experience. | **MEDIUM** |

---

## Detailed Gap Breakdown by Stage

### 1. Landing & Authentication (`LandingPage.tsx` & `AuthFlow.tsx`)
- **Observation**: The landing page provides a slick modern UI with language switching, theme toggles, feature chips, and a QR code. However, `AuthFlow` relies strictly on Email OTP or Google OAuth.
- **Gaps**:
  - **SMTP/Backend Dependency**: If the backend server (`backend/`) is not running or `.env` lacks valid email credentials (`SMTP_HOST`, `GEMINI_API_KEY`), OTP requests fail with a generic `errNetwork` or `errRate`.
  - **OAuth In-App Browser Block**: Google OAuth explicitly blocks sign-in inside in-app webviews (Instagram, Facebook, Twitter browsers), showing `errInApp`, but does not provide an automatic "Open in External Browser" button.
  - **No Password Authentication**: Users accustomed to traditional email + password accounts have no fallback if OTP emails are delayed by spam filters.

### 2. Onboarding & First-Time Studio Experience (`App.tsx` & `CompleteBwengeStudio.tsx`)
- **Observation**: Upon successful authentication, users land directly in the workspace (`CompleteBwengeStudio` / `ModernBwengeStudio` / `Step1CreateUpload`).
- **Gaps**:
  - **Lack of Guided Walkthrough / Tour**: There is no onboarding checklist (e.g., "Step 1: Create your exam rubric, Step 2: Upload student scripts, Step 3: Run AI marker"). First-time teachers are dropped into a complex UI with chat panels, toolbars, and tabs.
  - **Sample Data Discoverability**: While `sampleExams.ts` exists, users have to manually discover sample exams rather than having a prominent "Try with Sample Exam & Scripts" button on the landing or initial workspace screen.

### 3. Core Marking Workflow: Steps 1 to 5 (`Step1CreateUpload.tsx` to `Step5ReviewExport.tsx`)
- **Observation**: The 5-step wizard (`Step1CreateUpload`, `Step2Rubric`, `Step3SubmitAnswers`, `Step4AIMarks`, `Step5ReviewExport`) covers exam creation, rubric setting, student submission, AI grading, and review/export.
- **Gaps**:
  - **AI API Key Dependency**: `geminiMarker.js` and `deepseekMarker.js` require active API keys in `.env`. If keys are missing or rate-limited, batch marking fails mid-way without clear recovery options.
  - **Per-Script Error Recovery**: In Step 4 (`Step4AIMarks.tsx`), if marking script #3 out of 10 fails due to an API timeout, the entire batch halts or logs an error, requiring a full re-mark rather than allowing retry of individual failed scripts.
  - **Rubric Flexibility**: Custom rubric criteria editing in Step 2 can feel rigid if teachers want weightings other than standard marks allocation.

### 4. UX & Responsive Polish (`MobileSheet.tsx`, `DocumentScanner.tsx`, `RightChatSidebar.tsx`)
- **Observation**: The app includes a document scanner, dark mode, floating toolbars, and chat assistance.
- **Gaps**:
  - **Mobile Layout Density**: On mobile screens (`useIsMobile`), the combination of navigation tabs, chat drawer (`RightChatSidebar`), and document viewer creates cognitive overload and vertical scrolling fatigue.
  - **Scanner Edge Detection**: `DocumentScanner.tsx` relies on canvas image processing which may struggle on low-resolution mobile cameras or uneven lighting.

---

## Recommended Action Plan

1. **Self-Healing AI & Mock Fallback Mode**:
   - Ensure `aiFallback.ts` automatically kicks in with realistic mock AI grades if API keys are missing in development/demo mode so users never hit dead ends.
2. **First-Time User Onboarding Banner / Tour**:
   - Add a dismissible quick-start banner or 3-step interactive tooltip tour upon first login.
3. **Resilient Batch Marking**:
   - Update Step 4 (`Step4AIMarks.tsx`) to support individual script retry buttons when a script fails marking.
4. **OAuth In-App Browser Helper**:
   - Add a direct "Open in Chrome/Safari" button when in-app browser detection triggers.
