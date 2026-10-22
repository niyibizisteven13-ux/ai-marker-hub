-- Telegram assistant: persisted conversation history and last request (for Regenerate).
ALTER TABLE "TelegramSession" ADD COLUMN "history" JSONB;
ALTER TABLE "TelegramSession" ADD COLUMN "lastPrompt" TEXT;
