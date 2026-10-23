# Billing: plans, MTN Mobile Money, receipts and admin control

## What the user sees

- **Upgrade page** (`/upgrade`) shows four plans with prices in USD and Rwandan francs:
  - **Free**: a daily, weekly and monthly credit allowance.
  - **GO**: pay as you go. Credit packs from 500 RWF, used only after the free allowance runs out.
  - **PRO**: $3 a month (list price $9, shown struck through as a launch offer). You can pay for 1, 3, 6 or 12 months.
  - **Institution**: $50+. It opens the request form.
- **Checkout**:
  1. The user enters an MTN number.
  2. MTN sends an approval prompt to their phone.
  3. The page waits for the confirmation, then shows success or the reason it failed.
- **Sidebar status**: plan, credits left today, GO balance, renewal date, and "Payment pending" while a payment is open.
- **Settings → Billing**: plan, renewal date, GO credits, all payments, and a printable receipt for each.
- **Telegram** `/settings` and `/plan` show the same plan and credits. A user who links Telegram to their web account uses one account: credits, usage, memory and files from Telegram-only use move to the web account.

## Payment flow (server)

1. `POST /api/billing/checkout {purpose: PRO|INSTITUTION|GO_PACK, months | packId, phone}`.
   - The amount always comes from the server price list.
   - A second tap within 2 minutes reuses the open payment, so nobody is charged twice.
2. MTN `requesttopay` is called with `X-Reference-Id` set to our payment id (a UUID).
3. The status is confirmed **by asking MTN** (`GET requesttopay/{id}`). Three things trigger a check:
   - the MTN callback `PUT/POST /api/billing/momo/callback/:id` (its body is ignored);
   - the checkout page polling;
   - a background poller every 30 seconds.
4. On SUCCESSFUL the payment is fulfilled exactly once:
   - PRO / Institution time is extended by 30 days per month, added on top of the current end date if the plan is still active, or GO credits are added;
   - a receipt number `BW-YYYYMMDD-XXXXXX` is issued;
   - the receipt is sent by email and Telegram, once each.
5. FAILED, or no approval within 15 minutes, marks the payment FAILED or EXPIRED and sends a "payment not completed" email.
6. Every hour a renewal sweep:
   - sends reminders 3 days and 1 day before a plan ends;
   - sends a notice when the plan has ended, and the account returns to Free.

   Mobile Money cannot renew automatically.

## Setting up MTN MoMo

1. Create an account on the MTN MoMo developer portal and subscribe to the **Collections** product. Copy its primary key.
2. Sandbox:
   - Create an API user (a UUID you choose) with your callback host (for example `www.bwenge.space`).
   - Generate its API key.
   - Set `MOMO_TARGET_ENV=sandbox`. The sandbox only accepts EUR, and the currency is set automatically.
3. Production:
   - MTN Rwanda gives you the production base URL, the API user and API key (created through the partner portal), and the target environment (`mtnrwanda`).
   - Set `MOMO_CURRENCY=RWF` (this is the default outside the sandbox).
4. Put these values in the server environment (`/opt/nexus/.env` or the secret manager), **never in git or chat**:

```
MOMO_BASE_URL=            # sandbox: https://sandbox.momodeveloper.mtn.com, production: from MTN
MOMO_COLLECTION_PRIMARY_KEY=
MOMO_API_USER=
MOMO_API_KEY=
MOMO_TARGET_ENV=          # sandbox | mtnrwanda
MOMO_CURRENCY=            # optional; EUR in sandbox, RWF otherwise
MOMO_CALLBACK_HOST=https://www.bwenge.space
```

5. The callback URL is `https://<host>/api/billing/momo/callback/<paymentId>`. MTN only calls back to HTTPS hosts that are registered for the API user. Payments still complete without callbacks, because the poller asks MTN.
6. Development without MTN: `MOMO_SIMULATE=true`. This is refused when `NODE_ENV=production`.
   - The second status check succeeds.
   - Numbers ending in `0000` are declined.

Until the keys are set, checkout answers "Mobile Money payments are being set up". Nothing is ever marked paid without MTN's confirmation.

### Quick sandbox setup (one command)

With your sandbox **Collections** subscription key (momodeveloper.mtn.com → Profile → Subscriptions), run:

```
MOMO_COLLECTION_PRIMARY_KEY=<key> MOMO_CALLBACK_HOST=www.bwenge.space npm run momo:sandbox
```

It creates the sandbox API user and API key and prints the lines to put in the server environment. Restart the service, then open **Admin → Billing → Test MTN connection**.

The test checks three things:
- that the configuration is present;
- that MTN accepts the credentials (an access token);
- that the Collections account is reachable.

It never shows the keys.

### Go-live checklist (MTN Rwanda)

1. Test end to end in the sandbox. Sandbox test numbers (see MTN's sandbox docs) approve automatically, and the sandbox currency is EUR.
2. Apply to MTN Rwanda MoMo for production Collections access (KYC and business documents). MTN gives you:
   - the production base URL;
   - a production subscription key;
   - an API user and API key, created by MTN for your callback host;
   - the target environment, `mtnrwanda`.
3. Set these on the server:
   - `MOMO_BASE_URL`, `MOMO_COLLECTION_PRIMARY_KEY`, `MOMO_API_USER` and `MOMO_API_KEY`;
   - `MOMO_TARGET_ENV=mtnrwanda` and `MOMO_CURRENCY=RWF`;
   - `MOMO_CALLBACK_HOST=https://www.bwenge.space`;
   - `APP_BASE_URL=https://www.bwenge.space`, so receipts, Telegram buttons and chat links point to the site.
4. Restart, then run **Test MTN connection** in Admin → Billing. All three checks must be green.
5. Make one real small payment (a 500 RWF GO pack) with your own MTN number. Confirm that:
   - the credits arrive;
   - the receipt email arrives (SMTP configured);
   - the Telegram notice arrives.
6. Watch Admin → Billing → Payments for the first days. "Check" re-asks MTN for any payment stuck in PENDING.

Nothing in the code needs to change between sandbox and production; only the environment does.

## Email (SMTP)

Receipts and notices are sent through SMTP:

```
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=Bwenge AI <billing@your-domain>
SMTP_SECURE=false        # true for port 465
SMTP_REPLY_TO=           # optional
```

Without SMTP the emails are skipped and logged. Telegram notices still go out.

## Admin → Billing

- **Overview**: revenue, AI cost, margin, active plans, GO credits sold and used, and the MoMo mode (live / sandbox / simulated / off).
- **Prices**:
  - PRO price and list price, Institution price;
  - USD→RWF rate;
  - GO packs (RWF and credits);
  - daily, weekly and monthly credit limits per plan.

  Changes are stored in the database and apply within a minute, with no redeploy.
- **Users**: search, grant PRO or Institution for N days, return a user to Free, add or remove GO credits. Each change is recorded.
- **Payments**: filter by status and re-check a pending payment with MTN. An admin cannot mark a payment paid by hand.

## Deploying

```
npx prisma migrate deploy   # adds BillingPayment, CreditLedger, AppSetting, NotificationLog
sudo systemctl restart nexus
```

## Troubleshooting: request-to-pay returns 400 with an empty body

MTN answers a bare `400 Bad Request` with no body. That gives no reason, so the app avoids the known causes on its own:

- **Payer message and payee note:** these are sent as plain ASCII: letters, digits, spaces and `. , -`. Characters such as `·`, `:` or accents were refused.
- **Callback URL:** the `X-Callback-Url` header is only accepted for the callback host registered with the API user (`providerCallbackHost`). If MTN refuses a request that carries it, the app retries once without it and skips it for later payments, until the next restart. The callback is only a hint: payment status is always confirmed by asking MTN, and pending payments are checked every 30 s.
- **Sandbox numbers:** in the sandbox, use MTN's test numbers (for example `46733123456`). They are sent exactly as typed.

To see which part MTN refuses, run this on the server in the app directory:

```bash
cd /opt/nexus && sudo -u nexus npm run --silent momo:diagnose            # add a number to test it too: -- 0788123456
```

Each line is one request-to-pay with its HTTP status (`202 OK` = accepted). Nothing is charged in the sandbox, and no keys or tokens are printed.

## AI pause switch and profit guard

**Admin → Upgrades & Subscriptions → AI generation** shows this month's numbers:
- revenue against AI cost, with the margin;
- free users against paying users: how many, what they cost, and what each costs on average;
- conversion: the share of active users who pay;
- usage by platform (web and Telegram);
- the users who cost the most (emails masked).

The panel has two controls:

- **Pause AI now** stops every new AI action at once (chat, marking, Telegram, practice) for everyone except admins. Users see "Temporarily unavailable"; after a resume, "continue" finishes their request.
- **Profit guard** (on by default) checks the month's AI cost against revenue every minute and stops new AI actions by itself:
  - **Free users:** paused when they cost more than the monthly free budget (default $10). Paying users continue, and free users are offered GO credits or PRO.
  - **Everyone except admins:** only when the mode is "everyone" and total cost is above revenue plus the free budget.

"Paying" means an active PRO or Institution plan, GO credits bought, or a payment this month. Actions already running finish; only new ones are refused. The guard lives in `server/services/billing/aiGuard.ts`; every AI action passes through it in `checkUsage`.
