DROP TABLE "Payment" CASCADE;
DROP TYPE "PaymentStatus";

CREATE TYPE "PaymentGateway" AS ENUM ('RAZORPAY');
CREATE TYPE "PaymentTargetType" AS ENUM ('APPLICATION', 'CERTIFICATE', 'PLAN');
CREATE TYPE "PaymentCategory" AS ENUM ('INITIAL', 'OBJECTION', 'ADDITIONAL', 'CORRECTION', 'PLAN');
CREATE TYPE "PaymentChargeStatus" AS ENUM ('OPEN', 'PAID', 'REFUNDED', 'CANCELLED');
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('CREATING', 'PENDING', 'AUTHORIZED', 'SUCCESS', 'FAILED', 'EXPIRED', 'DUPLICATE_SUCCESS');
CREATE TYPE "PaymentWebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED');
CREATE TYPE "PaymentRefundStatus" AS ENUM ('REQUESTED', 'PENDING', 'PROCESSED', 'FAILED');

ALTER TABLE "Application" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "CertificateRequest" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Plan" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "UserPlan" DROP COLUMN "paymentId";
ALTER TABLE "UserPlan" ADD COLUMN "paymentAttemptId" UUID;

CREATE TABLE "PaymentCharge" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "targetType" "PaymentTargetType" NOT NULL,
    "applicationId" UUID,
    "certificateRequestId" UUID,
    "planId" UUID,
    "sourceApplicationUpdateId" UUID,
    "sourceCertificateUpdateId" UUID,
    "category" "PaymentCategory" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "purpose" TEXT NOT NULL,
    "status" "PaymentChargeStatus" NOT NULL DEFAULT 'OPEN',
    "paidAttemptId" UUID,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentCharge_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentCharge_one_target" CHECK (num_nonnulls("applicationId", "certificateRequestId", "planId") = 1),
    CONSTRAINT "PaymentCharge_positive_amount" CHECK ("amountMinor" > 0),
    CONSTRAINT "PaymentCharge_target_matches_type" CHECK (
      ("targetType" = 'APPLICATION' AND "applicationId" IS NOT NULL) OR
      ("targetType" = 'CERTIFICATE' AND "certificateRequestId" IS NOT NULL) OR
      ("targetType" = 'PLAN' AND "planId" IS NOT NULL)
    )
);

CREATE TABLE "PaymentAttempt" (
    "id" UUID NOT NULL,
    "chargeId" UUID NOT NULL,
    "gateway" "PaymentGateway" NOT NULL DEFAULT 'RAZORPAY',
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATING',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "gatewayOrderId" TEXT,
    "gatewayPaymentId" TEXT,
    "paymentMethod" TEXT,
    "failureCode" TEXT,
    "failureDescription" TEXT,
    "gatewayResponse" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentAttempt_positive_amount" CHECK ("amountMinor" > 0)
);

CREATE TABLE "PaymentWebhookEvent" (
    "id" UUID NOT NULL,
    "eventKey" TEXT NOT NULL,
    "providerEventId" TEXT,
    "payloadDigest" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "gatewayOrderId" TEXT,
    "gatewayPaymentId" TEXT,
    "attemptId" UUID,
    "status" "PaymentWebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "failureReason" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentRefund" (
    "id" UUID NOT NULL,
    "chargeId" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "requestedBy" UUID NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentRefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "gatewayRefundId" TEXT,
    "gatewayResponse" JSONB,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentRefund_positive_amount" CHECK ("amountMinor" > 0)
);

CREATE TABLE "ScheduledJobLease" (
    "name" TEXT NOT NULL,
    "holderId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScheduledJobLease_pkey" PRIMARY KEY ("name")
);

CREATE UNIQUE INDEX "PaymentCharge_sourceApplicationUpdateId_key" ON "PaymentCharge"("sourceApplicationUpdateId");
CREATE UNIQUE INDEX "PaymentCharge_sourceCertificateUpdateId_key" ON "PaymentCharge"("sourceCertificateUpdateId");
CREATE UNIQUE INDEX "PaymentCharge_paidAttemptId_key" ON "PaymentCharge"("paidAttemptId");
CREATE INDEX "PaymentCharge_userId_createdAt_idx" ON "PaymentCharge"("userId", "createdAt");
CREATE INDEX "PaymentCharge_applicationId_idx" ON "PaymentCharge"("applicationId");
CREATE INDEX "PaymentCharge_certificateRequestId_idx" ON "PaymentCharge"("certificateRequestId");
CREATE INDEX "PaymentCharge_planId_idx" ON "PaymentCharge"("planId");
CREATE UNIQUE INDEX "PaymentAttempt_gatewayOrderId_key" ON "PaymentAttempt"("gatewayOrderId");
CREATE UNIQUE INDEX "PaymentAttempt_gatewayPaymentId_key" ON "PaymentAttempt"("gatewayPaymentId");
CREATE INDEX "PaymentAttempt_chargeId_status_idx" ON "PaymentAttempt"("chargeId", "status");
CREATE INDEX "PaymentAttempt_status_updatedAt_idx" ON "PaymentAttempt"("status", "updatedAt");
CREATE UNIQUE INDEX "PaymentAttempt_one_open_per_charge" ON "PaymentAttempt"("chargeId") WHERE "status" IN ('CREATING', 'PENDING', 'AUTHORIZED');
CREATE UNIQUE INDEX "PaymentWebhookEvent_eventKey_key" ON "PaymentWebhookEvent"("eventKey");
CREATE INDEX "PaymentWebhookEvent_providerEventId_idx" ON "PaymentWebhookEvent"("providerEventId");
CREATE INDEX "PaymentWebhookEvent_attemptId_idx" ON "PaymentWebhookEvent"("attemptId");
CREATE UNIQUE INDEX "PaymentRefund_attemptId_key" ON "PaymentRefund"("attemptId");
CREATE UNIQUE INDEX "PaymentRefund_gatewayRefundId_key" ON "PaymentRefund"("gatewayRefundId");
CREATE INDEX "PaymentRefund_chargeId_idx" ON "PaymentRefund"("chargeId");
CREATE INDEX "PaymentRefund_requestedBy_idx" ON "PaymentRefund"("requestedBy");
CREATE UNIQUE INDEX "UserPlan_paymentAttemptId_key" ON "UserPlan"("paymentAttemptId");

ALTER TABLE "PaymentCharge" ADD CONSTRAINT "PaymentCharge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentCharge" ADD CONSTRAINT "PaymentCharge_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentCharge" ADD CONSTRAINT "PaymentCharge_certificateRequestId_fkey" FOREIGN KEY ("certificateRequestId") REFERENCES "CertificateRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentCharge" ADD CONSTRAINT "PaymentCharge_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentCharge" ADD CONSTRAINT "PaymentCharge_sourceApplicationUpdateId_fkey" FOREIGN KEY ("sourceApplicationUpdateId") REFERENCES "ApplicationUpdate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentCharge" ADD CONSTRAINT "PaymentCharge_sourceCertificateUpdateId_fkey" FOREIGN KEY ("sourceCertificateUpdateId") REFERENCES "CertificateUpdate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "PaymentCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentCharge" ADD CONSTRAINT "PaymentCharge_paidAttemptId_fkey" FOREIGN KEY ("paidAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentWebhookEvent" ADD CONSTRAINT "PaymentWebhookEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PaymentAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "PaymentCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserPlan" ADD CONSTRAINT "UserPlan_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
