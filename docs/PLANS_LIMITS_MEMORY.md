# Plans, usage limits and memory

## Credits and default plans

Each credit represents up to $0.001 of modeled provider spend. The meter rounds up and counts at least one credit per AI action. Claude's reported usage is adjusted per call for caching, long Haiku 5.5 prompts, and web-search fees. Features without provider usage can charge a minimum estimate.

| Plan | RWF/month | Five hours | Day | Week | Month |
|---|---:|---:|---:|---:|---:|
| Free | 0 | 10 | 15 | 40 | 50 |
| Top-up | Pay as you go | 10 | 15 | 40 | 50 |
| Starter | 3,000 | 35 | 90 | 180 | 600 |
| Pro | 6,500 | 115 | 290 | 650 | 2,200 |
| Pro Plus | 10,000 | 190 | 475 | 1,050 | 3,600 |
| Institution | By arrangement | 190 | 475 | 1,050 | 3,600 |

Settings can override default prices and allowances. Existing invoices and wallet balances keep the values agreed at purchase. Version 2 settings matching the old defaults follow the new catalog. Other overrides carry forward.

## Enforcement

- Calendar days, Monday-to-Sunday weeks and calendar months follow Kigali time. Five-hour windows run continuously, and their next reset is shown in **Settings → Usage**.
- When a plan allowance runs low, the wallet can cover the remainder up to its own window caps. The wallet has at least 50 credits available per five-hour window and 200 per week, or the plan’s limit for each window if higher and the wallet has sufficient credit. Unspent credits stay in the wallet.
- The usage gate checks available credits before new actions. Known-cost form and quiz creation checks its minimum. Settlement records the provider spend and caps wallet debits in a serializable transaction. An action that is already running can cost more than its admission estimate.
- **Settings → Usage** shows plan and wallet meters, their reset times, daily feature caps, and recent activity.

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
