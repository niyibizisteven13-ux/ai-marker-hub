-- Form versions: immutable snapshots of form definitions; each response records the version it answered.
ALTER TABLE "FormSubmission" ADD COLUMN "formVersion" INTEGER;

CREATE TABLE "FormVersion" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FormVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FormVersion_formId_version_key" ON "FormVersion"("formId", "version");
CREATE INDEX "FormVersion_formId_createdAt_idx" ON "FormVersion"("formId", "createdAt");
