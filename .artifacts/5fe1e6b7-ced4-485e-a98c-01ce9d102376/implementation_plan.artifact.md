# Implementation Plan - Bwengebot 4-Command Streamlining & Real Integration

Update Telegram bot (`bwengebot`) to feature exactly **4 core commands** corresponding to 4 core services of Bwenge ("Your grading companion"), configure the provided token in `.env`, and ensure full end-to-end operation.

## User Review Required

> [!IMPORTANT]
> - **Bot Token Integration**: We will add `TELEGRAM_BOT_TOKEN=8609031899:AAFNFwDf_2UzMZ1CS2xmyPLETAu2MPNMsW0` to `.env`.
> - **4 Core Services / Commands**:
>   1. `/grade` - Batch grade student exam papers against a rubric and return Excel report.
>   2. `/exam` - Generate complete exam papers and marking rubrics.
>   3. `/form` - Create online application/assessment forms with USSD integration.
>   4. `/research` - Perform deep web research and answer academic queries.
>   - (`/start` and `/help` will also be retained as introductory/help commands).

## Proposed Changes

### Configuration
#### [MODIFY] [.env](file:///C:/Users/niyib/Downloads/ai-marker-hub/.env)
- Add `TELEGRAM_BOT_TOKEN=8609031899:AAFNFwDf_2UzMZ1CS2xmyPLETAu2MPNMsW0` and `TELEGRAM_BOT_SECRET_TOKEN` if needed.

### Backend Bot Services & Routes
#### [MODIFY] [TelegramBotService.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server/services/TelegramBotService.ts)
- Update `registerCommands()` to register the 4 core service commands (`/grade`, `/exam`, `/form`, `/research`) plus `/start` and `/help`.
#### [MODIFY] [telegramBotRoutes.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server/routes/telegramBotRoutes.ts)
- Streamline command handling and keyboard options around the 4 core services: Grade, Exam, Form, and Research.
- Ensure all natural language triggers and tool handlers route seamlessly through GonkaRouter and the respective backend services.

## Verification Plan

### Automated Tests
- Verify TypeScript compilation across server files.
- Test bot command registration and webhook endpoint responsiveness.

### Manual Verification
- Verify `.env` has `TELEGRAM_BOT_TOKEN`.
- Send messages to `https://t.me/Bwengebot` to test `/grade`, `/exam`, `/form`, and `/research`.
