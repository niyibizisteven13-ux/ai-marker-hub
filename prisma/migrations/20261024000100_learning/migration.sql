-- Learning: Telegram learning mode, adaptive practice (skills and items), classes and members.
ALTER TABLE "TelegramSession" ADD COLUMN "learning" JSONB;

CREATE TABLE "LearnerSkill" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topicKey" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "mastery" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "level" INTEGER NOT NULL DEFAULT 2,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "correct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "misses" INTEGER NOT NULL DEFAULT 0,
    "brierSum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratedCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LearnerSkill_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LearnerSkill_userId_topicKey_key" ON "LearnerSkill"("userId", "topicKey");
CREATE INDEX "LearnerSkill_userId_lastSeenAt_idx" ON "LearnerSkill"("userId", "lastSeenAt");

CREATE TABLE "PracticeItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topicKey" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "choices" JSONB,
    "answer" TEXT NOT NULL,
    "acceptable" JSONB,
    "explanation" TEXT NOT NULL,
    "hints" JSONB,
    "misconceptions" JSONB,
    "foundation" BOOLEAN NOT NULL DEFAULT false,
    "hintsUsed" INTEGER NOT NULL DEFAULT 0,
    "response" TEXT,
    "confidence" INTEGER,
    "score" DOUBLE PRECISION,
    "misconception" TEXT,
    "feedback" TEXT,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PracticeItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PracticeItem_userId_topicKey_createdAt_idx" ON "PracticeItem"("userId", "topicKey", "createdAt");
CREATE INDEX "PracticeItem_topicKey_answeredAt_idx" ON "PracticeItem"("topicKey", "answeredAt");

CREATE TABLE "Classroom" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Classroom_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Classroom_code_key" ON "Classroom"("code");
CREATE INDEX "Classroom_ownerId_idx" ON "Classroom"("ownerId");

CREATE TABLE "ClassMember" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClassMember_classId_userId_key" ON "ClassMember"("classId", "userId");
CREATE INDEX "ClassMember_userId_idx" ON "ClassMember"("userId");
