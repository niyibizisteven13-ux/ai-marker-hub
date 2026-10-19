CREATE TABLE "OrganizationUpgradeRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "faculty" TEXT,
    "estimatedSeats" INTEGER,
    "contactEmail" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationUpgradeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrganizationUpgradeRequest_status_createdAt_idx" ON "OrganizationUpgradeRequest"("status", "createdAt");
CREATE INDEX "OrganizationUpgradeRequest_userId_createdAt_idx" ON "OrganizationUpgradeRequest"("userId", "createdAt");

ALTER TABLE "OrganizationUpgradeRequest"
ADD CONSTRAINT "OrganizationUpgradeRequest_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
