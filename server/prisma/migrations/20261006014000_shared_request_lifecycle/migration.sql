-- CreateEnum
CREATE TYPE "RequestCaseType" AS ENUM ('APPLICATION', 'CERTIFICATE');

-- CreateEnum
CREATE TYPE "RequestCaseStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'APPROVED', 'REJECTED', 'COMPLETED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CaseEventType" AS ENUM ('CASE_SUBMITTED', 'REVIEW_STARTED', 'DOCUMENTS_REQUESTED', 'DOCUMENTS_SUBMITTED', 'PAYMENT_REQUESTED', 'PAYMENT_CONFIRMED', 'USER_MESSAGE', 'ADMIN_MESSAGE', 'CASE_APPROVED', 'CASE_REJECTED', 'DELIVERABLE_ATTACHED', 'CASE_COMPLETED', 'CASE_CLOSED', 'REQUIREMENT_CANCELLED');

-- CreateEnum
CREATE TYPE "CaseRequirementType" AS ENUM ('DOCUMENT', 'PAYMENT');

-- CreateEnum
CREATE TYPE "CaseRequirementStatus" AS ENUM ('OPEN', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CaseAssetPurpose" AS ENUM ('REQUIREMENT_DOCUMENT', 'FINAL_DELIVERABLE');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL');

-- CreateEnum
CREATE TYPE "OutboxDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterEnum
ALTER TYPE "AssetContext" ADD VALUE 'CASE';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "caseEventId" UUID;

-- CreateTable
CREATE TABLE "RequestCase" (
    "id" UUID NOT NULL,
    "type" "RequestCaseType" NOT NULL,
    "ownerId" UUID NOT NULL,
    "applicationId" UUID,
    "certificateRequestId" UUID,
    "status" "RequestCaseStatus" NOT NULL DEFAULT 'SUBMITTED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestCase_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RequestCase_exactly_one_target_check" CHECK (
      ("type" = 'APPLICATION' AND "applicationId" IS NOT NULL AND "certificateRequestId" IS NULL)
      OR
      ("type" = 'CERTIFICATE' AND "certificateRequestId" IS NOT NULL AND "applicationId" IS NULL)
    )
);

-- CreateTable
CREATE TABLE "CaseEvent" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "actorId" UUID,
    "actorRoleSnapshot" "Role",
    "type" "CaseEventType" NOT NULL,
    "message" TEXT,
    "previousStatus" "RequestCaseStatus" NOT NULL,
    "newStatus" "RequestCaseStatus" NOT NULL,
    "metadata" JSONB,
    "requirementId" UUID,
    "paymentChargeId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseRequirement" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "type" "CaseRequirementType" NOT NULL,
    "status" "CaseRequirementStatus" NOT NULL DEFAULT 'OPEN',
    "createdBy" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "documentLabels" TEXT[],
    "dueAt" TIMESTAMP(3),
    "fulfilledBy" UUID,
    "fulfilledAt" TIMESTAMP(3),
    "cancelledBy" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "paymentChargeId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseRequirement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CaseRequirement_payment_link_check" CHECK (
      ("type" = 'PAYMENT' AND "paymentChargeId" IS NOT NULL)
      OR
      ("type" = 'DOCUMENT' AND "paymentChargeId" IS NULL)
    )
);

-- CreateTable
CREATE TABLE "CaseAsset" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "requirementId" UUID,
    "eventId" UUID,
    "purpose" "CaseAssetPurpose" NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "templateKey" TEXT NOT NULL,
    "status" "OutboxDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RequestCase_applicationId_key" ON "RequestCase"("applicationId");
CREATE UNIQUE INDEX "RequestCase_certificateRequestId_key" ON "RequestCase"("certificateRequestId");
CREATE INDEX "RequestCase_ownerId_createdAt_idx" ON "RequestCase"("ownerId", "createdAt");
CREATE INDEX "RequestCase_status_updatedAt_idx" ON "RequestCase"("status", "updatedAt");
CREATE INDEX "CaseEvent_caseId_createdAt_idx" ON "CaseEvent"("caseId", "createdAt");
CREATE INDEX "CaseEvent_requirementId_idx" ON "CaseEvent"("requirementId");
CREATE INDEX "CaseEvent_paymentChargeId_idx" ON "CaseEvent"("paymentChargeId");
CREATE UNIQUE INDEX "CaseEvent_caseId_idempotencyKey_key" ON "CaseEvent"("caseId", "idempotencyKey");
CREATE UNIQUE INDEX "CaseRequirement_paymentChargeId_key" ON "CaseRequirement"("paymentChargeId");
CREATE INDEX "CaseRequirement_caseId_status_idx" ON "CaseRequirement"("caseId", "status");
CREATE INDEX "CaseRequirement_createdBy_idx" ON "CaseRequirement"("createdBy");
CREATE INDEX "CaseRequirement_fulfilledBy_idx" ON "CaseRequirement"("fulfilledBy");
CREATE INDEX "CaseRequirement_cancelledBy_idx" ON "CaseRequirement"("cancelledBy");
CREATE UNIQUE INDEX "CaseAsset_assetId_key" ON "CaseAsset"("assetId");
CREATE INDEX "CaseAsset_caseId_purpose_idx" ON "CaseAsset"("caseId", "purpose");
CREATE INDEX "CaseAsset_requirementId_idx" ON "CaseAsset"("requirementId");
CREATE INDEX "CaseAsset_eventId_idx" ON "CaseAsset"("eventId");
CREATE INDEX "NotificationOutbox_status_availableAt_idx" ON "NotificationOutbox"("status", "availableAt");
CREATE INDEX "NotificationOutbox_caseId_createdAt_idx" ON "NotificationOutbox"("caseId", "createdAt");
CREATE INDEX "NotificationOutbox_recipientId_createdAt_idx" ON "NotificationOutbox"("recipientId", "createdAt");
CREATE UNIQUE INDEX "NotificationOutbox_eventId_recipientId_channel_templateKey_key" ON "NotificationOutbox"("eventId", "recipientId", "channel", "templateKey");
CREATE INDEX "Notification_caseEventId_idx" ON "Notification"("caseEventId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_caseEventId_fkey" FOREIGN KEY ("caseEventId") REFERENCES "CaseEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RequestCase" ADD CONSTRAINT "RequestCase_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RequestCase" ADD CONSTRAINT "RequestCase_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RequestCase" ADD CONSTRAINT "RequestCase_certificateRequestId_fkey" FOREIGN KEY ("certificateRequestId") REFERENCES "CertificateRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseEvent" ADD CONSTRAINT "CaseEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RequestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseEvent" ADD CONSTRAINT "CaseEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CaseEvent" ADD CONSTRAINT "CaseEvent_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "CaseRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseEvent" ADD CONSTRAINT "CaseEvent_paymentChargeId_fkey" FOREIGN KEY ("paymentChargeId") REFERENCES "PaymentCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseRequirement" ADD CONSTRAINT "CaseRequirement_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RequestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseRequirement" ADD CONSTRAINT "CaseRequirement_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseRequirement" ADD CONSTRAINT "CaseRequirement_fulfilledBy_fkey" FOREIGN KEY ("fulfilledBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseRequirement" ADD CONSTRAINT "CaseRequirement_cancelledBy_fkey" FOREIGN KEY ("cancelledBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseRequirement" ADD CONSTRAINT "CaseRequirement_paymentChargeId_fkey" FOREIGN KEY ("paymentChargeId") REFERENCES "PaymentCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseAsset" ADD CONSTRAINT "CaseAsset_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RequestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseAsset" ADD CONSTRAINT "CaseAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "UploadedAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseAsset" ADD CONSTRAINT "CaseAsset_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "CaseRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseAsset" ADD CONSTRAINT "CaseAsset_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CaseEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RequestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CaseEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
