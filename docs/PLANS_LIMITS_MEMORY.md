# Plans, usage limits and memory

## Credits

- **What a credit is:** 1 credit = $0.001 of real AI model cost, and every action costs at least 1 credit.
- **How they're counted:** every reply is metered from its actual token usage, on the web and in Telegram. Each one is stored as a `UsageRecord` (migration `20261023000200_usage_records`).
- **Model prices:** set in `server/services/billing/usage.ts`. Claude Haiku 5.5 costs $0.10 / $0.50 per million tokens. Gonka rates come from `GONKA_PRICE_IN_PER_MTOK` / `GONKA_PRICE_OUT_PER_MTOK`; the defaults are deliberately conservative.

## Plans (`server/services/billing/plans.ts`)

| Plan | Price | Credits per day / week / month | Daily feature caps (tool · vision · files · marking) | Memory |
|---|---|---|---|---|
| Free | 0 | 20 / 80 / 250 | 5 · 5 · 2 · 3 | — |
| GO | packs from 500 RWF | 60 / 300 / 1,000 | 20 · 30 · 8 · 15 | — |
| PRO | ~~$9~~ $3/month (≈ 4,400 RWF) | 120 / 500 / 1,000 | 60 · 100 · 25 · 60 | 2,000 memories |
| Institution | $50+/month, 25 seats | 400 / 1,800 / 5,000 per member | 200 · 300 · 80 · 300 | 10,000 memories |

- **Message limits:** each plan also caps message length, attachments per message and upload size.
- **Which plan a user is on:** active subscriptions map to plans: `PRO` and `BUSINESS` → PRO, `ORGANIZATION` → Institution, `GO` → GO. Admins get Institution limits.
- **Time zone:** periods follow Kigali time. Days start at midnight, weeks on Monday, months on the 1st.
- **RWF prices:** `FX_USD_RWF` (default 1470) converts USD prices, rounded to the nearest 100 RWF.

## Enforcement

- **Before each reply:** the web chat (`/api/ai/chat`) and the Telegram assistant check the user's limits.
- **When a limit is reached:**
  - the web chat replies with a "Limit reached" message: when the credits renew, and an Upgrade link;
  - Telegram sends a card with an Upgrade button.
- **Settings → Usage** shows:
  - today, this week and this month;
  - the daily feature caps and the plan's limits;
  - recent activity.

## Memory across all chats (`server/services/MemoryService.ts`)

- **Availability:** PRO and Institution only. On Free and GO, Settings → Memory shows a locked switch and an Upgrade button with the price, and the API returns `402 UPGRADE_REQUIRED`.
- **What gets saved:**
  - things the user says to remember ("remember that…") or forget ("forget that…");
  - stated facts and preferences ("my name is…", "I teach…", "I prefer…");
  - a short note of each conversation;
  - anything the assistant saves with the `remember`, `recall_memory` and `forget_memory` tools.
- **Recall:** each reply gets the user's profile, plus the memories most relevant to the message, within a fixed size budget.
- **Never saved:** passwords, codes, card numbers or keys.
- **When full:** the oldest conversation notes are replaced first.
- **After a downgrade:** memories are kept but no longer used. Users can always view, edit and delete them.
- **API:** `GET/POST/DELETE /api/memory`, `PATCH /api/memory/settings`, `PATCH|DELETE /api/memory/:id`.

## Tests

- `tests/usage_memory.test.ts`
- The limits test in `tests/telegram_bot.test.ts`
