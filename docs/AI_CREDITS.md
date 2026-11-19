# AI credits on every AI feature

All AI work spends from one balance (plan credits, then top-up credits), on the web and in Telegram. When a person is out of
credits the server answers **402 `UPGRADE_REQUIRED`** with the plan's message. `authFetch` turns that into one app-wide
"Upgrade to keep going" dialog (`src/components/UpgradeDialog.tsx`) with **See plans** and, when a payment number is set,
**Pay on WhatsApp**: a wa.me link to the same number the live room uses for payments (Admin → MySEB sales → payment settings).
There is no WhatsApp bot: people pay by Mobile Money and send the screenshot to that number.

| Feature | Meter | Price |
| --- | --- | --- |
| Chat, tools, files (existing) | real model cost | at least 1 credit |
| Quiz from an uploaded file | `artifact` | 6 credits |
| Form from a description | `artifact` | 3 credits |
| AI marking of written answers | `marking`, **the lecturer pays** | 1 credit per answer |
| Summary, translation | `tool` | 1 credit |
| Next-message suggestions | not charged, **paid plans only** | 0 |

* **Free plan:** 15 credits a day (40 a week, 50 a month), 1 file or form a day, **no AI marking**.
* A student's response is never blocked. If the lecturer has no credits, written answers stay **waiting** for the lecturer
  (or an upgrade); `POST /api/forms/:id/marks/ai` marks them later.
* Prices: `AI_PRICE` in `server/services/billing/aiMeter.ts`. Plan sizes and prices are edited by the admin (Billing).
* The admin pause switch and the profit guard still come first (`aiGuard.ts`).

## Paying by hand (until online Mobile Money is set up)

While the MTN keys are not set (`payments: "off"`), the Upgrade page opens a **Pay by Mobile Money** dialog instead of the MoMo prompt:
the amount, the Mobile Money code and name, the person's **payment code** (like `BW-4F7K2A`), and an **I have paid** button that opens WhatsApp to the
payment number with the plan, amount and payment code already written. The code, name and number are the ones in Admin → MySEB sales → payment settings (the same as the live room).
The administrator types the code into **Admin → Billing → Users** (search accepts a payment code as well as name or email), sees the person, and presses the plan
button (days are asked) or adds credits (`POST /api/admin/billing/users/:id/plan` and `/credits`). The code is worked out from the account id (`payRef`), so it never
changes and nothing is stored; it identifies an account to the administrator and opens nothing.
When the MTN keys are added the page switches to the online prompt by itself.

## Cost calibration (Admin → Billing → Cost calibration)

A credit is $0.001 of model cost, worked out from a built-in price table (USD per million tokens, by model family: haiku, sonnet, opus,
fable, other; see `tablePrice` in `server/services/billing/usage.ts`). If your provider's real prices differ, every credit, the profit guard
and every margin figure are off by the same factor, and nothing warns you. The calibration fixes that without a code change:

- **Match the invoice**: enter what the provider charged this month so far. The page compares it with the cost recorded for the month and
  offers the multiplier that makes new usage match (it replaces the current multiplier, it does not stack on it). Overhead the invoice
  includes (web searches, retries, failed calls) ends up in the multiplier, which is the point: it is the real cost per recorded credit.
- **Set by hand**: a multiplier (0.1–50) on all costs, and/or the real price per million tokens for one model family.
- A change applies to new usage within a minute (cached for 60 s on each server). Costs already recorded keep the figure they were recorded
  with, so a comparison for the month in which you change it is approximate; the page says so.
- A multiplier above 1 means each action uses more credits, so users reach their plan limits sooner. That is the correct effect when the
  table was too low; check the plans' credit sizes afterwards (Admin → Billing → Plans) and the profit guard's figures.

Check the multiplier once a month against the provider's invoice. API: `GET/PUT /api/admin/billing/cost-calibration`,
`POST /api/admin/billing/cost-calibration/reconcile` (`{ invoiceUsd, apply? }`).
