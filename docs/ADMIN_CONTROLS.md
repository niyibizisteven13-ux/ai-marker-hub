# Administrator controls

Everything here is in the admin console (Admin → Platform control). Every change is written to the audit log with who did it.

## Platform controls
- **Maintenance mode:** on, everyone except administrators sees a message and the API answers 503. Sign-in, the admin pages, the health check, the public status and MySEB stay open, so you can always turn it off.
- **Announcement banner:** one line on every page (information, warning, urgent) with an optional end time.
- **Switches:** chat abilities (live rooms and classes, marking and results, forms, tasks, web search, Python, pictures, 3D) and MySEB (new sign-ins, browser mode). A switch can only turn something **off** that the server allows; it never turns on something the deployment disabled. Chat switches take effect on the next message. MySEB switches decide who can **start** a test: students already inside are never cut off.
- **Blocked addresses:** an address (`203.0.113.9`) or a range prefix ending in a dot (`203.0.113.`). Blocked visitors get a message; the health check and status stay readable. You cannot block your own address.
- **Retention:** MySEB's period (7 to 3650 days, default 90) can be changed here and the clean-up run now. Exam sets, tasks, classes and failed sign-in records have fixed periods that are listed for reference.

## MySEB (exams)
Exam server status (running, restarts, requests in flight, turned away as busy, memory, live pictures held), every exam with how many students are inside, paused or lost, **End exam** (with a reason), the two switches, the clean-up, and the published app links. The exam server keeps its own copy of the switches (it is a separate process); the site pushes them whenever they change and once a minute.

## Users
**Details** on a person: plan and credits, storage (with **extra room** you can grant), signed-in devices, and a read-only list of what they made (forms, tasks, classes, marked exams). **Sign out everywhere**, **download their data (JSON)**, and **Erase**: removes name, email, sign-in links, memory and Telegram link, deletes their tasks and classes, and stops their forms taking answers (answers already given stay). Payments and usage records stay without a name. Erasing needs the person's email typed and cannot be undone. (There is no "view as this user": support is read-only on purpose.)

## MySEB sales (Admin → MySEB sales)
MySEB is sold. A lecturer needs **access** to get a code for students; students never pay, and administrators are never charged.
- **Plans:** *Monthly* (default US$5, shown in RWF at today's rate): unlimited tests for 30 days per month paid; paying before the end adds to it. *One test* (default 1,500 RWF): one test credit; the first code for a test takes it and every later code for that same test is free.
- **How a lecturer pays (until online payment is set up):** in the live room, **Get code for students** opens a panel with the two prices, the Mobile Money code (default **2191184**, name **Niyibizi Steven**), a WhatsApp button for the screenshot, and **I have paid**. They are then told it takes a few minutes, and the page carries on by itself and gets the code as soon as you enable them. The chat gives the same steps when a lecturer asks it for a code.
- **What you do:** check the screenshot or your Mobile Money message, then in **Waiting for you** press **Enable** (you can change the plan and how many months or tests), or type their email under **Enable someone by email** (they must have signed in once). **Remove** takes access away. Every grant, rejection and removal is in the audit log.
- **Set once:** the **WhatsApp number** (with country code, spaces are fine), the prices, the Mobile Money code and name. Until the number is set, lecturers are told to ask you for it.
- **Switch:** *Charge for MySEB* turns the whole paywall off (free for everyone) and back on. It is on by default, so lecturers who had no access before need to be enabled, or switch it off while you enable the ones who already use MySEB.

## Content & organisations
Every form on the platform (search by title or owner), **Close** one with a reason. Organisations: rename, add members by email (they need an account), remove members, remove the organisation.

## Jobs & Telegram
Background jobs that are running, waiting or failed (their contents are never shown), **Stop** and **Retry**, failed jobs to review, batch marking runs stuck for over an hour, and the Telegram bot (counts, masked chats, unlink).

## Security
Failed sign-ins (wrong or expired codes, attempts on disabled accounts) by hour, where they come from, and one-click **Block**. Failures are kept 30 days.

## Audit log
Filter by who, action, resource, text in the details and dates; page back through history; **Export CSV**. Things the chat did for lecturers (letting a student back in, releasing results, changing a mark, changing a live room's rules, making classes...) are recorded as `CHAT_…`.

## Limits
- A switch's effect on the chat is per message; on MySEB it can take up to a minute to reach the exam server (**Send now** pushes it at once).
- Queue controls cover the in-process job queues; with several servers each shows its own queue.
- Not covered: backups and restore (see `scripts/cluster/backup.sh`), per-organisation plans, and viewing as a user.
