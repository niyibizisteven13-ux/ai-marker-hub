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
the amount, the Mobile Money code and name, and an **I have paid** button that opens WhatsApp to the payment number with the plan and amount
written. The code, name and number are the ones in Admin → MySEB sales → payment settings (the same as the live room).
An administrator then activates the plan or adds credits in **Admin → Billing → Users** (`POST /api/admin/billing/users/:id/plan` and `/credits`).
When the MTN keys are added the page switches to the online prompt by itself.
