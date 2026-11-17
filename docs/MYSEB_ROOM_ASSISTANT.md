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

## Levels, practice mode and acting in the room (step 1 of the exam agent)
- **Level**: *Assist* (default: lets students back in after small problems) or *Watch only* (it only looks and tells you; what it would have done becomes a "needs you" note).
- **Practice mode** (`dryRun`): it writes what it WOULD do ("Would have let back in …") and does nothing. Use it on a small first test.
- **Acting in the room** (`POST /:id/myseb/room-action`, chat tool `live_room_action`, buttons in the live room): pause everyone, let everyone back in, add 1-60 minutes (everyone or one student), send a short message to all students or one. The lecturer can always do these. The assistant itself will use them in the next steps, only within your limits (**most minutes it may add in total**, **times it may pause the room**, 20 messages), checked in code (`checkRoomAction`), every action logged in the room log and the audit log.
- **Students see messages** in the browser test page (carried by the heartbeat, kept 10 minutes in memory on the MySEB server). **The phone and desktop apps do not show them yet**; that comes with the apps build in step 3. Added time does work in the apps (their countdown follows the server).
- Not done yet (next steps): the assistant choosing these actions itself (judgement loop), Telegram buttons for them, and scheduled open/close.

## Autopilot (step 2): the test runs without the lecturer
Set it up once (live room → Room assistant → Rules → *What it may do* → *Autopilot*, or ask the chat). Switching it on needs a clear confirmation each time. Try **Practice mode** first on a small test.

What it does by itself, by the policy you chose beforehand:
1. **Counts serious signals per student** (screenshot, recording app, second person, developer tools, split screen, a second screen, a refused student card; three copy/paste/shortcut attempts count as one). Small slips (switching window, face out of view) never count.
2. **Warns first** (a message on the student's screen). A warned student who was paused is let back in. At your limit (1-3 serious signals, default 2) it applies your policy: **warn and record only** (default), or **end their test**. You can let a student back in from the live room while time remains. It never ends anyone you did not allow it to.
3. **Mass connection loss** (40% or more of 4+ students): that is a fault, so it adds time within your limit (up to 10 minutes) and tells everyone.
4. **Announces** 10 minutes and 1 minute left.
5. **Closes the test** two minutes after everyone has finished (switchable), then **sends the final report** (Telegram, else email, else the chat; also kept in the live room): who took part, who to look at (most first, with the reason), what it did, and a plain reminder that signals are not proof.
Everything is in the room log and the audit log (`MYSEB_AGENT_*`).

### What it cannot do
It **reduces cheating, it cannot guarantee that nobody cheats.** MySEB cannot see a phone out of view, a second person off camera, or answers passed by voice. Browser tests (especially on phones) are weaker than the app. Treat the report as a list of people to look at, never as proof. Marks are not changed and results are not released by the agent.
Not yet: a model reading camera pictures; the apps do not show messages yet (browser tests do).
