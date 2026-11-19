# bwenge4biz: a page for every business, and a private notebook behind it

A business gets a public page at **`bwenge.space/b/<name>`** (that is the short link), built and kept up to date by talking to the Bwenge assistant. The owner
sees a private side the public never sees. Photos and short videos the owner adds appear on the public page.

## The pages

| Page | Address | Who | What it is |
| --- | --- | --- | --- |
| **Public page** | `/b/<name>` | Everyone | A page that follows the kind of business (restaurant: Menu, Order now, Book a table; salon: Services, Book now; farm: Produce; school: Courses; and so on). Cover and logo, open now, quick buttons (order, pay online, WhatsApp, call, directions, share), products with a cart, gallery, about, hours, map link, contact, MoMo Pay code (if turned on), a QR code of the page and an "Install app" button, a message form, "Report this page". |
| **Customer checkout** | on the public page | Everyone | Send an order (saved as a pending order and opened in WhatsApp) or **Pay now** with MTN MoMo / Airtel Money: the customer types their number, approves on their phone, the page shows paid. The amount is always worked out on the server from the products. |
| **Studio** | `/biz` (also Settings → Connections → Bwenge4biz) | Owner only | A dashboard: **Dashboard** (sales, orders, customers, profit against yesterday, sales chart, top products, quick actions, orders today, low-stock alerts, recent activity, link and QR), **Sales and orders**, **Expenses**, **Products and stock**, **Customers**, **Reports** (CSV), **Messages**, **Public page** (details, photos and videos, preview), **Secrets and payments**, **Settings**. |
| **The assistant** | the Bwenge chat | Owner only | "Today I sold 5 loaves for 4,000", "bought flour for 8,000", "how is my week?", "what is running out?", "ask 0788 123 456 to pay 3,000", "add this photo", "publish my page". It can also read a photo of a sales book the owner attached (it lists what it read and asks before recording). |
| **The business's own app** | `/b/<name>` installed | Customers | Each page has its own web app manifest, name, colour and icon, so a customer can "Add to Home screen" and it opens as that business's app. It is a home-screen web app, not an app-store app. |

## Paid dashboard, onboarding, feed and map
* **The dashboard is free** (page, photos, notebook, stock, orders, feed). Videos, the business agent and online payments need a paid plan. Optionally `BIZ_REQUIRE_PAID=true` puts the whole dashboard behind Starter or higher (administrators count as Institution); then `/biz` shows an unlock screen with the Starter price (read from the plan table) and the normal upgrade and manual mobile-money payment flow; every owner action and agent tool answers 402 `UPGRADE_REQUIRED`. The public page keeps working for customers.
* **Onboarding** asks for the business name and kind, the WhatsApp number (a local 0788… number is stored with `BIZ_COUNTRY_CODE`, default 250) and the location.
* **Feed (Instagram-style)**: Studio → Feed → **New post** follows Instagram's flow: pick up to 10 photos or short videos (drop them, or use the camera), crop them (1:1, 4:5 or as taken) and reorder, then caption (up to 1,500 characters), tag a product for an **Order** button, and Share; then share the link on WhatsApp. On the public page, **Updates** shows each post like Instagram: the business header, swipeable media with dots, double-tap to **love**, **comments**, share, Order, the number of loves, the caption and the time. Anyone can love (one per visitor, a short hash only) and comment (a name and up to 300 characters, rate limited, robots ignored); the owner is alerted of comments (agent alerts), can reply as the business and delete comments. Pinned post first, then newest; link `/b/<name>#updates`, per post `/b/<name>?post=<id>#post-<id>`. Feed photos are not in the gallery, are public only while a post shows them, and are deleted with the post (with its loves and comments). By chat: `biz_post` (caption, optional product tag).
* **Map**: latitude and longitude (Use my current location, paste a Google Maps link or coordinates). The public page shows a small OpenStreetMap tile map with a pin and a Directions button; it is an image of OpenStreetMap tiles (keep use light and keep the attribution; use your own tile server at scale).

## Money notebook (private)
Sales and expenses are kept per business (`biz-ledger:<id>`, newest first, up to 5,000 entries), never part of `publicView`. A completed sale of a product with a stock count lowers the stock; cancelling gives it back; a product that reaches zero is marked out of stock on the page. Pending orders from the page are not income until confirmed or paid.

## Running the dashboard from the normal Bwenge chat
The ordinary chat can do everything the dashboard does (`biz_*` tools). Business messages now route to the tool-using assistant (`server/services/ai/platformIntent.ts`: "today I sold…", "how are my sales", "restock", "post an update to my page", "ask 0788… to pay", "close the day", and the French and Kinyarwanda equivalents; general questions such as "what is profit margin" stay on the cheap chat).
* **Routines (`biz_workflow`)**: built in, *Open the day*, *Close the day*, *Weekly review* (the assistant carries them out with the read tools and proposes any change); the owner can save their own ("remember this as Weekend promo": steps limited to business tools), and a saved routine is shown as a plan and runs only on the owner's yes, with undo where possible.
* **Plans may now contain business actions** (`biz_orders`, `biz_change_product`, `biz_stock`, `biz_post`, `biz_request_payment`, …); the same plan mechanism serves the business agent's suggestions, the one-tap order confirm on Telegram and saved routines.
* **Photos by chat**: attach a photo and say "make this my logo/cover" (`biz_add_media use_as`) or "post this with the caption…" (`biz_post file_ids`, with an optional product tag for the Order button).
* **Links (`biz_open`)** to any dashboard screen (`/biz?view=sales`, `feed`, `agent`, …), the page, and the installable app. "Update my app" means updating the page (name, colour, logo, products, hours): the installed app is the page, so it updates itself.

## Features the agent can create, and the Kinyarwanda page
* **New features without code.** The owner (or the agent, by chat) can build features from their own data: **Trackers** (private tables with fields they choose: bookings, deliveries, customer credit, equipment; Studio → Trackers, with CSV and status per record) and **extra public sections** (text, FAQ, price list, buttons to links, or a **form** whose answers land in a tracker, such as bookings; Studio → Public page → Extra sections). Ready-made ones in one step: booking, faq, price_list, deliveries, loans (`biz_feature`), otherwise `biz_tracker`, `biz_section`, `biz_records`. Everything is checked data (links must be https, nothing is shown as HTML, public forms are rate-limited with a honeypot and only reach the tracker behind them, never other records). The agent does not change the app's code.
* **Kinyarwanda.** The public page has an EN / RW switch; the labels are translated in the app (`src/biz/i18n.ts`, to be read by a native speaker) and the business's own words come from the translation the agent saves (`biz_translate`: tagline, about, product names and descriptions, section texts, posts) under `translations.rw`; untranslated parts fall back to English. The owner chooses the language the page opens in (Studio → Public page → Language, or by chat). The agent understands and answers in Kinyarwanda (business words such as nacuruje, naguze, natanze, ibihumbi 7 = 7,000), and "turn my page into Kinyarwanda" is a one-line request. The studio has an English / Kinyarwanda button in its header (about 280 labels; `src/biz/studioI18n.ts`, also for native review); the choice is remembered per person on the server, so **the agent can change it** (`biz_language`: studio_language for the owner's dashboard, page_language for the language the public page opens in).

## Costs and spending, and fixing the notebook
* **Studio → Costs and spending** (also `/biz?view=expenses`): spent this month against last month, sales and profit (estimate), six months of trend, spending by category with budget bars (amber at 80%, red at 100%), **monthly budgets** (alerts at 80% and 100% through the business agent), **recurring costs** (rent, a server, salaries: they record themselves on their day, checked whenever the numbers are read, so no timer is needed; paused ones record nothing), and the full expense list with in-place **Edit** and delete. Categories are free words ("server", "investment") with suggestions.
* **The agent can fix the notebook** (`biz_entries`): list recent entries with ids to verify, edit one, or delete one (only with the owner's confirmation). Recording an entry now returns its id and the freshly read day totals, so the assistant reports what really happened. The same expense twice within 15 minutes, or the same sale twice within 2 minutes from the chat, is refused as a likely duplicate unless forced (ordinary repeat sales in the studio are never blocked). `biz_costs`, `biz_recurring` and `biz_budget` give the agent the same powers as the screen.
* The assistant is told never to claim a change that no tool result confirmed, to fix duplicates itself, and to say plainly what it cannot do.

## The business agent
The owner has a **dedicated Business Agent chat** inside the Studio (Ask the agent): one agent for one business, with only the `biz_*` tools (no general chat tools), a business-manager persona, and a photo button for sales books and receipts. It is separate from the general Bwenge chat (which can still do the same by tool). `POST /api/biz/:id/agent/chat` runs it, gated and charged like any assistant action.
A standing helper (Studio → Business agent, or by chat: "turn on my business agent in assist mode"). It runs as the owner's assistant with a short, level-based tool list (`server/services/biz/agent.ts`):
* **Watch**: reads the real numbers and reports. A morning plan (07:30), a closing summary (19:30), a weekly review (Monday 08:00), and instant alerts (new order, payment received, low stock, new message) on Telegram, else email, else in the chat.
* **Assist**: also proposes changes (confirm an order, restock, mark out of stock, ask a customer to pay) as plans the owner approves with one tap (Do it / Cancel), with undo where possible. A new order arrives with a ready "Confirm" button.
* **Run**: also settles payments the provider reports as paid and marks messages seen.
* At every level an unattended run is never given the tools to publish, delete, change prices, record sales, send payment requests or touch keys; those exist only in the chat (and in plans the owner approves). Customer messages and order notes are treated as information, never as instructions. Each run spends the owner's credits like any assistant action.

## Secrets and payments
* Keys for MTN MoMo (Collections: subscription key, API user, API key) and Airtel Money (client id and secret) are entered **only** in Studio → Secrets. They are encrypted with AES-256-GCM (`BIZ_SECRETS_KEY`, falling back to the server's JWT secret) and can be written, tested and removed but **never read back** by any route, the studio, or the assistant (the studio shows the last four characters). The assistant is told never to accept keys in chat.
* "Test keys" only asks the provider for an access token. A payment moves money from the customer straight to the owner's own account; Bwenge never holds funds.
* Online payment on the page needs keys saved **and** the owner's switch on. "Any amount" (for a counter QR at `#pay`) is a second switch.
* The MTN and Airtel adapters follow the providers' published APIs and are tested against recorded replies; **they have not been run against a live MTN or Airtel account** (live use needs the providers' own approval of the business).

## What the public sees and what only the owner sees

**Public** (everything returned by `publicView` in `server/services/biz/model.ts`, and nothing else):
name, category, tagline, about, colour, logo, cover, gallery photos and videos marked visible, products not hidden (with price, unit, photo, stock),
opening hours, the contact details the owner filled in (WhatsApp, phone, email, address, map link, website, Instagram, Facebook), and the MoMo Pay code only when
the owner turned "Show how to pay" on.

**Only the owner** (never leaves through a public route):
visitor messages and their contact details, visit and tap counts, hidden products, photos and videos marked hidden, drafts (an unpublished page returns "not found"),
the owner's private notes, the owner's account, reports against the page, and the notebook.

This is enforced in one place: public routes answer with `publicView(business)`, which builds the answer field by field. A test puts secret text in every private
field and checks it cannot appear in the public answer.

## Photos and videos
* Photos up to 6 MB (JPEG, PNG, WebP, GIF) and videos up to 25 MB (MP4, WebM). The file type is checked by its first bytes, not its name; SVG and HTML are refused.
* **Photos are free; videos need a paid plan** (Starter or higher; Top-up counts as paid). Free: 12 gallery photos, 80 MB in all, 60 feed photos; paid: 60 photos, 10 videos, 600 MB, 400 feed items. A free owner who picks a video, in the gallery or a post, is told videos are for paid plans (server answer 402 `VIDEO_PAID`).
* The **business agent** and **online payments** (MTN/Airtel keys, payment requests, pay on the page) also need a paid plan (402 `UPGRADE_REQUIRED`). Everything else in the dashboard is free; `BIZ_REQUIRE_PAID=true` puts the whole dashboard behind a paid plan again.
* Files are stored on the server (`data/biz-media`, or `BIZ_MEDIA_DIR`) and served only for a page that is live and for media marked visible. Videos support seeking.
* Videos are not converted, so phones should record short clips (about 30 seconds). Converting for slow connections is a later step.

## Safety of a public service
* Page names: 3 to 32 letters, numbers and dashes; names of Bwenge's own pages and anything starting with "bwenge" are kept back.
* No HTML from visitors or owners is ever shown as HTML; links must be https; phone numbers are digits only.
* The message form has a hidden field for robots, a limit per visitor, and cannot be sent to a page that is not live.
* Anyone can **Report this page**; an administrator sees reports (Admin → Settings → Platform controls → Business pages) and can suspend a page, which hides it.
* Sharing on WhatsApp shows the business's own name, tagline and cover photo, because the server writes the preview for each page.

## Connected to the assistant
Tools in the chat (`biz_*`): see and update the page, add and change products, add a photo or video the user attached, publish or unpublish, give the link, read messages.
Each costs credits like any assistant action. Nothing is published without the owner saying so.

## Not built yet (and honest limits)
* **Scanning a sales sheet by the studio** (the assistant can read a photo in chat; a studio upload button comes next), MoMo statement import, bookings and staff accounts. The notebook lives in the light key/value storage (5,000 entries per business); a business that outgrows it needs real database tables.
* **A separate domain** such as `bwenge4biz.com`: today the link is `bwenge.space/b/<name>`. A business sub-domain (`<name>.bwenge.space`) needs a wildcard DNS record.
* Staff accounts, orders and payment tracking, video conversion, page search on Google (pages are public, but not yet submitted to search engines), custom templates.
* Free storage is a promise of this server's disk: back it up like the rest of the data.

## Programs (plans customers pay for once and use with a pass)

A business sells a plan once and customers use it again and again with a pass on their phone. It works for any business that sells repeat
use: a month of lunches at a restaurant near a university (40,000 RWF), a monthly gym pass, four haircuts at a salon, a laundry card, a weekly
bus pass, a month of tutoring sessions, a car-wash subscription.

**How it works**
1. **Owner** (Dashboard → *Programs* → *Plans*): makes a plan: a name, the price, how many days it lasts, **what a member gets each day**
   (an item such as "Lunch", "Entry" or "Haircut"; up to four, one of each per person per day), the days of the week it is available, and
   optionally the times of day, a **total number of uses** (10 visits, 4 haircuts) and a maximum number of members. Each plan gets a share
   link (`/b/<page>?plan=<id>`) with a QR code and a WhatsApp share button. The page must be published.
2. **Customer, first time**: scans the QR code or opens the link. Step 1: name, phone number, the owner's **4-digit join code** (when the owner set
   one; nobody can join without it) and, if the owner asks for it, an ID. Step 2: the customer **creates a passcode** (4 to 6 digits) and is signed in.
   From then on they open their card by signing in with **phone number and passcode** (optionally "keep me signed in on this phone for 30 days"). There is
   no secret link to guard or share. The customer is **proposed a short user name** (3 to 12 letters or numbers, made from their name, for example `aline`; they can change it, and no two are the same at one business). This phone remembers it, so coming back they type **only the passcode** ("Signing in as aline · Not you?"). User name or phone number plus passcode both work. A phone number is one account at that business: a second program on the same number uses the same passcode.
   A forgotten passcode is reset by the owner (Members → *Reset passcode* gives a temporary one to pass on). Five wrong passcodes lock that phone
   number for ten minutes.
3. **Paying**: if the owner has MTN/Airtel keys saved (Secrets and payments) the customer can approve a prompt on their phone and the plan
   starts by itself; otherwise the pass shows the MoMo code, the customer pays and taps **I have paid** (optionally with the MoMo reference), the
   owner is told, checks their phone and taps **Confirm payment** (MoMo or cash). Either way the sale appears once in the notebook. Bwenge never
   holds the money.
4. **Each time they come** (Programs → *Today*): the owner taps *Scan a pass* (camera) or types the code. The screen says **Allowed: Lunch** in green,
   or why not in red: not paid, not started, ended, paused, not available today, already used today at 12:41, all uses taken, or outside the
   times it is available (the owner may *Allow anyway*; nothing else can be overridden). A mistaken scan can be undone for 20 minutes.
4b. **Who ticks the card is the owner's choice** (per program, set in the plan form or by the assistant with `check_in`). **The business** (default): scan or type the code
   as above. **The customer**: after signing in they open their card, and today's items (for example *Lunch* and *Dinner*) are big buttons, and also tappable
   boxes in today's row of the card. One tap ticks it at once, under exactly the same rules as a scan (paid, open day, serving times, one of each item a day, total cap; no
   override). A wrong tap can be taken back for one minute; staff can undo longer from *Today*, where self ticks are marked. Choose self check-in only where a
   wrong tick costs little; a customer can tick an item while not on the premises, so for meals or visits that cost you money prefer staff scanning.
5. **Running it**: *Today* shows who has checked in and who has a program today but has not come yet. *Members* shows payments waiting for
   confirmation, pause / resume, add days (for example after a closure), cancel, search, and a WhatsApp reminder link for programs that are ending.

**Rules** (`server/services/biz/programs.ts`, tested in `tests/biz_programs.test.ts`): a plan lasts *days* calendar days from its start day (30 days
starting on the 1st ends on the 30th); days it is not available neither allow a use nor count as missed; one of each item per person per day; with a
*total uses* cap, no more than that many uses overall; dates are Kigali dates. Unused days are not carried over (add days by hand if you want to).

**The card** looks like the paper one a restaurant hands out: the business name and phone numbers, the person's name and period, a stamp (PAID or NOT PAID),
then a grid with the dates down the side (15 days to a block, a switch between blocks) and **one column per item** (Morning, Midday, Evening; or just
Lunch and Supper; up to four), a cross in every box that was used, closed days hatched, today highlighted. Under it: uses left, valid until, the QR code
(only once paid; tap to enlarge) and the short code.

**Privacy and safety**: the public page shows only the plans (name, price, days, items), never members and never the join code. Passcodes are stored only
as salted hashes, a session is a long random token kept as a hash and sent in a header (never in an address), the QR secret is stored encrypted, and the
card pages are marked noindex; the owner side is scoped to the owner like the rest of
Bwenge4biz. Joining is rate limited, has a hidden spam field, allows one live plan per phone number per plan, and respects the maximum members.
Joining is also slowed for anyone guessing join codes. Joining and checking in run under a per-business lock, so two scans at the same moment cannot use the same item twice.

**Honest limits**
- A card can still be screenshotted or a phone handed to a friend, and the passcode can be told to someone. The system allows one use of each item per day, so a shared pass only uses that customer's
  own allowance, but the owner should still glance at the name on the screen. The pass shows a ticking clock so a still picture is easy to spot.
- Self check-in trusts the customer: a signed-in customer can tick today's item from anywhere (the rules still stop a second one, an unpaid card, a closed day or the wrong time, so set serving times when you use it). A user name is not secret; the passcode (with its lockout) protects the card.
- The lock that prevents double use lives in one server process. With several server instances behind a balancer, two scans in the same instant
  on different instances could both pass; use one instance for the API or move the lock to the database before relying on it at scale.
- The camera needs HTTPS and a browser that allows it; browsers without a built-in QR reader use the small `jsqr` library, and the code can always
  be typed.
- Not included: refunds, carrying unused days over, automatic reminders by SMS or WhatsApp (a ready WhatsApp message link is offered), several
  businesses honouring one card, and checking a customer against a list.
- The online MTN/Airtel payment adapters have not yet been run against a live account (see above); manual MoMo and cash work without them.
- The Kinyarwanda text should be read by a native speaker.

**Assistant**: the chat can list and create programs (`biz_program`) and report how they are doing (`biz_plan_status`).
