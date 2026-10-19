CREATE TABLE "ResponseFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "question" TEXT,
    "response" TEXT NOT NULL,
    "reasons" TEXT NOT NULL DEFAULT '[]',
    "details" TEXT,
    "consentForImprovement" BOOLEAN NOT NULL DEFAULT false,
    "datasetExampleId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResponseFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResponseFeedback_userId_messageId_key" ON "ResponseFeedback"("userId", "messageId");
CREATE UNIQUE INDEX "ResponseFeedback_datasetExampleId_key" ON "ResponseFeedback"("datasetExampleId");
CREATE INDEX "ResponseFeedback_status_createdAt_idx" ON "ResponseFeedback"("status", "createdAt");

ALTER TABLE "ResponseFeedback"
ADD CONSTRAINT "ResponseFeedback_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ResponseFeedback"
ADD CONSTRAINT "ResponseFeedback_datasetExampleId_fkey"
FOREIGN KEY ("datasetExampleId") REFERENCES "DatasetExample"("id") ON DELETE SET NULL ON UPDATE CASCADE;
