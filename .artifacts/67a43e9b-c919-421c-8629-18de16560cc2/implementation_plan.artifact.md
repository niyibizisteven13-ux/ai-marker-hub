# Implementation Plan - Universal Command Error Boundary

Add a robust command-level error boundary inside `handleBotCommand` in `server/routes/telegramBotRoutes.ts`. If any command handler throws an unhandled exception (network timeout, Prisma error, null pointer, etc.), the bot will guarantee a reply back to the teacher (in English or Kinyarwanda) rather than falling into silent silence.

## Proposed Changes

### [Telegram Bot Routes]

#### [MODIFY] [telegramBotRoutes.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server/routes/telegramBotRoutes.ts)
- Wrap `handleBotCommand` execution in a `try/catch` block.
- On any error, log the stack trace and send a polite error message back to `chatId` so the user is never left hanging with total silence.

## Verification Plan

### Automated Tests
- Run `npm run lint` (`tsc --noEmit`) to verify type safety.
