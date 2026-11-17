# Agentic chat: working while you are away

The chat (web and Telegram share one assistant) can now act on its own in three ways. Nothing here needs a database change: it all lives in `appSetting` rows.

## 1. Scheduled tasks and the morning brief
- Say it in plain words: "every morning at 7 tell me what needs me", "remind me on Friday to mark the quiz". The assistant calls `schedule_task` (daily / weekly / once, in Rwanda time unless you say otherwise; daylight saving is handled).
- Every minute the primary server runs what is due (`server/services/agenda/runner.ts`) as a chat turn for the owner. A scheduled run can only **look and write up**, and **propose** changes; marking by itself only when the owner allowed it (`allow_marking`). It never releases results, changes a mark or ends a student's test.
- The result goes to **Telegram** (if linked), else **email**, else waits in the chat ("found while you were away"). Three failures in a row switch a task off.
- `/brief` in Telegram writes the brief now; `/agenda` lists what is scheduled and the plans waiting for a yes.

## 2. Plans with approval and undo
- For anything that changes several things, the assistant calls `propose_actions` (steps in plain words, each with its undo where one exists), shows the plan and **waits**. Only after the yes it calls `run_proposal`; `undo_proposal` puts back the reversible steps. Plans wait two days. The first failing step stops the rest.
- In Telegram a plan arrives with **✅ Do it / ✖ Cancel** buttons (and **↩️ Undo** afterwards). A tap is the yes.
- Only action tools may be in a plan (`server/services/agenda/proposals.ts: PROPOSABLE`). Every run and undo is in the audit log.
- Honest limit: "never run in the same turn" is enforced by a 4-second guard plus the prompt; the buttons are the strong path.

## 3. Platform owner tools and alerts
- Administrator only (checked on every call): `admin_overview`, `admin_pending_payments`, `admin_decide_payment`.
- When a lecturer taps "I have paid", every administrator with payment alerts on gets a Telegram message with **✅ Approve / ✖ Reject**. Check MoMo first.
- During a test, what only the lecturer can decide (student cards, a pause for a serious reason, the limit reached) is sent to their phone as one short message with a link to the live room. Turn off with `notify_settings` (`liveAlerts`, `payments`).

## Settings
`ENABLE_AGENDA_TOOLS=false` removes the agenda tools; `AGENDA_DISABLED=true` stops the scheduler. Admins can also switch tools off in Admin → Platform controls.
