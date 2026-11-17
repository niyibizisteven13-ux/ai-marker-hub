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

## Review queue and evidence (autopilot v3, part 1)
- **Evidence:** when a rule is broken and camera/screen pictures are on, the MySEB server keeps the pictures it holds at that moment (up to 6 per student: the first and the newest). **Memory only**, like every picture here: capped (`MYSEB_MAX_EVIDENCE_MB`, default 100), forgotten after 12 hours or at a restart. The lecturer downloads what they need ("Download evidence": one page with the timeline and the pictures).
- **Review queue** (live room → under the assistant; chat tool `live_room_review`): everyone with a serious signal, a test ended by a rule, 3+ signals, or a let-back-in, most serious first. Each shows what happened in order (including what the assistant did), the pictures, and the lecturer's decision: **Confirm**, **Dismiss**, **Dismiss and give 10 minutes** (lets a student ended by a rule back in even if their time ran out, while the test is still open), **Reopen**, with a note. The agent never decides this; decisions are in the audit log (`MYSEB_REVIEW`).
- **Keep the test open for review:** Autopilot → "Keep it open after the last student" (2-120 minutes). After the test is closed nobody can be let back in.
- Pictures exist only if camera pictures were on during the test; without them the queue shows the timeline only.

## Never fails silently (autopilot v3, part 2)
- **Survives a server restart:** announcements already made, student cards already shown, the last connection-loss incident and the quiet-time start are saved with the room, so a restart never repeats a message or adds time twice. (Serious-signal counts were already saved.)
- **Falls back safely:** if the assistant itself fails 3 looks in a row, autopilot drops to **watch mode** (it only looks and tells you; any other level switches itself off), writes it in the room log and tells you on Telegram or email. You switch it back on yourself.
- **Tells you when it is blind:** if the test server cannot be reached for about a minute (6 looks), you get one message that nobody is watching the room automatically.

## Control from Telegram, and the timetable (autopilot v3, part 3)
- **Alerts carry buttons.** When something needs you (a paused student, a student card, or a test the autopilot ended) the Telegram message has one-tap buttons: **Let <name> back in** (or **dismiss, +10 min** / **Confirm** for a test the autopilot ended), **⏸ Pause all**, **▶ All back in**, **+5 min**, and a link to the live room. A tap is your decision and is recorded like the same action in the live room. Buttons are single use, work only for you, and last 8 hours.
- **`/room`** shows the rooms the assistant is watching for you (counts, assistant mode) with the same controls. Asking the chat ("pause my room", "add 10 minutes") works too.
- **Timetable (autopilot):** *Opens at* makes the join code at that time and sends it to you with the link and a ready WhatsApp message (needs your MySEB plan or a test credit; if it cannot be made you are told). *Closes at* closes the test then; the report follows. The assistant must be on before the opening time. Each happens once, even across a server restart; practice mode only writes what it would do.

## Answer-pattern checks (autopilot v3, part 4)
For a test made from a quiz, the **review queue and the final report** now also use the handed-in answers:
- answers to written questions that are nearly the same as another student's, the **same wrong answers** on several questions, **one device used by two people** (these are the existing class-review checks), and
- **finishing far faster than the class** (a quarter of the typical time or less; only when 8 or more students finished and the typical time is 5 minutes or more).
A response is matched to a live-room student **by the name typed in the quiz** (order and capitals do not matter). If that does not point to exactly one student, the flag is shown on its own ("no clear student") and is never put on anyone. They appear once students have handed in, and only for quizzes (not tasks). They are leads for a conversation, never proof: two students who studied together can make the same mistakes. Nothing changes a mark.

## Picture checks with AI (autopilot v3, part 5): opt-in, notes only
Rules → **Check pictures** (or ask the chat). Needs a clear confirmation, camera pictures **on** in the room, and credits.
- A few small pictures (at most 4 every 10 seconds, each student at most once a minute, once every 30 seconds if they have signals) are looked at by the agent model, which says only **how many people**, **whether a face is in view** and **whether a phone is clearly in view**. It never identifies anyone; the prompt tells it to ignore any text inside the picture.
- **One picture never counts.** A second person or a phone must show on 2 pictures in a row, no face on 3 in a row. Then a note appears in the room log and the review queue, the picture is **kept as evidence** (memory only, see above) and you get an alert. It never pauses or ends anyone and adds no strike.
- **Students are told** when it starts ("An AI assistant may check small camera pictures during this test…"). Practice mode tells nobody and sends nothing to the model.
- **Limits you choose:** most pictures per test (default 200, 20-2000); it stops and tells you when they are used, and when your plan has no credits left for it. Each picture is one `vision` use of your plan.
- **Honest limits:** the pictures are about 160x120, so only plain things can be seen: a phone held low, a second person out of view, a screen below the camera, or someone whispering will not be. The model can be wrong in both directions, which is why nothing happens without you.
- **Privacy:** the pictures go to the AI provider the platform uses for the agent model. Say so to your students and your school before you switch it on.
