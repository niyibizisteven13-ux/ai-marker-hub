-- Billing: Mobile Money payments, GO credit ledger, admin settings and a notification log.
CREATE TABLE "BillingPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "packId" TEXT,
    "months" INTEGER NOT NULL DEFAULT 0,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "amountRwf" INTEGER NOT NULL,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "provider" TEXT NOT NULL DEFAULT 'MTN_MOMO',
    "phoneMasked" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerStatus" TEXT,
    "providerReason" TEXT,
    "financialTransactionId" TEXT,
    "receiptNumber" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "checks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingPayment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BillingPayment_receiptNumber_key" ON "BillingPayment"("receiptNumber");
CREATE INDEX "BillingPayment_userId_createdAt_idx" ON "BillingPayment"("userId", "createdAt");
CREATE INDEX "BillingPayment_status_createdAt_idx" ON "BillingPayment"("status", "createdAt");

CREATE TABLE "CreditLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "paymentId" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditLedger_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CreditLedger_userId_createdAt_idx" ON "CreditLedger"("userId", "createdAt");

CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NotificationLog_key_key" ON "NotificationLog"("key");
