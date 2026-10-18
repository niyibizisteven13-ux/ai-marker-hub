CREATE TABLE "AiTrace" (
    "id" TEXT NOT NULL,
    "userIdHash" TEXT NOT NULL,
    "chatIdHash" TEXT,
    "capability" TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL DEFAULT 'unversioned',
    "toolCalls" TEXT NOT NULL DEFAULT '[]',
    "retries" INTEGER NOT NULL DEFAULT 0,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "finalStatus" TEXT NOT NULL,
    "failureClass" TEXT,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiTrace_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiTrace_createdAt_idx" ON "AiTrace"("createdAt");
CREATE INDEX "AiTrace_capability_createdAt_idx" ON "AiTrace"("capability", "createdAt");
CREATE INDEX "AiTrace_finalStatus_createdAt_idx" ON "AiTrace"("finalStatus", "createdAt");
