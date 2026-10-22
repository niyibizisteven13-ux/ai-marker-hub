# Bwenge AI on Telegram

The bot is a second front end to the **same assistant as the web chat**:
- the same model routing (Claude Haiku when `AI_AGENT_PROVIDER=anthropic`);
- the same tools, file storage and security checks.

Only the presentation is Telegram-specific.

## Architecture

```
POST /api/telegram/webhook  (server/routes/telegramBotRoutes.ts: secret check, 200 at once)
  └─ server/services/telegram/router.ts
       ├─ setup: dedupe by update_id · per-chat rate limit · group etiquette
       ├─ new screens: /start /help /files /settings /new, inline buttons, quick actions on files
       ├─ LegacyHooks: batch grading, /scan, /transcribe, forms, status, quota, result discussion, account linking
       └─ agentBridge.ts: exam chat → generalAssist (same as web) → live progress → answer → files
  telegram/api.ts     typed Bot API client (HTML, 429 retry_after, photo/document, callbacks)
  telegram/format.ts  Markdown → Telegram HTML (headings, lists, tables, code, links), safe splitting
  telegram/ui.ts      design system: cards, keyboards, progress card, files list
  telegram/uiText.ts  every string in English, Kinyarwanda and French
```

## Design language

- **Cards:** emoji + **bold title**, a short body, and an *italic footer* for hints.
  - Telegram HTML is used throughout, so formatting never breaks.
  - Model answers are converted from Markdown.
  - Tables become aligned monospace blocks.
- **Home (/start):** a greeting by name, a capability list, and a 3×2 grid of inline buttons:
  - 📊 Charts & files, 📝 Mark exams, 📄 Transcribe, 🔎 Ask my library, 📁 My files, ⚙️ Settings.
  - Buttons edit the same message, so menus never flood the chat. Every sub-screen has ‹ Back.
- **One live progress message per request.**
  - It shows `⏳ Working on it`, then each tool step: "Creating chart: …" ⏳ → ✅ "Ready: … (XLSX, 7.4 KB)".
  - When the answer is ready, the progress message is edited into the answer, with 🔁 Regenerate · 📁 My files · 🏠 Menu.
- **Deliverables:**
  - Charts and diagrams arrive as photos (PNG preview).
  - Workbooks, documents, decks, PDFs and interactive HTML arrive as documents.
  - Each has a caption with type and size. Files are re-read and validated before sending.
- **Files sent by the user (PDF, Word, Excel, CSV, photos; albums are collected into one request):**
  - **With a caption:** the caption is the request, and the files go to the assistant, which can read and analyse them.
  - **Without a caption:** quick actions are offered. Summarise for every file; Chart + Excel and Statistics for
    tables; Transcribe and Mark as exam scripts for images and PDFs. The next typed message also uses those files.
- **My files (/files):** artifacts from the output engine, 6 per page. ⬇️ buttons send a file again; only the
  owner's files can be sent.
- **Settings:** language buttons (✓ marks the current one) and account-link status.
- **Command menu:** registered in all three languages.
- **Errors:** a friendly card with 🔁 Try again. No provider names, HTTP codes or stack traces.

## Behaviour

- **Conversation history:** the last 12 turns are stored on `TelegramSession.history`, which survives restarts.
  `/new` clears it.
- **One request at a time per chat.** Extra messages get a short "still working" note. Rate limit: 20 messages per
  minute per chat.
- **Groups:** the bot answers only commands, replies to the bot, and messages that @mention it.
- **Duplicates:** Telegram redeliveries (same `update_id`) are processed once.
- **File size:** bots can download at most 20 MB per file; larger files get a clear message.
- **Legacy flows are kept:**
  - Uploads are staged as papers/rubrics only after `/grade`, which turns batch mode on until grading starts.
  - `/markphoto` and `/transcribe` captions, the scanner, forms, `/status`, `/quota` and result discussion work as
    before.
  - Exam papers and research now go to the full assistant, which produces real Word/PDF files and sources.

## Configuration

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather. Without it the bot runs in mock mode (calls are logged, nothing is sent). |
| `TELEGRAM_BOT_SECRET_TOKEN` | Webhook secret, checked on every update (recommended). |
| `TELEGRAM_BOT_USERNAME` | Fallback username for @mention detection in groups (normally read from `getMe`). |
| `TELEGRAM_API_BASE` | Optional local Bot API server. |
| `APP_BASE_URL` | Public URL; the webhook is `APP_BASE_URL/api/telegram/webhook`. |
| `AI_AGENT_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `CLAUDE_AGENT_MODEL` | Run tool turns (files, charts, statistics) on Claude, as in the web chat. |

Deployment:
- Run `prisma migrate deploy`. It applies `20261023000100_telegram_history`, which adds `history` and `lastPrompt`
  to `TelegramSession`.
- On start, the server registers the webhook with `allowed_updates` = message, edited_message and callback_query.
  This is explicit because Telegram otherwise keeps an older setting that could drop button taps. The command menus
  are registered at the same time.

## Tests

`tests/telegram_bot.test.ts` runs the real webhook route against a local fake Bot API and a local fake Claude:
- formatter output and safe splitting;
- home and menus, including the language switch;
- the chart + Excel acceptance request (live steps, formatted answer, PNG photo, real `.xlsx` with the values);
- a CSV with quick actions, where the model reads the file;
- My files, including refusing another user's file;
- the error card, duplicate deliveries, and group etiquette.
