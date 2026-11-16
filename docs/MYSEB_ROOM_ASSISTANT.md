# MySEB room assistant and running a test from the chat

## Room assistant (Live room → "Room assistant", or ask the chat)
The lecturer sets rules for routine moments; the assistant applies them during the test and keeps a log, so the lecturer only deals with what needs a person.

- **Lets a student back in** when they were paused for a small reason (face left the camera, camera off, lost connection, left the test screen, switched window, left the app, left full screen, stopped sharing the screen), they are connected again, and the wait (default 30 s) has passed. Limit per student (default 2).
- **Never touches**: a student the lecturer paused, or anything that looks like cheating (screenshot, recording app, more than one face, student card refused, developer tools, token misuse). These go to the log as "needs you".
- **Ends a student's test only if** the lecturer switched on "End their test" after the limit. Off by default.
- **Never** lets back in a disqualified student, and never changes the test.
- Runs on the primary server every 10 s for rooms where it is on; stops by itself when the test ends. Rules and log live in `appSetting` (`myseb-agent:<kind>:<id>`), every action is in the audit log (`MYSEB_AGENT_RESUME`, `MYSEB_AGENT_END`, `MYSEB_AGENT_RULES`).
- It is a rule-follower, not a judge: it never decides that someone cheated.

## One chat, a whole test
Tools: `create_form` → `review_form` → `publish_form` (ask first) → `launch_test` (rules, assistant, code, one link, a ready WhatsApp message) → `live_room_status` / `room_assistant` / `live_room_student` → `test_debrief`.
`launch_test` makes the code first: when the lecturer has not paid it changes nothing and relays the payment steps. It does not send anything to students (no WhatsApp API); the lecturer shares the link.
`test_debrief` ranks who may be worth a conversation (a number to judge, never proof), adds what the assistant did, and what is still waiting.
The quiz owner is the one charged for MySEB (see ADMIN_CONTROLS.md).
