-- CreateTable
CREATE TABLE "GeneratedArtifact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "kind" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "rootId" TEXT,
    "parentId" TEXT,
    "spec" JSONB NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "fileId" TEXT,
    "previewFileId" TEXT,
    "sizeBytes" INTEGER,
    "sha256" TEXT,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "jobId" TEXT,
    "shareMode" TEXT NOT NULL DEFAULT 'private',
    "shareTokenHash" TEXT,
    "shareExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeneratedArtifact_userId_createdAt_idx" ON "GeneratedArtifact"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "GeneratedArtifact_rootId_idx" ON "GeneratedArtifact"("rootId");

-- CreateIndex
CREATE INDEX "GeneratedArtifact_shareTokenHash_idx" ON "GeneratedArtifact"("shareTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedArtifact_userId_idempotencyKey_key" ON "GeneratedArtifact"("userId", "idempotencyKey");

