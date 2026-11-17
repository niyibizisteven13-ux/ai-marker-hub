# bwenge4biz: a page for every business, and a private notebook behind it

A business gets a public page at **`bwenge.space/b/<name>`** (that is the short link), built and kept up to date by talking to the Bwenge assistant. The owner
sees a private side the public never sees. Photos and short videos the owner adds appear on the public page.

## The pages

| Page | Address | Who | What it is |
| --- | --- | --- | --- |
| **Public page** | `/b/<name>` | Everyone | The business's page: cover and logo, name, one-line tagline, buttons (WhatsApp, Call, Directions, Share), about, products or menu with prices and photos, photo and video gallery, opening hours (with "Open now"), address and map, MoMo Pay code (only if the owner turns it on), a "Send us a message" form, a small "Report this page". |
| **Studio: Overview** | `/biz` | Owner only | The page link with a copy button, a QR code and "Share on WhatsApp"; the Publish switch; this month's visits and taps on WhatsApp, Call and Share; new messages waiting. |
| **Studio: Page** | `/biz` → Page | Owner only | Edit the name, tagline, about, category, colour, contact numbers, address, map link, opening hours, MoMo Pay code and whether to show it. A live preview shows exactly what visitors see. |
| **Studio: Products** | `/biz` → Products | Owner only | Add, price, photograph, hide or mark "out of stock". |
| **Studio: Photos and videos** | `/biz` → Gallery | Owner only | Upload photos and small videos (a short clip up to 25 MB), choose the cover and logo, show or hide each, add a caption. |
| **Studio: Messages** | `/biz` → Messages | Owner only | Messages visitors sent (name, how to reach them, what they want), marked new, seen or done. |
| **Studio: Settings** | `/biz` → Settings | Owner only | The page name (the short link), private notes, unpublish, delete. |
| **Notebook** (next phase) | `/biz` → Notebook | Owner only | The money record: "today I made 45,000"; scanned sales sheets; reports. Never public. |
| **The assistant** | the Bwenge chat | Owner only | "Add 12 kg of tomatoes at 1,200", "open until 8 pm on Saturdays", "publish my page", "what messages came in?" |

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
* **The notebook** (money records, scanning a sales sheet, MoMo statements, reports). It needs real database tables, not the light storage used for pages.
* **A separate domain** such as `bwenge4biz.com`: today the link is `bwenge.space/b/<name>`. A business sub-domain (`<name>.bwenge.space`) needs a wildcard DNS record.
* Staff accounts, orders and payment tracking, video conversion, page search on Google (pages are public, but not yet submitted to search engines), custom templates.
* Free storage is a promise of this server's disk: back it up like the rest of the data.
