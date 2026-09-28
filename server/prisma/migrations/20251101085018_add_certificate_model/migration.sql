-- CreateEnum
CREATE TYPE "CertificateRequestStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CertificateUpdateType" AS ENUM ('USER_MESSAGE', 'ADMIN_MESSAGE', 'CERTIFICATE_PROVIDED', 'STATUS_CHANGE');

-- CreateTable
CREATE TABLE "CertificateRequest" (
    "id" UUID NOT NULL,
    "requestNo" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "status" "CertificateRequestStatus" NOT NULL DEFAULT 'PENDING',
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CertificateRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificateUpdate" (
    "id" UUID NOT NULL,
    "certificateRequestId" UUID NOT NULL,
    "updatedBy" UUID NOT NULL,
    "message" TEXT,
    "attachmentUrl" TEXT,
    "attachmentPublicId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updateType" "CertificateUpdateType" NOT NULL,

    CONSTRAINT "CertificateUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CertificateRequest_requestNo_key" ON "CertificateRequest"("requestNo");

-- AddForeignKey
ALTER TABLE "CertificateRequest" ADD CONSTRAINT "CertificateRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateUpdate" ADD CONSTRAINT "CertificateUpdate_certificateRequestId_fkey" FOREIGN KEY ("certificateRequestId") REFERENCES "CertificateRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateUpdate" ADD CONSTRAINT "CertificateUpdate_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
