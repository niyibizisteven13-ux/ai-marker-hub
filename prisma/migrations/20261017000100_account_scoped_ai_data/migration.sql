ALTER TABLE "KnowledgeBase"
  ADD COLUMN "userId" TEXT,
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "globalApproved" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Document"
  ADD COLUMN "userId" TEXT,
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "globalApproved" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Dataset"
  ADD COLUMN "userId" TEXT,
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "globalApproved" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "DatasetExample"
  ADD COLUMN "consentGiven" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "piiReviewed" BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "User" WHERE "role" = 'ADMIN')
    AND (
      EXISTS (SELECT 1 FROM "KnowledgeBase")
      OR EXISTS (SELECT 1 FROM "Document")
      OR EXISTS (SELECT 1 FROM "Dataset")
    )
  THEN
    RAISE EXCEPTION 'Cannot assign legacy AI data ownership: create an ADMIN account before applying this migration.';
  END IF;
END $$;

UPDATE "DatasetExample"
SET "status" = 'pending'
WHERE "consentGiven" = false OR "piiReviewed" = false;

UPDATE "KnowledgeBase"
SET "userId" = (
  SELECT "id" FROM "User" WHERE "role" = 'ADMIN' ORDER BY "createdAt", "id" LIMIT 1
)
WHERE "userId" IS NULL;

UPDATE "Document" AS document
SET "userId" = COALESCE(
  (SELECT "userId" FROM "KnowledgeBase" WHERE "id" = document."knowledgeBaseId"),
  (SELECT "id" FROM "User" WHERE "role" = 'ADMIN' ORDER BY "createdAt", "id" LIMIT 1)
)
WHERE "userId" IS NULL;

UPDATE "Document" AS document
SET "organizationId" = (
  SELECT "organizationId" FROM "KnowledgeBase" WHERE "id" = document."knowledgeBaseId"
)
WHERE "organizationId" IS NULL;

UPDATE "Dataset"
SET "userId" = (
  SELECT "id" FROM "User" WHERE "role" = 'ADMIN' ORDER BY "createdAt", "id" LIMIT 1
)
WHERE "userId" IS NULL;

ALTER TABLE "FineTuneJob" RENAME COLUMN "fineTunedModelName" TO "adapterName";
ALTER TABLE "FineTuneJob" RENAME COLUMN "fineTunedModelId" TO "aiModelId";
UPDATE "AiModel"
SET "name" = 'dataset-adapter:' || substr("name", 4)
WHERE "name" LIKE 'ft:%';
UPDATE "FineTuneJob" SET "status" = 'BUILDING_ADAPTER' WHERE "status" = 'TRAINING';
UPDATE "FineTuneJob" SET "status" = 'ADAPTER_READY' WHERE "status" = 'COMPLETED';
UPDATE "AuditLog"
SET "action" = 'BUILD_DATASET_ADAPTER', "resourceType" = 'dataset_adapter'
WHERE "action" = 'CREATE_FINETUNE_JOB' OR "resourceType" = 'fine_tune_job';

CREATE INDEX "KnowledgeBase_userId_idx" ON "KnowledgeBase"("userId");
CREATE INDEX "KnowledgeBase_organizationId_idx" ON "KnowledgeBase"("organizationId");
CREATE INDEX "KnowledgeBase_globalApproved_idx" ON "KnowledgeBase"("globalApproved");
CREATE INDEX "Document_userId_idx" ON "Document"("userId");
CREATE INDEX "Document_organizationId_idx" ON "Document"("organizationId");
CREATE INDEX "Document_globalApproved_idx" ON "Document"("globalApproved");
CREATE INDEX "Dataset_userId_idx" ON "Dataset"("userId");
CREATE INDEX "Dataset_organizationId_idx" ON "Dataset"("organizationId");
CREATE INDEX "Dataset_globalApproved_idx" ON "Dataset"("globalApproved");

ALTER TABLE "KnowledgeBase"
  ADD CONSTRAINT "KnowledgeBase_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "KnowledgeBase_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Document_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Dataset"
  ADD CONSTRAINT "Dataset_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Dataset_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
