# MySEB dashboard (/lecturer)

The lecturer's home for secure exams, on a phone and on a computer, with the Bwenge assistant beside it. Open it from the main sidebar (**Teaching → MySEB**) or go to `/lecturer` (signed in).

## Layout
- **Computer**: a dark sidebar (Overview, Live rooms, Tests, Tasks, Marking and results, then Get the app and Access and payment, with a small "N live" badge on Live rooms and the MySEB plan at the bottom), the page, and **Ask Bwenge** docked on the right on wide screens.
- **Phone**: a top bar with a menu button (the sidebar opens as a drawer), a bottom bar with Overview, Live rooms, Tests and Ask Bwenge (the assistant opens as a full sheet), and rooms with their buttons stacked under the text.
- **Overview**: students in an exam now, how many are paused or left (need you), secure tests and tasks, all tests and tasks; your live rooms with live numbers and **Open room** / **Copy link**; quick actions (new secure test, mark papers, marked exams, get the app); a banner when MySEB needs a plan.
- It refreshes by itself every 15 seconds while the page is visible.

## Ask Bwenge on this page
The same assistant as the main chat (`/api/ai/chat`), told it is in the MySEB dashboard (`surface: 'myseb'`, see `server/services/ai/mysebDashboardNote.ts`). It lists rooms, says how a room is going, pauses the room, lets students back in, adds time, messages students, starts a secure exam with a code and link, makes and reviews tests, and debriefs afterwards, using the existing tools. Anything that changes a room is done only when asked. "Secure it" on a test and "Make with Bwenge" send the matching request to it. The chat engine is shared with the form editor and marked-exam drawers (`src/components/AgentChat.tsx`).

## Data
`GET /api/myseb-dashboard` (signed in) returns, in one call: your access state, totals, your tests and tasks (only your own), and the busiest rooms with live counts (in the exam, paused, left, finished). Each room has its own 3.5 s limit, so one slow room never blocks the page (its status shows "not available right now"). Code: `server/routes/mySebDashboardRoutes.ts`; tests: `tests/myseb_dashboard.test.ts`.

## Not done yet
English only (no Kinyarwanda yet). The live room itself and the existing Forms, Tasks and Marking pages are unchanged and still open as their own pages from here. No notifications or sound when a student needs you while the page is in the background (Telegram alerts still work).
