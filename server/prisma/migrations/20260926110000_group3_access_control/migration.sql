CREATE TYPE "AssetStatus" AS ENUM ('TEMPORARY', 'ATTACHED', 'DELETED');
CREATE TYPE "AssetContext" AS ENUM ('DOCUMENT', 'APPLICATION_UPDATE', 'CERTIFICATE_UPDATE');
CREATE TYPE "InvitationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "UploadedAsset" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "publicId" TEXT NOT NULL,
    "secureUrl" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'TEMPORARY',
    "context" "AssetContext",
    "referenceId" TEXT,
    "attachedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UploadedAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminInvitation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deliveryStatus" "InvitationDeliveryStatus" NOT NULL,
    "lastSentAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdminInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UploadedAsset_publicId_key" ON "UploadedAsset"("publicId");
CREATE INDEX "UploadedAsset_ownerId_status_idx" ON "UploadedAsset"("ownerId", "status");
CREATE INDEX "UploadedAsset_context_referenceId_idx" ON "UploadedAsset"("context", "referenceId");
CREATE UNIQUE INDEX "AdminInvitation_userId_key" ON "AdminInvitation"("userId");

ALTER TABLE "UploadedAsset" ADD CONSTRAINT "UploadedAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminInvitation" ADD CONSTRAINT "AdminInvitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User" ALTER COLUMN "phone" DROP NOT NULL;
