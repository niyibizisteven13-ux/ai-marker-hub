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

## Money notebook (private)
Sales and expenses are kept per business (`biz-ledger:<id>`, newest first, up to 5,000 entries), never part of `publicView`. A completed sale of a product with a stock count lowers the stock; cancelling gives it back; a product that reaches zero is marked out of stock on the page. Pending orders from the page are not income until confirmed or paid.

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
* Limits: Free: 12 photos, 2 videos, 80 MB in all; paid plans: 60 photos, 10 videos, 600 MB.
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
